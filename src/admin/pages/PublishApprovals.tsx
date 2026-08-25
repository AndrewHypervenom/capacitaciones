import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import i18n from '@/i18n'
import {
  Loader2, ShieldCheck, Inbox, Search, X, Check, Undo2, Clock, RefreshCw,
  BookOpen, Users, ExternalLink, AlertTriangle, Lock, Building2,
} from 'lucide-react'

import { fold } from '@/lib/normalize'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import { FadeIn, Stagger, StaggerItem } from '@/components/ui/motion'
import { Tooltip } from '@/components/ui/Tooltip'
import { EntityIcon } from '@/components/ui/EntityIcon'
import { PublicationDecisionModal, type PublicationDecision } from '@/admin/components/PublicationDecisionModal'
import {
  getCoursePublicationRequests,
  approveCoursePublication,
  rejectCoursePublication,
  revokeCoursePublication,
  type CoursePublicationRequest,
  type CourseApprovalStatus,
} from '@/services/courseApprovals.service'
import { invalidateModulesCache } from '@/hooks/useModules'
import { invalidateLearnerCoursesCache } from '@/hooks/useLearnerCourses'
import { usePendingPublicationsStore } from '@/stores/pendingPublicationsStore'

type Tab = CourseApprovalStatus | 'all'
const TABS: Tab[] = ['pending', 'rejected', 'approved', 'draft', 'all']

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

/**
 * Bandeja del aprobador: qué cursos están esperando el permiso para verse.
 *
 * Es la otra mitad de la puerta que instaló el SQL de aprobación de
 * publicaciones. El capacitador termina su curso y lo pide; aquí se aprueba (y
 * sale a producción en ese mismo acto) o se devuelve con un motivo que le llega
 * por la campana y le queda escrito en el editor.
 *
 * Quién entra: el superadmin siempre, y el capacitador al que el superadmin le
 * marcó el permiso en /admin/users. La ruta lo filtra y el RPC lo vuelve a
 * comprobar por dentro: la bandeja no es el candado, es la ventana.
 */
