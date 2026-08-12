import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import { requestDeletion, type DeletionResult } from '@/services/audit.service'

type ChoiceScenarioRow = Database['public']['Tables']['choice_scenarios']['Row']
type ChoiceScenarioInsert = Database['public']['Tables']['choice_scenarios']['Insert']
type ChoiceScenarioUpdate = Database['public']['Tables']['choice_scenarios']['Update']

export type { ChoiceScenarioRow }

export async function getAllChoiceScenariosAdmin(campaignId: string): Promise<ChoiceScenarioRow[]> {
  let query = supabase.from('choice_scenarios').select('*').order('created_at')
  // '' o '__all__' = todas las campañas (superadmin ve TODO; RLS decide).
  if (campaignId && campaignId !== '__all__') query = query.eq('campaign_id', campaignId)
  const { data, error } = await query
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

export async function deleteChoiceScenario(id: string): Promise<DeletionResult> {
  return requestDeletion('choice_scenarios', id)
}

export async function toggleChoiceScenarioPublished(id: string, is_published: boolean): Promise<void> {
  const { error } = await supabase
    .from('choice_scenarios')
    .update({ is_published })
    .eq('id', id)
  if (error) throw error
}

/** Simulación de opción múltiple compartida por otra campaña. */
export type ShareableChoiceScenario = ChoiceScenarioRow & { campaign_name: string | null }

/** Marca/desmarca la simulación como compartible con otros capacitadores. */
export async function setChoiceScenarioShareable(id: string, value: boolean): Promise<void> {
  const { error } = await supabase
    .from('choice_scenarios')
    .update({ is_shareable: value })
    .eq('id', id)
  if (error) throw error
}

/** Simulaciones de opción múltiple compartidas por OTRAS campañas. */
export async function getShareableChoiceScenarios(
  ownCampaignId: string,
): Promise<ShareableChoiceScenario[]> {
  const { data, error } = await supabase
    .from('choice_scenarios')
    .select('*, campaigns!choice_scenarios_campaign_id_fkey(name)')
    .eq('is_shareable', true)
    .eq('is_published', true)
    .neq('campaign_id', ownCampaignId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as (ChoiceScenarioRow & { campaigns: { name: string } | null })[])
    .map(({ campaigns, ...row }) => ({ ...row, campaign_name: campaigns?.name ?? null }))
}

/**
 * Copia una simulación de opción múltiple compartida a la campaña indicada.
 * RPC SECURITY DEFINER con la misma validación que `clone_scenario`.
 */
export async function cloneChoiceScenario(
  sourceId: string,
  targetCampaignId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('clone_choice_scenario', {
    p_scenario_id: sourceId,
    p_target_campaign_id: targetCampaignId,
  })
  if (error) throw error
  return data as string
}
