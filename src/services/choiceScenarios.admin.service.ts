import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import { requestDeletion } from '@/services/audit.service'

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

export async function deleteChoiceScenario(id: string): Promise<'deleted' | 'pending'> {
  return requestDeletion('choice_scenarios', id)
}

export async function toggleChoiceScenarioPublished(id: string, is_published: boolean): Promise<void> {
  const { error } = await supabase
    .from('choice_scenarios')
    .update({ is_published })
    .eq('id', id)
  if (error) throw error
}
