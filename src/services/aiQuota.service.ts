import { supabase } from '@/lib/supabase'

/**
 * Cupo diario de operaciones con IA.
 *
 * Una "operación" es una cosa que el capacitador pidió: generar un módulo,
 * un mundo, un simulador, traducir un curso… No importa cuántas llamadas
 * haga por dentro. El tope se renueva a medianoche, hora Colombia.
 *
 * Ver `supabase/sql/2026-07-28_ai_daily_limits.sql`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

/** Tipos de operación que consumen cupo. */
export type AiOperationKind =
  | 'module'
  | 'world'
  | 'simulation'
  | 'translation'
  | 'analysis'
  | 'assist'

export interface AiQuota {
  day: string
  used: number
  /** `null` cuando no hay tope (superadmin o excepción "sin límite"). */
  limit: number | null
  unlimited: boolean
  remaining: number | null
}

/** Cupo por defecto si el SQL todavía no se corrió (para no bloquear a nadie). */
const FALLBACK_QUOTA: AiQuota = { day: '', used: 0, limit: null, unlimited: true, remaining: null }

/** Error que lanza `consumeAiOperation` cuando ya no queda cupo. */
export class AiQuotaExceededError extends Error {
  constructor(public quota: AiQuota | null) {
    super('AI_QUOTA_EXCEEDED')
    this.name = 'AiQuotaExceededError'
  }
}

export function isQuotaExceeded(err: unknown): err is AiQuotaExceededError {
  return err instanceof AiQuotaExceededError
}

/** Cupo de hoy de quien está firmado (o de otra persona, si es superadmin). */
export async function getAiQuota(userId?: string): Promise<AiQuota> {
  const { data, error } = await db.rpc('get_ai_quota', { p_user: userId ?? null })
  if (error || !data) return FALLBACK_QUOTA
  return data as AiQuota
}

/**
 * Descuenta una operación ANTES de arrancar la generación.
 * Si no queda cupo lanza `AiQuotaExceededError` y no se gasta un peso.
 *
 * Si la función todavía no existe en la base (SQL sin correr), deja pasar:
 * es preferible que el sitio siga andando a bloquear por una migración pendiente.
 */
export async function consumeAiOperation(
  kind: AiOperationKind,
  label?: string,
  campaignId?: string | null,
): Promise<AiQuota> {
  const { data, error } = await db.rpc('consume_ai_operation', {
    p_kind: kind,
    p_label: label ?? null,
    p_campaign_id: campaignId ?? null,
  })

  if (error) {
    const msg = `${error.message ?? ''} ${error.details ?? ''}`
    if (msg.includes('AI_QUOTA_EXCEEDED')) {
      throw new AiQuotaExceededError(await getAiQuota().catch(() => null))
    }
    // RPC inexistente / red: no bloqueamos el trabajo del capacitador.
    return FALLBACK_QUOTA
  }

  notifyQuotaChanged()
  return (data ?? FALLBACK_QUOTA) as AiQuota
}

/** Avisa a los indicadores de cupo que el número cambió (sin acoplar stores). */
function notifyQuotaChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ai_quota_changed'))
}

/**
 * Devuelve la última operación del día cuando algo falló antes de gastar
 * (cancelación inmediata, error de red). Best-effort.
 */
export async function refundAiOperation(kind?: AiOperationKind): Promise<void> {
  try {
    await db.rpc('refund_ai_operation', { p_kind: kind ?? null })
    notifyQuotaChanged()
  } catch {
    /* silencioso: el cupo se renueva igual mañana */
  }
}

// ── Panel /admin/limits (solo superadmin) ──────────────────────────────────

export interface AiQuotaRow {
  user_id: string
  display_name: string
  email: string | null
  role: 'superadmin' | 'capacitador' | 'learner'
  avatar_url: string | null
  campaign_name: string
  effective_limit: number | null
  daily_limit: number | null
  unlimited: boolean
  bonus_ops: number
  bonus_day: string | null
  note: string | null
  used_today: number
  used_30d: number
  last_op_at: string | null
  /** Rastro de la excepción: quién la puso y cuándo (null si no hay excepción). */
  updated_at: string | null
  updated_by_name: string | null
}

export async function getAiQuotaOverview(): Promise<AiQuotaRow[]> {
  const { data, error } = await db.rpc('admin_ai_quota_overview')
  if (error) throw error
  return (data ?? []) as AiQuotaRow[]
}

export async function setAiUserLimit(opts: {
  userId: string
  dailyLimit?: number | null
  unlimited?: boolean
  bonusOps?: number
  bonusToday?: boolean
  note?: string | null
}): Promise<void> {
  const { error } = await db.rpc('admin_set_ai_limit', {
    p_user: opts.userId,
    p_daily_limit: opts.dailyLimit ?? null,
    p_unlimited: opts.unlimited ?? false,
    p_bonus_ops: opts.bonusOps ?? 0,
    p_bonus_today: opts.bonusToday ?? false,
    p_note: opts.note ?? null,
  })
  if (error) throw error
}

/**
 * Extra de un clic para HOY. Suma al extra que ya tuviera (dos clics de +5 dan
 * 10) y no toca el resto de la excepción.
 */
export async function grantAiBonus(userId: string, ops: number): Promise<void> {
  const { error } = await db.rpc('admin_grant_ai_bonus', { p_user: userId, p_ops: ops })
  if (error) throw error
}

/** Lee el cupo por defecto del sitio (app_settings). */
export async function getAiDefaultLimit(): Promise<number> {
  const { data, error } = await db
    .from('app_settings')
    .select('value')
    .eq('key', 'ai_daily_op_limit')
    .maybeSingle()
  if (error || !data) return 10
  const n = Number(data.value)
  return Number.isFinite(n) ? n : 10
}

export async function setAiDefaultLimit(limit: number): Promise<void> {
  const { error } = await db.rpc('admin_set_ai_default_limit', { p_limit: limit })
  if (error) throw error
}

export interface AiOperationRow {
  id: string
  kind: AiOperationKind
  label: string | null
  created_at: string
  op_day: string
  display_name: string | null
  campaign_name: string | null
}

export async function getAiOperations(limit = 100): Promise<AiOperationRow[]> {
  const { data, error } = await db.rpc('admin_ai_operations', { p_limit: limit })
  if (error) throw error
  return (data ?? []) as AiOperationRow[]
}
