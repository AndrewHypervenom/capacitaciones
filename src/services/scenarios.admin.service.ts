import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import { requestDeletion, type DeletionResult } from '@/services/audit.service'

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

export async function deleteScenario(id: string): Promise<DeletionResult> {
  return requestDeletion('scenarios', id)
}

export async function toggleScenarioPublished(id: string, is_published: boolean): Promise<void> {
  const { error } = await supabase.from('scenarios').update({ is_published }).eq('id', id)
  if (error) throw error
}

/** Simulación compartida por otra campaña, con el nombre de su campaña de origen. */
export type ShareableScenario = ScenarioRow & { campaign_name: string | null }

/**
 * Marca/desmarca una simulación como compartible con otros capacitadores. Solo
 * aparece en el catálogo si además está publicada (lo exige la RLS
 * `scenarios_select_shared_catalog`).
 */
export async function setScenarioShareable(id: string, value: boolean): Promise<void> {
  const { error } = await supabase.from('scenarios').update({ is_shareable: value }).eq('id', id)
  if (error) throw error
}

/**
 * Simulaciones de llamada compartidas por OTRAS campañas. A diferencia de los
 * cursos (matrícula viva), aquí el capacitador se lleva una COPIA: la simulación
 * vive pegada a su campaña y a un curso suyo.
 */
export async function getShareableScenarios(ownCampaignId: string): Promise<ShareableScenario[]> {
  const { data, error } = await supabase
    .from('scenarios')
    .select('*, campaigns!scenarios_campaign_id_fkey(name)')
    .eq('is_shareable', true)
    .eq('is_published', true)
    .neq('campaign_id', ownCampaignId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as (ScenarioRow & { campaigns: { name: string } | null })[])
    .map(({ campaigns, ...row }) => ({ ...row, campaign_name: campaigns?.name ?? null }))
}

/** Autor de una simulación (llamada u opción múltiple). */
export interface SimulationAuthor {
  id: string | null
  name: string | null
  role: string | null
}

/**
 * Quién creó cada simulación, por id. Sirve para ambos tipos (llamada y opción
 * múltiple): el RPC busca en las dos tablas.
 *
 * Va por RPC SECURITY DEFINER porque el autor puede pertenecer a otra campaña
 * (una simulación copiada del catálogo compartido) y la RLS de `profiles` no
 * dejaría leer su nombre con un join normal.
 */
export async function getSimulationAuthors(ids: string[]): Promise<Map<string, SimulationAuthor>> {
  const map = new Map<string, SimulationAuthor>()
  if (ids.length === 0) return map
  const { data, error } = await supabase.rpc('get_simulation_authors', { p_ids: ids })
  if (error) throw error
  for (const row of data ?? []) {
    map.set(row.simulation_id, {
      id: row.author_id,
      name: row.author_name,
      role: row.author_role,
    })
  }
  return map
}

/**
 * Copia una simulación compartida a la campaña indicada (deep-copy de nodos y
 * checklist). El RPC `clone_scenario` corre con SECURITY DEFINER y valida
 * permisos server-side. La copia nace como borrador, sin curso y sin compartir.
 * Devuelve el id de la copia.
 */
export async function cloneScenario(sourceId: string, targetCampaignId: string): Promise<string> {
  const { data, error } = await supabase.rpc('clone_scenario', {
    p_scenario_id: sourceId,
    p_target_campaign_id: targetCampaignId,
  })
  if (error) throw error
  return data as string
}
