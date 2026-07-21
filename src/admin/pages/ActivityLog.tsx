import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import {
  Loader2, Activity, ChevronDown, ChevronRight,
  Plus, Pencil, EyeOff, RotateCcw, Trash2, ShieldCheck, Share2,
  UserMinus, UserPlus, UserX, UserCog, ArrowRightLeft, Send, Undo2,
  Award, RefreshCw, MessageSquare, FileEdit,
} from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { FadeIn } from '@/components/ui/motion'
import {
  getActivityLog, type ActivityLogRow, type ActivityAction, type EntityType,
} from '@/services/audit.service'

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
  'create_user', 'delete_user',
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
}

/** Etiqueta corta del tipo (para los filtros y chips). */
function entityLabel(type: string): string {
  return i18n.t(`admin.entity_types.${type}`, type)
}
/** Tipo con artículo, para las frases ("el curso", "la campaña", …). */
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
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
function roleColor(role: string | null): string {
  if (role === 'superadmin') return '#f59e0b'
  if (role === 'capacitador') return '#8b5cf6'
  return '#94a3b8'
}
/** Renderiza un valor jsonb de forma compacta para la vista de cambios. */
function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '∅'
  if (typeof v === 'string') return v.length > 120 ? v.slice(0, 120) + '…' : v
  if (typeof v === 'object') {
    const s = JSON.stringify(v)
    return s.length > 120 ? s.slice(0, 120) + '…' : s
  }
  return String(v)
}

/**
 * Rellena una plantilla con tokens {{actor}}, {{type}}, {{label}}, {{target}},
 * {{count}}. Los nombres (actor/label/target) van en negrita; el resto en el
 * tono atenuado del contenedor. Así cada evento se lee como una frase natural.
 */
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

/** Construye la frase del evento a partir de su acción y datos. */
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

  // La carga masiva de usuarios llega como create_user con {count} y sin etiqueta.
  const action =
    row.action === 'create_user' && detail.count != null ? 'create_user_bulk' : row.action

  const tpl = i18n.t(`admin.activity.tpl_${action}`, '')
  if (tpl) return renderTemplate(tpl, parts)

  // Respaldo genérico si faltara la plantilla: "actor acción tipo label".
  return renderTemplate('{{actor}} {{type}} {{label}}', parts)
}

/** Chip de detalle inline para cambios con from→to (rol/campaña). */
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

export default function ActivityLog() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<ActivityLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actorId, setActorId] = useState('all')
  const [entityType, setEntityType] = useState<'all' | EntityType>('all')
  const [action, setAction] = useState<'all' | ActivityAction>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getActivityLog({
      entityType: entityType === 'all' ? undefined : entityType,
      action: action === 'all' ? undefined : action,
      actorId: actorId === 'all' ? undefined : actorId,
      limit: 300,
    })
      .then((d) => { if (alive) setRows(d) })
      .catch((e) => console.error('activity log error:', e))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [entityType, action, actorId])

  // Opciones de actor derivadas de lo cargado (evita un query extra).
  const [actorOptions, setActorOptions] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    setActorOptions((prev) => {
      const map = new Map(prev.map((a) => [a.id, a.name]))
      for (const r of rows) {
        if (r.actor_id && !map.has(r.actor_id)) map.set(r.actor_id, r.actor_name ?? r.actor_id.slice(0, 8))
      }
      return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
    })
  }, [rows])

  const grouped = useMemo(() => rows, [rows])

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1 flex items-center gap-2">
          <Activity className="h-6 w-6 text-[rgb(var(--brand-green))]" />
          {t('admin.activity.title')}
        </h1>
        <p className="text-[13px] text-text-muted">{t('admin.activity.subtitle')}</p>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <Select
          className="sm:w-auto sm:min-w-[200px]"
          value={actorId}
          onChange={setActorId}
          options={[
            { value: 'all', label: t('admin.activity.filter_all_actors') },
            ...actorOptions.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
        <Select
          className="sm:w-auto sm:min-w-[180px]"
          value={entityType}
          onChange={(v) => setEntityType(v as 'all' | EntityType)}
          options={[
            { value: 'all', label: t('admin.activity.filter_all_types') },
            ...ENTITY_TYPES.map((e) => ({ value: e, label: entityLabel(e) })),
          ]}
        />
        <Select
          className="sm:w-auto sm:min-w-[180px]"
          value={action}
          onChange={(v) => setAction(v as 'all' | ActivityAction)}
          options={[
            { value: 'all', label: t('admin.activity.filter_all_actions') },
            ...ACTIONS.map((a) => ({ value: a, label: actionLabel(a) })),
          ]}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-6 sm:p-12 text-center">
          <Activity className="h-7 w-7 text-text-subtle mx-auto mb-3" />
          <div className="text-[15px] font-medium text-text mb-1">{t('admin.activity.empty_title')}</div>
          <div className="text-[13px] text-text-muted">{t('admin.activity.empty_desc')}</div>
        </div>
      ) : (
        <>
          <h2 className="text-[11px] uppercase tracking-wider text-text-muted mb-2">
            {t('admin.activity.count', { n: grouped.length })}
          </h2>
          <FadeIn className="rounded-2xl border border-line overflow-hidden divide-y divide-line" y={14}>
            {grouped.map((r) => (
              <LogItem
                key={r.id}
                row={r}
                open={expanded === r.id}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
              />
            ))}
          </FadeIn>
        </>
      )}
    </div>
  )
}

