import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { backdropDismiss } from '@/lib/backdropDismiss'
import type { TFunction } from 'i18next'
import {
  Trophy, Plus, Pencil, Trash2, Eye, EyeOff, Star, RotateCcw, Loader2, X, Save, Gauge,
} from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { FadeIn } from '@/components/ui/motion'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'
import {
  useGamificationStore,
  METRIC_META,
  metricMeta,
  metricLabel,
  badgeLabel,
  type BadgeDef,
  type BadgeCategory,
  type BadgeMetric,
  type XPLevel,
  type Lang,
} from '@/stores/gamificationStore'
import {
  loadGamification,
  upsertBadge,
  deleteBadge,
  upsertLevel,
  deleteLevel,
  seedDefaults,
} from '@/services/gamification.service'

const CATEGORIES: BadgeCategory[] = ['progress', 'streak', 'excellence', 'certification', 'optional']

function newBadgeDraft(): BadgeDef {
  return {
    id: `custom-${Date.now().toString(36)}`,
    emoji: '⭐',
    category: 'progress',
    metric: 'modules_completed',
    threshold: 1,
    rare: false,
    enabled: true,
    builtin: false,
    sort: 999,
    label: '',
    description: '',
  }
}

export default function Gamification() {
  const { t, i18n } = useTranslation()
  const lang = (i18n.resolvedLanguage ?? 'es') as Lang
  const confirm = useConfirm()

  const badgeDefs = useGamificationStore((s) => s.badgeDefs)
  const xpLevels = useGamificationStore((s) => s.xpLevels)

  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<BadgeDef | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadGamification(true).finally(() => setLoading(false))
  }, [])

  const catLabel = (c: BadgeCategory) => t(`admin.gamification.cat.${c}`, c)

  const byCategory = useMemo(() => {
    const map = new Map<BadgeCategory, BadgeDef[]>()
    for (const c of CATEGORIES) map.set(c, [])
    for (const b of [...badgeDefs].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
      map.get(b.category)?.push(b)
    }
    return map
  }, [badgeDefs])

  const toggleEnabled = async (b: BadgeDef) => {
    try {
      setBusy(true)
      await upsertBadge({ ...b, enabled: b.enabled === false })
      await loadGamification(true)
    } catch {
      toast.error(t('admin.gamification.save_error', 'No se pudo guardar'))
    } finally {
      setBusy(false)
    }
  }

  const removeBadge = async (b: BadgeDef) => {
    if (b.builtin) return
    const ok = await confirm({
      title: t('admin.gamification.delete_badge', 'Eliminar logro'),
      description: t('admin.gamification.delete_badge_desc', {
        name: badgeLabel(b, lang),
        defaultValue: `¿Eliminar el logro "${badgeLabel(b, lang)}"?`,
      }),
    })
    if (!ok) return
    try {
      setBusy(true)
      await deleteBadge(b.id)
      await loadGamification(true)
      toast.success(t('admin.gamification.deleted', 'Logro eliminado'))
    } catch {
      toast.error(t('admin.gamification.save_error', 'No se pudo guardar'))
    } finally {
      setBusy(false)
    }
  }

  const restoreDefaults = async () => {
    const ok = await confirm({
      title: t('admin.gamification.restore', 'Restaurar valores de fábrica'),
      description: t(
        'admin.gamification.restore_desc',
        'Se re-crearán los logros y niveles originales. Tus logros personalizados no se borran.',
      ),
      tone: 'default',
    })
    if (!ok) return
    try {
      setBusy(true)
      await seedDefaults()
      await loadGamification(true)
      toast.success(t('admin.gamification.restored', 'Valores de fábrica restaurados'))
    } catch {
      toast.error(t('admin.gamification.save_error', 'No se pudo guardar'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[20px] sm:text-[24px] font-bold text-text mb-1">
            <Trophy className="h-6 w-6 text-amber-500" />
            {t('admin.gamification.title', 'Gamificación')}
          </h1>
          <p className="text-[13px] text-text-muted">
            {t('admin.gamification.subtitle', 'Logros y niveles de experiencia (XP) del aprendiz.')}
          </p>
        </div>
        <button
          onClick={restoreDefaults}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px] font-medium text-text hover:bg-subtle transition-colors min-h-[44px] disabled:opacity-40"
        >
          <RotateCcw className="h-4 w-4" />
          {t('admin.gamification.restore', 'Restaurar valores de fábrica')}
        </button>
      </div>

      {/* ── Logros ── */}
      <section className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-text">
            {t('admin.gamification.badges', 'Logros')}
          </h2>
          <button
            onClick={() => setEditing(newBadgeDraft())}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-[13px] font-semibold text-on-primary hover:opacity-90 transition-opacity min-h-[44px]"
          >
            <Plus className="h-4 w-4" />
            {t('admin.gamification.add_badge', 'Nuevo logro')}
          </button>
        </div>

        <FadeIn className="space-y-6" y={14}>
          {CATEGORIES.map((cat) => {
            const items = byCategory.get(cat) ?? []
            if (items.length === 0) return null
            return (
              <div key={cat}>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                  {catLabel(cat)}
                </h3>
                <div className="grid grid-cols-1 gap-2">
                  {items.map((b) => (
                    <BadgeRow
                      key={b.id}
                      badge={b}
                      lang={lang}
                      busy={busy}
                      onEdit={() => setEditing({ ...b })}
                      onToggle={() => toggleEnabled(b)}
                      onDelete={() => removeBadge(b)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </FadeIn>
      </section>

      {/* ── Niveles de XP ── */}
      <XPLevelsEditor levels={xpLevels} busy={busy} setBusy={setBusy} />

      {editing && (
        <BadgeModal
          draft={editing}
          lang={lang}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await loadGamification(true)
          }}
        />
      )}
    </div>
  )
}

function thresholdText(metric: BadgeMetric, threshold: number, t: TFunction): string {
  const unit = metricMeta(metric).unit
  if (unit === 'bool') return t('admin.gamification.unit_yes', 'Sí')
  if (unit === 'percent') return `≥ ${threshold}%`
  return `≥ ${threshold}`
}

function BadgeRow({
  badge, lang, busy, onEdit, onToggle, onDelete,
}: {
  badge: BadgeDef
  lang: Lang
  busy: boolean
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const disabled = badge.enabled === false
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-card-hover',
        disabled && 'opacity-55',
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-subtle text-xl">
        {badge.emoji}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-medium text-text">{badgeLabel(badge, lang)}</span>
          {badge.rare && <Star className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
          {badge.builtin && (
            <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-subtle">
              {t('admin.gamification.builtin', 'Sistema')}
            </span>
          )}
        </div>
        <p className="truncate text-[11.5px] text-text-muted">
          {metricLabel(badge.metric, lang)} · {thresholdText(badge.metric, badge.threshold, t)}
          {badge.requires ? ` · ${t(`admin.gamification.requires.${badge.requires}`, badge.requires)}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={onToggle}
          disabled={busy}
          title={disabled ? t('admin.gamification.enable', 'Activar') : t('admin.gamification.disable', 'Desactivar')}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:bg-subtle hover:text-text transition-colors disabled:opacity-40"
        >
          {disabled ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <button
          onClick={onEdit}
          disabled={busy}
          title={t('common.edit', 'Editar')}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:bg-subtle hover:text-text transition-colors disabled:opacity-40"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={onDelete}
          disabled={busy || badge.builtin}
          title={badge.builtin ? t('admin.gamification.builtin_no_delete', 'Los logros de sistema no se borran (puedes desactivarlos)') : t('common.delete', 'Eliminar')}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:bg-danger/10 hover:text-danger transition-colors disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-text-muted"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function BadgeModal({
  draft, lang, onClose, onSaved,
}: {
  draft: BadgeDef
  lang: Lang
  onClose: () => void
  onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const adminLang = (i18n.resolvedLanguage ?? 'es') as Lang
  const [form, setForm] = useState<BadgeDef>(draft)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof BadgeDef>(k: K, v: BadgeDef[K]) => setForm((f) => ({ ...f, [k]: v }))
  const unit = metricMeta(form.metric).unit

  const save = async () => {
    if (!form.label.trim()) {
      toast.error(t('admin.gamification.label_required', 'El nombre (español) es obligatorio'))
      return
    }
    try {
      setSaving(true)
      await upsertBadge(form)
      toast.success(t('admin.gamification.saved', 'Logro guardado'))
      onSaved()
    } catch {
      toast.error(t('admin.gamification.save_error', 'No se pudo guardar'))
      setSaving(false)
    }
  }

  const field = 'w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[14px] text-text outline-none focus:border-primary min-h-[44px]'
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-wider text-text-subtle mb-1'

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" {...backdropDismiss(onClose)}>
      <div
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-line bg-bg p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-text">
            {form.builtin
              ? t('admin.gamification.edit_badge', 'Editar logro')
              : draft.label
                ? t('admin.gamification.edit_badge', 'Editar logro')
                : t('admin.gamification.add_badge', 'Nuevo logro')}
          </h3>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:bg-subtle">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="w-20">
              <label className={labelCls}>{t('admin.gamification.emoji', 'Emoji')}</label>
              <input aria-label={t('admin.gamification.emoji', 'Emoji')} value={form.emoji} onChange={(e) => set('emoji', e.target.value)} maxLength={4} className={cn(field, 'text-center text-xl')} />
            </div>
            <div className="flex-1">
              <label className={labelCls}>{t('admin.gamification.name_es', 'Nombre (ES)')}</label>
              <input aria-label={t('admin.gamification.name_es', 'Nombre (ES)')} value={form.label} onChange={(e) => set('label', e.target.value)} className={field} />
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
            <input aria-label={t('admin.gamification.desc_es', 'Descripción (ES)')} value={form.description} onChange={(e) => set('description', e.target.value)} className={field} />
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('admin.gamification.category', 'Categoría')}</label>
              <Select
                value={form.category}
                onChange={(v) => set('category', v as BadgeCategory)}
                options={CATEGORIES.map((c) => ({ value: c, label: t(`admin.gamification.cat.${c}`, c) }))}
              />
            </div>
            <div>
              <label className={labelCls}>{t('admin.gamification.requires_field', 'Requiere función')}</label>
              <Select
                value={form.requires ?? ''}
                onChange={(v) => set('requires', (v || undefined) as BadgeDef['requires'])}
                options={[
                  { value: '', label: t('admin.gamification.requires.none', 'Ninguna') },
                  { value: 'world', label: t('admin.gamification.requires.world', 'Mundo') },
                  { value: 'simulator', label: t('admin.gamification.requires.simulator', 'Simulador') },
                ]}
              />
            </div>
          </div>

          {/* Regla: métrica + umbral */}
          <div className="rounded-2xl border border-line bg-subtle/40 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
              <Gauge className="h-3.5 w-3.5" />
              {t('admin.gamification.rule', 'Regla para otorgarlo')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
              <div>
                <label className={labelCls}>{t('admin.gamification.metric', 'Métrica')}</label>
                <Select
                  value={form.metric}
                  onChange={(v) => set('metric', v as BadgeMetric)}
                  options={METRIC_META.map((m) => ({ value: m.metric, label: metricLabel(m.metric, adminLang) }))}
                />
              </div>
              <div className="w-full sm:w-36">
                <label className={labelCls}>
                  {unit === 'bool'
                    ? t('admin.gamification.condition', 'Condición')
                    : unit === 'percent'
                      ? t('admin.gamification.threshold_pct', 'Umbral (%)')
                      : t('admin.gamification.threshold', 'Umbral')}
                </label>
                {unit === 'bool' ? (
                  <div className="flex h-[44px] items-center rounded-xl border border-line bg-surface px-3 text-[13px] text-text-muted">
                    {t('admin.gamification.unit_yes', 'Sí')}
                  </div>
                ) : (
                  <input
                    type="number"
                    min={1}
                    aria-label={t('admin.gamification.threshold', 'Umbral')}
                    value={form.threshold}
                    onChange={(e) => set('threshold', Math.max(1, Number(e.target.value) || 1))}
                    className={field}
                  />
                )}
              </div>
            </div>
            <p className="mt-2 text-[11px] text-text-muted">
              {t('admin.gamification.rule_hint', 'Se otorga cuando el aprendiz alcanza este valor.')}
            </p>
          </div>

          <div className="flex items-center gap-5">
            <label className="flex items-center gap-2 text-[13px] text-text cursor-pointer">
              <input type="checkbox" checked={!!form.rare} onChange={(e) => set('rare', e.target.checked)} className="h-4 w-4 accent-amber-500" />
              {t('admin.gamification.rare', 'Poco común (⭐)')}
            </label>
            <label className="flex items-center gap-2 text-[13px] text-text cursor-pointer">
              <input type="checkbox" checked={form.enabled !== false} onChange={(e) => set('enabled', e.target.checked)} className="h-4 w-4 accent-primary" />
              {t('admin.gamification.enabled', 'Activo')}
            </label>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-line bg-surface px-4 py-2.5 text-[13px] font-medium text-text hover:bg-subtle min-h-[44px]">
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-semibold text-on-primary hover:opacity-90 min-h-[44px] disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t('common.save', 'Guardar')}
          </button>
        </div>
      </div>
    </div>
  )
}

function XPLevelsEditor({
  levels, busy, setBusy,
}: {
  levels: XPLevel[]
  busy: boolean
  setBusy: (b: boolean) => void
}) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [rows, setRows] = useState<XPLevel[]>(levels)
  const [dirty, setDirty] = useState(false)

  useEffect(() => { setRows(levels); setDirty(false) }, [levels])

  const update = (idx: number, patch: Partial<XPLevel>) => {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)))
    setDirty(true)
  }

  const addLevel = () => {
    const nextLevel = rows.length > 0 ? Math.max(...rows.map((r) => r.level)) + 1 : 1
    const lastMax = rows.length > 0 ? rows[rows.length - 1].maxXP : 0
    setRows((r) => [
      ...r,
      { level: nextLevel, label: '', minXP: lastMax, maxXP: lastMax + 500, color: '#888' },
    ])
    setDirty(true)
  }

  const removeRow = (idx: number) => {
    setRows((r) => r.filter((_, i) => i !== idx))
    setDirty(true)
  }

  const saveAll = async () => {
    if (rows.some((r) => !r.label.trim())) {
      toast.error(t('admin.gamification.level_label_required', 'Cada nivel necesita un nombre'))
      return
    }
    const ok = await confirm({
      title: t('admin.gamification.save_levels', 'Guardar niveles'),
      description: t('admin.gamification.save_levels_desc', 'Se aplicará a todos los aprendices.'),
      tone: 'default',
    })
    if (!ok) return
    try {
      setBusy(true)
      // Borrar los niveles que ya no están.
      const keep = new Set(rows.map((r) => r.level))
      for (const l of levels) if (!keep.has(l.level)) await deleteLevel(l.level)
      for (const r of rows) await upsertLevel(r)
      await loadGamification(true)
      toast.success(t('admin.gamification.levels_saved', 'Niveles guardados'))
    } catch {
      toast.error(t('admin.gamification.save_error', 'No se pudo guardar'))
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-[13px] text-text outline-none focus:border-primary'

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-text">
            {t('admin.gamification.xp_levels', 'Niveles de experiencia (XP)')}
          </h2>
          <p className="text-[12px] text-text-muted">
            {t('admin.gamification.xp_hint', 'Rangos de XP que definen el rango/nivel del aprendiz.')}
          </p>
        </div>
        <button
          onClick={addLevel}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px] font-medium text-text hover:bg-subtle min-h-[44px]"
        >
          <Plus className="h-4 w-4" />
          {t('admin.gamification.add_level', 'Nivel')}
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-line bg-subtle text-left text-[11px] uppercase tracking-wider text-text-subtle">
              <th className="px-3 py-2.5 w-12">Nv.</th>
              <th className="px-3 py-2.5">{t('admin.gamification.level_name', 'Nombre (ES / EN / PT)')}</th>
              <th className="px-3 py-2.5 w-24">{t('admin.gamification.min_xp', 'XP mín.')}</th>
              <th className="px-3 py-2.5 w-24">{t('admin.gamification.max_xp', 'XP máx.')}</th>
              <th className="px-3 py-2.5 w-20">{t('admin.gamification.color', 'Color')}</th>
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, idx) => (
              <tr key={idx}>
                <td className="px-3 py-2 font-bold tabular-nums text-text">{r.level}</td>
                <td className="px-3 py-2">
                  <div className="grid grid-cols-3 gap-1.5">
                    <input value={r.label} placeholder="ES" onChange={(e) => update(idx, { label: e.target.value })} className={field} />
                    <input value={r.label_en ?? ''} placeholder="EN" onChange={(e) => update(idx, { label_en: e.target.value })} className={field} />
                    <input value={r.label_pt ?? ''} placeholder="PT" onChange={(e) => update(idx, { label_pt: e.target.value })} className={field} />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <input type="number" aria-label="XP mín." value={r.minXP} onChange={(e) => update(idx, { minXP: Number(e.target.value) || 0 })} className={field} />
                </td>
                <td className="px-3 py-2">
                  <input type="number" aria-label="XP máx." value={r.maxXP} onChange={(e) => update(idx, { maxXP: Number(e.target.value) || 0 })} className={field} />
                </td>
                <td className="px-3 py-2">
                  <input type="color" aria-label="Color del nivel" value={r.color} onChange={(e) => update(idx, { color: e.target.value })} className="h-9 w-full cursor-pointer rounded-lg border border-line bg-surface" />
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => removeRow(idx)}
                    disabled={rows.length <= 1}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-25"
                    title={t('common.delete', 'Eliminar')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dirty && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={saveAll}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-semibold text-on-primary hover:opacity-90 min-h-[44px] disabled:opacity-40"
          >
            <Save className="h-4 w-4" />
            {t('admin.gamification.save_levels', 'Guardar niveles')}
          </button>
        </div>
      )}
    </section>
  )
}
