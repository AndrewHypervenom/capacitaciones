import { supabase } from '@/lib/supabase'
import type { ChoiceScenario } from '@/data/choiceScenarios'
import type { Json } from '@/types/database'
import type { SimUnlockMode } from './scenarios.service'

function dbRowToChoiceScenario(row: {
  id: string
  slug: string
  title_es: string
  description: string | null
  client_name: string | null
  client_company: string | null
  objective: string | null
  level: string
  start_node_id: string
  nodes: Json
}): ChoiceScenario {
  const t = (v: string | null) => ({ es: v ?? '', en: v ?? '', pt: v ?? '' })
  return {
    id: row.slug,
    title: t(row.title_es),
    description: t(row.description),
    clientName: row.client_name ?? '',
    clientCompany: t(row.client_company),
    objective: t(row.objective),
    startId: row.start_node_id,
    level: row.level as 'basico' | 'medio' | 'avanzado',
    nodes: row.nodes as unknown as ChoiceScenario['nodes'],
  }
}

/** Escenario de opción múltiple de un curso, con su ancla en el recorrido. */
export type CourseChoiceScenario = ChoiceScenario & {
  /** id real de la fila (el `id` del escenario es el slug). */
  rowId: string
  /** En qué punto del curso aparece; null = falta la migración (ver scenarios.service). */
  unlockMode: SimUnlockMode | null
  /** Módulo que lo abre cuando el modo es 'after_module'. */
  unlockModuleId: string | null
  passScore: number
}

/** Escenarios de opción múltiple publicados y ligados a un curso (con su umbral de aprobación). */
export async function getChoiceScenariosForCourse(
  courseId: string,
): Promise<CourseChoiceScenario[]> {
  const { data, error } = await supabase
    .from('choice_scenarios')
    .select('*')
    .eq('course_id', courseId)
    .eq('is_published', true)
    .order('created_at')

  if (error) throw error
  return (data ?? []).map((row) => ({
    ...dbRowToChoiceScenario(row),
    rowId: row.id,
    // Sin la migración estas columnas no vienen: se cae a la regla del curso.
    unlockMode: row.unlock_mode ?? null,
    unlockModuleId: row.unlock_module_id ?? null,
    passScore: row.pass_score,
  }))
}

/** Un escenario de opción múltiple publicado por slug (para el runner cuando no es estático). */
export async function getChoiceScenarioBySlug(slug: string): Promise<ChoiceScenario | null> {
  const { data, error } = await supabase
    .from('choice_scenarios')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw error
  return data?.[0] ? dbRowToChoiceScenario(data[0]) : null
}

export async function getAllChoiceScenariosForCampaign(campaignId: string) {
  const { data, error } = await supabase
    .from('choice_scenarios')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at')
  if (error) throw error
  return data ?? []
}
