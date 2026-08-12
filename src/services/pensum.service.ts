import { supabase } from '@/lib/supabase'
import { moduleAiAssist } from '@/services/ai.service'

/* ────────────────────────────────────────────────────────────────────────────
   Pénsum del certificado — lo que se publica en /verify/:certId

   La página que abre el QR del diploma responde "¿qué sabe esta persona?" con
   dos campos que ya existían en `modules` pero que nadie relacionaba con el
   certificado:

     · objectives_es    → "Aprendió a…"        (por módulo)
     · key_takeaways_es → "Ahora sabe hacer…"  (vitrina de competencias)

   Este servicio es el puente: los lee para el editor de curso, los redacta con
   IA cuando faltan y los vuelve a guardar. Trabaja SOLO en español: los otros
   dos idiomas los produce el flujo de traducción diferida que ya existe.
   ──────────────────────────────────────────────────────────────────────────── */

/** Un módulo del curso tal como lo edita el panel de pénsum del certificado. */
export interface PensumDraft {
  id: string
  icon: string | null
  duration_min: number
  title_es: string
  subtitle_es: string | null
  objectives_es: string[]
  takeaways_es: string[]
  /** Títulos de las secciones. Solo lectura: salen del contenido del módulo. */
  topics_es: string[]
  /** Extractos del cuerpo de cada sección; solo alimentan el prompt de IA. */
  excerpts: string[]
}

interface SectionRow {
  module_id: string
  sort_order: number
  heading_es: string | null
  body_es: string[] | null
}

/** Primeras palabras del cuerpo de una sección, para que la IA sepa de qué va. */
function excerpt(body: string[] | null, max = 220): string {
  const text = (body ?? []).join(' ').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * Los módulos del curso con lo que el certificado va a publicar de cada uno.
 * Devuelve [] si el curso no tiene módulos vivos (nunca revienta el editor).
 */
export async function loadCoursePensum(courseId: string): Promise<PensumDraft[]> {
  const { data: mods, error } = await supabase
    .from('modules')
    .select('id, icon, duration_min, course_sort_order, title_es, subtitle_es, objectives_es, key_takeaways_es, deleted_at')
    .eq('course_id', courseId)
    .order('course_sort_order')
  if (error) throw error

  // El borrado suave solo marca `deleted_at`: sin este filtro el pénsum listaría
  // módulos que ya nadie ve en el curso.
  const live = (mods ?? []).filter((m) => !m.deleted_at)
  if (live.length === 0) return []

  const ids = live.map((m) => m.id as string)
  const { data: secs } = await supabase
    .from('module_sections')
    .select('module_id, sort_order, heading_es, body_es')
    .in('module_id', ids)
    .order('sort_order')

  const byModule = new Map<string, SectionRow[]>()
  for (const s of (secs ?? []) as SectionRow[]) {
    const list = byModule.get(s.module_id) ?? []
    list.push(s)
    byModule.set(s.module_id, list)
  }

  return live.map((m) => {
    const sections = (byModule.get(m.id as string) ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
    return {
      id: m.id as string,
      icon: (m.icon as string | null) ?? null,
      duration_min: (m.duration_min as number) ?? 0,
      title_es: (m.title_es as string) ?? '',
      subtitle_es: (m.subtitle_es as string | null) ?? null,
      objectives_es: ((m.objectives_es as string[] | null) ?? []).filter((s) => !!s?.trim()),
      takeaways_es: ((m.key_takeaways_es as string[] | null) ?? []).filter((s) => !!s?.trim()),
      topics_es: sections.map((s) => s.heading_es ?? '').filter((s) => !!s.trim()),
      excerpts: sections.map((s) => excerpt(s.body_es)),
    }
  })
}

export interface PensumAiResult {
  objectives_es: string[]
  key_takeaways_es: string[]
}

/**
 * Redacta objetivos y conclusiones para los módulos indicados, en UNA llamada.
 *
 * Va todo junto a propósito: el modelo ve el curso completo y puede evitar que
 * dos módulos cierren con la misma idea — algo imposible de detectar si cada
 * módulo se pidiera por separado, y que en la vitrina de competencias se vería
 * como una lista con repeticiones.
 *
 * Devuelve un resultado por módulo, en el mismo orden. Si el modelo devolviera
 * menos, los faltantes salen vacíos y el capacitador los escribe a mano: es
 * preferible a desalinear los resultados con los módulos.
 */
export async function generatePensumWithAi(opts: {
  courseTitle: string
  modules: PensumDraft[]
}): Promise<PensumAiResult[]> {
  const { data } = await moduleAiAssist({
    action: 'pensum',
    contentType: 'meta',
    sourceLang: 'es',
    fields: {},
    moduleTitle: opts.courseTitle,
    pensum: {
      courseTitle: opts.courseTitle,
      modules: opts.modules.map((m) => ({
        title_es: m.title_es,
        subtitle_es: m.subtitle_es,
        objectives_es: m.objectives_es,
        key_takeaways_es: m.takeaways_es,
        sections: m.topics_es.map((h, i) => ({
          heading_es: h,
          excerpt_es: m.excerpts[i] ?? '',
        })),
      })),
    },
  })

  const rows = (data as { modules?: PensumAiResult[] })?.modules ?? []
  return opts.modules.map((_, i) => ({
    objectives_es: (rows[i]?.objectives_es ?? []).filter((s) => !!s?.trim()),
    key_takeaways_es: (rows[i]?.key_takeaways_es ?? []).filter((s) => !!s?.trim()),
  }))
}

/**
 * Guarda el pénsum de los módulos que cambiaron. Escribe solo los dos campos
 * en español: los idiomas restantes los llena el flujo de traducción, y
 * pisarlos aquí borraría traducciones ya revisadas.
 */
export async function savePensum(
  entries: Array<{ id: string; objectives_es: string[]; takeaways_es: string[] }>,
): Promise<void> {
  for (const e of entries) {
    const { error } = await supabase
      .from('modules')
      .update({
        objectives_es: e.objectives_es,
        key_takeaways_es: e.takeaways_es,
      })
      .eq('id', e.id)
    if (error) throw error
  }
}
