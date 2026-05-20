import { supabase } from '@/lib/supabase'
import type { ChoiceScenario } from '@/data/choiceScenarios'
import type { Json } from '@/types/database'

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

export async function getChoiceScenariosForCampaign(campaignId: string): Promise<ChoiceScenario[]> {
  const { data, error } = await supabase
    .from('choice_scenarios')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_published', true)
    .order('created_at')

  if (error) throw error
  return (data ?? []).map(dbRowToChoiceScenario)
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
