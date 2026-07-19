import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { Loader2, Trash2, RotateCcw, ShieldAlert, Inbox } from 'lucide-react'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { FadeIn } from '@/components/ui/motion'
import { toast } from '@/stores/toastStore'
import {
  getPendingDeletions, approveDeletion, rejectDeletion,
  type DeletionRequestRow, type EntityType,
} from '@/services/audit.service'

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
}

function entityLabel(type: string): string {
  return i18n.t(`admin.entity_types.${type}`, type)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(i18n.language, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function DeletionApprovals() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [rows, setRows] = useState<DeletionRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    getPendingDeletions()
      .then(setRows)
      .catch((e) => console.error('deletion requests error:', e))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const handleApprove = async (r: DeletionRequestRow) => {
    const ok = await confirm({
      title: t('admin.approvals.confirm_approve_title'),
      description: t('admin.approvals.confirm_approve_desc', { name: r.entity_label ?? entityLabel(r.entity_type) }),
      confirmLabel: t('admin.approvals.approve'),
    })
    if (!ok) return
    setBusyId(r.id)
    try {
      await approveDeletion(r.id)
      setRows((prev) => prev.filter((x) => x.id !== r.id))
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
      await rejectDeletion(r.id)
      setRows((prev) => prev.filter((x) => x.id !== r.id))
      toast.success(t('admin.approvals.rejected_toast'))
    } catch (e) {
      console.error(e)
      toast.error(t('admin.approvals.error'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1 flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-[rgb(var(--brand-green))]" />
          {t('admin.approvals.title')}
        </h1>
        <p className="text-[13px] text-text-muted">{t('admin.approvals.subtitle')}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-6 sm:p-12 text-center">
          <Inbox className="h-7 w-7 text-text-subtle mx-auto mb-3" />
          <div className="text-[15px] font-medium text-text mb-1">{t('admin.approvals.empty_title')}</div>
          <div className="text-[13px] text-text-muted">{t('admin.approvals.empty_desc')}</div>
        </div>
      ) : (
        <>
          <h2 className="text-[11px] uppercase tracking-wider text-text-muted mb-2">
            {t('admin.approvals.count', { n: rows.length })}
          </h2>
          <FadeIn className="rounded-2xl border border-line overflow-hidden divide-y divide-line" y={14}>
            {rows.map((r) => {
              const color = ENTITY_COLORS[r.entity_type] ?? '#94a3b8'
              const busy = busyId === r.id
              return (
                <div key={r.id} className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 px-4 py-3 items-center transition-colors hover:bg-subtle/40">
                  <div className="min-w-0 flex items-center gap-3">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-1 text-[10.5px] font-medium shrink-0"
                      style={{ background: `${color}1a`, color }}
                    >
                      {entityLabel(r.entity_type)}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[14px] text-text truncate font-medium">
                        {r.entity_label ?? '—'}
                      </div>
                      <div className="text-[11.5px] text-text-muted truncate">
                        {t('admin.approvals.requested_by')}: {r.requested_by_name ?? t('admin.approvals.unknown_user')} · {fmtDate(r.requested_at)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleReject(r)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12.5px] font-medium text-text-muted hover:text-text hover:border-glass-border/30 transition-colors disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t('admin.approvals.reject')}
                    </button>
                    <button
                      onClick={() => handleApprove(r)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] font-medium text-danger hover:bg-danger/20 transition-colors disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      {t('admin.approvals.approve')}
                    </button>
                  </div>
                </div>
              )
            })}
          </FadeIn>
        </>
      )}
    </div>
  )
}
