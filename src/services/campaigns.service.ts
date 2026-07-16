import { supabase } from '@/lib/supabase'
import type { Campaign, CollaboratorProfile } from '@/types/database'

/**
 * Campañas que el usuario puede gestionar: su campaña "casa"
 * (profiles.campaign_id) más aquellas donde figura como colaborador. El
 * superadmin ve todas. La RLS ya acota, pero acotamos también en el cliente
 * para no traer de más.
 */
export async function getAccessibleCampaigns(opts: {
  isSuperAdmin: boolean
  homeCampaignId: string | null
  userId: string | null
}): Promise<Campaign[]> {
  const { isSuperAdmin, homeCampaignId, userId } = opts

  if (isSuperAdmin) {
    const { data, error } = await supabase.from('campaigns').select('*').order('created_at')
    if (error) throw error
    return (data ?? []) as Campaign[]
  }

  // Ids de campañas donde colabora. No-fatal: si la tabla aún no existe (SQL sin
  // correr) o la consulta falla, seguimos con solo la campaña casa.
  const collabIds: string[] = []
  if (userId) {
    const { data: collabs } = await supabase
      .from('campaign_collaborators')
      .select('campaign_id')
      .eq('user_id', userId)
      .then((r) => r, () => ({ data: [] as Array<{ campaign_id: string }> }))
    for (const row of collabs ?? []) collabIds.push((row as { campaign_id: string }).campaign_id)
  }

  const ids = Array.from(new Set([homeCampaignId, ...collabIds].filter(Boolean))) as string[]
  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .in('id', ids)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as Campaign[]
}

/** Colaboradores actuales de una campaña (perfil + email), sin el dueño casa. */
export async function getCampaignCollaborators(campaignId: string): Promise<CollaboratorProfile[]> {
  const { data: rows, error } = await supabase
    .from('campaign_collaborators')
    .select('user_id')
    .eq('campaign_id', campaignId)
  if (error) throw error
  const ids = (rows ?? []).map((r) => (r as { user_id: string }).user_id)
  if (ids.length === 0) return []

  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, display_name, job_title, avatar_url')
    .in('id', ids)
  if (pErr) throw pErr
  return (profiles ?? []).map((p) => ({
    id: (p as { id: string }).id,
    display_name: (p as { display_name: string | null }).display_name,
    email: null,
    job_title: (p as { job_title: string | null }).job_title,
    avatar_url: (p as { avatar_url: string | null }).avatar_url,
    is_collaborator: true,
  }))
}

/**
 * Busca capacitadores/superadmins candidatos a colaborar (con email y marca de
 * si ya colaboran). Usa el RPC SECURITY DEFINER search_campaign_candidates.
 */
export async function searchCampaignCandidates(
  campaignId: string,
  query: string,
  /** superadmin ve todos los usuarios; capacitador solo los corporativos. */
  includeAll = false,
): Promise<CollaboratorProfile[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('search_campaign_candidates', {
    p_campaign_id: campaignId,
    p_query: query.trim(),
  })
  if (error) throw error
  return ((data ?? []) as Array<{
    id: string
    display_name: string | null
    email: string | null
    job_title: string | null
    avatar_url: string | null
    is_collaborator: boolean
  }>)
    // Para el capacitador solo se muestran usuarios corporativos
    // (@positivosmais.com), así los usuarios de prueba no aparecen al compartir
    // campañas. El superadmin (includeAll) ve a todos. Se mantienen los que ya
    // son colaboradores aunque no tengan el dominio, para poder quitarlos.
    .filter((r) => includeAll || r.is_collaborator || isCorporateEmail(r.email))
    .map((r) => ({
      id: r.id,
      display_name: r.display_name,
      email: r.email,
      job_title: r.job_title,
      avatar_url: r.avatar_url,
      is_collaborator: r.is_collaborator,
    }))
}

/** Dominio corporativo. Solo estos usuarios pueden ser colaboradores de campañas. */
const CORPORATE_EMAIL_DOMAIN = '@positivosmais.com'

function isCorporateEmail(email: string | null): boolean {
  return !!email && email.trim().toLowerCase().endsWith(CORPORATE_EMAIL_DOMAIN)
}

/** Agrega un capacitador como colaborador de la campaña. */
export async function addCollaborator(
  campaignId: string,
  userId: string,
  addedBy: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('campaign_collaborators')
    .upsert({ campaign_id: campaignId, user_id: userId, added_by: addedBy })
  if (error) throw error
}

/** Quita un colaborador de la campaña. */
export async function removeCollaborator(campaignId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('campaign_collaborators')
    .delete()
    .eq('campaign_id', campaignId)
    .eq('user_id', userId)
  if (error) throw error
}
