import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Pencil, Trash2, X, Save, Loader2, Rocket, Clock, CalendarClock } from 'lucide-react'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { Select } from '@/components/ui/Select'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import {
  useXPEventStore,
  xpEventLabel,
  xpEventStatus,
  type XPEvent,
  type XPEventStatus,
} from '@/stores/xpEventStore'
import { XP_REWARDS, reviewValue } from '@/stores/progressStore'
import type { Lang } from '@/stores/gamificationStore'

/* ────────────────────────────────────────────────────────────────────────────
   Eventos de XP: "hoy es día ×2".

   El superadmin programa ventanas con multiplicador. Mientras una está vigente,
   TODO el XP se multiplica (decisión de producto: un solo alcance, fácil de
   anunciar y de auditar).

   La lista es de solo-datos, pero se anima el estado (activo/programado/pasado)
   porque es lo único que importa de un vistazo: qué está pagando AHORA.
   ──────────────────────────────────────────────────────────────────────────── */

const PRESET_MULTIPLIERS = [2, 3, 5, 10]

/** `datetime-local` habla en hora local sin zona; la BD guarda ISO con zona. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

function newEventDraft(): XPEvent {
  const start = new Date()
  start.setMinutes(0, 0, 0)
  const end = new Date(start.getTime() + 24 * 3600_000)
  return {
    id: crypto.randomUUID(),
    emoji: '⚡',
    multiplier: 2,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    enabled: true,
    color: '#B33D9E',
    label: '',
  }
}

function formatRange(e: XPEvent, lang: Lang): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }
  const locale = lang === 'en' ? 'en-US' : lang === 'pt' ? 'pt-BR' : 'es-CO'
  return `${new Date(e.startsAt).toLocaleString(locale, opts)} → ${new Date(e.endsAt).toLocaleString(locale, opts)}`
}

/**
 * Los eventos son parte del borrador de la pantalla de gamificación: llegan por
 * prop y los cambios se suben. Antes cada interruptor escribía en la base al
 * instante, lo que dejaba media pantalla con "cambios sin guardar" y la otra
 * media guardando sola — la peor combinación posible.
 */
