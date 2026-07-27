import { supabase } from '@/lib/supabase'

/**
 * Auditoría del staff + borrado suave con aprobación del superadmin.
 * Ver migración supabase/sql/2026-07-15_audit_soft_delete.sql.
 */

/** Entidades de "proceso" que soportan borrado suave + solicitud de eliminación. */
export type EntityType =
  | 'campaigns'
  | 'courses'
  | 'modules'
  | 'scenarios'
  | 'choice_scenarios'
  | 'live_quizzes'
  | 'worlds'
  | 'arena_quizzes'
  | 'guided_missions'
  | 'campaign_collaborators'
  | 'profiles'
  | 'course_assignments'
  | 'course_campaigns'
  | 'certifications'
  | 'progress'
  | 'gamification'

export type ActivityAction =
  | 'insert'
  | 'update'
  | 'edit_content'
  | 'soft_delete'
  | 'restore'
  | 'delete'
  | 'approve_delete'
  | 'share'
  | 'unshare'
  | 'role_change'
  | 'campaign_change'
  | 'assign'
  | 'unassign'
  | 'publish'
  | 'unpublish'
  | 'certify'
  | 'recertify'
  | 'reset'
  | 'feedback'
  | 'create_user'
  | 'delete_user'

export interface ActivityLogRow {
  id: string
  actor_id: string | null
  actor_name: string | null
  actor_role: string | null
  action: ActivityAction
  entity_type: string
  entity_id: string | null
  entity_label: string | null
  campaign_id: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

/** Registro de actividad desde el cliente (staff). Ver RPC log_activity. */
export async function logActivity(params: {
  action: ActivityAction
  entityType: EntityType
  entityId?: string | null
  entityLabel?: string | null
  campaignId?: string | null
  detail?: Record<string, unknown> | null
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('log_activity', {
    p_action: params.action,
    p_entity_type: params.entityType,
    p_entity_id: params.entityId ?? null,
    p_entity_label: params.entityLabel ?? null,
    p_campaign_id: params.campaignId ?? null,
    p_detail: params.detail ?? null,
  })
  if (error) throw error
}

export interface DeletionRequestRow {
  id: string
  entity_type: EntityType
  entity_id: string
  entity_label: string | null
  campaign_id: string | null
  requested_by: string | null
  requested_by_name?: string | null
  requested_at: string
  status: 'pending' | 'approved' | 'rejected'
  resolved_by: string | null
  resolved_at: string | null
}

export interface ActivityLogFilters {
  actorId?: string
  entityType?: EntityType
  action?: ActivityAction
  campaignId?: string
  /** Texto libre: busca en la etiqueta de la entidad y en el nombre del actor. */
  search?: string
  /** ISO. Rango de fechas (inclusive). */
  from?: string
  to?: string
  limit?: number
  offset?: number
}

/** Resumen agregado del período filtrado (para KPIs y gráfico). */
export interface ActivityPulse {
  total: number
  /** Serie por día (YYYY-MM-DD) ordenada ascendente, sin huecos. */
  byDay: { day: string; count: number }[]
  byAction: { action: string; count: number }[]
  byEntityType: { entityType: string; count: number }[]
  topActors: { id: string; name: string; count: number }[]
  actors: number
  creates: number
  edits: number
  deletes: number
  /** true si se topó el techo de filas agregadas (el total es un mínimo). */
  truncated: boolean
}

/**
 * Devuelve el resultado de request_deletion:
 *  - 'deleted': se borró definitivamente (llamante superadmin).
 *  - 'pending': se ocultó y quedó una solicitud para aprobación.
 */
export async function requestDeletion(
  entityType: EntityType,
  entityId: string,
): Promise<'deleted' | 'pending'> {
  const { data, error } = await supabase.rpc('request_deletion', {
    p_entity_type: entityType,
    p_entity_id: entityId,
  })
  if (error) throw error
  return (data as 'deleted' | 'pending') ?? 'pending'
}

export async function approveDeletion(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_deletion', { p_request_id: requestId })
  if (error) throw error
}

export async function rejectDeletion(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('reject_deletion', { p_request_id: requestId })
  if (error) throw error
}

/** Solicitudes de eliminación pendientes (solo superadmin, por RLS). */
export async function getPendingDeletions(): Promise<DeletionRequestRow[]> {
  return getDeletionRequests('pending')
}

/**
 * Solicitudes de eliminación por estado. 'all' trae también el historial ya
 * resuelto, que es lo que permite auditar qué se aprobó o se restauró.
 */
export async function getDeletionRequests(
  status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending',
): Promise<DeletionRequestRow[]> {
  let q = supabase.from('deletion_requests').select('*').order('requested_at', { ascending: false })
  if (status !== 'all') q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw error
  return hydrateRequesterNames((data ?? []) as unknown as DeletionRequestRow[])
}

/** Aplica los filtros comunes a un query sobre activity_log. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters<T extends { eq: any; gte: any; lte: any; or: any }>(q: T, f: ActivityLogFilters): T {
  let out = q
  if (f.actorId) out = out.eq('actor_id', f.actorId)
  if (f.entityType) out = out.eq('entity_type', f.entityType)
  if (f.action) out = out.eq('action', f.action)
  if (f.campaignId) out = out.eq('campaign_id', f.campaignId)
  if (f.from) out = out.gte('created_at', f.from)
  if (f.to) out = out.lte('created_at', f.to)
  const s = f.search?.trim()
  if (s) {
    // Comas y paréntesis rompen la sintaxis de PostgREST en .or(); los quitamos.
    const safe = s.replace(/[,()]/g, ' ').trim()
    if (safe) out = out.or(`entity_label.ilike.%${safe}%,actor_name.ilike.%${safe}%`)
  }
  return out
}

/** Bitácora de actividad (solo superadmin, por RLS). */
export async function getActivityLog(filters: ActivityLogFilters = {}): Promise<ActivityLogRow[]> {
  const limit = filters.limit ?? 200
  const offset = filters.offset ?? 0
  const q = applyFilters(
    supabase
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
    filters,
  )
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as unknown as ActivityLogRow[]
}

/** Techo de filas que se agregan para KPIs/gráfico (evita traer la tabla entera). */
const PULSE_CAP = 5000

/**
 * Agregados del período: KPIs, serie diaria, desglose por acción/tipo y ranking
 * de actores. Se calcula sobre columnas mínimas para que sea barato.
 */
export async function getActivityPulse(filters: ActivityLogFilters = {}): Promise<ActivityPulse> {
  const q = applyFilters(
    supabase
      .from('activity_log')
      .select('actor_id, actor_name, action, entity_type, created_at')
      .order('created_at', { ascending: false })
      .limit(PULSE_CAP),
    filters,
  )
  const { data, error } = await q
  if (error) throw error
  const rows = (data ?? []) as unknown as {
    actor_id: string | null; actor_name: string | null
    action: string; entity_type: string; created_at: string
  }[]

  const byAction = new Map<string, number>()
  const byType = new Map<string, number>()
  const byActor = new Map<string, { name: string; count: number }>()
  const byDay = new Map<string, number>()

  for (const r of rows) {
    byAction.set(r.action, (byAction.get(r.action) ?? 0) + 1)
    byType.set(r.entity_type, (byType.get(r.entity_type) ?? 0) + 1)
    if (r.actor_id) {
      const prev = byActor.get(r.actor_id)
      byActor.set(r.actor_id, {
        name: prev?.name || r.actor_name || r.actor_id.slice(0, 8),
        count: (prev?.count ?? 0) + 1,
      })
    }
    const d = new Date(r.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
  }

  // Serie continua: rellenamos los días sin eventos para que el gráfico no mienta.
  const days = [...byDay.keys()].sort()
  const series: { day: string; count: number }[] = []
  if (days.length > 0) {
    const cur = new Date(days[0] + 'T00:00:00')
    const end = new Date(days[days.length - 1] + 'T00:00:00')
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
      series.push({ day: key, count: byDay.get(key) ?? 0 })
      cur.setDate(cur.getDate() + 1)
      if (series.length > 400) break
    }
  }

  const sum = (...actions: string[]) => actions.reduce((n, a) => n + (byAction.get(a) ?? 0), 0)

  return {
    total: rows.length,
    byDay: series,
    byAction: [...byAction].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
    byEntityType: [...byType].map(([entityType, count]) => ({ entityType, count })).sort((a, b) => b.count - a.count),
    topActors: [...byActor].map(([id, v]) => ({ id, name: v.name, count: v.count })).sort((a, b) => b.count - a.count).slice(0, 6),
    actors: byActor.size,
    creates: sum('insert', 'create_user'),
    edits: sum('update', 'edit_content', 'publish', 'unpublish', 'role_change', 'campaign_change', 'assign', 'unassign', 'share', 'unshare'),
    deletes: sum('soft_delete', 'delete', 'approve_delete', 'delete_user'),
    truncated: rows.length >= PULSE_CAP,
  }
}

/** Historial completo de una entidad concreta (para el panel de detalle). */
export async function getEntityActivity(entityId: string, limit = 40): Promise<ActivityLogRow[]> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as ActivityLogRow[]
}

/** Actores presentes en la bitácora (para el filtro), sin depender de lo cargado. */
export async function getActivityActors(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('actor_id, actor_name')
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) throw error
  const map = new Map<string, string>()
  for (const r of (data ?? []) as unknown as { actor_id: string | null; actor_name: string | null }[]) {
    if (r.actor_id && !map.has(r.actor_id)) map.set(r.actor_id, r.actor_name || r.actor_id.slice(0, 8))
  }
  return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** Campañas para el filtro de contexto. */
export async function getCampaignOptions(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.from('campaigns').select('id, name').order('name')
  if (error) throw error
  return (data ?? []).map((c) => ({ id: c.id, name: c.name }))
}

/** Completa el nombre del solicitante a partir de requested_by en un solo query. */
async function hydrateRequesterNames(rows: DeletionRequestRow[]): Promise<DeletionRequestRow[]> {
  const ids = [...new Set(rows.map((r) => r.requested_by).filter(Boolean))] as string[]
  if (ids.length === 0) return rows
  const { data } = await supabase.from('profiles').select('id, display_name').in('id', ids)
  const byId = new Map((data ?? []).map((p) => [p.id, p.display_name as string | null]))
  return rows.map((r) => ({
    ...r,
    requested_by_name: r.requested_by ? byId.get(r.requested_by) ?? null : null,
  }))
}
