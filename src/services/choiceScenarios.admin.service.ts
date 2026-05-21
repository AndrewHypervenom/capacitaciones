import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import { CHOICE_SCENARIOS } from '@/data/choiceScenarios'

type ChoiceScenarioRow = Database['public']['Tables']['choice_scenarios']['Row']
type ChoiceScenarioInsert = Database['public']['Tables']['choice_scenarios']['Insert']
type ChoiceScenarioUpdate = Database['public']['Tables']['choice_scenarios']['Update']

export type { ChoiceScenarioRow }

export async function getAllChoiceScenariosAdmin(campaignId: string): Promise<ChoiceScenarioRow[]> {
  const { data, error } = await supabase
    .from('choice_scenarios')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at')
  if (error) throw error
  return data ?? []
}

export async function getChoiceScenarioAdmin(id: string): Promise<ChoiceScenarioRow> {
  const { data, error } = await supabase
    .from('choice_scenarios')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createChoiceScenario(scenario: ChoiceScenarioInsert): Promise<ChoiceScenarioRow> {
  const { data, error } = await supabase
    .from('choice_scenarios')
    .insert(scenario)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateChoiceScenario(id: string, updates: ChoiceScenarioUpdate): Promise<ChoiceScenarioRow> {
  const { data, error } = await supabase
    .from('choice_scenarios')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteChoiceScenario(id: string): Promise<void> {
  const { error } = await supabase.from('choice_scenarios').delete().eq('id', id)
  if (error) throw error
}

export async function toggleChoiceScenarioPublished(id: string, is_published: boolean): Promise<void> {
  const { error } = await supabase
    .from('choice_scenarios')
    .update({ is_published })
    .eq('id', id)
  if (error) throw error
}

/** Seed the hardcoded choice scenarios into the DB for a given campaign. */
export async function seedHardcodedChoiceScenarios(campaignId: string): Promise<number> {
  const slugs = CHOICE_SCENARIOS.map((s) => s.id)
  await supabase.from('choice_scenarios').delete().eq('campaign_id', campaignId).in('slug', slugs)

  const inserts: ChoiceScenarioInsert[] = CHOICE_SCENARIOS.map((s) => ({
    campaign_id: campaignId,
    slug: s.id,
    title_es: s.title.es,
    title_en: s.title.en ?? s.title.es,
    title_pt: s.title.pt ?? s.title.es,
    description: s.description.es,
    client_name: s.clientName,
    client_company: s.clientCompany.es,
    objective: s.objective.es,
    level: s.level,
    start_node_id: s.startId,
    nodes: s.nodes as unknown as ChoiceScenarioInsert['nodes'],
    is_published: true,
  }))

  const { data, error } = await supabase.from('choice_scenarios').insert(inserts).select('id')
  if (error) throw error
  return (data ?? []).length
}
