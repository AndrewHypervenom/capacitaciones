import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import { SCENARIOS } from '@/data/scenarios'

type ScenarioRow = Database['public']['Tables']['scenarios']['Row']
type ScenarioInsert = Database['public']['Tables']['scenarios']['Insert']
type ScenarioUpdate = Database['public']['Tables']['scenarios']['Update']

export type { ScenarioRow }

export async function getAllScenariosAdmin(campaignId: string): Promise<ScenarioRow[]> {
  const { data, error } = await supabase
    .from('scenarios')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at')
  if (error) throw error
  return data ?? []
}

export async function getScenarioAdmin(id: string): Promise<ScenarioRow> {
  const { data, error } = await supabase
    .from('scenarios')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createScenario(scenario: ScenarioInsert): Promise<ScenarioRow> {
  const { data, error } = await supabase
    .from('scenarios')
    .insert(scenario)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateScenario(id: string, updates: ScenarioUpdate): Promise<ScenarioRow> {
  const { data, error } = await supabase
    .from('scenarios')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteScenario(id: string): Promise<void> {
  const { error } = await supabase.from('scenarios').delete().eq('id', id)
  if (error) throw error
}

export async function toggleScenarioPublished(id: string, is_published: boolean): Promise<void> {
  const { error } = await supabase.from('scenarios').update({ is_published }).eq('id', id)
  if (error) throw error
}

/** Seed the hardcoded scenarios into the DB for a given campaign.
 *  Deletes existing rows for the same campaign+slug before reinserting. */
export async function seedHardcodedScenarios(campaignId: string): Promise<number> {
  const slugs = SCENARIOS.map((s) => s.id)

  // Remove existing to allow clean re-seed
  await supabase.from('scenarios').delete().eq('campaign_id', campaignId).in('slug', slugs)

  const inserts: ScenarioInsert[] = SCENARIOS.map((s) => ({
    campaign_id: campaignId,
    slug: s.id,
    country: s.country,
    difficulty: s.difficulty,
    title_es: s.title.es,
    title_en: s.title.en,
    title_pt: s.title.pt,
    summary_es: s.summary.es,
    summary_en: s.summary.en,
    summary_pt: s.summary.pt,
    customer_name: s.customer.name,
    customer_phone: s.customer.phone,
    customer_reason_es: s.customer.reason.es,
    customer_reason_en: s.customer.reason.en,
    customer_reason_pt: s.customer.reason.pt,
    avatar_seed: s.customer.avatarSeed,
    checklist_items: s.checklist as unknown as Database['public']['Tables']['scenarios']['Insert']['checklist_items'],
    empathy_keywords: s.empathyKeywords,
    max_turns: s.maxTurns,
    start_node_id: s.start,
    nodes: s.nodes as unknown as Database['public']['Tables']['scenarios']['Insert']['nodes'],
    is_published: true,
  }))

  const { data, error } = await supabase.from('scenarios').insert(inserts).select('id')
  if (error) throw error
  return (data ?? []).length
}
