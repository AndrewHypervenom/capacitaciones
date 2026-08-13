import { supabase } from '@/lib/supabase'
import type { Scenario } from '@/data/scenarios'
import type { Json } from '@/types/database'

function dbRowToScenario(row: {
  id: string
  slug: string
  country: 'CO' | 'MX' | 'AR'
  difficulty: number
  title_es: string
  title_en: string | null
  title_pt: string | null
  summary_es: string | null
  summary_en: string | null
  summary_pt: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_reason_es: string | null
  customer_reason_en: string | null
  customer_reason_pt: string | null
  avatar_seed: number | null
  checklist_items: Json
  empathy_keywords: string[] | null
  max_turns: number | null
  start_node_id: string
  nodes: Json
}): Scenario {
  return {
    id: row.slug,
    country: row.country,
    difficulty: row.difficulty as 1 | 2 | 3,
    title: {
      es: row.title_es,
      en: row.title_en ?? row.title_es,
      pt: row.title_pt ?? row.title_es,
    },
    summary: {
      es: row.summary_es ?? '',
      en: row.summary_en ?? row.summary_es ?? '',
      pt: row.summary_pt ?? row.summary_es ?? '',
    },
    customer: {
      name: row.customer_name ?? '',
      phone: row.customer_phone ?? '',
      reason: {
        es: row.customer_reason_es ?? '',
        en: row.customer_reason_en ?? row.customer_reason_es ?? '',
        pt: row.customer_reason_pt ?? row.customer_reason_es ?? '',
      },
      avatarSeed: row.avatar_seed ?? 1,
    },
    checklist: (row.checklist_items as unknown[]) as Scenario['checklist'],
    empathyKeywords: row.empathy_keywords ?? [],
    maxTurns: row.max_turns ?? 10,
    start: row.start_node_id,
    nodes: row.nodes as unknown as Scenario['nodes'],
  }
}

export async function getScenariosForCampaign(campaignId: string): Promise<Scenario[]> {
  const { data, error } = await supabase
    .from('scenarios')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_published', true)
    .order('created_at')

  if (error) throw error
  return (data ?? []).map(dbRowToScenario)
}

export async function getAllScenariosForCampaign(campaignId: string) {
  const { data, error } = await supabase
    .from('scenarios')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at')
  if (error) throw error
  return data ?? []
}

/**
 * Un escenario publicado por su slug, sin depender de la campaña del usuario.
 * Lo usa SimulatorRun como respaldo: el staff sin campaña (superadmin) y los
 * aprendices cross-campaña no encuentran el escenario en useScenarios (que
 * solo trae los de SU campaña) y quedaban en "Cargando…" infinito.
 */
export async function getScenarioBySlug(slug: string): Promise<Scenario | null> {
  const { data, error } = await supabase
    .from('scenarios')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .order('created_at')
    .limit(1)
  if (error) throw error
  return data && data.length > 0 ? dbRowToScenario(data[0]) : null
}

/**
 * Escenario de un curso con lo que el recorrido necesita para COLOCARLO: el
 * módulo que lo abre y su umbral de aprobación.
 */
export type CourseScenario = Scenario & {
  /** id real de la fila (el `id` del escenario es el slug). */
  rowId: string
  /**
   * En qué punto del curso aparece. `null` significa que la columna todavía no
   * existe (falta correr 2026-08-12_sim_after_module.sql): quien lo lea debe
   * caer a la regla vieja del curso, no inventarse un punto.
   */
  unlockMode: SimUnlockMode | null
  /** Módulo que lo abre cuando el modo es 'after_module'. */
  unlockModuleId: string | null
  passScore: number
}

/** Los tres puntos posibles del recorrido. */
export type SimUnlockMode = 'from_start' | 'after_module' | 'after_all'

/** Escenarios publicados que pertenecen a un curso (para el bloque del aprendiz). */
export async function getScenariosForCourse(courseId: string): Promise<CourseScenario[]> {
  const { data, error } = await supabase
    .from('scenarios')
    .select('*')
    .eq('course_id', courseId)
    .eq('is_published', true)
    .order('created_at')
  if (error) throw error
  return (data ?? []).map((row) => ({
    ...dbRowToScenario(row),
    rowId: row.id,
    // `?? null` y no `!`: si la migración todavía no se corrió, estas columnas
    // no vienen en la fila y la página cae a la regla vieja del curso.
    unlockMode: row.unlock_mode ?? null,
    unlockModuleId: row.unlock_module_id ?? null,
    passScore: row.pass_score ?? 70,
  }))
}