export default function PublishApprovals() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<CoursePublicationRequest[]>([])
  const [loading, setLoading] = useState(true)
  /** true cuando el RPC no existe: falta correr el SQL. */
  const [notReady, setNotReady] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('pending')
  const [search, setSearch] = useState('')
  const [decision, setDecision] = useState<{ kind: PublicationDecision; row: CoursePublicationRequest } | null>(null)

  // El globo del menú y la tarjeta del tablero cuentan lo mismo que esta
  // bandeja. Como aquí las filas ya están en la mano, el número se le pasa
  // hecho: pedirle al servidor un conteo que acabamos de traer sería una
  // segunda vuelta para nada.
  const setBadge = usePendingPublicationsStore((s) => s.setCount)

  const load = () => {
    setLoading(true)
    getCoursePublicationRequests('all')
      .then((data) => {
        if (data === null) { setNotReady(true); setRows([]); return }
        setNotReady(false)
        setRows(data)
        setBadge(data.filter((r) => r.approval_status === 'pending').length)
      })
      .catch((e) => {
        console.error('[PublishApprovals] load', e)
        toast.error(t('admin.publish_approvals.error'))
      })
      .finally(() => setLoading(false))
  }
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.approval_status === 'pending').length,
    rejected: rows.filter((r) => r.approval_status === 'rejected').length,
    approved: rows.filter((r) => r.approval_status === 'approved').length,
    draft: rows.filter((r) => r.approval_status === 'draft').length,
    all: rows.length,
  }), [rows])

  const oldest = counts.pending > 0
    ? rows
        .filter((r) => r.approval_status === 'pending' && r.approval_requested_at)
        .reduce<CoursePublicationRequest | null>(
          (a, b) => (a && a.approval_requested_at! < b.approval_requested_at! ? a : b),
          null,
        )
    : null

  const visible = useMemo(() => {
    // Búsqueda sin tildes: "Telefonia" tiene que encontrar "Telefonía".
    const q = fold(search.trim())
    return rows.filter((r) => {
      if (tab !== 'all' && r.approval_status !== tab) return false
      if (!q) return true
      return fold([r.title, r.campaign_name, r.requested_by_name].filter(Boolean).join(' ')).includes(q)
    })
  }, [rows, tab, search])

  /**
   * Tras resolver, la fila se recarga del servidor: nada de estado adivinado. El
   * globo se actualiza solo, porque `load()` se lo vuelve a fijar con lo que
   * traiga.
   */
  const afterDecision = () => {
    invalidateModulesCache()
    invalidateLearnerCoursesCache()
    load()
  }

  const handleApprove = async (r: CoursePublicationRequest) => {
    setBusyId(r.course_id)
    try {
      await approveCoursePublication(r.course_id)
      toast.success(t('admin.publish_approvals.approved_ok', { name: r.title }))
      afterDecision()
    } catch (e) {
      console.error('[PublishApprovals] approve', e)
      toast.error(t('admin.publish_approvals.error'), e instanceof Error ? e.message : undefined)
    } finally {
      setBusyId(null)
    }
  }

  const handleDecision = async (note: string) => {
    if (!decision) return
    const { kind, row } = decision
    if (kind === 'reject') await rejectCoursePublication(row.course_id, note)
    else await revokeCoursePublication(row.course_id, note)
    toast.success(
      kind === 'reject'
        ? t('admin.publish_approvals.rejected_ok', { name: row.title })
        : t('admin.publish_approvals.revoked_ok', { name: row.title }),
    )
    afterDecision()
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-[rgb(var(--brand-green))]" />
            {t('admin.publish_approvals.title')}
          </h1>
          <p className="text-[13px] text-text-muted">{t('admin.publish_approvals.subtitle')}</p>
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
      ) : notReady ? (
        <FadeIn className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.08] px-4 py-5 text-[13px] text-amber-600">
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
            {t('admin.publish_approvals.sql_pending')}
          </p>
          <p className="mt-1.5 pl-6 text-text-muted">{t('admin.publish_approvals.sql_pending_body')}</p>
        </FadeIn>
      ) : (
        <>
          {/* ── KPIs ── */}
          <Stagger as="section" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5" gap={0.06}>
            <Kpi icon={Inbox} color="#f59e0b" label={t('admin.publish_approvals.kpi_pending')} value={String(counts.pending)} />
            <Kpi icon={Undo2} color="#8b5cf6" label={t('admin.publish_approvals.kpi_rejected')} value={String(counts.rejected)} />
            <Kpi icon={Check} color="#10D451" label={t('admin.publish_approvals.kpi_approved')} value={String(counts.approved)} />
            <Kpi
              icon={Clock} color="#06b6d4" label={t('admin.publish_approvals.kpi_oldest')}
              value={oldest?.approval_requested_at
                ? t('admin.approvals.days', { n: ageDays(oldest.approval_requested_at) })
                : '—'}
            />
          </Stagger>

          {/* ── Pestañas + búsqueda ── */}
          <div className="flex flex-col gap-3 mb-5">
            <div className="flex flex-wrap items-center gap-2">
              {TABS.map((s) => (
                <button
                  key={s}
                  onClick={() => setTab(s)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                    tab === s
                      ? 'border-[rgb(var(--brand-green))] text-[rgb(var(--brand-green))] bg-[rgb(var(--brand-green))]/10'
                      : 'border-line text-text-muted hover:text-text hover:border-glass-border/30',
                  )}
                >
                  {t(`admin.publish_approvals.tab_${s}`)}
                  <span className="tabular-nums opacity-70">{counts[s]}</span>
                </button>
              ))}
            </div>
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-subtle" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('admin.publish_approvals.search_ph')}
                className="w-full rounded-xl border border-line bg-surface pl-9 pr-9 py-2.5 text-[13px] text-text placeholder:text-text-subtle outline-none focus:border-primary"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-lg text-text-subtle hover:text-text"
                  aria-label={t('common.close', 'Cerrar')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* ── Lista ── */}
          {visible.length === 0 ? (
            <FadeIn className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface py-16">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-text-subtle">
                <Inbox className="h-6 w-6" />
              </span>
              <p className="text-[13px] text-text-muted">
                {tab === 'pending'
                  ? t('admin.publish_approvals.empty_pending')
                  : t('admin.publish_approvals.empty')}
              </p>
            </FadeIn>
          ) : (
            <Stagger className="space-y-2.5" gap={0.04}>
              {visible.map((r) => (
                <CourseRow
                  key={r.course_id}
                  row={r}
                  busy={busyId === r.course_id}
                  onApprove={() => handleApprove(r)}
                  onReject={() => setDecision({ kind: 'reject', row: r })}
                  onRevoke={() => setDecision({ kind: 'revoke', row: r })}
                />
              ))}
            </Stagger>
          )}
        </>
      )}

      {decision && (
        <PublicationDecisionModal
          kind={decision.kind}
          courseTitle={decision.row.title}
          onClose={() => setDecision(null)}
          onConfirm={handleDecision}
        />
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

const STATUS_COLOR: Record<CourseApprovalStatus, string> = {
  pending: '#f59e0b',
  approved: '#10D451',
  rejected: '#8b5cf6',
  draft: '#94a3b8',
}

function CourseRow({ row, busy, onApprove, onReject, onRevoke }: {
  row: CoursePublicationRequest
  busy: boolean
  onApprove: () => void
  onReject: () => void
  onRevoke: () => void
}) {
  const { t } = useTranslation()
  const color = STATUS_COLOR[row.approval_status]
  const modulesReady = row.modules_total > 0 && row.modules_published === row.modules_total

  return (
    <StaggerItem className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ background: row.color }}
        >
          <EntityIcon value={row.icon} fallback="🎓" size={18} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-text break-words [overflow-wrap:anywhere]">
              {row.title}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ background: `${color}1f`, color }}
            >
              {t(`admin.publish_approvals.status_${row.approval_status}`)}
            </span>
            {row.is_published && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                {t('admin.courses.published')}
              </span>
            )}
          </div>

          {/* Lo que hace falta para decidir sin abrir el curso. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-muted">
            {row.campaign_name && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" /> {row.campaign_name}
              </span>
            )}
            <Tooltip label={t('admin.publish_approvals.modules_hint')} maxWidth={240}>
              <span className={cn('inline-flex items-center gap-1', !modulesReady && 'text-amber-500')}>
                <BookOpen className="h-3.5 w-3.5" />
                {t('admin.courses.modules_published_count', { n: row.modules_published, total: row.modules_total })}
              </span>
            </Tooltip>
            <Tooltip label={t('admin.publish_approvals.audience_hint')} maxWidth={240}>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> {row.audience_count}
              </span>
            </Tooltip>
            {row.approval_requested_at && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {t('admin.publish_approvals.requested_by', {
                  name: row.requested_by_name,
                  when: fmtRelative(row.approval_requested_at),
                })}
              </span>
            )}
          </div>

          {/* El motivo del último rechazo: es lo que el capacitador está leyendo. */}
          {row.approval_note && (
            <p className="mt-2 rounded-xl border border-line bg-subtle px-3 py-2 text-[12px] text-text-muted break-words [overflow-wrap:anywhere]">
              {t('admin.courses.approval_note_prefix', { note: row.approval_note })}
            </p>
          )}

          {row.approval_status === 'pending' && row.modules_total === 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-[12px] text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
              {t('admin.publish_approvals.warn_no_modules')}
            </p>
          )}
          {row.approval_status === 'pending' && row.audience_count === 0 && (
            <p className="mt-1 flex items-start gap-1.5 text-[12px] text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
              {t('admin.publish_approvals.warn_no_audience')}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Link
            to={`/admin/courses/${row.course_id}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-medium text-text-muted hover:text-text transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('admin.publish_approvals.review')}
          </Link>

          {row.approval_status === 'pending' && (
            <>
              <button
                onClick={onApprove}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-medium text-black disabled:opacity-50"
                style={{ background: '#10D451' }}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {t('admin.publish_approvals.approve')}
              </button>
              <button
                onClick={onReject}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-medium text-text-muted hover:text-amber-500 hover:border-amber-500/40 transition-colors disabled:opacity-50"
              >
                <Undo2 className="h-3.5 w-3.5" />
                {t('admin.publish_approvals.reject')}
              </button>
            </>
          )}

          {row.approval_status === 'approved' && row.is_published && (
            <button
              onClick={onRevoke}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-medium text-text-muted hover:text-amber-500 hover:border-amber-500/40 transition-colors disabled:opacity-50"
            >
              <Lock className="h-3.5 w-3.5" />
              {t('admin.publish_approvals.revoke')}
            </button>
          )}
        </div>
      </div>
    </StaggerItem>
  )
}
