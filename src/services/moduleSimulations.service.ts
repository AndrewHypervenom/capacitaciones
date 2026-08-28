import { supabase } from '@/lib/supabase'
import type { Language } from '@/stores/userStore'
import { pickLang } from '@/lib/contentLang'

/**
 * Simulaciones que se abren al terminar UN módulo.
 *
 * La página del módulo no necesita el guion completo (nodos, checklist): solo
 * lo justo para celebrar el desbloqueo y ofrecer el enlace. Por eso se piden
 * las columnas contadas y no `select('*')` — esta consulta corre cada vez que
 * alguien abre un módulo.
 */

export interface UnlockedSimulation {
  /** Tipo de simulación: cambia la ruta y el icono. */
  kind: 'call' | 'choice'
  /** id de la fila (clave de React). */
  rowId: string
  /** Slug: es lo que va en la URL del simulador. */
  slug: string
  title: string
  summary: string
  passScore: number
  /** Solo en llamadas: 1 a 3 llamas de dificultad. */
  difficulty?: 1 | 2 | 3
  /** Solo en opción múltiple. */
  level?: 'basico' | 'medio' | 'avanzado'
}

/** Ruta del simulador para una simulación desbloqueada. */
export function simulationPath(sim: Pick<UnlockedSimulation, 'kind' | 'slug'>): string {
  return sim.kind === 'call' ? `/simulator/run/${sim.slug}` : `/simulator/choice/${sim.slug}`
}

const pick = (es: string | null, en: string | null, pt: string | null, lang: Language): string =>
  pickLang(es, en, pt, lang)

/**
 * ¿Es "esa columna no existe"? Mientras `2026-08-12_sim_after_module.sql` no se
 * corra, preguntar por `unlock_module_id` es un error 42703. No es motivo para
 * romper la página del módulo: se responde "ninguna" y la función queda muda
 * hasta que la migración exista.
 */
function isMissingUnlockColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const msg = error.message ?? ''
  return (
    (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST200') &&
    (msg.includes('unlock_module_id') || msg.includes('unlock_mode'))
  )
}

/**
 * Simulaciones publicadas ancladas a este módulo. `moduleId` es el UUID real
 * (module.dbId), no el slug: el ancla es una FK contra `modules.id`.
 */
export async function getSimulationsUnlockedByModule(
  moduleId: string,
  lang: Language,
): Promise<UnlockedSimulation[]> {
  if (!moduleId) return []

  const [calls, choices] = await Promise.all([
    supabase
      .from('scenarios')
      .select('id, slug, title_es, title_en, title_pt, summary_es, summary_en, summary_pt, difficulty, pass_score')
      .eq('unlock_module_id', moduleId)
      .eq('unlock_mode', 'after_module')
      .eq('is_published', true)
      .order('created_at'),
    supabase
      .from('choice_scenarios')
      .select('id, slug, title_es, title_en, title_pt, description, level, pass_score')
      .eq('unlock_module_id', moduleId)
      .eq('unlock_mode', 'after_module')
      .eq('is_published', true)
      .order('created_at'),
  ])

  for (const res of [calls, choices]) {
    if (res.error && !isMissingUnlockColumn(res.error)) {
      console.warn('[moduleSimulations]', res.error.message)
    }
  }

  const out: UnlockedSimulation[] = []
  for (const row of calls.data ?? []) {
    out.push({
      kind: 'call',
      rowId: row.id,
      slug: row.slug,
      title: pick(row.title_es, row.title_en, row.title_pt, lang),
      summary: pick(row.summary_es, row.summary_en, row.summary_pt, lang),
      passScore: row.pass_score ?? 70,
      difficulty: (row.difficulty as 1 | 2 | 3) ?? 2,
    })
  }
  for (const row of choices.data ?? []) {
    out.push({
      kind: 'choice',
      rowId: row.id,
      slug: row.slug,
      title: pick(row.title_es, row.title_en, row.title_pt, lang),
      // En opción múltiple la descripción es un solo texto (sin traducir).
      summary: row.description ?? '',
      passScore: row.pass_score ?? 70,
      level: row.level,
    })
  }
  return out
}
