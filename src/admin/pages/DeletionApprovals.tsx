import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import i18n from '@/i18n'
import {
  Loader2, Trash2, RotateCcw, ShieldAlert, Inbox, Search, X, ChevronDown, ChevronRight,
  AlertTriangle, Clock, Layers, History, ExternalLink, CheckSquare, Square, RefreshCw,
} from 'lucide-react'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { Select } from '@/components/ui/Select'
import { FadeIn, Stagger, StaggerItem } from '@/components/ui/motion'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'
import {
  getDeletionRequests, approveDeletion, rejectDeletion, getEntityActivity,
  restoreDeletion, purgeDeletion, purgeExpiredTrash, trashDaysLeft, TRASH_DAYS,
  type DeletionRequestRow, type EntityType, type ActivityLogRow,
} from '@/services/audit.service'
import { getContentDetail, type ContentDetail } from '@/services/auditContext.service'
import { AuditContentPanel } from '../components/AuditContentPanel'

const ENTITY_COLORS: Record<EntityType, string> = {
  campaigns: '#f59e0b',
  courses: '#22c55e',
  modules: '#06b6d4',
  scenarios: '#8b5cf6',
  choice_scenarios: '#a855f7',
  live_quizzes: '#ec4899',
  worlds: '#10b981',
  arena_quizzes: '#ef4444',
  guided_missions: '#3b82f6',
  // No son objetivos de borrado; presentes sólo para satisfacer el Record.
  campaign_collaborators: '#10D451',
  profiles: '#8b5cf6',
  course_assignments: '#22c55e',
  course_campaigns: '#10D451',
  course_exams: '#6366f1',
  exam_unlocks: '#6366f1',
  certifications: '#eab308',
  progress: '#06b6d4',
  gamification: '#a855f7',
}

type StatusTab = 'pending' | 'trashed' | 'approved' | 'rejected' | 'all'
const TABS: StatusTab[] = ['pending', 'trashed', 'approved', 'rejected', 'all']

