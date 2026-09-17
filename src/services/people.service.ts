import { supabase } from '@/lib/supabase'
import { chunk } from '@/lib/chunk'
import { fold } from '@/lib/normalize'
import { getMyPeopleIds, getTestUnitIds } from '@/services/org.service'
import { getTestCampaignIds } from '@/services/campaigns.service'
import { shouldHideTestData } from '@/stores/testModeStore'
import type { Profile } from '@/types/database'

/**
 * /admin/users por PÁGINAS.
 *
 * Antes la pantalla pedía `profiles.select('*')` entero (860 filas), después
 * las campañas de cada una en nueve tandas, las credenciales de todos y los
 * dispositivos biométricos de todos, y pintaba las 860 filas con sus fotos,
 * sus tooltips y un selector de rol por fila. Ahora se pide una página
 * (`PEOPLE_PAGE_SIZE`) y la búsqueda la resuelve la base, así que buscar a
 * alguien no exige haber descargado a todos antes.
 *
 * Camino principal: el RPC `admin_people_page` (SQL 39). Decide el alcance
 * igual que antes —superadmin todo, el resto «mi gente»—, busca sin tildes por
 * nombre, correo, cédula, cargo, teléfono y cliente, y devuelve el total.
 * Mientras el SQL no se haya corrido se usa `fallbackPage`, que da el mismo
 * resultado con consultas directas.
 */

export const PEOPLE_PAGE_SIZE = 50

export type PeopleScope = 'people' | 'clients'
export type PeopleStatus = 'active' | 'inactive' | 'all'

export interface PeoplePageQuery {
  /** `people` = todo menos clientes · `clients` = solo clientes. */
  scope: PeopleScope
  search: string
  status: PeopleStatus
  role: Profile['role'] | ''
  /** Página empezando en 0. */
  page: number
  pageSize?: number
  isSuperAdmin: boolean
  /** Respaldo si `get_my_people_ids` tampoco existe: la campaña de casa. */
  homeCampaignId: string | null
}

export interface PeoplePage {
  rows: Profile[]
  total: number
}

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /could not find the function|does not exist/i.test(error.message ?? '')
  )
}

/** Palabras de la búsqueda, ya sin tildes. Todas tienen que aparecer. */
function tokensOf(search: string): string[] {
  return fold(search).split(/\s+/).filter(Boolean)
}

async function testExclusions(isSuperAdmin: boolean): Promise<{ campaigns: string[]; units: string[] }> {
  if (!shouldHideTestData(isSuperAdmin)) return { campaigns: [], units: [] }
  const [campaigns, units] = await Promise.all([
    getTestCampaignIds().catch(() => [] as string[]),
    getTestUnitIds().catch(() => [] as string[]),
  ])
  return { campaigns, units }
}

export async function getPeoplePage(q: PeoplePageQuery): Promise<PeoplePage> {
  const pageSize = q.pageSize ?? PEOPLE_PAGE_SIZE
  const exclude = await testExclusions(q.isSuperAdmin)
  const { data, error } = await supabase.rpc('admin_people_page', {
    p_scope: q.scope,
    p_search: fold(q.search),
    p_status: q.status,
    p_role: q.role || null,
    p_exclude_campaigns: exclude.campaigns,
    p_exclude_units: exclude.units,
    p_limit: pageSize,
    p_offset: q.page * pageSize,
  })
  if (!error) {
    const rows = (data ?? []) as { profile: Profile; total_count: number }[]
    return { rows: rows.map((r) => r.profile), total: Number(rows[0]?.total_count ?? 0) }
  }
  if (!isMissingFunction(error)) throw error
  return fallbackPage(q, pageSize, exclude)
}

/** Cuántos clientes hay registrados (para el contador de la pestaña). */
export async function countClients(isSuperAdmin: boolean): Promise<number> {
  const { total } = await getPeoplePage({
    scope: 'clients',
    search: '',
    status: 'active',
    role: '',
    page: 0,
    pageSize: 1,
    isSuperAdmin,
    homeCampaignId: null,
  })
  return total
}

/* ── Respaldo mientras el SQL 39 no esté corrido ─────────────────────────── */

const SEARCH_FIELDS = ['display_name', 'email', 'national_id', 'job_title', 'phone', 'client_name']

/**
 * Convierte una palabra ya plegada en una expresión regular que acepta sus
 * tildes («rocio» → r[oóòöôõ]c[iíìïî][oóòöôõ]). Así la base encuentra «Rocío»
 * sin extensión `unaccent` y sin traer a nadie de más. Todo lo que no sea letra,
 * número o `@ . _ -` se descarta: no hace falta para buscar gente y evita que
 * un carácter especial rompa la expresión o el filtro `or` de PostgREST.
 */
function accentPattern(token: string): string {
  const classes: Record<string, string> = {
    a: '[aáàäâãAÁÀÄÂÃ]',
    e: '[eéèëêEÉÈËÊ]',
    i: '[iíìïîIÍÌÏÎ]',
    o: '[oóòöôõOÓÒÖÔÕ]',
    u: '[uúùüûUÚÙÜÛ]',
    n: '[nñNÑ]',
    c: '[cçCÇ]',
    '.': '[.]',
  }
  return [...token.replace(/[^a-z0-9@._-]/g, '')]
    .map((ch) => classes[ch] ?? ch)
    .join('')
}

