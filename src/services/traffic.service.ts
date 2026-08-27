import { supabase } from '@/lib/supabase'
import {
  secondsSinceSeen,
  viewKeyForRoute,
  STALE_AFTER_MS,
  type Peer,
} from '@/stores/presenceStore'

/**
 * Tráfico del sitio para el superadmin. Dos fuentes que NO se mezclan:
 *
 *  · EN VIVO — se calcula en el navegador a partir de la presencia (Realtime,
 *    efímera). Responde "¿quién está ahora mismo y dónde?". Cero consultas.
 *  · HISTÓRICO — RPCs sobre `traffic_events` (ver supabase/sql/traffic_events.sql).
 *    Responde "¿cuánto se usó, cuándo y qué se miró?".
 *
 * Los dos números no van a cuadrar: la presencia se apaga a los 3 min sin
 * interacción, el histórico cuenta navegaciones. Se presentan por separado.
 */

// ════════════════════════════════════════════════════════════════════════
//  EN VIVO
// ════════════════════════════════════════════════════════════════════════

export interface LiveSlice {
  key: string
  count: number
}

export interface LiveTraffic {
  /** Personas conectadas ahora, incluyéndome. */
  total: number
  /** De esas, cuántas están dando señales de vida recientes. */
  active: number
  /** Atenuadas: siguen conectadas pero sin señal fresca (STALE_AFTER_MS). */
  idle: number
  byRole: LiveSlice[]
  byCampaign: LiveSlice[]
  /** Clave i18n de la vista (`presence.views.*`) → cuánta gente hay ahí. */
  byView: LiveSlice[]
  /** Cuántas están dentro de un recurso concreto, por tipo. */
  byResource: LiveSlice[]
  /** Quién está editando algo ahora mismo (riesgo de pisarse). */
  editing: Peer[]
}

const ROLE_ORDER = ['superadmin', 'capacitador', 'learner']

