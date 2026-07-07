import { supabase } from '@/lib/supabase'

// La tabla ai_usage_logs aún no está en los tipos generados de la BD; se accede
// sin tipar (cast). profiles sí va tipado. Ver supabase/sql/ai_usage_logs.sql.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const logs = () => (supabase as any).from('ai_usage_logs')

// ─── Catálogo de funciones (para etiquetas y filtros) ────────────────
export type AiFunction =
  | 'generate-world'
  | 'generate-module'
  | 'generate-simulation'
  | 'analyze-document'
  | 'module-ai-assist'
  | 'help-chat'
  | 'create-users-bulk'

export const FUNCTION_META: Record<string, { label: string; color: string; icon: string }> = {
  'generate-world':      { label: 'Mundos (IA)',        color: '#8b5cf6', icon: '🌍' },
  'generate-module':     { label: 'Módulos (IA)',       color: '#22c55e', icon: '📘' },
  'generate-simulation': { label: 'Simulaciones (IA)',  color: '#06b6d4', icon: '🎭' },
  'analyze-document':    { label: 'Análisis de doc',    color: '#f59e0b', icon: '📄' },
  'module-ai-assist':    { label: 'Asistente módulo',   color: '#ec4899', icon: '✨' },
  'help-chat':           { label: 'Chat de ayuda',      color: '#3b82f6', icon: '💬' },
  'create-users-bulk':   { label: 'Carga de usuarios',  color: '#64748b', icon: '👥' },
}

export function functionLabel(fn: string): string {
  return FUNCTION_META[fn]?.label ?? fn
}
export function functionColor(fn: string): string {
  return FUNCTION_META[fn]?.color ?? '#64748b'
}

// ─── Tipos ───────────────────────────────────────────────────────────
export interface AiUsageRow {
  id: string
  created_at: string
  user_id: string | null
  function_name: string
  operation: string | null
  model: string
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  cost_usd: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any> | null
  display_name: string | null
}

export interface AiUsageKpis {
  calls: number
  tokens: number
  costUsd: number
  activeUsers: number
}

export interface TimePoint {
  day: string        // YYYY-MM-DD
  costUsd: number
  calls: number
}

export interface Breakdown {
  key: string
  label: string
  color: string
  calls: number
  costUsd: number
  tokens: number
}

export interface UserOption {
  id: string
  name: string
}

export interface AiUsageFilters {
  functionName?: string   // 'all' o un function_name
  model?: string          // 'all' o un modelo
  userId?: string         // 'all' o un user_id
  from?: string           // ISO (inclusive)
  to?: string             // ISO (inclusive)
  search?: string
}

export interface AiUsageData {
  rows: AiUsageRow[]
  kpis: AiUsageKpis
  timeseries: TimePoint[]
  byFunction: Breakdown[]
  byModel: Breakdown[]
  topUsers: Breakdown[]
  truncated: boolean
}

const FETCH_LIMIT = 4000

const tokensOf = (r: AiUsageRow) =>
  (r.input_tokens ?? 0) +
  (r.output_tokens ?? 0) +
  (r.cache_creation_input_tokens ?? 0) +
  (r.cache_read_input_tokens ?? 0)

