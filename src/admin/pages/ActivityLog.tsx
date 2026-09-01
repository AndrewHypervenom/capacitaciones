import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import i18n from '@/i18n'
import {
  Loader2, Activity, ChevronDown, ChevronRight, Search, X, Download, RefreshCw as Refresh,
  Plus, Pencil, EyeOff, RotateCcw, Trash2, ShieldCheck, Share2, ExternalLink, Copy, Check,
  UserMinus, UserPlus, UserX, UserCog, ArrowRightLeft, Send, Undo2, Layers, History, Braces,
  Award, RefreshCw, MessageSquare, FileEdit, Sparkles, Users, PenLine, Trash, SlidersHorizontal, KeyRound,
} from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { FadeIn, Stagger, StaggerItem } from '@/components/ui/motion'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import {
  getActivityLog, getActivityPulse, getActivityActors, getCampaignOptions, getEntityActivity,
  type ActivityLogRow, type ActivityAction, type EntityType, type ActivityPulse, type ActivityLogFilters,
} from '@/services/audit.service'
import {
  getEntityContexts, getContentDetail, type EntityContext, type ContentDetail,
} from '@/services/auditContext.service'
import { AuditContentPanel } from '../components/AuditContentPanel'

const PAGE_SIZE = 100

const ENTITY_TYPES: EntityType[] = [
  'campaigns', 'courses', 'modules', 'scenarios', 'choice_scenarios',
  'live_quizzes', 'worlds', 'arena_quizzes', 'guided_missions',
  'campaign_collaborators', 'course_assignments', 'course_campaigns',
  'certifications', 'progress', 'profiles', 'gamification',
]

const ACTIONS: ActivityAction[] = [
  'insert', 'update', 'edit_content', 'soft_delete', 'restore', 'delete', 'approve_delete',
  'share', 'unshare', 'role_change', 'campaign_change', 'assign', 'unassign',
  'publish', 'unpublish', 'certify', 'recertify', 'reset', 'feedback',
  'create_user', 'delete_user', 'view_credentials',
]

const ACTION_META: Record<ActivityAction, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  insert:          { icon: Plus,          color: '#22c55e' },
  update:          { icon: Pencil,        color: '#06b6d4' },
  edit_content:    { icon: FileEdit,      color: '#06b6d4' },
  soft_delete:     { icon: EyeOff,        color: '#f59e0b' },
  restore:         { icon: RotateCcw,     color: '#8b5cf6' },
  delete:          { icon: Trash2,        color: '#ef4444' },
  approve_delete:  { icon: ShieldCheck,   color: '#ef4444' },
  share:           { icon: Share2,        color: '#10D451' },
  unshare:         { icon: UserMinus,     color: '#f59e0b' },
  role_change:     { icon: UserCog,       color: '#8b5cf6' },
  campaign_change: { icon: ArrowRightLeft, color: '#06b6d4' },
  assign:          { icon: UserPlus,      color: '#22c55e' },
  unassign:        { icon: UserMinus,     color: '#f59e0b' },
  publish:         { icon: Send,          color: '#10D451' },
  unpublish:       { icon: Undo2,         color: '#f59e0b' },
  certify:         { icon: Award,         color: '#eab308' },
  recertify:       { icon: RefreshCw,     color: '#f59e0b' },
  reset:           { icon: RefreshCw,     color: '#ef4444' },
  feedback:        { icon: MessageSquare, color: '#06b6d4' },
  create_user:     { icon: UserPlus,      color: '#22c55e' },
  delete_user:     { icon: UserX,         color: '#ef4444' },
  view_credentials: { icon: KeyRound,    color: '#f59e0b' },
}

// ─── Rango de fechas ─────────────────────────────────────────────────
type Preset = 'today' | '7d' | '30d' | '90d' | 'all'
const PRESETS: Preset[] = ['today', '7d', '30d', '90d', 'all']

function rangeFor(preset: Preset): { from?: string } {
  const now = new Date()
  const start = new Date(now)
  switch (preset) {
    case 'today': start.setHours(0, 0, 0, 0); return { from: start.toISOString() }
    case '7d': start.setDate(now.getDate() - 6); start.setHours(0, 0, 0, 0); return { from: start.toISOString() }
    case '30d': start.setDate(now.getDate() - 29); start.setHours(0, 0, 0, 0); return { from: start.toISOString() }
    case '90d': start.setDate(now.getDate() - 89); start.setHours(0, 0, 0, 0); return { from: start.toISOString() }
    case 'all': return {}
  }
}