function tally(entries: (string | null | undefined)[], fallback: string): LiveSlice[] {
  const map = new Map<string, number>()
  for (const e of entries) {
    const key = e ?? fallback
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/**
 * Resume la presencia en los números del panel.
 *
 * `peers` viene del store SIN uno mismo (así lo entrega `syncPeers`), por eso
 * `self` se suma aparte: el superadmin que mira el panel también está en línea y
 * omitirlo hacía que el total no cuadrara con la barra lateral.
 */
export function summarizeLivePeers(peers: Peer[], self: { role?: string | null; campaignId?: string | null; route?: string } | null): LiveTraffic {
  const all = peers
  const roles = all.map((p) => p.role)
  const campaigns = all.map((p) => p.activity?.campaignId ?? p.campaign_id)
  const views = all.map((p) => viewKeyForRoute(p.route ?? ''))

  if (self) {
    roles.push(self.role ?? undefined)
    campaigns.push(self.campaignId ?? undefined)
    views.push(viewKeyForRoute(self.route ?? ''))
  }

  const stale = all.filter((p) => secondsSinceSeen(p) * 1000 >= STALE_AFTER_MS).length
  const total = all.length + (self ? 1 : 0)

  // Orden fijo (superadmin → capacitador → aprendiz) para que las píldoras no
  // bailen en cada sincronización. Lo que no reconozcamos va al final, no al
  // principio: `indexOf` devuelve -1 y sin esto un rol raro encabezaría.
  const rank = (k: string) => (ROLE_ORDER.indexOf(k) < 0 ? ROLE_ORDER.length : ROLE_ORDER.indexOf(k))
  const byRole = tally(roles, 'unknown').sort((a, b) => rank(a.key) - rank(b.key))

  return {
    total,
    active: total - stale,
    idle: stale,
    byRole,
    byCampaign: tally(campaigns, 'none'),
    byView: tally(views, 'presence.views.somewhere'),
    byResource: tally(
      all.filter((p) => p.activity).map((p) => p.activity!.type),
      'none',
    ),
    editing: all.filter((p) => (p.activity?.mode ?? 'edit') === 'edit' && !!p.activity),
  }
}

// ════════════════════════════════════════════════════════════════════════
//  HISTÓRICO
// ════════════════════════════════════════════════════════════════════════

export interface TrafficFilters {
  from: string
  to: string
  campaignId: string | null
  role: string | null
  /** Minutos por punto de la curva de concurrencia. */
  bucketMinutes: number
}

export interface TrafficOverview {
  users: number
  prevUsers: number
  sessions: number
  views: number
  activeMs: number
  avgSessionMs: number
  avgViewsPerSession: number
  peakConcurrent: number | null
  peakAt: string | null
  newUsers: number
}

export interface ConcurrencyPoint {
  bucket: string
  /**
   * Máximo de personas A LA VEZ dentro de la franja. Sale de un barrido sobre
   * los intervalos [started_at, created_at] de cada fila, no de contar filas:
   * quien lleva media hora en la misma pantalla cuenta en todas las franjas que
   * atraviesa, no solo en aquella donde se fue.
   */
  peak: number
  /** Personas distintas que pasaron por la franja (el pico nunca la supera). */
  users: number
  sessions: number
  activeMs: number
}

export interface ViewRow {
  viewKey: string
  views: number
  users: number
  activeMs: number
  avgMs: number
}

export interface CampaignRow {
  campaignId: string | null
  campaignName: string | null
  users: number
  views: number
  activeMs: number
}

export interface RoleRow {
  role: string
  users: number
  views: number
  activeMs: number
}

export interface UserRow {
  userId: string
  displayName: string | null
  avatarUrl: string | null
  role: string | null
  campaignName: string | null
  sessions: number
  views: number
  activeMs: number
  lastSeen: string
}

export interface TrafficHistory {
  overview: TrafficOverview
  concurrency: ConcurrencyPoint[]
  topViews: ViewRow[]
  byCampaign: CampaignRow[]
  byRole: RoleRow[]
  topUsers: UserRow[]
  /** true = el SQL todavía no se ha corrido; el panel lo dice en vez de fallar. */
  notInstalled: boolean
}

const EMPTY_OVERVIEW: TrafficOverview = {
  users: 0, prevUsers: 0, sessions: 0, views: 0, activeMs: 0,
  avgSessionMs: 0, avgViewsPerSession: 0, peakConcurrent: null, peakAt: null, newUsers: 0,
}

export const EMPTY_HISTORY: TrafficHistory = {
  overview: EMPTY_OVERVIEW,
  concurrency: [], topViews: [], byCampaign: [], byRole: [], topUsers: [],
  notInstalled: false,
}

/** 42883 / PGRST202 = la función aún no existe (SQL pendiente de correr). */
function isMissingFunction(err: { code?: string } | null): boolean {
  return err?.code === '42883' || err?.code === 'PGRST202'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rpc = { data: any; error: any }

/**
 * Trae todo el histórico del rango en paralelo. Cada RPC devuelve ya agregado
 * (nunca filas crudas): son decenas de miles de eventos y aquí solo se pintan
 * unas pocas docenas de números.
 */
export async function fetchTrafficHistory(f: TrafficFilters): Promise<TrafficHistory> {
  const common = { p_from: f.from, p_to: f.to }
  const campaign = { p_campaign: f.campaignId }
  const role = { p_role: f.role }

  const [overview, concurrency, topViews, byCampaign, byRole, topUsers] = await Promise.all([
    supabase.rpc('get_traffic_overview', { ...common, ...campaign, ...role }) as unknown as Promise<Rpc>,
    supabase.rpc('get_traffic_concurrency', { ...common, ...campaign, ...role, p_bucket: f.bucketMinutes }) as unknown as Promise<Rpc>,
    supabase.rpc('get_traffic_top_views', { ...common, ...campaign, ...role, p_limit: 15 }) as unknown as Promise<Rpc>,
    supabase.rpc('get_traffic_by_campaign', { ...common, ...role }) as unknown as Promise<Rpc>,
    supabase.rpc('get_traffic_by_role', { ...common, ...campaign }) as unknown as Promise<Rpc>,
    supabase.rpc('get_traffic_top_users', { ...common, ...campaign, ...role, p_limit: 10 }) as unknown as Promise<Rpc>,
  ])

  if (isMissingFunction(overview.error)) {
    return { ...EMPTY_HISTORY, notInstalled: true }
  }
  for (const r of [overview, concurrency, topViews, byCampaign, byRole, topUsers]) {
    if (r.error && !isMissingFunction(r.error)) {
      console.warn('[traffic]', r.error.message)
    }
  }

  const o = (overview.data ?? {}) as Partial<TrafficOverview>

  return {
    overview: {
      users: Number(o.users ?? 0),
      prevUsers: Number(o.prevUsers ?? 0),
      sessions: Number(o.sessions ?? 0),
      views: Number(o.views ?? 0),
      activeMs: Number(o.activeMs ?? 0),
      avgSessionMs: Number(o.avgSessionMs ?? 0),
      avgViewsPerSession: Number(o.avgViewsPerSession ?? 0),
      peakConcurrent: o.peakConcurrent == null ? null : Number(o.peakConcurrent),
      peakAt: o.peakAt ?? null,
      newUsers: Number(o.newUsers ?? 0),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    concurrency: ((concurrency.data ?? []) as any[]).map((r) => ({
      bucket: r.bucket,
      // `peak` puede faltar si el delta SQL todavía no se corrió: se cae a
      // `users`, que es lo que la versión anterior devolvía.
      peak: Number(r.peak ?? r.users ?? 0),
      users: Number(r.users),
      sessions: Number(r.sessions),
      activeMs: Number(r.active_ms),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topViews: ((topViews.data ?? []) as any[]).map((r) => ({
      viewKey: r.view_key, views: Number(r.views), users: Number(r.users),
      activeMs: Number(r.active_ms), avgMs: Number(r.avg_ms),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    byCampaign: ((byCampaign.data ?? []) as any[]).map((r) => ({
      campaignId: r.campaign_id, campaignName: r.campaign_name,
      users: Number(r.users), views: Number(r.views), activeMs: Number(r.active_ms),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    byRole: ((byRole.data ?? []) as any[]).map((r) => ({
      role: r.role, users: Number(r.users), views: Number(r.views), activeMs: Number(r.active_ms),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    topUsers: ((topUsers.data ?? []) as any[]).map((r) => ({
      userId: r.user_id, displayName: r.display_name, avatarUrl: r.avatar_url,
      role: r.user_role, campaignName: r.campaign_name,
      sessions: Number(r.sessions), views: Number(r.views),
      activeMs: Number(r.active_ms), lastSeen: r.last_seen,
    })),
    notInstalled: false,
  }
}

/** Borra el tráfico más viejo que `days`. Devuelve cuántas filas se fueron. */
export async function purgeTrafficEvents(days: number): Promise<number> {
  const { data, error } = await supabase.rpc('purge_traffic_events', { p_days: days })
  if (error) throw error
  return Number(data ?? 0)
}
