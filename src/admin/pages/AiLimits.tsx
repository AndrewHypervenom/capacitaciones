import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check, Clock, Gauge, History, Infinity as InfinityIcon, Loader2, Plus, RotateCcw,
  Search, Settings2, ShieldAlert, Sparkles, TriangleAlert, X, Zap,
} from 'lucide-react'
import i18n from '@/i18n'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { Avatar } from '@/components/ui/Avatar'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { FadeIn } from '@/components/ui/motion'
import {
  getAiDefaultLimit, getAiOperations, getAiQuotaOverview, grantAiBonus,
  setAiDefaultLimit, setAiUserLimit,
  type AiOperationRow, type AiQuotaRow,
} from '@/services/aiQuota.service'

/**
 * /admin/limits — cupo diario de operaciones con IA.
 *
 * Existe para que el gasto no dependa de la buena voluntad: cada capacitador
 * tiene N operaciones por día (una operación = un módulo, un mundo, un
 * simulador, una traducción) y desde acá el superadmin sube el techo global,
 * hace excepciones por persona o regala un extra puntual para hoy.
 *
 * La pantalla está armada para que NO se pueda meter la pata sin enterarse:
 * cada cambio que puede dejar a alguien bloqueado (o sin techo) avisa antes de
 * guardar, dice a cuánta gente afecta y muestra quién tocó la excepción por
 * última vez, para que dos superadmins no se pisen a ciegas.
 */

type Filter = 'all' | 'capped' | 'exceptions'