/** Una consulta directa a `profiles` con filtros, búsqueda y rango. */
async function directPage(
  q: PeoplePageQuery,
  pageSize: number,
  exclude: { campaigns: string[]; units: string[] },
): Promise<PeoplePage> {
  let query = supabase
    .from('profiles')
    .select('*', { count: 'exact' })
    .order('display_name', { ascending: true, nullsFirst: false })
    .order('id')
  query = q.scope === 'clients' ? query.eq('is_client', true) : query.not('is_client', 'is', true)
  if (!q.isSuperAdmin) query = query.neq('role', 'superadmin')
  if (q.status === 'active') query = query.not('is_active', 'is', false)
  if (q.status === 'inactive') query = query.eq('is_active', false)
  if (q.role) query = query.eq('role', q.role)
  // `not in` a secas deja fuera también a quien no tiene campaña (NULL).
  if (exclude.campaigns.length) {
    query = query.or(`campaign_id.is.null,campaign_id.not.in.(${exclude.campaigns.join(',')})`)
  }
  if (exclude.units.length) {
    query = query.or(`operation_id.is.null,operation_id.not.in.(${exclude.units.join(',')})`)
  }
  for (const token of tokensOf(q.search)) {
    const pattern = accentPattern(token)
    if (!pattern) continue
    query = query.or(SEARCH_FIELDS.map((f) => `${f}.imatch."${pattern}"`).join(','))
  }
  const from = q.page * pageSize
  const { data, count, error } = await query.range(from, from + pageSize - 1)
  if (error) throw error
  return { rows: (data ?? []) as Profile[], total: count ?? 0 }
}

type LiteRow = Pick<
  Profile,
  'id' | 'display_name' | 'email' | 'national_id' | 'job_title' | 'phone' | 'client_name' | 'role' | 'is_active' | 'is_client'
>
const LITE_COLS = 'id, display_name, email, national_id, job_title, phone, client_name, role, is_active, is_client'

/** Índice liviano de «mi gente» (solo texto, sin fotos). Dura un minuto. */
let liteCache: { key: string; at: number; rows: Promise<LiteRow[]> } | null = null

export function invalidatePeopleCache() {
  liteCache = null
}

async function myPeopleLite(homeCampaignId: string | null): Promise<LiteRow[]> {
  const key = homeCampaignId ?? ''
  if (liteCache && liteCache.key === key && Date.now() - liteCache.at < 60_000) return liteCache.rows
  const rows = (async () => {
    const people = await getMyPeopleIds()
    if (people === null) {
      if (!homeCampaignId) return []
      const { data, error } = await supabase
        .from('profiles')
        .select(LITE_COLS)
        .eq('campaign_id', homeCampaignId)
        .neq('role', 'superadmin')
      if (error) throw error
      return (data ?? []) as LiteRow[]
    }
    // Los ids van en la URL: en tandas, o PostgREST responde 400 a partir de ~200.
    const parts = await Promise.all(
      chunk(people).map(async (ids) => {
        const { data, error } = await supabase
          .from('profiles')
          .select(LITE_COLS)
          .in('id', ids)
          .neq('role', 'superadmin')
        if (error) throw error
        return (data ?? []) as LiteRow[]
      }),
    )
    return parts.flat()
  })()
  liteCache = { key, at: Date.now(), rows }
  rows.catch(() => { liteCache = null })
  return rows
}

async function fallbackPage(
  q: PeoplePageQuery,
  pageSize: number,
  exclude: { campaigns: string[]; units: string[] },
): Promise<PeoplePage> {
  // Superadmin (todo) y clientes (la RLS decide): la base filtra y pagina.
  if (q.isSuperAdmin || q.scope === 'clients') return directPage(q, pageSize, exclude)

  // Capacitador y RH: su alcance es una lista de ids que no cabe en una URL,
  // así que se filtra un índice de solo texto y se piden completas nada más
  // las filas de la página.
  const tokens = tokensOf(q.search)
  const matched = (await myPeopleLite(q.homeCampaignId))
    .filter((p) => p.is_client !== true)
    .filter((p) => q.status === 'all' || (q.status === 'active' ? p.is_active !== false : p.is_active === false))
    .filter((p) => !q.role || p.role === q.role)
    .filter((p) => {
      if (!tokens.length) return true
      const hay = fold([p.display_name, p.email, p.national_id, p.job_title, p.phone, p.client_name].filter(Boolean).join(' '))
      return tokens.every((t) => hay.includes(t))
    })
    .sort((a, b) => (a.display_name ?? '￿').localeCompare(b.display_name ?? '￿', 'es'))

  const ids = matched.slice(q.page * pageSize, (q.page + 1) * pageSize).map((p) => p.id)
  if (!ids.length) return { rows: [], total: matched.length }
  const { data, error } = await supabase.from('profiles').select('*').in('id', ids)
  if (error) throw error
  const byId = new Map(((data ?? []) as Profile[]).map((p) => [p.id, p]))
  return {
    rows: ids.map((id) => byId.get(id)).filter((p): p is Profile => !!p),
    total: matched.length,
  }
}

/** Capacitadores y superadmins activos: los candidatos para heredar contenido. */
export async function getContentOwners(): Promise<{ id: string; display_name: string | null }[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('role', ['capacitador', 'superadmin'])
    .not('is_active', 'is', false)
    .order('display_name')
  if (error) throw error
  return data ?? []
}
