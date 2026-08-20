import { supabase } from '@/lib/supabase'
import { shouldHideTestData } from '@/stores/testModeStore'
import type { Campaign, CollaboratorProfile } from '@/types/database'

/* ─── Campañas de prueba ──────────────────────────────────────────────────
 *
 * Una campaña `is_test` es un entorno de pruebas: su gente, su contenido y su
 * progreso no deben mezclarse con lo real. Aquí viven las tres reglas:
 *   1. al superadmin se le esconden salvo que encienda el Modo pruebas;
 *   2. al capacitador solo le llegan si se las asignaron (eso ya lo hace el
 *      conjunto casa + colaboraciones, y el trigger de all_campaigns dejó de
 *      meterlo en las de prueba);
 *   3. nadie puede quedar con un pie en cada mundo (`assertSameTestScope`).
 *
 * `is_test` puede no existir todavía en la base (SQL sin correr): en ese caso
 * la columna llega `undefined`, todo cuenta como "no es de prueba" y el panel
 * se comporta exactamente como antes.
 */

/** ¿La campaña está marcada como entorno de pruebas? */
export function isTestCampaign(c: { is_test?: boolean | null } | null | undefined): boolean {
  return c?.is_test === true
}

/** Ids de las campañas de prueba, para excluirlas de consultas y reportes. */
let testIdsCache: Promise<string[]> | null = null

export async function getTestCampaignIds(): Promise<string[]> {
  if (!testIdsCache) {
    testIdsCache = (async () => {
      try {
        const { data, error } = await supabase.from('campaigns').select('id').eq('is_test', true)
        // Un error aquí (columna sin crear, RLS) no puede tumbar la pantalla:
        // sin campañas de prueba el panel se comporta como siempre.
        if (error) return []
        return (data ?? []).map((r) => (r as { id: string }).id)
      } catch {
        return []
      }
    })()
  }
  return testIdsCache
}

/** Tras marcar/desmarcar una campaña hay que volver a preguntar. */
export function invalidateTestCampaigns(): void {
  testIdsCache = null
}

/** Marca (o desmarca) una campaña como entorno de pruebas. Solo superadmin. */
export async function setCampaignTest(campaignId: string, isTest: boolean): Promise<void> {
  const { error } = await supabase
    .from('campaigns')
    .update({ is_test: isTest })
    .eq('id', campaignId)
  if (error) throw error
  invalidateTestCampaigns()
}

/**
 * Error de mezcla de mundos: lo real y lo de prueba no se cruzan. Lo lanzan
 * los guardas del cliente y también los triggers de la base, que responden con
 * el mismo texto `TEST_SCOPE_MISMATCH` para poder reconocerlo.
 */
export class TestScopeError extends Error {
  constructor(message = 'TEST_SCOPE_MISMATCH') {
    super(message)
    this.name = 'TestScopeError'
  }
}

/** ¿El mensaje de error viene de un guarda de entorno de pruebas? */
export function isTestScopeError(err: unknown): boolean {
  if (err instanceof TestScopeError) return true
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return msg.includes('TEST_SCOPE_MISMATCH')
}

/**
 * Exige que un conjunto de campañas sea todo de prueba o todo real. Se usa al
 * asignarle campañas a una persona: con un pie en cada mundo, su progreso de
 * pruebas acabaría en los reportes de verdad.
 */
export async function assertSameTestScope(campaignIds: string[]): Promise<void> {
  if (campaignIds.length < 2) return
  const testIds = new Set(await getTestCampaignIds())
  const hasTest = campaignIds.some((id) => testIds.has(id))
  const hasReal = campaignIds.some((id) => !testIds.has(id))
  if (hasTest && hasReal) throw new TestScopeError()
}

/**
 * Quita de una lista de personas a las del entorno de pruebas (las de una
 * campaña `is_test`), salvo que el Modo pruebas esté encendido. Se usa donde el
 * superadmin lee perfiles sin acotar por campaña (p. ej. /admin/users).
 */