function entityLabel(type: string): string {
  return i18n.t(`admin.entity_types.${type}`, type)
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(i18n.language, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
function fmtRelative(iso: string) {
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  if (s < 2592000) return rtf.format(-Math.round(s / 86400), 'day')
  return rtf.format(-Math.round(s / 2592000), 'month')
}
function ageDays(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

export default function DeletionApprovals() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [rows, setRows] = useState<DeletionRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tab, setTab] = useState<StatusTab>('pending')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const load = () => {
    setLoading(true)
    setSelected(new Set())
    // Antes de listar, se purga lo que ya cumplió los 30 días. Es la única
    // garantía de que la papelera se vacía sin depender de pg_cron; si el RPC
    // todavía no existe, devuelve 0 y la página sigue igual.
    purgeExpiredTrash()
      .then(() => getDeletionRequests('all'))
      .then(setRows)
      .catch((e) => { console.error('deletion requests error:', e); toast.error(t('admin.approvals.error')) })
      .finally(() => setLoading(false))
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.status === 'pending').length,
    trashed: rows.filter((r) => r.status === 'trashed').length,
    // 'restored' y 'rejected' son lo mismo visto desde dos puertas (papelera y
    // cola de aprobación): se cuentan juntos para no multiplicar pestañas.
    approved: rows.filter((r) => r.status === 'approved').length,
    rejected: rows.filter((r) => r.status === 'rejected' || r.status === 'restored').length,
    all: rows.length,
  }), [rows])

  const typeOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.entity_type))
    return [...set].sort()
  }, [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (tab === 'rejected' && !(r.status === 'rejected' || r.status === 'restored')) return false
      if (tab !== 'all' && tab !== 'rejected' && r.status !== tab) return false
      if (typeFilter !== 'all' && r.entity_type !== typeFilter) return false
      if (!q) return true
      return [r.entity_label, entityLabel(r.entity_type), r.requested_by_name, r.entity_id]
        .filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [rows, tab, typeFilter, search])

  const pendingVisible = visible.filter((r) => r.status === 'pending')
  const oldest = counts.pending > 0
    ? rows.filter((r) => r.status === 'pending').reduce((a, b) => (a.requested_at < b.requested_at ? a : b))
    : null

  const applyResolution = async (r: DeletionRequestRow, kind: 'approve' | 'reject') => {
    if (kind === 'approve') await approveDeletion(r.id)
    else await rejectDeletion(r.id)
    setRows((prev) => prev.map((x) => (
      x.id === r.id
        ? { ...x, status: kind === 'approve' ? 'approved' : 'rejected', resolved_at: new Date().toISOString() }
        : x
    )))
  }

  const handleApprove = async (r: DeletionRequestRow) => {
    const ok = await confirm({
      title: t('admin.approvals.confirm_approve_title'),
      description: t('admin.approvals.confirm_approve_desc', { name: r.entity_label ?? entityLabel(r.entity_type) }),
      confirmLabel: t('admin.approvals.approve'),
    })
    if (!ok) return
    setBusyId(r.id)
    try {
      await applyResolution(r, 'approve')
      toast.success(t('admin.approvals.approved_toast'))
    } catch (e) {
      console.error(e)
      toast.error(t('admin.approvals.error'))
    } finally {
      setBusyId(null)
    }
  }

  const handleReject = async (r: DeletionRequestRow) => {
    setBusyId(r.id)
    try {
      await applyResolution(r, 'reject')
      toast.success(t('admin.approvals.rejected_toast'))
    } catch (e) {
      console.error(e)
      toast.error(t('admin.approvals.error'))
    } finally {
      setBusyId(null)
    }
  }

  // ── Papelera ──────────────────────────────────────────────────────────────
  const handleRestore = async (r: DeletionRequestRow) => {
    setBusyId(r.id)
    try {
      await restoreDeletion(r.id)
      setRows((prev) => prev.map((x) => (
        x.id === r.id ? { ...x, status: 'restored', resolved_at: new Date().toISOString() } : x
      )))
      toast.success(t('admin.approvals.restored_toast'))
    } catch (e) {
      console.error(e)
      toast.error(t('admin.approvals.error'))
    } finally {
      setBusyId(null)
    }
  }

  const handlePurge = async (r: DeletionRequestRow) => {
    const name = r.entity_label ?? entityLabel(r.entity_type)
    const ok = await confirm({
      title: t('admin.approvals.confirm_purge_title'),
      description: t('admin.approvals.confirm_purge_desc', { name }),
      confirmLabel: t('admin.approvals.purge'),
      // Vaciar antes de tiempo es el único paso de aquí sin vuelta atrás.
      requireText: name,
      requireTextLabel: t('admin.approvals.confirm_purge_type'),
    })
    if (!ok) return
    setBusyId(r.id)
    try {
      await purgeDeletion(r.id)
      setRows((prev) => prev.map((x) => (
        x.id === r.id ? { ...x, status: 'approved', resolved_at: new Date().toISOString() } : x
      )))
      toast.success(t('admin.approvals.purged_toast'))
    } catch (e) {
      console.error(e)
      toast.error(t('admin.approvals.error'))
    } finally {
      setBusyId(null)
    }
  }

  const handleBulk = async (kind: 'approve' | 'reject') => {
    const targets = pendingVisible.filter((r) => selected.has(r.id))
    if (targets.length === 0) return
    const ok = await confirm({
      title: kind === 'approve' ? t('admin.approvals.confirm_bulk_approve_title') : t('admin.approvals.confirm_bulk_reject_title'),
      description: kind === 'approve'
        ? t('admin.approvals.confirm_bulk_approve_desc', { n: targets.length })
        : t('admin.approvals.confirm_bulk_reject_desc', { n: targets.length }),
      confirmLabel: kind === 'approve' ? t('admin.approvals.approve') : t('admin.approvals.reject'),
    })
    if (!ok) return
    setBulkBusy(true)
    let done = 0
    for (const r of targets) {
      try {
        await applyResolution(r, kind)
        done += 1
      } catch (e) {
        console.error(e)
      }
    }
    setBulkBusy(false)
    setSelected(new Set())
    toast.success(t('admin.approvals.bulk_done', { n: done }))
  }

  const toggleSel = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const allSelected = pendingVisible.length > 0 && pendingVisible.every((r) => selected.has(r.id))

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1 flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-[rgb(var(--brand-green))]" />
            {t('admin.approvals.title')}
          </h1>
          <p className="text-[13px] text-text-muted">{t('admin.approvals.subtitle', { days: TRASH_DAYS })}</p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-medium text-text-muted hover:text-text transition-colors"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          {t('admin.activity.refresh')}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : (
        <>
          {/* ── KPIs ── */}
          <Stagger as="section" className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-5" gap={0.06}>
            <Kpi icon={Inbox} color="#f59e0b" label={t('admin.approvals.kpi_pending')} value={String(counts.pending)} />
            <Kpi icon={Trash2} color="#06b6d4" label={t('admin.approvals.kpi_trashed')} value={String(counts.trashed)} />
            <Kpi icon={Trash2} color="#ef4444" label={t('admin.approvals.kpi_approved')} value={String(counts.approved)} />
            <Kpi icon={RotateCcw} color="#8b5cf6" label={t('admin.approvals.kpi_rejected')} value={String(counts.rejected)} />
            <Kpi
              icon={Clock} color="#06b6d4" label={t('admin.approvals.kpi_oldest')}
              value={oldest ? t('admin.approvals.days', { n: ageDays(oldest.requested_at) }) : '—'}
            />
          </Stagger>

          {/* ── Pestañas + filtros ── */}
          <div className="flex flex-col gap-3 mb-5">
            <div className="flex flex-wrap items-center gap-2">
              {TABS.map((s) => (
                <button
                  key={s}
                  onClick={() => { setTab(s); setSelected(new Set()) }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                    tab === s
                      ? 'border-[rgb(var(--brand-green))] text-[rgb(var(--brand-green))] bg-[rgb(var(--brand-green))]/10'
                      : 'border-line text-text-muted hover:text-text hover:border-glass-border/30',
                  )}
                >
                  {t(`admin.approvals.tab_${s}`)}
                  <span className="tabular-nums opacity-70">{counts[s]}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted/70" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('admin.approvals.search_ph')}
                  className="w-full rounded-xl border border-line bg-surface pl-9 pr-9 py-2.5 text-[13px] text-text placeholder:text-text-muted/60 outline-none focus:border-[rgb(var(--brand-green))]/40 transition-colors"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                    aria-label={t('admin.activity.clear')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Select
                className="sm:w-[220px]"
                value={typeFilter}
                onChange={setTypeFilter}
                options={[
                  { value: 'all', label: t('admin.activity.filter_all_types') },
                  ...typeOptions.map((tp) => ({ value: tp, label: entityLabel(tp) })),
                ]}
              />
            </div>

            {/* Acciones en lote (sólo sobre pendientes visibles) */}
            {pendingVisible.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setSelected(allSelected ? new Set() : new Set(pendingVisible.map((r) => r.id)))}
                  className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text transition-colors"
                >
                  {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                  {t('admin.approvals.select_all')}
                </button>
                {selected.size > 0 && (
                  <>
                    <span className="text-[12px] text-text-muted">{t('admin.approvals.n_selected', { n: selected.size })}</span>
                    <button
                      onClick={() => handleBulk('reject')}
                      disabled={bulkBusy}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[12px] font-medium text-text-muted hover:text-text transition-colors disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t('admin.approvals.reject')}
                    </button>
                    <button
                      onClick={() => handleBulk('approve')}
                      disabled={bulkBusy}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-danger/30 bg-danger/10 px-3 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/20 transition-colors disabled:opacity-50"
                    >
                      {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      {t('admin.approvals.approve')}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {tab === 'trashed' && (
            <div className="mb-4 rounded-xl border border-cyan-500/25 bg-cyan-500/5 px-3 py-2.5 text-[12.5px] text-text-muted">
              {t('admin.approvals.trash_note', { days: TRASH_DAYS })}
            </div>
          )}

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-6 sm:p-12 text-center">
              <Inbox className="h-7 w-7 text-text-subtle mx-auto mb-3" />
              <div className="text-[15px] font-medium text-text mb-1">{t('admin.approvals.empty_title')}</div>
              <div className="text-[13px] text-text-muted">{t('admin.approvals.empty_desc')}</div>
            </div>
          ) : (
            <>
              <h2 className="text-[11px] uppercase tracking-wider text-text-muted mb-2">
                {t('admin.approvals.count', { n: visible.length })}
              </h2>
              <FadeIn className="rounded-2xl border border-line overflow-hidden divide-y divide-line bg-surface" y={14}>
                {visible.map((r) => (
                  <RequestRow
                    key={r.id}
                    row={r}
                    busy={busyId === r.id}
                    open={expanded === r.id}
                    selected={selected.has(r.id)}
                    onSelect={() => toggleSel(r.id)}
                    onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                    onApprove={() => handleApprove(r)}
                    onReject={() => handleReject(r)}
                    onRestore={() => handleRestore(r)}
                    onPurge={() => handlePurge(r)}
                  />
                ))}
              </FadeIn>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, color }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string; color: string
}) {
  return (
    <StaggerItem className="rounded-2xl border border-line bg-surface p-4 flex flex-col gap-2 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${color}1a`, color }}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] sm:text-[11px] uppercase tracking-wider text-text-muted truncate">{label}</span>
      </div>
      <span className="text-2xl sm:text-3xl font-bold tabular-nums text-text">{value}</span>
    </StaggerItem>
  )
}

function RequestRow({ row, busy, open, selected, onSelect, onToggle, onApprove, onReject, onRestore, onPurge }: {
  row: DeletionRequestRow
  busy: boolean; open: boolean; selected: boolean
  onSelect: () => void; onToggle: () => void
  onApprove: () => void; onReject: () => void
  onRestore: () => void; onPurge: () => void
}) {
  const { t } = useTranslation()
  const color = ENTITY_COLORS[row.entity_type] ?? '#94a3b8'
  const isPending = row.status === 'pending'
  const isTrashed = row.status === 'trashed'
  const daysLeft = isTrashed ? trashDaysLeft(row.requested_at) : 0

  return (
    <div className={cn(open && 'bg-subtle/30')}>
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-3 px-4 py-3 items-center transition-colors hover:bg-subtle/40">
        <div className="flex items-center gap-2 shrink-0">
          {isPending && (
            <button onClick={onSelect} className="text-text-muted hover:text-text" aria-label={t('admin.approvals.select_all')}>
              {selected ? <CheckSquare className="h-4 w-4 text-[rgb(var(--brand-green))]" /> : <Square className="h-4 w-4" />}
            </button>
          )}
          <button onClick={onToggle} className="text-text-muted hover:text-text" aria-label={t('admin.activity.tab_content')}>
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <span
            className="inline-flex items-center rounded-full px-2 py-1 text-[10.5px] font-medium"
            style={{ background: `${color}1a`, color }}
          >
            {entityLabel(row.entity_type)}
          </span>
        </div>

        <button onClick={onToggle} className="min-w-0 text-left">
          <div className="text-[14px] text-text truncate font-medium">
            {row.entity_label ?? '—'}
          </div>
          <div className="text-[11.5px] text-text-muted truncate">
            {t('admin.approvals.requested_by')}: {row.requested_by_name ?? t('admin.approvals.unknown_user')}
            {' · '}{fmtDate(row.requested_at)}{' · '}{fmtRelative(row.requested_at)}
            {isTrashed && (
              <span className={cn(
                'ml-1.5 rounded-md px-1.5 py-0.5 text-[10.5px] tabular-nums',
                // Los últimos días se avisan en ámbar: después ya no hay vuelta.
                daysLeft <= 5 ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
              )}>
                {t('admin.approvals.days_left', { n: daysLeft })}
              </span>
            )}
            {row.status !== 'pending' && !isTrashed && (
              <span className={cn(
                'ml-1.5 rounded-md px-1.5 py-0.5 text-[10.5px]',
                row.status === 'approved' ? 'bg-danger/10 text-danger' : 'bg-subtle text-text-muted',
              )}>
                {t(`admin.approvals.status_${row.status}`)}
                {row.resolved_at ? ` · ${fmtDate(row.resolved_at)}` : ''}
              </span>
            )}
          </div>
        </button>

        {isPending ? (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onReject}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-medium text-text-muted hover:text-text hover:border-glass-border/30 transition-colors disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('admin.approvals.reject')}
            </button>
            <button
              onClick={onApprove}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] font-medium text-danger hover:bg-danger/20 transition-colors disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {t('admin.approvals.approve')}
            </button>
          </div>
        ) : isTrashed ? (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onPurge}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-medium text-text-muted hover:text-danger hover:border-danger/30 transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('admin.approvals.purge')}
            </button>
            <button
              onClick={onRestore}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[rgb(var(--brand-green))]/30 bg-[rgb(var(--brand-green))]/10 px-3 py-2 text-[12.5px] font-medium text-[rgb(var(--brand-green))] hover:bg-[rgb(var(--brand-green))]/20 transition-colors disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              {t('admin.approvals.restore')}
            </button>
          </div>
        ) : <span />}
      </div>

      {open && <RequestDetail row={row} />}
    </div>
  )
}

