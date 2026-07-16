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

export type ActivityAction =
  | 'insert'
  | 'update'
  | 'soft_delete'
  | 'restore'
  | 'delete'
  | 'approve_delete'

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
  detail: Record<string, { from: unknown; to: unknown }> | null
  created_at: string
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
  limit?: number
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
  const { data, error } = await supabase
    .from('deletion_requests')
    .select('*')
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
  if (error) throw error
  return hydrateRequesterNames((data ?? []) as unknown as DeletionRequestRow[])
}

/** Bitácora de actividad (solo superadmin, por RLS). */
export async function getActivityLog(filters: ActivityLogFilters = {}): Promise<ActivityLogRow[]> {
  let q = supabase
    .from('activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 200)

  if (filters.actorId) q = q.eq('actor_id', filters.actorId)
  if (filters.entityType) q = q.eq('entity_type', filters.entityType)
  if (filters.action) q = q.eq('action', filters.action)
  if (filters.campaignId) q = q.eq('campaign_id', filters.campaignId)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as unknown as ActivityLogRow[]
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