export async function withoutTestPeople<T extends { campaign_id: string | null }>(
  rows: T[],
  isSuperAdmin: boolean,
): Promise<T[]> {
  if (!shouldHideTestData(isSuperAdmin)) return rows
  const testIds = new Set(await getTestCampaignIds())
  if (testIds.size === 0) return rows
  return rows.filter((r) => !r.campaign_id || !testIds.has(r.campaign_id))
}

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
  /**
   * Traer también las campañas de prueba aunque el Modo pruebas esté apagado,
   * para esconderlas al pintar en vez de al consultar. Solo tiene sentido en
   * /admin/campaigns, que es donde se PONE la marca: ahí encender el modo debe
   * revelar en el acto las que ya estaban marcadas, sin recargar y sin
   * tragarse lo que haya sin guardar. En el resto del panel va apagado, que es
   * lo correcto: lo de prueba ni se pide.
   */
  includeTest?: boolean
}): Promise<Campaign[]> {
  const { isSuperAdmin, homeCampaignId, userId, includeTest } = opts

  if (isSuperAdmin) {
    const { data, error } = await supabase.from('campaigns').select('*').order('created_at')
    if (error) throw error
    const all = (data ?? []) as Campaign[]
    // Con el Modo pruebas apagado, para el superadmin las campañas de prueba
    // sencillamente no existen: ni en selectores ni en conteos.
    return shouldHideTestData(true) && !includeTest ? all.filter((c) => !isTestCampaign(c)) : all
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
 * Campañas a las que se puede ASIGNAR una persona al darla de alta.
 *
 * Ojo: no es lo mismo que `getAccessibleCampaigns`. Gestionar contenido sigue
 * acotado a las campañas propias, pero al crear un usuario el capacitador
 * habilitado (`profiles.can_create_learners`) puede mandarlo a cualquier
 * campaña: quien da de alta suele ser quien recibe el reporte de Talento
 * Humano, y la gente nueva no siempre cae en sus campañas.
 *
 * La RLS de `campaigns` solo deja ver las propias, así que la lista completa
 * llega por el RPC SECURITY DEFINER `get_assignable_campaigns`, que valida el
 * permiso en la base (id, nombre y poco más: nada sensible).
 *
 * No es fatal: si el SQL todavía no se corrió, se cae a las campañas propias y
 * el selector se comporta como antes.
 */
export async function getAssignableCampaigns(opts: {
  isSuperAdmin: boolean
  homeCampaignId: string | null
  userId: string | null
}): Promise<Campaign[]> {
  if (opts.isSuperAdmin) return getAccessibleCampaigns(opts)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('get_assignable_campaigns')
  if (error) {
    // 42883/PGRST202 = la función aún no existe (SQL pendiente).
    if (error.code !== '42883' && error.code !== 'PGRST202') {
      console.warn('[campaigns] get_assignable_campaigns', error.message)
    }
    return getAccessibleCampaigns(opts)
  }
  const rows = (data ?? []) as Campaign[]
  // Sin permiso el RPC devuelve vacío: en ese caso vale lo de siempre.
  if (rows.length === 0) return getAccessibleCampaigns(opts)

  // El RPC devuelve TODAS las campañas (por eso existe), así que aquí se acota
  // al mundo de quien pregunta: el capacitador de prueba da de alta solo en
  // campañas de prueba y el real solo en las reales. Sin esto, dar de alta
  // sería la puerta trasera para meter gente real al entorno de pruebas.
  const own = await getAccessibleCampaigns(opts)
  const viewerIsTest = own.length > 0 && own.every(isTestCampaign)
  // Dos señales porque ninguna basta sola: la marca viene en la fila si el RPC
  // devuelve la columna, y la lista de ids solo la puede leer quien tenga
  // visibilidad sobre esas campañas (la RLS acota a un capacitador real).
  const testIds = new Set(await getTestCampaignIds())
  const rowIsTest = (c: Campaign) => isTestCampaign(c) || testIds.has(c.id)
  return rows.filter((c) => rowIsTest(c) === viewerIsTest)
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
  // Nadie con un pie en cada mundo: o todo prueba o todo real.
  await assertSameTestScope(wanted)
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