/** Qué contiene y qué se destruiría: se carga al desplegar la solicitud. */
function RequestDetail({ row }: { row: DeletionRequestRow }) {
  const { t } = useTranslation()
  const [detail, setDetail] = useState<ContentDetail | null>(null)
  const [history, setHistory] = useState<ActivityLogRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      getContentDetail(row.entity_type, row.entity_id),
      getEntityActivity(row.entity_id, 15).catch(() => [] as ActivityLogRow[]),
    ])
      .then(([d, h]) => { if (!alive) return; setDetail(d); setHistory(h) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [row.entity_type, row.entity_id])

  if (loading) {
    return <div className="px-4 pb-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-text-subtle" /></div>
  }

  // Los conteos en cero no aportan; el peso ("1,2 MB") es texto y siempre entra.
  const impact = (detail?.impact ?? []).filter(
    (i) => (typeof i.value === 'number' ? i.value > 0 : String(i.value).trim() !== ''),
  )

  return (
    <div className="px-4 pb-4 border-t border-line space-y-4 pt-3">
      {/* Impacto: lo que desaparece si se aprueba */}
      {impact.length > 0 && (
        <div className="rounded-xl border border-danger/25 bg-danger/5 p-3">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-danger mb-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('admin.approvals.impact_title')}
          </div>
          <div className="flex flex-wrap gap-2">
            {impact.map((i) => (
              <span key={i.labelKey} className="rounded-lg bg-danger/10 px-2 py-1 text-[11.5px] text-danger tabular-nums">
                {i.value} {t(i.labelKey).toLowerCase()}
              </span>
            ))}
          </div>
        </div>
      )}

      {detail?.exists ? (
        <div>
          <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-text-muted mb-2">
            <Layers className="h-3.5 w-3.5" />
            {t('admin.approvals.content_title')}
            {detail.href && (
              <Link to={detail.href} className="ml-1 inline-flex items-center gap-1 text-[rgb(var(--brand-green))] normal-case tracking-normal hover:underline">
                <ExternalLink className="h-3 w-3" />
                {t('admin.audit.open')}
              </Link>
            )}
          </div>
          <AuditContentPanel detail={detail} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-line p-4 text-center">
          <p className="text-[13px] text-text mb-1">{t('admin.approvals.no_content_title')}</p>
          <p className="text-[12px] text-text-muted">{t('admin.approvals.no_content_desc')}</p>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-text-muted mb-2">
            <History className="h-3.5 w-3.5" />
            {t('admin.approvals.history_title')}
          </div>
          <ol className="relative border-l border-line ml-2 space-y-2.5 py-1">
            {history.map((h) => (
              <li key={h.id} className="ml-4 relative">
                <span className="absolute -left-[22px] top-1 inline-flex h-2.5 w-2.5 rounded-full bg-text-subtle ring-4 ring-bg" />
                <div className="text-[12.5px] text-text-muted">
                  <span className="font-medium text-text">{h.actor_name ?? '—'}</span>{' '}
                  {i18n.t(`admin.activity.action_${h.action}`, h.action).toLowerCase()}
                </div>
                <div className="text-[11px] text-text-subtle">{fmtDate(h.created_at)}</div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="text-[11px] text-text-subtle font-mono">{row.entity_type} · {row.entity_id}</div>
    </div>
  )
}