// ─── Etiquetas ───────────────────────────────────────────────────────
function entityLabel(type: string): string {
  return i18n.t(`admin.entity_types.${type}`, type)
}
function typeThe(type: string): string {
  return i18n.t(`admin.activity.type_the.${type}`, entityLabel(type))
}
function actionLabel(a: string): string {
  return i18n.t(`admin.activity.action_${a}`, a)
}
function roleLabel(role: string | null | undefined): string {
  if (!role) return '—'
  return i18n.t(`admin.activity.role_${role}`, role)
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(i18n.language, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
}
function fmtDayHeading(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - date.getTime()) / 86400000)
  if (diff === 0) return i18n.t('admin.activity.today')
  if (diff === 1) return i18n.t('admin.activity.yesterday')
  return date.toLocaleDateString(i18n.language, { weekday: 'long', day: '2-digit', month: 'long' })
}
/** "hace 5 min" sin dependencias: usa Intl.RelativeTimeFormat. */
function fmtRelative(iso: string) {
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return rtf.format(-Math.round(s), 'second')
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  if (s < 2592000) return rtf.format(-Math.round(s / 86400), 'day')
  return rtf.format(-Math.round(s / 2592000), 'month')
}
function dayKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function roleColor(role: string | null): string {
  if (role === 'superadmin') return '#f59e0b'
  if (role === 'capacitador') return '#8b5cf6'
  return '#94a3b8'
}
function fmtValue(v: unknown, max = 400): string {
  if (v === null || v === undefined) return '∅'
  if (typeof v === 'boolean') return v ? '✓' : '✕'
  if (typeof v === 'string') return v.length > max ? v.slice(0, max) + '…' : v
  if (typeof v === 'object') {
    const s = JSON.stringify(v, null, 2)
    return s.length > max ? s.slice(0, max) + '…' : s
  }
  return String(v)
}

