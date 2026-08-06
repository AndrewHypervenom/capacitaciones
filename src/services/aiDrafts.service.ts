import { supabase } from '@/lib/supabase'
import type { GeneratedScenario } from '@/services/ai.service'

// La tabla ai_scenario_drafts aún no está en los tipos generados de la BD; se
// accede sin tipar hasta regenerarlos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = () => (supabase as any).from('ai_scenario_drafts')

export type DraftType = 'dialogue' | 'choice'
export type DraftMode = 'generate' | 'improve' | 'translate' | 'edit'

export interface AiScenarioDraft {
  id: string
  type: DraftType
  mode: DraftMode
  title: string
  returnPath: string
  runKey: string
  campaignId: string | null
  payload: GeneratedScenario
  createdAt: string
}

export interface SaveDraftInput {
  runKey: string
  returnPath: string
  type: DraftType
  mode: DraftMode
  title: string
  campaignId?: string | null
  payload: GeneratedScenario
}

interface DraftRow {
  id: string
  type: DraftType
  mode: DraftMode
  title: string | null
  return_path: string
  run_key: string
  campaign_id: string | null
  payload: GeneratedScenario
  created_at: string
}

function toDraft(row: DraftRow): AiScenarioDraft {
  return {
    id: row.id,
    type: row.type,
    mode: row.mode,
    title: row.title ?? '',
    returnPath: row.return_path,
    runKey: row.run_key,
    campaignId: row.campaign_id,
    payload: row.payload,
    createdAt: row.created_at,
  }
}

/**
 * Guarda (o reemplaza) el borrador de una corrida. Se hace apenas la IA termina,
 * ANTES de que nadie lo cargue en el editor: a partir de aquí el escenario ya no
 * depende de que este navegador siga vivo.
 *
 * El upsert va por (created_by, run_key): "Regenerar" en el mismo editor pisa su
 * propio borrador en vez de dejar un rastro de intentos abandonados.
 */
export async function saveAiDraft(input: SaveDraftInput): Promise<AiScenarioDraft> {
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth.user?.id
  if (!userId) throw new Error('No hay sesión para guardar el borrador')

  const { data, error } = await table()
    .upsert(
      {
        created_by: userId,
        campaign_id: input.campaignId || null,
        type: input.type,
        mode: input.mode,
        title: input.title.slice(0, 200),
        return_path: input.returnPath,
        run_key: input.runKey,
        payload: input.payload,
      },
      { onConflict: 'created_by,run_key' },
    )
    .select()
    .single()
  if (error) throw error
  return toDraft(data as DraftRow)
}

/** Borradores propios, del más reciente al más viejo. */
export async function listAiDrafts(): Promise<AiScenarioDraft[]> {
  const { data, error } = await table().select('*').order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as DraftRow[]).map(toDraft)
}

/** Se llama al cargar el borrador en el editor o al descartarlo a propósito. */
export async function deleteAiDraft(id: string): Promise<void> {
  const { error } = await table().delete().eq('id', id)
  if (error) throw error
}

/** Borra el borrador de una corrida sin conocer su id (al aplicar desde el editor). */
export async function deleteAiDraftByRunKey(runKey: string): Promise<void> {
  const { error } = await table().delete().eq('run_key', runKey)
  if (error) throw error
}