function LogItem({ row, open, onToggle }: { row: ActivityLogRow; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const meta = ACTION_META[row.action] ?? ACTION_META.update
  const Icon = meta.icon
  // El desglose de campos sólo aplica a ediciones con forma {from,to}.
  const hasDetail =
    row.action === 'update' &&
    !!row.detail &&
    Object.values(row.detail).every((v) => v && typeof v === 'object' && 'from' in (v as object)) &&
    Object.keys(row.detail).length > 0
  const changedKeys = hasDetail ? Object.keys(row.detail!) : []
  const chip = changeChip(row)

  return (
    <div>
      <button
        className="w-full grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-3 items-center text-left hover:bg-subtle/50 transition-colors"
        onClick={hasDetail ? onToggle : undefined}
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg shrink-0"
          style={{ background: `${meta.color}1a`, color: meta.color }}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <div className="text-[13.5px] text-text-muted truncate">
            {describe(row)}
            {chip && (
              <span className="ml-1.5 rounded-md bg-subtle px-1.5 py-0.5 text-[11px] text-text">
                {chip}
              </span>
            )}
          </div>
          <div className="text-[11px] text-text-muted truncate flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: roleColor(row.actor_role) }}
            />
            {roleLabel(row.actor_role)} · {fmtDate(row.created_at)}
            {hasDetail && <span className="text-text-subtle">· {changedKeys.length} {t('admin.activity.changed_fields').toLowerCase()}</span>}
          </div>
        </div>
        {hasDetail ? (
          open ? <ChevronDown className="h-4 w-4 text-text-muted" /> : <ChevronRight className="h-4 w-4 text-text-muted" />
        ) : <span />}
      </button>
      {open && hasDetail && (
        <div className="px-4 pb-4 pt-1 bg-subtle/40 border-t border-line">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2">{t('admin.activity.changed_fields')}</div>
          <div className="space-y-1.5">
            {changedKeys.map((k) => {
              const change = row.detail![k] as { from: unknown; to: unknown }
              return (
                <div key={k} className="grid grid-cols-[minmax(80px,140px)_1fr] gap-3 text-[12px]">
                  <span className="text-text-muted truncate">{k}</span>
                  <span className="min-w-0 break-words">
                    <span className="text-danger/80 line-through">{fmtValue(change?.from)}</span>
                    <span className="text-text-muted mx-1.5">→</span>
                    <span className="text-[rgb(var(--brand-green))]">{fmtValue(change?.to)}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