function renderTemplate(
  tpl: string,
  parts: Record<string, { text: string; strong?: boolean }>,
): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /\{\{(\w+)\}\}/g
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(tpl)) !== null) {
    if (m.index > last) out.push(<span key={key++}>{tpl.slice(last, m.index)}</span>)
    const p = parts[m[1]]
    if (p) {
      out.push(
        p.strong
          ? <span key={key++} className="font-medium text-text">{p.text}</span>
          : <span key={key++}>{p.text}</span>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < tpl.length) out.push(<span key={key++}>{tpl.slice(last)}</span>)
  return out
}

function describe(row: ActivityLogRow): React.ReactNode {
  const detail = (row.detail ?? {}) as Record<string, unknown>
  const label = row.entity_label ? `«${row.entity_label}»` : '—'
  const parts: Record<string, { text: string; strong?: boolean }> = {
    actor: { text: row.actor_name ?? '—', strong: true },
    type: { text: typeThe(row.entity_type) },
    label: { text: label, strong: true },
    target: { text: String(detail.target ?? ''), strong: true },
    count: { text: String(detail.count ?? ''), strong: true },
  }
  const action =
    row.action === 'create_user' && detail.count != null ? 'create_user_bulk' : row.action
  const tpl = i18n.t(`admin.activity.tpl_${action}`, '')
  if (tpl) return renderTemplate(tpl, parts)
  return renderTemplate('{{actor}} {{type}} {{label}}', parts)
}

/** Texto plano del evento: alimenta la búsqueda local y la exportación CSV. */
function plainText(row: ActivityLogRow): string {
  return [
    row.actor_name, roleLabel(row.actor_role), actionLabel(row.action),
    entityLabel(row.entity_type), row.entity_label,
    row.detail ? JSON.stringify(row.detail) : '',
  ].filter(Boolean).join(' ').toLowerCase()
}

function changeChip(row: ActivityLogRow): string | null {
  const d = (row.detail ?? {}) as Record<string, unknown>
  if (row.action === 'role_change' && d.role && typeof d.role === 'object') {
    const r = d.role as { from?: string; to?: string }
    return `${roleLabel(r.from)} → ${roleLabel(r.to)}`
  }
  if (row.action === 'campaign_change' && d.campaign && typeof d.campaign === 'object') {
    const c = d.campaign as { from?: string | null; to?: string | null }
    return `${c.from ?? '∅'} → ${c.to ?? '∅'}`
  }
  return null
}

/** Campos {from,to} del detalle; el resto se muestra como datos del evento. */
function splitDetail(detail: Record<string, unknown> | null) {
  const changes: { key: string; from: unknown; to: unknown }[] = []
  const extras: { key: string; value: unknown }[] = []
  for (const [k, v] of Object.entries(detail ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && ('from' in v || 'to' in v)) {
      const o = v as { from?: unknown; to?: unknown }
      changes.push({ key: k, from: o.from, to: o.to })
    } else {
      extras.push({ key: k, value: v })
    }
  }
  return { changes, extras }
}

// ════════════════════════════════════════════════════════════════════
// Página
// ════════════════════════════════════════════════════════════════════
export default function ActivityLog() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<ActivityLogRow[]>([])
  const [pulse, setPulse] = useState<ActivityPulse | null>(null)
  const [contexts, setContexts] = useState<Record<string, EntityContext>>({})
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reachedEnd, setReachedEnd] = useState(false)

  const [preset, setPreset] = useState<Preset>('30d')
  const [actorId, setActorId] = useState('all')
  const [campaignId, setCampaignId] = useState('all')
  const [entityType, setEntityType] = useState<'all' | EntityType>('all')
  const [action, setAction] = useState<'all' | ActivityAction>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [actorOptions, setActorOptions] = useState<{ id: string; name: string }[]>([])
  const [campaignOptions, setCampaignOptions] = useState<{ id: string; name: string }[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  // Opciones de filtro (una vez).
  useEffect(() => {
    getActivityActors().then(setActorOptions).catch((e) => console.error('activity actors error:', e))
    getCampaignOptions().then(setCampaignOptions).catch((e) => console.error('campaign options error:', e))
  }, [])

  // Buscar con "/" desde cualquier parte de la vista.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Debounce de la búsqueda.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(id)
  }, [searchInput])

  const filters: ActivityLogFilters = useMemo(() => ({
    actorId: actorId === 'all' ? undefined : actorId,
    campaignId: campaignId === 'all' ? undefined : campaignId,
    entityType: entityType === 'all' ? undefined : entityType,
    action: action === 'all' ? undefined : action,
    search: search || undefined,
    ...rangeFor(preset),
  }), [actorId, campaignId, entityType, action, search, preset])

  // Carga principal (feed + agregados).
  useEffect(() => {
    let alive = true
    setLoading(true)
    setReachedEnd(false)
    Promise.all([
      getActivityLog({ ...filters, limit: PAGE_SIZE, offset: 0 }),
      getActivityPulse(filters),
    ])
      .then(([data, p]) => {
        if (!alive) return
        setRows(data)
        setPulse(p)
        setReachedEnd(data.length < PAGE_SIZE)
      })
      .catch((e) => { console.error('activity log error:', e); if (alive) toast.error(t('admin.activity.load_error')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [filters, reloadKey, t])

  // Contexto de las entidades visibles (ruta y si siguen existiendo).
  // El ref recuerda lo ya pedido: hay tipos (inscripciones, progreso…) que no
  // tienen ficha propia y nunca vuelven en el mapa; sin esto se re-pedirían en
  // cada render.
  const requestedCtx = useRef<Set<string>>(new Set())
  useEffect(() => {
    const pending = rows
      .filter((r) => r.entity_id && !requestedCtx.current.has(`${r.entity_type}:${r.entity_id}`))
      .map((r) => ({ type: r.entity_type, id: r.entity_id as string }))
    if (pending.length === 0) return
    for (const it of pending) requestedCtx.current.add(`${it.type}:${it.id}`)
    let alive = true
    getEntityContexts(pending)
      .then((map) => {
        if (alive && Object.keys(map).length > 0) setContexts((prev) => ({ ...prev, ...map }))
      })
      .catch((e) => console.error('entity context error:', e))
    return () => { alive = false }
  }, [rows])

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    try {
      const next = await getActivityLog({ ...filters, limit: PAGE_SIZE, offset: rows.length })
      setRows((prev) => [...prev, ...next])
      if (next.length < PAGE_SIZE) setReachedEnd(true)
    } catch (e) {
      console.error('activity load more error:', e)
      toast.error(t('admin.activity.load_error'))
    } finally {
      setLoadingMore(false)
    }
  }, [filters, rows.length, t])

  // Refinamiento local: la búsqueda del servidor cubre etiqueta y actor; aquí
  // además miramos dentro del detalle del evento.
  const visible = useMemo(() => {
    if (!search) return rows
    const q = search.toLowerCase()
    return rows.filter((r) => plainText(r).includes(q))
  }, [rows, search])

  const groups = useMemo(() => {
    const map = new Map<string, ActivityLogRow[]>()
    for (const r of visible) {
      const k = dayKey(r.created_at)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(r)
    }
    return [...map.entries()]
  }, [visible])

  const activeFilters = [
    actorId !== 'all' && { key: 'actor', label: actorOptions.find((a) => a.id === actorId)?.name ?? actorId, clear: () => setActorId('all') },
    campaignId !== 'all' && { key: 'campaign', label: campaignOptions.find((c) => c.id === campaignId)?.name ?? campaignId, clear: () => setCampaignId('all') },
    entityType !== 'all' && { key: 'type', label: entityLabel(entityType), clear: () => setEntityType('all') },
    action !== 'all' && { key: 'action', label: actionLabel(action), clear: () => setAction('all') },
    search && { key: 'search', label: `"${search}"`, clear: () => { setSearchInput(''); setSearch('') } },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[]

  const exportCsv = () => {
    const head = ['fecha', 'actor', 'rol', 'accion', 'tipo', 'entidad', 'entity_id', 'campaign_id', 'detalle']
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [head.join(',')]
    for (const r of visible) {
      lines.push([
        fmtDate(r.created_at), r.actor_name, roleLabel(r.actor_role), actionLabel(r.action),
        entityLabel(r.entity_type), r.entity_label, r.entity_id, r.campaign_id,
        r.detail ? JSON.stringify(r.detail) : '',
      ].map(esc).join(','))
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `actividad-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('admin.activity.exported', { n: visible.length }))
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1 flex items-center gap-2">
            <Activity className="h-6 w-6 text-[rgb(var(--brand-green))]" />
            {t('admin.activity.title')}
          </h1>
          <p className="text-[13px] text-text-muted">{t('admin.activity.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-medium text-text-muted hover:text-text transition-colors"
          >
            <Refresh className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('admin.activity.refresh')}
          </button>
          <button
            onClick={exportCsv}
            disabled={visible.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-medium text-text-muted hover:text-text transition-colors disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            {t('admin.activity.export')}
          </button>
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                preset === p
                  ? 'border-[rgb(var(--brand-green))] text-[rgb(var(--brand-green))] bg-[rgb(var(--brand-green))]/10'
                  : 'border-line text-text-muted hover:text-text hover:border-glass-border/30',
              )}
            >
              {t(`admin.activity.preset_${p}`)}
            </button>
          ))}
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              'ml-auto inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] font-medium transition-colors',
              showFilters || activeFilters.length > 0
                ? 'border-[rgb(var(--brand-green))]/40 text-text' : 'border-line text-text-muted hover:text-text',
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t('admin.activity.filters')}
            {activeFilters.length > 0 && (
              <span className="rounded-full bg-[rgb(var(--brand-green))]/15 px-1.5 text-[10.5px] text-[rgb(var(--brand-green))]">
                {activeFilters.length}
              </span>
            )}
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted/70" />
          <input
            ref={searchRef}
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('admin.activity.search_ph')}
            className="w-full rounded-xl border border-line bg-surface pl-9 pr-9 py-2.5 text-[13px] text-text placeholder:text-text-muted/60 outline-none focus:border-[rgb(var(--brand-green))]/40 transition-colors"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
              aria-label={t('admin.activity.clear')}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {showFilters && (
          <FadeIn className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" y={8}>
            <Select
              value={actorId}
              onChange={setActorId}
              options={[
                { value: 'all', label: t('admin.activity.filter_all_actors') },
                ...actorOptions.map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
            <Select
              value={campaignId}
              onChange={setCampaignId}
              options={[
                { value: 'all', label: t('admin.activity.filter_all_campaigns') },
                ...campaignOptions.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <Select
              value={entityType}
              onChange={(v) => setEntityType(v as 'all' | EntityType)}
              options={[
                { value: 'all', label: t('admin.activity.filter_all_types') },
                ...ENTITY_TYPES.map((e) => ({ value: e, label: entityLabel(e) })),
              ]}
            />
            <Select
              value={action}
              onChange={(v) => setAction(v as 'all' | ActivityAction)}
              options={[
                { value: 'all', label: t('admin.activity.filter_all_actions') },
                ...ACTIONS.map((a) => ({ value: a, label: actionLabel(a) })),
              ]}
            />
          </FadeIn>
        )}

        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {activeFilters.map((f) => (
              <span key={f.key} className="inline-flex items-center gap-1 rounded-full bg-subtle px-2.5 py-1 text-[11.5px] text-text">
                {f.label}
                <button onClick={f.clear} className="text-text-muted hover:text-text" aria-label={t('admin.activity.clear')}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button
              onClick={() => {
                setActorId('all'); setCampaignId('all'); setEntityType('all'); setAction('all')
                setSearchInput(''); setSearch('')
              }}
              className="text-[11.5px] text-text-muted hover:text-text underline underline-offset-2"
            >
              {t('admin.activity.clear_all')}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : (
        <>
          {/* ── KPIs ── */}
          {pulse && (
            <Stagger as="section" className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-5" gap={0.06}>
              <KpiCard icon={Activity} color="#06b6d4" label={t('admin.activity.kpi_events')} value={pulse.total} suffix={pulse.truncated ? '+' : ''} />
              <KpiCard icon={Users} color="#8b5cf6" label={t('admin.activity.kpi_actors')} value={pulse.actors} />
              <KpiCard icon={Sparkles} color="#22c55e" label={t('admin.activity.kpi_creates')} value={pulse.creates} />
              <KpiCard icon={PenLine} color="#0ea5e9" label={t('admin.activity.kpi_edits')} value={pulse.edits} />
              <KpiCard icon={Trash} color="#ef4444" label={t('admin.activity.kpi_deletes')} value={pulse.deletes} />
            </Stagger>
          )}

          {/* ── Ritmo diario + desgloses ── */}
          {pulse && pulse.byDay.length > 0 && (
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
              <FadeIn className="lg:col-span-2 rounded-2xl border border-line bg-surface p-5" y={12}>
                <h3 className="text-[11px] uppercase tracking-wider text-text-muted mb-4">{t('admin.activity.chart_title')}</h3>
                <DayBars points={pulse.byDay} />
              </FadeIn>
              <FadeIn className="rounded-2xl border border-line bg-surface p-5" y={12}>
                <h3 className="text-[11px] uppercase tracking-wider text-text-muted mb-3">{t('admin.activity.top_actors')}</h3>
                {pulse.topActors.length === 0 ? (
                  <p className="text-[12.5px] text-text-muted">{t('admin.activity.no_data')}</p>
                ) : (
                  <div className="space-y-2.5">
                    {pulse.topActors.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => setActorId(a.id)}
                        className="w-full text-left group"
                      >
                        <div className="flex items-center justify-between text-[12.5px] mb-1">
                          <span className="truncate text-text group-hover:text-[rgb(var(--brand-green))] transition-colors">{a.name}</span>
                          <span className="tabular-nums text-text-muted">{a.count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-subtle overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[rgb(var(--brand-green))]"
                            style={{ width: `${Math.max(4, (a.count / pulse.topActors[0].count) * 100)}%` }}
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </FadeIn>
            </section>
          )}

          {/* ── Desglose por tipo (chips filtrables) ── */}
          {pulse && pulse.byEntityType.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-5">
              {pulse.byEntityType.slice(0, 12).map((b) => (
                <button
                  key={b.entityType}
                  onClick={() => setEntityType(entityType === b.entityType ? 'all' : (b.entityType as EntityType))}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors',
                    entityType === b.entityType
                      ? 'border-[rgb(var(--brand-green))] text-[rgb(var(--brand-green))] bg-[rgb(var(--brand-green))]/10'
                      : 'border-line text-text-muted hover:text-text',
                  )}
                >
                  {entityLabel(b.entityType)}
                  <span className="tabular-nums opacity-70">{b.count}</span>
                </button>
              ))}
            </div>
          )}

          {/* ── Feed ── */}
          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-6 sm:p-12 text-center">
              <Activity className="h-7 w-7 text-text-subtle mx-auto mb-3" />
              <div className="text-[15px] font-medium text-text mb-1">{t('admin.activity.empty_title')}</div>
              <div className="text-[13px] text-text-muted">{t('admin.activity.empty_desc')}</div>
            </div>
          ) : (
            <>
              <h2 className="text-[11px] uppercase tracking-wider text-text-muted mb-2">
                {t('admin.activity.count', { n: visible.length })}
              </h2>
              <div className="space-y-5">
                {groups.map(([day, items]) => (
                  <div key={day}>
                    <div className="sticky top-0 z-10 -mx-1 px-1 py-1.5 bg-bg/85 backdrop-blur-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-text capitalize">{fmtDayHeading(day)}</span>
                        <span className="text-[11px] text-text-subtle">· {items.length}</span>
                        <span className="flex-1 h-px bg-line" />
                      </div>
                    </div>
                    <FadeIn className="rounded-2xl border border-line overflow-hidden divide-y divide-line bg-surface" y={10}>
                      {items.map((r) => (
                        <LogItem
                          key={r.id}
                          row={r}
                          ctx={r.entity_id ? contexts[`${r.entity_type}:${r.entity_id}`] : undefined}
                          open={expanded === r.id}
                          onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                        />
                      ))}
                    </FadeIn>
                  </div>
                ))}
              </div>

              {!reachedEnd && (
                <div className="flex justify-center mt-5">
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-[13px] font-medium text-text-muted hover:text-text transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
                    {t('admin.activity.load_more')}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// Piezas visuales
// ════════════════════════════════════════════════════════════════════
function KpiCard({ icon: Icon, label, value, color, suffix }: {
  icon: React.ComponentType<{ className?: string }>
  label: string; value: number; color: string; suffix?: string
}) {
  return (
    <StaggerItem className="rounded-2xl border border-line bg-surface p-4 flex flex-col gap-2 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${color}1a`, color }}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] sm:text-[11px] uppercase tracking-wider text-text-muted truncate">{label}</span>
      </div>
      <span className="text-2xl sm:text-3xl font-bold tabular-nums text-text">
        <AnimatedNumber value={value} format={(n) => Math.round(n).toLocaleString(i18n.language)} />{suffix}
      </span>
    </StaggerItem>
  )
}

