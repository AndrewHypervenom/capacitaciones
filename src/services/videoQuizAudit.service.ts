import { supabase } from '@/lib/supabase'
import { MIN_VIDEO_QUIZ_SECONDS } from '@/types/blocks'

/**
 * Auditoría de quizzes DENTRO de videos que quedaron demasiado al principio.
 *
 * Un marcador de quiz en 0:00 (o antes de MIN_VIDEO_QUIZ_SECONDS) NUNCA se
 * dispara: la detección es por cruce (prev < t && cur >= t) y el video arranca
 * en 0, así que el aprendiz se queda con el video bloqueado y sin pregunta.
 * `clampQuizTime` ya lo evita al crear/editar, pero el contenido viejo —o el
 * generado por IA antes de la guarda— puede seguir en 0:00. Antes de PUBLICAR
 * lo detectamos y bloqueamos la publicación: corregirlo es del capacitador,
 * porque un quiz de video no se puede saltar y mover su tiempo cambia el
 * recorrido del aprendiz.
 */

export interface EarlyVideoQuiz {
  moduleId: string
  moduleTitle: string
  sectionId: string
  sectionHeading: string
  /** 1-based, para mostrarlo como "Sección 3" cuando no hay título. */
  sectionNumber: number
  timeSeconds: number
}

interface AuditSectionRow {
  id: string
  module_id: string
  sort_order: number
  heading_es: string | null
  video_markers: unknown
  blocks_data: unknown
}

type QuizMarkerLike = { type: 'quiz'; timeSeconds: number }

function isEarlyQuizMarker(value: unknown): value is QuizMarkerLike {
  if (!value || typeof value !== 'object') return false
  const m = value as { type?: unknown; timeSeconds?: unknown }
  return m.type === 'quiz' && typeof m.timeSeconds === 'number' && m.timeSeconds < MIN_VIDEO_QUIZ_SECONDS
}

/**
 * Recorre a fondo `video_markers` / `blocks_data` (los marcadores viven tanto en
 * la sección de estilo `video-interactive` como dentro de cada bloque `video`, y
 * un bloque `video` puede estar anidado en columnas/pestañas).
 */
function walkQuizMarkers(node: unknown, visit: (marker: QuizMarkerLike) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => walkQuizMarkers(child, visit))
    return
  }
  if (!node || typeof node !== 'object') return
  if (isEarlyQuizMarker(node)) visit(node)
  Object.values(node as Record<string, unknown>).forEach((child) => walkQuizMarkers(child, visit))
}

/** Los segundos de cada quiz demasiado temprano de una sección. */
export function earlyQuizTimesInSection(section: {
  video_markers?: unknown
  blocks_data?: unknown
}): number[] {
  const times: number[] = []
  walkQuizMarkers(section.video_markers, (m) => times.push(m.timeSeconds))
  walkQuizMarkers(section.blocks_data, (m) => times.push(m.timeSeconds))
  return times
}

/**
 * Busca en la BD los quiz de video en 0:00 de uno o varios módulos.
 * Devuelve una entrada por quiz encontrado (puede haber varios por sección).
 */
export async function findEarlyVideoQuizzes(moduleIds: string[]): Promise<EarlyVideoQuiz[]> {
  const ids = moduleIds.filter(Boolean)
  if (ids.length === 0) return []

  const [{ data: sectionRows, error: secErr }, { data: moduleRows, error: modErr }] = await Promise.all([
    supabase
      .from('module_sections')
      .select('id, module_id, sort_order, heading_es, video_markers, blocks_data')
      .in('module_id', ids),
    supabase.from('modules').select('id, title_es').in('id', ids),
  ])
  if (secErr) throw secErr
  if (modErr) throw modErr

  const titles = new Map<string, string>(
    ((moduleRows ?? []) as { id: string; title_es: string | null }[]).map((m) => [m.id, m.title_es ?? '']),
  )

  const rows = ((sectionRows ?? []) as unknown as AuditSectionRow[])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)

  const found: EarlyVideoQuiz[] = []
  const seenPerModule = new Map<string, number>()
  for (const row of rows) {
    const n = (seenPerModule.get(row.module_id) ?? 0) + 1
    seenPerModule.set(row.module_id, n)
    for (const timeSeconds of earlyQuizTimesInSection(row)) {
      found.push({
        moduleId: row.module_id,
        moduleTitle: titles.get(row.module_id) ?? '',
        sectionId: row.id,
        sectionHeading: row.heading_es ?? '',
        sectionNumber: n,
        timeSeconds,
      })
    }
  }
  return found
}