export function XPEventsEditor({
  lang,
  events,
  loading,
  onChange,
}: {
  lang: Lang
  events: XPEvent[]
  loading: boolean
  onChange: (events: XPEvent[]) => void
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const now = useXPEventStore((s) => s.now)

  const [editing, setEditing] = useState<XPEvent | null>(null)
  const busy = false

  const grouped = useMemo(() => {
    const order: Record<XPEventStatus, number> = { active: 0, scheduled: 1, off: 2, ended: 3 }
    return [...events].sort((a, b) => {
      const sa = order[xpEventStatus(a, now)]
      const sb = order[xpEventStatus(b, now)]
      if (sa !== sb) return sa - sb
      return Date.parse(b.startsAt) - Date.parse(a.startsAt)
    })
  }, [events, now])

  const save = (e: XPEvent) => {
    onChange(
      events.some((x) => x.id === e.id)
        ? events.map((x) => (x.id === e.id ? e : x))
        : [...events, e],
    )
  }

  /** Borrador: sale en la barra y se deshace con Ctrl+Z, sin diálogo previo. */
  const remove = (e: XPEvent) => onChange(events.filter((x) => x.id !== e.id))

  const toggle = (e: XPEvent) => save({ ...e, enabled: !e.enabled })

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-text">
            <Rocket className="h-4 w-4 text-neon-magenta" />
            {t('admin.gamification.events', 'Días de XP multiplicado')}
          </h2>
          <p className="text-[12px] text-text-muted">
            {t(
              'admin.gamification.events_hint',
              'Programa ventanas ×2, ×5… Mientras están vigentes, TODO el XP del aprendiz se multiplica: módulos, quizzes, repasos, certificaciones y racha.',
            )}
          </p>
        </div>
        <button
          onClick={() => setEditing(newEventDraft())}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-[13px] font-semibold text-on-primary hover:opacity-90 transition-opacity min-h-[44px]"
        >
          <Plus className="h-4 w-4" />
          {t('admin.gamification.add_event', 'Nuevo evento')}
        </button>
      </div>

      {loading ? (
        <div className="flex h-24 items-center justify-center rounded-2xl border border-line">
          <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-8 text-center">
          <CalendarClock className="mx-auto mb-2 h-6 w-6 text-text-subtle" />
          <p className="text-[13px] text-text-muted">
            {t('admin.gamification.events_empty', 'Aún no hay eventos. Crea uno para anunciar un día de XP doble.')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          <AnimatePresence initial={false}>
            {grouped.map((e) => {
              const status = xpEventStatus(e, now)
              const active = status === 'active'
              return (
                <motion.div
                  key={e.id}
                  layout
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                  className={cn(
                    'relative flex items-center gap-3 overflow-hidden rounded-2xl border p-3 transition-colors',
                    active ? 'border-transparent' : 'border-line bg-surface',
                    status === 'ended' && 'opacity-55',
                    status === 'off' && 'opacity-55',
                  )}
                  style={active ? { borderColor: `${e.color}55`, background: `${e.color}0d` } : undefined}
                >
                  {active && !reduce && (
                    <motion.span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-12 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                      animate={{ x: ['0%', '460%'] }}
                      transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 4, ease: [0.16, 1, 0.3, 1] }}
                    />
                  )}

                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-subtle text-xl">
                    {e.emoji}
                  </div>

                  <div className="relative min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[14px] font-medium text-text">
                        {xpEventLabel(e, lang) || t('admin.gamification.event_untitled', 'Sin nombre')}
                      </span>
                      <StatusPill status={status} reduce={reduce} color={e.color} />
                    </div>
                    <p className="truncate text-[11.5px] tabular-nums text-text-muted">
                      {formatRange(e, lang)}
                    </p>
                  </div>

                  <span
                    className="relative shrink-0 rounded-xl px-2.5 py-1 text-[13px] font-black text-white"
                    style={{ background: e.color }}
                  >
                    ×{e.multiplier}
                  </span>

                  <div className="relative flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => toggle(e)}
                      disabled={busy}
                      title={e.enabled
                        ? t('admin.gamification.disable', 'Desactivar')
                        : t('admin.gamification.enable', 'Activar')}
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-lg transition-colors disabled:opacity-40',
                        e.enabled ? 'text-primary hover:bg-primary/10' : 'text-text-muted hover:bg-subtle',
                      )}
                    >
                      <Rocket className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setEditing({ ...e })}
                      disabled={busy}
                      title={t('common.edit', 'Editar')}
                      className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:bg-subtle hover:text-text transition-colors disabled:opacity-40"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(e)}
                      disabled={busy}
                      title={t('common.delete', 'Eliminar')}
                      className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:bg-danger/10 hover:text-danger transition-colors disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {editing && (
        <XPEventModal
          draft={editing}
          onClose={() => setEditing(null)}
          onSave={async (e) => {
            save(e)
            setEditing(null)
            toast.success(t('admin.gamification.event_saved', 'Evento guardado'))
          }}
        />
      )}
    </section>
  )
}

function StatusPill({ status, reduce, color }: { status: XPEventStatus; reduce: boolean; color: string }) {
  const { t } = useTranslation()
  const map: Record<XPEventStatus, { text: string; cls: string }> = {
    active: { text: t('admin.gamification.status_active', 'En vivo'), cls: '' },
    scheduled: { text: t('admin.gamification.status_scheduled', 'Programado'), cls: 'bg-subtle text-text-subtle' },
    ended: { text: t('admin.gamification.status_ended', 'Terminado'), cls: 'bg-subtle text-text-subtle' },
    off: { text: t('admin.gamification.status_off', 'Apagado'), cls: 'bg-subtle text-text-subtle' },
  }
  const info = map[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
        info.cls,
      )}
      style={status === 'active' ? { background: `${color}22`, color } : undefined}
    >
      {status === 'active' && (
        <motion.span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: color }}
          animate={reduce ? undefined : { opacity: [1, 0.25, 1], scale: [1, 0.8, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      {info.text}
    </span>
  )
}

function XPEventModal({
  draft, onClose, onSave,
}: {
  draft: XPEvent
  onClose: () => void
  onSave: (e: XPEvent) => Promise<void>
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<XPEvent>(draft)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof XPEvent>(k: K, v: XPEvent[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.label.trim()) {
      toast.error(t('admin.gamification.label_required', 'El nombre (español) es obligatorio'))
      return
    }
    if (Date.parse(form.endsAt) <= Date.parse(form.startsAt)) {
      toast.error(t('admin.gamification.event_bad_range', 'El fin debe ser posterior al inicio'))
      return
    }
    try {
      setSaving(true)
      await onSave(form)
    } catch {
      toast.error(t('admin.gamification.save_error', 'No se pudo guardar'))
      setSaving(false)
    }
  }

  const field = 'w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[14px] text-text outline-none focus:border-primary min-h-[44px]'
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-wider text-text-subtle mb-1'

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" {...backdropDismiss(onClose)}>
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-line bg-bg p-5 sm:p-6"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-text">
            {draft.label
              ? t('admin.gamification.edit_event', 'Editar evento')
              : t('admin.gamification.add_event', 'Nuevo evento')}
          </h3>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:bg-subtle">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="w-20">
              <label className={labelCls}>{t('admin.gamification.emoji', 'Emoji')}</label>
              <input aria-label={t('admin.gamification.emoji', 'Emoji')} value={form.emoji} maxLength={4} onChange={(e) => set('emoji', e.target.value)} className={cn(field, 'text-center text-xl')} />
            </div>
            <div className="flex-1">
              <label className={labelCls}>{t('admin.gamification.name_es', 'Nombre (ES)')}</label>
              <input aria-label={t('admin.gamification.name_es', 'Nombre (ES)')} value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Lunes doble" className={field} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('admin.gamification.name_en', 'Nombre (EN)')}</label>
              <input aria-label={t('admin.gamification.name_en', 'Nombre (EN)')} value={form.label_en ?? ''} onChange={(e) => set('label_en', e.target.value)} className={field} />
            </div>
            <div>
              <label className={labelCls}>{t('admin.gamification.name_pt', 'Nombre (PT)')}</label>
              <input aria-label={t('admin.gamification.name_pt', 'Nombre (PT)')} value={form.label_pt ?? ''} onChange={(e) => set('label_pt', e.target.value)} className={field} />
            </div>
          </div>

          <div>
            <label className={labelCls}>{t('admin.gamification.desc_es', 'Descripción (ES)')}</label>
            <input aria-label={t('admin.gamification.desc_es', 'Descripción (ES)')} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} placeholder="Hoy todo lo que estudies vale el doble" className={field} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('admin.gamification.desc_en', 'Descripción (EN)')}</label>
              <input aria-label={t('admin.gamification.desc_en', 'Descripción (EN)')} value={form.description_en ?? ''} onChange={(e) => set('description_en', e.target.value)} className={field} />
            </div>
            <div>
              <label className={labelCls}>{t('admin.gamification.desc_pt', 'Descripción (PT)')}</label>
              <input aria-label={t('admin.gamification.desc_pt', 'Descripción (PT)')} value={form.description_pt ?? ''} onChange={(e) => set('description_pt', e.target.value)} className={field} />
            </div>
          </div>

          {/* Multiplicador */}
          <div className="rounded-2xl border border-line bg-subtle/40 p-3">
            <label className={labelCls}>{t('admin.gamification.multiplier', 'Multiplicador')}</label>
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_MULTIPLIERS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => set('multiplier', m)}
                  className={cn(
                    'min-h-[44px] rounded-xl border px-4 text-[14px] font-black transition-all',
                    form.multiplier === m
                      ? 'border-transparent text-white'
                      : 'border-line bg-surface text-text hover:bg-subtle',
                  )}
                  style={form.multiplier === m ? { background: form.color } : undefined}
                >
                  ×{m}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={10}
                step={0.5}
                aria-label={t('admin.gamification.multiplier', 'Multiplicador')}
                value={form.multiplier}
                onChange={(e) => set('multiplier', Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
                className={cn(field, 'w-24')}
              />
            </div>
            {/* Vista previa concreta: qué se lleva el aprendiz con este número. */}
            <p className="mt-2 text-[11px] tabular-nums text-text-muted">
              {t('admin.gamification.multiplier_preview', {
                module: Math.round(XP_REWARDS.module * form.multiplier),
                quiz: Math.round(XP_REWARDS.quizCorrect * form.multiplier),
                review: Math.round(reviewValue(XP_REWARDS.module) * form.multiplier),
                defaultValue:
                  'Módulo {{module}} XP · acierto {{quiz}} XP · repaso {{review}} XP',
              })}
            </p>
          </div>

          {/* Ventana */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>
                <Clock className="mr-1 inline h-3 w-3" />
                {t('admin.gamification.starts_at', 'Empieza')}
              </label>
              <input
                type="datetime-local"
                aria-label={t('admin.gamification.starts_at', 'Empieza')}
                value={toLocalInput(form.startsAt)}
                onChange={(e) => set('startsAt', fromLocalInput(e.target.value) || form.startsAt)}
                className={field}
              />
            </div>
            <div>
              <label className={labelCls}>
                <Clock className="mr-1 inline h-3 w-3" />
                {t('admin.gamification.ends_at', 'Termina')}
              </label>
              <input
                type="datetime-local"
                aria-label={t('admin.gamification.ends_at', 'Termina')}
                value={toLocalInput(form.endsAt)}
                onChange={(e) => set('endsAt', fromLocalInput(e.target.value) || form.endsAt)}
                className={field}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('admin.gamification.color', 'Color')}</label>
              <input
                type="color"
                aria-label={t('admin.gamification.color', 'Color')}
                value={form.color}
                onChange={(e) => set('color', e.target.value)}
                className="h-[44px] w-full cursor-pointer rounded-xl border border-line bg-surface"
              />
            </div>
            <div>
              <label className={labelCls}>{t('admin.gamification.enabled', 'Activo')}</label>
              <Select
                value={form.enabled ? 'on' : 'off'}
                onChange={(v) => set('enabled', v === 'on')}
                options={[
                  { value: 'on', label: t('admin.gamification.event_on', 'Sí, puede pagar') },
                  { value: 'off', label: t('admin.gamification.event_off', 'No (apagado)') },
                ]}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-line bg-surface px-4 py-2.5 text-[13px] font-medium text-text hover:bg-subtle min-h-[44px]">
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-semibold text-on-primary hover:opacity-90 min-h-[44px] disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t('common.save', 'Guardar')}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