/** Barras por día con tooltip: el ritmo del equipo de un vistazo. */
function DayBars({ points }: { points: { day: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...points.map((p) => p.count))
  const shown = points.slice(-90)
  return (
    <div className="relative">
      <div className="flex items-end gap-[2px] h-[120px]">
        {shown.map((p, i) => (
          <div
            key={p.day}
            className="flex-1 min-w-[3px] h-full flex items-end"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className={cn(
                'w-full rounded-t-[3px] transition-colors',
                hover === i ? 'bg-[rgb(var(--brand-green))]' : 'bg-[rgb(var(--brand-green))]/40',
              )}
              style={{ height: `${Math.max(2, (p.count / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-2 text-[10.5px] text-text-subtle">
        <span>{shown[0] && fmtDayHeading(shown[0].day)}</span>
        <span>{shown[shown.length - 1] && fmtDayHeading(shown[shown.length - 1].day)}</span>
      </div>
      {hover != null && shown[hover] && (
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1 text-[11.5px] text-text shadow-glass">
          <span className="capitalize">{fmtDayHeading(shown[hover].day)}</span>
          <span className="text-text-muted"> · {shown[hover].count}</span>
        </div>
      )}
    </div>
  )
}

function LogItem({ row, ctx, open, onToggle }: {
  row: ActivityLogRow; ctx?: EntityContext; open: boolean; onToggle: () => void
}) {
  const { t } = useTranslation()
  const meta = ACTION_META[row.action] ?? ACTION_META.update
  const Icon = meta.icon
  const { changes } = splitDetail(row.detail)
  const chip = changeChip(row)

  return (
    <div className={cn(open && 'bg-subtle/30')}>
      <button
        className="w-full grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-3 items-center text-left hover:bg-subtle/50 transition-colors"
        onClick={onToggle}
      >
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg shrink-0"
          style={{ background: `${meta.color}1a`, color: meta.color }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[13.5px] text-text-muted truncate">
            {describe(row)}
            {chip && (
              <span className="ml-1.5 rounded-md bg-subtle px-1.5 py-0.5 text-[11px] text-text">{chip}</span>
            )}
          </div>
          <div className="text-[11px] text-text-muted flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: roleColor(row.actor_role) }}
            />
            {roleLabel(row.actor_role)}
            <span title={fmtDate(row.created_at)}>· {fmtTime(row.created_at)} · {fmtRelative(row.created_at)}</span>
            {ctx?.path?.length ? (
              <span className="truncate text-text-subtle">
                · {ctx.path.map((p) => p.label).join(' › ')}
              </span>
            ) : null}
            {changes.length > 0 && (
              <span className="text-text-subtle">· {t('admin.activity.n_fields', { n: changes.length })}</span>
            )}
            {ctx && !ctx.exists && (
              <span className="rounded-md bg-danger/10 px-1.5 text-[10.5px] text-danger">{t('admin.audit.gone')}</span>
            )}
          </div>
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-text-muted" /> : <ChevronRight className="h-4 w-4 text-text-muted" />}
      </button>
      {open && <EventDetail row={row} ctx={ctx} />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// Panel de detalle del evento
// ════════════════════════════════════════════════════════════════════
type Tab = 'changes' | 'content' | 'history' | 'raw'

function EventDetail({ row, ctx }: { row: ActivityLogRow; ctx?: EntityContext }) {
  const { t } = useTranslation()
  const { changes, extras } = splitDetail(row.detail)
  const [tab, setTab] = useState<Tab>(changes.length > 0 ? 'changes' : 'content')
  const [content, setContent] = useState<ContentDetail | null>(null)
  const [history, setHistory] = useState<ActivityLogRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  // Contenido y historial se cargan sólo cuando se abre la pestaña.
  useEffect(() => {
    if (tab !== 'content' || content || !row.entity_id) return
    setBusy(true)
    getContentDetail(row.entity_type, row.entity_id)
      .then(setContent)
      .finally(() => setBusy(false))
  }, [tab, content, row.entity_type, row.entity_id])

  useEffect(() => {
    if (tab !== 'history' || history || !row.entity_id) return
    setBusy(true)
    getEntityActivity(row.entity_id)
      .then(setHistory)
      .catch((e) => { console.error(e); setHistory([]) })
      .finally(() => setBusy(false))
  }, [tab, history, row.entity_id])

  const copyId = () => {
    navigator.clipboard.writeText(row.entity_id ?? row.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const TABS: { key: Tab; icon: React.ComponentType<{ className?: string }>; label: string; badge?: number }[] = [
    { key: 'changes', icon: FileEdit, label: t('admin.activity.tab_changes'), badge: changes.length },
    { key: 'content', icon: Layers, label: t('admin.activity.tab_content') },
    { key: 'history', icon: History, label: t('admin.activity.tab_history') },
    { key: 'raw', icon: Braces, label: t('admin.activity.tab_raw') },
  ]

  return (
    <div className="px-4 pb-4 pt-1 border-t border-line">
      {/* Cabecera del detalle: quién, cuándo, dónde y accesos directos */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3 text-[11.5px] text-text-muted">
        <span><span className="text-text-subtle">{t('admin.activity.meta_when')}:</span> {fmtDate(row.created_at)}</span>
        <span><span className="text-text-subtle">{t('admin.activity.meta_who')}:</span> {row.actor_name ?? '—'} ({roleLabel(row.actor_role)})</span>
        <span><span className="text-text-subtle">{t('admin.activity.meta_what')}:</span> {actionLabel(row.action)} · {entityLabel(row.entity_type)}</span>
        {row.entity_id && (
          <button onClick={copyId} className="inline-flex items-center gap-1 hover:text-text transition-colors">
            {copied ? <Check className="h-3 w-3 text-[rgb(var(--brand-green))]" /> : <Copy className="h-3 w-3" />}
            <span className="font-mono">{row.entity_id.slice(0, 8)}</span>
          </button>
        )}
        {ctx?.href && ctx.exists && (
          <Link to={ctx.href} className="inline-flex items-center gap-1 text-[rgb(var(--brand-green))] hover:underline">
            <ExternalLink className="h-3 w-3" />
            {t('admin.audit.open')}
          </Link>
        )}
      </div>

      <div className="flex gap-1 rounded-xl border border-line p-0.5 w-fit mb-3">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors',
              tab === tb.key ? 'bg-subtle text-text' : 'text-text-muted hover:text-text',
            )}
          >
            <tb.icon className="h-3.5 w-3.5" />
            {tb.label}
            {tb.badge ? <span className="tabular-nums opacity-60">{tb.badge}</span> : null}
          </button>
        ))}
      </div>

      {busy && <div className="py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-text-subtle" /></div>}

      {tab === 'changes' && !busy && (
        <div className="space-y-3">
          {changes.length === 0 && extras.length === 0 && (
            <p className="text-[12.5px] text-text-muted">{t('admin.activity.no_changes')}</p>
          )}
          {changes.length > 0 && (
            <div className="rounded-xl border border-line overflow-hidden">
              <div className="grid grid-cols-[minmax(90px,160px)_1fr_1fr] gap-2 px-3 py-2 bg-subtle/60 text-[10.5px] uppercase tracking-wider text-text-muted">
                <span>{t('admin.activity.field')}</span>
                <span>{t('admin.activity.field_from')}</span>
                <span>{t('admin.activity.field_to')}</span>
              </div>
              <div className="divide-y divide-line">
                {changes.map((c) => (
                  <div key={c.key} className="grid grid-cols-[minmax(90px,160px)_1fr_1fr] gap-2 px-3 py-2 text-[12px] items-start">
                    <span className="text-text-muted font-mono break-all">{c.key}</span>
                    <pre className="whitespace-pre-wrap break-words text-danger/80 font-sans">{fmtValue(c.from)}</pre>
                    <pre className="whitespace-pre-wrap break-words text-[rgb(var(--brand-green))] font-sans">{fmtValue(c.to)}</pre>
                  </div>
                ))}
              </div>
            </div>
          )}
          {extras.length > 0 && (
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-text-muted mb-1.5">{t('admin.activity.event_data')}</div>
              <div className="rounded-xl border border-line divide-y divide-line">
                {extras.map((e) => (
                  <div key={e.key} className="grid grid-cols-[minmax(90px,160px)_1fr] gap-2 px-3 py-2 text-[12px]">
                    <span className="text-text-muted font-mono break-all">{e.key}</span>
                    <pre className="whitespace-pre-wrap break-words text-text font-sans">{fmtValue(e.value)}</pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'content' && !busy && (
        content && content.exists
          ? <AuditContentPanel detail={content} />
          : (
            <div className="rounded-xl border border-dashed border-line p-5 text-center">
              <p className="text-[13px] text-text mb-1">{t('admin.audit.gone_title')}</p>
              <p className="text-[12px] text-text-muted">{t('admin.audit.gone_desc')}</p>
            </div>
          )
      )}

      {tab === 'history' && !busy && (
        (history?.length ?? 0) === 0 ? (
          <p className="text-[12.5px] text-text-muted">{t('admin.activity.no_history')}</p>
        ) : (
          <ol className="relative border-l border-line ml-2 space-y-3 py-1">
            {history!.map((h) => {
              const m = ACTION_META[h.action] ?? ACTION_META.update
              return (
                <li key={h.id} className="ml-4 relative">
                  <span
                    className="absolute -left-[22px] top-1 inline-flex h-3 w-3 rounded-full ring-4 ring-bg"
                    style={{ background: m.color }}
                  />
                  <div className="text-[12.5px] text-text-muted">{describe(h)}</div>
                  <div className="text-[11px] text-text-subtle">{fmtDate(h.created_at)}</div>
                </li>
              )
            })}
          </ol>
        )
      )}

      {tab === 'raw' && !busy && (
        <pre className="rounded-xl border border-line bg-subtle/40 p-3 text-[11.5px] text-text overflow-x-auto">
          {JSON.stringify(row, null, 2)}
        </pre>
      )}
    </div>
  )
}
