import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import { requestDeletion } from '@/services/audit.service'

type ScenarioRow = Database['public']['Tables']['scenarios']['Row']
type ScenarioInsert = Database['public']['Tables']['scenarios']['Insert']
type ScenarioUpdate = Database['public']['Tables']['scenarios']['Update']

export type { ScenarioRow }

export async function getAllScenariosAdmin(campaignId: string): Promise<ScenarioRow[]> {
  let query = supabase.from('scenarios').select('*').order('created_at')
  // '' o '__all__' = todas las campañas (superadmin ve TODO; RLS decide).
  if (campaignId && campaignId !== '__all__') query = query.eq('campaign_id', campaignId)
  const { data, error } = await query
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

export async function deleteScenario(id: string): Promise<'deleted' | 'pending'> {
  return requestDeletion('scenarios', id)
}

export async function toggleScenarioPublished(id: string, is_published: boolean): Promise<void> {
  const { error } = await supabase.from('scenarios').update({ is_published }).eq('id', id)
  if (error) throw error
}
