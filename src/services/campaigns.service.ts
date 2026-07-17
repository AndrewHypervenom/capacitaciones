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

/**
 * Campañas de cada usuario (casa + colaboraciones), en una sola consulta.
 * Devuelve un mapa user_id → ids de campaña, ya deduplicado. La casa va
 * primero: /admin/users la marca como principal.
 */
export async function getCampaignIdsByUser(
  users: Array<{ id: string; campaign_id: string | null }>,
): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = {}
  for (const u of users) map[u.id] = u.campaign_id ? [u.campaign_id] : []

  const ids = users.map((u) => u.id)
  if (ids.length === 0) return map

  // No-fatal: si la tabla no existe todavía, cada usuario queda con su casa.
  const { data, error } = await supabase
    .from('campaign_collaborators')
    .select('user_id, campaign_id')
    .in('user_id', ids)
  if (error) return map

  for (const row of (data ?? []) as Array<{ user_id: string; campaign_id: string }>) {
    const current = map[row.user_id]
    if (current && !current.includes(row.campaign_id)) current.push(row.campaign_id)
  }
  return map
}

/**
 * Fija el conjunto exacto de campañas de un usuario (solo superadmin; la RLS lo
 * exige). La primera pasa a ser la casa (profiles.campaign_id) y el resto viven
 * en campaign_collaborators; las que no estén en `campaignIds` se quitan, que es
 * lo que hace que al quitar una campaña el capacitador deje de verla.
 *
 * Conserva la casa actual si sigue seleccionada, para no reescribirla sin
 * necesidad. Sin campañas, la casa queda en null: el panel se muestra vacío con
 * el aviso de "sin campañas asignadas" (ver AdminLayout).
 *
 * Devuelve la nueva casa para que quien llama actualice su estado local.
 */
export async function setUserCampaigns(
  userId: string,
  campaignIds: string[],
  currentHomeId: string | null,
): Promise<string | null> {
  const wanted = Array.from(new Set(campaignIds.filter(Boolean)))
  const home =
    currentHomeId && wanted.includes(currentHomeId) ? currentHomeId : wanted[0] ?? null

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ campaign_id: home })
    .eq('id', userId)
  if (profileError) throw profileError

  const collabIds = wanted.filter((id) => id !== home)

  // Quitar las colaboraciones que ya no aplican. `.in()` con lista vacía no
  // filtra nada en PostgREST, así que sin colaboraciones se borran todas.
  let del = supabase.from('campaign_collaborators').delete().eq('user_id', userId)
  if (collabIds.length > 0) del = del.not('campaign_id', 'in', `(${collabIds.join(',')})`)
  const { error: delError } = await del
  if (delError) throw delError

  if (collabIds.length > 0) {
    const { error: insError } = await supabase
      .from('campaign_collaborators')
      .upsert(
        collabIds.map((campaign_id) => ({ campaign_id, user_id: userId })),
        { onConflict: 'campaign_id,user_id' },
      )
    if (insError) throw insError
  }

  return home
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