export default function AiLimits() {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [rows, setRows] = useState<AiQuotaRow[]>([])
  const [ops, setOps] = useState<AiOperationRow[]>([])
  const [defaultLimit, setDefaultLimit] = useState(10)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<AiQuotaRow | null>(null)
  /** Fila que acaba de cambiar: destella en verde para confirmar visualmente. */
  const [flashId, setFlashId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [overview, def, log] = await Promise.all([
        getAiQuotaOverview(),
        getAiDefaultLimit(),
        getAiOperations(40).catch(() => [] as AiOperationRow[]),
      ])
      setRows(overview)
      setDefaultLimit(def)
      setOps(log)
    } catch (e) {
      console.error('[AiLimits] load', e)
      toast.error(t('admin.ai_limits.load_error'), e instanceof Error ? e.message : undefined)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  const flash = useCallback((id: string) => {
    setFlashId(id)
    setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1600)
  }, [])

  const counts = useMemo(() => {
    const capped = rows.filter((r) => isCapped(r)).length
    const exceptions = rows.filter((r) => hasException(r)).length
    return { all: rows.length, capped, exceptions }
  }, [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => {
        if (filter === 'capped' && !isCapped(r)) return false
        if (filter === 'exceptions' && !hasException(r)) return false
        if (!q) return true
        return (r.display_name ?? '').toLowerCase().includes(q)
          || (r.email ?? '').toLowerCase().includes(q)
          || (r.campaign_name ?? '').toLowerCase().includes(q)
      })
      // Los superadmin van de últimos: no topan nunca, así que arriba solo
      // estorban a quien de verdad hay que gestionar (los capacitadores).
      .sort((a, b) => {
        const aSuper = a.role === 'superadmin' ? 1 : 0
        const bSuper = b.role === 'superadmin' ? 1 : 0
        if (aSuper !== bSuper) return aSuper - bSuper
        if (a.used_today !== b.used_today) return b.used_today - a.used_today
        return (a.display_name ?? '').localeCompare(b.display_name ?? '')
      })
  }, [rows, search, filter])

  const usedToday = useMemo(() => rows.reduce((n, r) => n + r.used_today, 0), [rows])

  /** "+N hoy" de un clic: es lo que el superadmin hace el 90% de las veces. */
  const handleQuickBonus = async (row: AiQuotaRow, ops_: number) => {
    setBusyId(row.user_id)
    try {
      await grantAiBonus(row.user_id, ops_)
      await load()
      flash(row.user_id)
      toast.success(t('admin.ai_limits.bonus_granted', { n: ops_, name: row.display_name }))
    } catch (e) {
      toast.error(t('admin.ai_limits.save_error'), e instanceof Error ? e.message : undefined)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-4 sm:p-8">
      <FadeIn>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="mb-1 text-[20px] font-bold text-text sm:text-[24px]">{t('admin.ai_limits.title')}</h1>
            <p className="max-w-2xl text-[13px] text-text-muted">{t('admin.ai_limits.subtitle')}</p>
          </div>
          <ResetCountdown />
        </div>
      </FadeIn>

      {/* ── Cupo por defecto + resumen del día ── */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DefaultLimitCard
          value={defaultLimit}
          rows={rows}
          onSaved={(n) => { setDefaultLimit(n); void load() }}
        />
        <StatCard icon={Zap} label={t('admin.ai_limits.stat_today')} value={usedToday} tone="green" />
        <StatCard icon={Gauge} label={t('admin.ai_limits.stat_capped')} value={counts.capped} tone={counts.capped ? 'amber' : 'plain'} />
        <StatCard icon={Settings2} label={t('admin.ai_limits.stat_exceptions')} value={counts.exceptions} tone="plain" />
      </div>

      {/* ── Filtros + buscador ── */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex gap-1 rounded-xl border border-line bg-bg p-1">
          {([
            { key: 'all' as const, label: t('admin.ai_limits.filter_all'), n: counts.all },
            { key: 'capped' as const, label: t('admin.ai_limits.filter_capped'), n: counts.capped },
            { key: 'exceptions' as const, label: t('admin.ai_limits.filter_exceptions'), n: counts.exceptions },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                'relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors',
                filter === tab.key ? 'text-text' : 'text-text-muted hover:text-text',
              )}
            >
              {filter === tab.key && (
                <motion.span
                  layoutId="ai-limits-filter-pill"
                  className="absolute inset-0 rounded-lg border border-brand-green/30 bg-brand-green/10"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative">{tab.label}</span>
              <span className="relative text-[11px] text-text-subtle">{tab.n}</span>
            </button>
          ))}
        </div>

        <div className="relative sm:max-w-xs sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.ai_limits.search')}
            className="h-10 w-full rounded-xl border border-line bg-bg pl-9 pr-3 text-[13px] text-text outline-none transition-colors placeholder:text-text-subtle focus:border-brand-green/50"
          />
        </div>
      </div>

      {/* ── Personas ── */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading', 'Cargando…')}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-4 py-12 text-center text-[13px] text-text-subtle">
          {t('admin.ai_limits.empty')}
        </div>
      ) : (
        <motion.ul layout className="space-y-2">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((r) => (
              <motion.li
                key={r.user_id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              >
                <QuotaRowCard
                  row={r}
                  flashing={flashId === r.user_id}
                  busy={busyId === r.user_id}
                  onEdit={() => setEditing(r)}
                  onQuickBonus={() => handleQuickBonus(r, 5)}
                  t={t}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}

      {/* ── Bitácora ── */}
      {ops.length > 0 && (
        <FadeIn>
          <div className="mt-8">
            <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-text">
              <Sparkles className="h-4 w-4 text-text-muted" />
              {t('admin.ai_limits.log_title')}
            </h2>
            <div className="overflow-hidden rounded-2xl border border-line bg-surface">
              {ops.map((o, i) => (
                <div
                  key={o.id}
                  className={cn(
                    'flex items-center justify-between gap-3 px-4 py-2.5 text-[12.5px]',
                    i > 0 && 'border-t border-line',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="shrink-0 text-[14px]">{KIND_ICON[o.kind] ?? '✨'}</span>
                    <span className="truncate text-text">{o.label || t(`admin.ai_limits.kind_${o.kind}`, o.kind)}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-text-subtle">
                    <span className="hidden sm:inline">{o.display_name}</span>
                    <span className="tabular-nums">
                      {new Date(o.created_at).toLocaleString(i18n.language, {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      )}

      <AnimatePresence>
        {editing && (
          <EditLimitModal
            row={editing}
            defaultLimit={defaultLimit}
            confirm={confirm}
            onClose={() => setEditing(null)}
            onSaved={async (id) => { setEditing(null); await load(); flash(id) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Reglas compartidas ─────────────────────────────────────────────────────

/** Ya no puede generar más hoy. */
function isCapped(r: AiQuotaRow): boolean {
  return r.effective_limit !== null && r.used_today >= r.effective_limit
}

/** Tiene algo distinto del cupo por defecto. */
function hasException(r: AiQuotaRow): boolean {
  return r.unlimited || r.daily_limit !== null || (r.bonus_ops > 0 && !!r.bonus_day)
}

const KIND_ICON: Record<string, string> = {
  module: '📘',
  world: '🗺️',
  simulation: '🎧',
  translation: '🌐',
  analysis: '🔎',
  assist: '✨',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TFn = (key: string, opts?: any) => string
type ConfirmFn = (opts?: { title?: string; description?: React.ReactNode; confirmLabel?: string; tone?: 'danger' | 'default' }) => Promise<boolean>

// ── Cuenta regresiva hasta el reinicio ─────────────────────────────────────

/**
 * "El cupo se renueva en 6 h 12 min". Sin esto, "por día" es ambiguo: nadie
 * sabe si el reinicio es a su medianoche o a la de Colombia.
 */
function ResetCountdown() {
  const { t } = useTranslation()
  const [label, setLabel] = useState('')

  useEffect(() => {
    const tick = () => {
      // Medianoche de Bogotá (UTC-5, sin horario de verano) expresada en local.
      const now = new Date()
      const bogotaMs = now.getTime() - 5 * 3600_000
      const msIntoDay = ((bogotaMs % 86_400_000) + 86_400_000) % 86_400_000
      const left = 86_400_000 - msIntoDay
      const h = Math.floor(left / 3_600_000)
      const m = Math.floor((left % 3_600_000) / 60_000)
      setLabel(h > 0 ? `${h} h ${m} min` : `${m} min`)
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
      <Clock className="h-3.5 w-3.5 text-text-subtle" />
      <span className="text-[11.5px] text-text-muted">{t('admin.ai_limits.resets_in', { time: label })}</span>
    </div>
  )
}

// ── Tarjetas de arriba ─────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, tone,
}: { icon: typeof Zap; label: string; value: number; tone: 'green' | 'amber' | 'plain' }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-center gap-2 text-[12px] text-text-muted">
        <Icon className={cn(
          'h-4 w-4',
          tone === 'green' ? 'text-brand-green' : tone === 'amber' ? 'text-amber-500' : 'text-text-subtle',
        )} />
        {label}
      </div>
      <div className={cn(
        'text-[26px] font-bold tabular-nums',
        tone === 'amber' && value > 0 ? 'text-amber-500' : 'text-text',
      )}>
        <AnimatedNumber value={value} />
      </div>
    </div>
  )
}

/**
 * El "10" de todos. Es el control más peligroso de la pantalla: un dígito de
 * más o de menos afecta a TODA la operación, así que antes de guardar dice a
 * cuánta gente toca y a quién dejaría bloqueado ahora mismo.
 */
function DefaultLimitCard({
  value, rows, onSaved,
}: { value: number; rows: AiQuotaRow[]; onSaved: (n: number) => void }) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const dirty = draft !== value

  useEffect(() => setDraft(value), [value])

  // A quién afecta de verdad: los que NO tienen excepción propia.
  const affected = useMemo(() => rows.filter((r) => r.role === 'capacitador' && !r.unlimited && r.daily_limit === null), [rows])
  const wouldBlock = useMemo(() => affected.filter((r) => r.used_today >= draft).length, [affected, draft])

  const save = async () => {
    // Bajar el cupo puede dejar gente bloqueada a mitad de jornada: se avisa.
    if (draft < value) {
      const ok = await confirm({
        title: t('admin.ai_limits.confirm_default_title'),
        description: t('admin.ai_limits.confirm_default_desc', {
          from: value, to: draft, people: affected.length, blocked: wouldBlock,
        }),
        confirmLabel: t('admin.ai_limits.confirm_apply'),
        tone: wouldBlock > 0 ? 'danger' : 'default',
      })
      if (!ok) return
    }

    setSaving(true)
    try {
      await setAiDefaultLimit(draft)
      onSaved(draft)
      toast.success(t('admin.ai_limits.default_saved', { n: draft }))
    } catch (e) {
      toast.error(t('admin.ai_limits.save_error'), e instanceof Error ? e.message : undefined)
      setDraft(value)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-brand-green/25 bg-brand-green/[0.06] p-4">
      <div className="mb-2 flex items-center gap-2 text-[12px] text-text-muted">
        <Gauge className="h-4 w-4 text-brand-green" />
        {t('admin.ai_limits.default_label')}
      </div>
      <div className="flex items-center gap-2">
        <Stepper value={draft} onChange={setDraft} min={0} max={999} />
        <AnimatePresence>
          {dirty && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9, x: -6 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.9, x: -6 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              onClick={save}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-green px-3 text-[12px] font-semibold text-black transition-all hover:brightness-110 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {t('common.save', 'Guardar')}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Impacto en vivo: se ve ANTES de tocar Guardar. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={dirty ? `d${draft}` : 'idle'}
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className={cn(
            'mt-2 text-[11.5px] leading-relaxed',
            dirty && wouldBlock > 0 ? 'font-medium text-amber-500' : 'text-text-subtle',
          )}
        >
          {!dirty
            ? t('admin.ai_limits.default_hint_n', { count: affected.length })
            : wouldBlock > 0
              ? t('admin.ai_limits.default_would_block', { count: wouldBlock })
              : t('admin.ai_limits.default_affects', { count: affected.length })}
        </motion.p>
      </AnimatePresence>

      {draft === 0 && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] font-medium text-amber-500">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t('admin.ai_limits.zero_warning_all')}
        </p>
      )}
    </div>
  )
}

function Stepper({
  value, onChange, min = 0, max = 999, tone = 'default',
}: { value: number; onChange: (n: number) => void; min?: number; max?: number; tone?: 'default' | 'warn' }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n))
  return (
    <div className={cn(
      'inline-flex h-9 items-center rounded-lg border bg-bg',
      tone === 'warn' ? 'border-amber-400/50' : 'border-line',
    )}>
      <button
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        className="flex h-full w-9 items-center justify-center rounded-l-lg text-text-muted transition-colors hover:bg-glass/6 hover:text-text disabled:opacity-30"
        aria-label="-"
      >
        −
      </button>
      <input
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, '')) || 0))}
        inputMode="numeric"
        className="h-full w-12 border-x border-line bg-transparent text-center text-[14px] font-semibold tabular-nums text-text outline-none"
      />
      <button
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        className="flex h-full w-9 items-center justify-center rounded-r-lg text-text-muted transition-colors hover:bg-glass/6 hover:text-text disabled:opacity-30"
        aria-label="+"
      >
        +
      </button>
    </div>
  )
}

// ── Fila de persona ────────────────────────────────────────────────────────

function QuotaRowCard({
  row, flashing, busy, onEdit, onQuickBonus, t,
}: {
  row: AiQuotaRow
  flashing: boolean
  busy: boolean
  onEdit: () => void
  onQuickBonus: () => void
  t: TFn
}) {
  const limit = row.effective_limit
  const unlimited = limit === null
  const pct = unlimited ? 0 : Math.min(100, Math.round((row.used_today / Math.max(limit, 1)) * 100))
  const capped = isCapped(row)

  return (
    <motion.div
      animate={flashing
        ? { borderColor: 'rgba(16,212,81,0.55)', backgroundColor: 'rgba(16,212,81,0.07)' }
        : { borderColor: 'rgb(var(--line))', backgroundColor: 'rgba(0,0,0,0)' }}
      transition={{ duration: flashing ? 0.2 : 0.9 }}
      className="flex items-center gap-3 rounded-2xl border bg-surface px-4 py-3"
    >
      <Avatar src={row.avatar_url} name={row.display_name} size={38} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[13.5px] font-medium text-text">{row.display_name}</span>
          {row.role === 'superadmin' && (
            <span className="shrink-0 rounded-full border border-brand-magenta/30 bg-brand-magenta/10 px-2 py-0.5 text-[10.5px] font-semibold text-brand-magenta">
              {t('admin.ai_limits.role_superadmin')}
            </span>
          )}
          {row.unlimited && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-brand-green/30 bg-brand-green/10 px-2 py-0.5 text-[10.5px] font-semibold text-brand-green">
              <InfinityIcon className="h-3 w-3" />
              {t('admin.ai_limits.badge_unlimited')}
            </span>
          )}
          {row.daily_limit !== null && !row.unlimited && (
            <span className="shrink-0 rounded-full border border-line bg-glass/6 px-2 py-0.5 text-[10.5px] font-semibold text-text-muted">
              {t('admin.ai_limits.badge_custom', { n: row.daily_limit })}
            </span>
          )}
          {row.bonus_ops > 0 && row.bonus_day && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10.5px] font-semibold text-amber-500">
              <Plus className="h-3 w-3" />
              {t('admin.ai_limits.badge_bonus', { n: row.bonus_ops })}
            </span>
          )}
        </div>

        <p className="truncate text-[11.5px] text-text-subtle">
          {row.campaign_name}
          {row.updated_by_name && row.updated_at && (
            <> · {t('admin.ai_limits.set_by', { name: row.updated_by_name, when: relTime(row.updated_at) })}</>
          )}
        </p>

        {/* Barra de consumo de hoy */}
        <div className="mt-2 flex items-center gap-2.5">
          <div className="h-1.5 max-w-[240px] flex-1 overflow-hidden rounded-full bg-glass/8">
            <motion.div
              className={cn(
                'h-full rounded-full',
                unlimited ? 'bg-text-subtle/30' : capped ? 'bg-amber-500' : 'bg-brand-green',
              )}
              initial={false}
              animate={{ width: unlimited ? '100%' : `${pct}%` }}
              transition={{ type: 'spring', stiffness: 130, damping: 24 }}
            />
          </div>
          <span className={cn(
            'shrink-0 text-[11.5px] tabular-nums',
            capped ? 'font-semibold text-amber-500' : 'text-text-muted',
          )}>
            {unlimited
              ? t('admin.ai_limits.used_unlimited', { n: row.used_today })
              : `${row.used_today} / ${limit}`}
          </span>
        </div>
      </div>

      <div className="hidden shrink-0 text-right sm:block">
        <div className="text-[11px] text-text-subtle">{t('admin.ai_limits.last_30d')}</div>
        <div className="text-[14px] font-semibold tabular-nums text-text">{row.used_30d}</div>
      </div>

      {/* Atajo del día a día: destrabar a alguien que se quedó sin cupo. */}
      <AnimatePresence>
        {capped && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 460, damping: 30 }}
            onClick={onQuickBonus}
            disabled={busy}
            title={t('admin.ai_limits.quick_bonus_hint')}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-brand-green/35 bg-brand-green/10 px-3 text-[12px] font-semibold text-brand-green transition-colors hover:bg-brand-green/20 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {t('admin.ai_limits.quick_bonus')}
          </motion.button>
        )}
      </AnimatePresence>

      <button
        onClick={onEdit}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-medium text-text transition-colors hover:bg-glass/6"
      >
        <Settings2 className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">{t('admin.ai_limits.adjust')}</span>
      </button>
    </motion.div>
  )
}

/** "hace 3 días" / "hace 2 h" — más legible que una fecha para un rastro de cambios. */
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60_000)
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
  if (Math.abs(min) < 60) return rtf.format(-min, 'minute')
  const h = Math.round(min / 60)
  if (Math.abs(h) < 24) return rtf.format(-h, 'hour')
  return rtf.format(-Math.round(h / 24), 'day')
}

// ── Modal de excepción ─────────────────────────────────────────────────────

function EditLimitModal({
  row, defaultLimit, confirm, onClose, onSaved,
}: {
  row: AiQuotaRow
  defaultLimit: number
  confirm: ConfirmFn
  onClose: () => void
  onSaved: (userId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [useCustom, setUseCustom] = useState(row.daily_limit !== null)
  const [limit, setLimit] = useState(row.daily_limit ?? defaultLimit)
  const [unlimited, setUnlimited] = useState(row.unlimited)
  const [bonus, setBonus] = useState(row.bonus_day ? row.bonus_ops : 0)
  const [note, setNote] = useState(row.note ?? '')
  const [saving, setSaving] = useState(false)
  // Estado inicial congelado al abrir: contra esto se mide si hay cambios sin
  // guardar. El modal se monta por persona, así que nunca cambia en vida.
  const [initial] = useState({
    useCustom: row.daily_limit !== null,
    limit: row.daily_limit ?? defaultLimit,
    unlimited: row.unlimited,
    bonus: row.bonus_day ? row.bonus_ops : 0,
    note: row.note ?? '',
  })

  const dirty = useCustom !== initial.useCustom
    || (useCustom && limit !== initial.limit)
    || unlimited !== initial.unlimited
    || bonus !== initial.bonus
    || note !== initial.note

  // Cupo que quedaría si se guarda tal cual está ahora.
  const nextLimit = unlimited ? null : (useCustom ? limit : defaultLimit) + bonus
  const wouldBlock = nextLimit !== null && row.used_today >= nextLimit
  const wouldZero = nextLimit === 0

  /** Cerrar con cambios sin guardar pide confirmación: evita perder el trabajo. */
  const tryClose = useCallback(async () => {
    if (saving) return
    if (!dirty) { onClose(); return }
    const ok = await confirm({
      title: t('admin.ai_limits.discard_title'),
      description: t('admin.ai_limits.discard_desc'),
      confirmLabel: t('admin.ai_limits.discard_confirm'),
      tone: 'danger',
    })
    if (ok) onClose()
  }, [confirm, dirty, onClose, saving, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void tryClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tryClose])

  /** "Sin límite" es el ajuste más caro que existe acá: se confirma aparte. */
  const toggleUnlimited = async (v: boolean) => {
    if (!v) { setUnlimited(false); return }
    const ok = await confirm({
      title: t('admin.ai_limits.confirm_unlimited_title'),
      description: t('admin.ai_limits.confirm_unlimited_desc', { name: row.display_name }),
      confirmLabel: t('admin.ai_limits.confirm_unlimited_ok'),
      tone: 'danger',
    })
    if (ok) setUnlimited(true)
  }

  const save = async () => {
    if (wouldBlock || wouldZero) {
      const ok = await confirm({
        title: t('admin.ai_limits.confirm_block_title'),
        description: wouldZero
          ? t('admin.ai_limits.confirm_zero_desc', { name: row.display_name })
          : t('admin.ai_limits.confirm_block_desc', {
              name: row.display_name, used: row.used_today, limit: nextLimit,
            }),
        confirmLabel: t('admin.ai_limits.confirm_apply'),
        tone: 'danger',
      })
      if (!ok) return
    }

    setSaving(true)
    try {
      await setAiUserLimit({
        userId: row.user_id,
        dailyLimit: useCustom && !unlimited ? limit : null,
        unlimited,
        bonusOps: bonus,
        bonusToday: bonus > 0,
        note: note.trim() || null,
      })
      toast.success(t('admin.ai_limits.saved', { name: row.display_name }))
      await onSaved(row.user_id)
    } catch (e) {
      toast.error(t('admin.ai_limits.save_error'), e instanceof Error ? e.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    const ok = await confirm({
      title: t('admin.ai_limits.confirm_reset_title'),
      description: t('admin.ai_limits.confirm_reset_desc', { name: row.display_name, n: defaultLimit }),
      confirmLabel: t('admin.ai_limits.reset'),
      tone: 'danger',
    })
    if (!ok) return

    setSaving(true)
    try {
      await setAiUserLimit({ userId: row.user_id })
      toast.success(t('admin.ai_limits.reset_done', { name: row.display_name }))
      await onSaved(row.user_id)
    } catch (e) {
      toast.error(t('admin.ai_limits.save_error'), e instanceof Error ? e.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" {...backdropDismiss(() => void tryClose())} />

      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-glass-lg"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar src={row.avatar_url} name={row.display_name} size={36} />
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-semibold text-text">{row.display_name}</h3>
              <p className="truncate text-[11.5px] text-text-subtle">
                {t('admin.ai_limits.used_today_of', { used: row.used_today, limit: row.effective_limit ?? '∞' })}
              </p>
            </div>
          </div>
          <button
            onClick={() => void tryClose()}
            disabled={saving}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-glass/6 hover:text-text disabled:opacity-30"
            aria-label={t('common.close', 'Cerrar')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Quién puso la excepción actual: evita que dos superadmins se pisen. */}
          {row.updated_by_name && row.updated_at && (
            <div className="flex items-start gap-2.5 rounded-xl border border-line bg-glass/4 px-3 py-2.5">
              <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-subtle" />
              <div className="min-w-0 text-[11.5px] leading-relaxed text-text-muted">
                {t('admin.ai_limits.set_by', { name: row.updated_by_name, when: relTime(row.updated_at) })}
                {row.note && <div className="mt-0.5 italic text-text-subtle">“{row.note}”</div>}
              </div>
            </div>
          )}

          <ToggleRow
            checked={unlimited}
            onChange={(v) => void toggleUnlimited(v)}
            title={t('admin.ai_limits.unlimited_title')}
            hint={t('admin.ai_limits.unlimited_hint')}
            tone="danger"
          />

          <div className={cn('transition-opacity', unlimited && 'pointer-events-none opacity-40')}>
            <ToggleRow
              checked={useCustom}
              onChange={setUseCustom}
              title={t('admin.ai_limits.custom_title')}
              hint={t('admin.ai_limits.custom_hint', { n: defaultLimit })}
            />
            <AnimatePresence initial={false}>
              {useCustom && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-3">
                    <Stepper value={limit} onChange={setLimit} min={0} max={999} tone={wouldBlock ? 'warn' : 'default'} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className={cn('transition-opacity', unlimited && 'pointer-events-none opacity-40')}>
            <div className="mb-2">
              <p className="text-[13px] font-medium text-text">{t('admin.ai_limits.bonus_title')}</p>
              <p className="text-[11.5px] leading-relaxed text-text-subtle">{t('admin.ai_limits.bonus_hint')}</p>
            </div>
            <Stepper value={bonus} onChange={setBonus} min={0} max={99} />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
              {t('admin.ai_limits.note_label')}
            </label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('admin.ai_limits.note_placeholder')}
              className="h-10 w-full rounded-xl border border-line bg-bg px-3 text-[13px] text-text outline-none transition-colors placeholder:text-text-subtle focus:border-brand-green/50"
            />
          </div>

          {/* Resultado del cambio, en una frase, antes de guardar. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${unlimited}-${nextLimit}`}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={cn(
                'flex items-start gap-2.5 rounded-xl border px-3 py-2.5',
                wouldBlock || wouldZero
                  ? 'border-amber-400/35 bg-amber-400/10'
                  : 'border-brand-green/25 bg-brand-green/[0.06]',
              )}
            >
              {wouldBlock || wouldZero
                ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-green" />}
              <p className={cn(
                'text-[11.5px] leading-relaxed',
                wouldBlock || wouldZero ? 'font-medium text-amber-500' : 'text-text-muted',
              )}>
                {unlimited
                  ? t('admin.ai_limits.preview_unlimited', { name: row.display_name })
                  : wouldZero
                    ? t('admin.ai_limits.preview_zero', { name: row.display_name })
                    : wouldBlock
                      ? t('admin.ai_limits.preview_blocked', { name: row.display_name, used: row.used_today, limit: nextLimit })
                      : t('admin.ai_limits.preview_ok', { limit: nextLimit, left: Math.max((nextLimit ?? 0) - row.used_today, 0) })}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <button
            onClick={reset}
            disabled={saving || !hasException(row)}
            title={hasException(row) ? undefined : t('admin.ai_limits.reset_disabled')}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-text-muted transition-colors hover:text-text disabled:opacity-30"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('admin.ai_limits.reset')}
          </button>
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-green px-4 text-[13px] font-semibold text-black transition-all hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {dirty ? t('common.save', 'Guardar') : t('admin.ai_limits.no_changes')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function ToggleRow({
  checked, onChange, title, hint, tone = 'default',
}: {
  checked: boolean
  onChange: (v: boolean) => void
  title: string
  hint: string
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border bg-bg p-3 text-left transition-colors',
        checked && tone === 'danger'
          ? 'border-amber-400/40 bg-amber-400/[0.06]'
          : 'border-line hover:border-glass-border/40',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
          checked ? (tone === 'danger' ? 'bg-amber-500' : 'bg-brand-green') : 'bg-glass/15',
        )}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
          className={cn('h-4 w-4 rounded-full bg-white shadow', checked && 'ml-auto')}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-text">{title}</span>
        <span className="block text-[11.5px] leading-relaxed text-text-subtle">{hint}</span>
      </span>
    </button>
  )
}