function dayKey(iso: string): string {
  const d = new Date(iso)
  // Clave local YYYY-MM-DD (agrupa por día del navegador del superadmin).
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Trae el uso de IA filtrado y calcula KPIs, serie temporal y desgloses en una
 * sola pasada. Para el volumen de esta plataforma alcanza con una consulta.
 */
export async function fetchAiUsage(filters: AiUsageFilters): Promise<AiUsageData> {
  let q = logs()
    .select('id,created_at,user_id,function_name,operation,model,input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens,cost_usd,metadata')
    .order('created_at', { ascending: false })
    .limit(FETCH_LIMIT)

  if (filters.functionName && filters.functionName !== 'all') q = q.eq('function_name', filters.functionName)
  if (filters.model && filters.model !== 'all') q = q.eq('model', filters.model)
  if (filters.userId && filters.userId !== 'all') q = q.eq('user_id', filters.userId)
  if (filters.from) q = q.gte('created_at', filters.from)
  if (filters.to) q = q.lte('created_at', filters.to)

  const { data, error } = await q
  if (error) throw error

  let rows = (data ?? []) as AiUsageRow[]

  // Búsqueda por texto (en operación, modelo y título del metadata) del lado cliente.
  const term = filters.search?.trim().toLowerCase()
  if (term) {
    rows = rows.filter((r) => {
      const title = String(r.metadata?.title ?? '')
      return (
        (r.operation ?? '').toLowerCase().includes(term) ||
        r.model.toLowerCase().includes(term) ||
        title.toLowerCase().includes(term) ||
        functionLabel(r.function_name).toLowerCase().includes(term)
      )
    })
  }

  // Nombres de usuario.
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[]
  const nameMap = new Map<string, string>()
  if (userIds.length) {
    const { data: profs } = await supabase.from('profiles').select('id,display_name').in('id', userIds)
    for (const p of profs ?? []) nameMap.set(p.id, p.display_name ?? '')
  }
  rows = rows.map((r) => ({ ...r, display_name: r.user_id ? nameMap.get(r.user_id) ?? null : null }))

  // KPIs.
  const kpis: AiUsageKpis = {
    calls: rows.length,
    tokens: rows.reduce((s, r) => s + tokensOf(r), 0),
    costUsd: rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0),
    activeUsers: new Set(rows.map((r) => r.user_id).filter(Boolean)).size,
  }

  // Serie temporal por día (ascendente).
  const tMap = new Map<string, TimePoint>()
  for (const r of rows) {
    const key = dayKey(r.created_at)
    const cur = tMap.get(key) ?? { day: key, costUsd: 0, calls: 0 }
    cur.costUsd += Number(r.cost_usd) || 0
    cur.calls += 1
    tMap.set(key, cur)
  }
  const timeseries = [...tMap.values()].sort((a, b) => a.day.localeCompare(b.day))

  // Desgloses.
  const byFunction = groupBreakdown(rows, (r) => r.function_name, (k) => ({
    label: functionLabel(k), color: functionColor(k),
  }))
  const byModel = groupBreakdown(rows, (r) => r.model || '—', (k) => ({
    label: k === '—' ? 'Sin modelo' : k,
    color: k.includes('sonnet') ? '#8b5cf6' : k.includes('haiku') ? '#22c55e' : '#64748b',
  }))
  const topUsers = groupBreakdown(rows, (r) => r.user_id ?? 'anon', (k) => ({
    label: k === 'anon' ? 'Desconocido' : nameMap.get(k) ?? 'Usuario', color: '#3b82f6',
  })).slice(0, 8)

  return {
    rows,
    kpis,
    timeseries,
    byFunction,
    byModel,
    topUsers,
    truncated: (data ?? []).length >= FETCH_LIMIT,
  }
}

function groupBreakdown(
  rows: AiUsageRow[],
  keyOf: (r: AiUsageRow) => string,
  meta: (k: string) => { label: string; color: string },
): Breakdown[] {
  const map = new Map<string, Breakdown>()
  for (const r of rows) {
    const key = keyOf(r)
    const cur = map.get(key) ?? { key, ...meta(key), calls: 0, costUsd: 0, tokens: 0 }
    cur.calls += 1
    cur.costUsd += Number(r.cost_usd) || 0
    cur.tokens += tokensOf(r)
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls)
}

/** Lista de usuarios que han generado con IA, para el filtro por usuario. */
export async function fetchAiUsageUsers(): Promise<UserOption[]> {
  const { data } = await logs()
    .select('user_id')
    .not('user_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(FETCH_LIMIT)

  const ids = [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))] as string[]
  if (!ids.length) return []

  const { data: profs } = await supabase.from('profiles').select('id,display_name').in('id', ids)
  const nameMap = new Map((profs ?? []).map((p) => [p.id, p.display_name ?? '']))
  return ids
    .map((id) => ({ id, name: nameMap.get(id) || 'Usuario' }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
