import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown, ArrowUp, Check, Combine, Loader2, Users, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { consumeAiOperation, isQuotaExceeded } from '@/services/aiQuota.service'
import {
  getModuleWithSectionsRaw,
  getSurgeryImpact,
  mergeManyModules,
  planMergeWithAi,
  type DbModuleWithSections,
  type MergeAiPlan,
  type PendingSurgery,
  type SurgeryAiWant,
  type SurgeryImpact,
} from '@/services/moduleSurgery.service'
import { AiRunButton, AiToggle, EASE, OutcomeCard, SPRING } from './ModuleSurgeryBits'

interface ModuleMergeModalProps {
  /** Módulos elegidos, en el orden en que están en el curso. */
  moduleIds: string[]
  campaignId: string
  onClose: () => void
  onApplied: (result: { pending: PendingSurgery; keepId: string }) => void
}

type Phase = 'loading' | 'editing' | 'merging' | 'done'

/**
 * UNIR DOS O MÁS MÓDULOS EN UNO.
 *
 * La metáfora es física: las tarjetas de los módulos elegidos se ven apiladas y
 * al confirmar se juntan hasta fundirse en una sola, con la costura brillando.
 * Debajo siempre está la verdad — el orden real de las secciones resultantes,
 * con una marca en cada costura, para que nadie confirme a ciegas.
 *
 * El primero de la lista es el que MANDA: conserva su id, su avance y su lugar
 * en el curso. Por eso se puede reordenar antes de confirmar.
 */
export function ModuleMergeModal({ moduleIds, campaignId, onClose, onApplied }: ModuleMergeModalProps) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()

  const [phase, setPhase] = useState<Phase>('loading')
  const [order, setOrder] = useState<string[]>(moduleIds)
  const [mods, setMods] = useState<Record<string, DbModuleWithSections>>({})
  const [impact, setImpact] = useState<Record<string, SurgeryImpact>>({})
  const [title, setTitle] = useState('')

  const [wantMeta, setWantMeta] = useState(true)
  const [wantBridge, setWantBridge] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiPlan, setAiPlan] = useState<MergeAiPlan | null>(null)

  const busy = phase === 'merging' || phase === 'done'
  const merging = phase === 'merging' || phase === 'done'

  /* ── Carga ───────────────────────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const loaded = await Promise.all(moduleIds.map((id) => getModuleWithSectionsRaw(id)))
        if (!alive) return
        const map: Record<string, DbModuleWithSections> = {}
        for (const m of loaded) map[m.id] = m
        setMods(map)
        setTitle(map[moduleIds[0]]?.title_es ?? '')
        setPhase('editing')
        const imp = await getSurgeryImpact(moduleIds)
        if (alive) setImpact(imp)
      } catch (e) {
        console.error('[ModuleMergeModal] load', e)
        toast.error(t('admin.surgery.load_error'))
        onClose()
      }
    })()
    return () => {
      alive = false
    }
  }, [moduleIds, onClose, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  // El primero manda: al reordenar cambia de quién se hereda el avance, así que
  // el título propuesto se recalcula salvo que ya lo hayan tocado a mano.
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...order]
    const to = idx + dir
    if (to < 0 || to >= next.length) return
    ;[next[idx], next[to]] = [next[to], next[idx]]
    setOrder(next)
    if (!aiPlan) setTitle(mods[next[0]]?.title_es ?? '')
  }

  /* ── Cifras y línea de tiempo del resultado ──────────────────────────────── */
  const merged = useMemo(() => {
    const list = order.map((id) => mods[id]).filter(Boolean)
    const timeline: Array<{ id: string; heading: string; from: number; seam: boolean }> = []
    let minutes = 0
    let quizzes = 0
    list.forEach((m, mi) => {
      minutes += m.duration_min || 0
      const ordered = [...m.module_sections].sort((a, b) => a.sort_order - b.sort_order)
      ordered.forEach((s, si) => {
        if ((s.section_quizzes ?? []).length > 0) quizzes += 1
        timeline.push({
          id: s.id,
          heading: s.heading_es || t('admin.surgery.untitled_section'),
          from: mi,
          seam: mi > 0 && si === 0,
        })
      })
    })
    return { list, timeline, minutes, quizzes }
  }, [order, mods, t])

  const affected = useMemo(() => {
    const completedAll = Object.values(impact).reduce((max, i) => Math.max(max, i.completed), 0)
    const started = Object.values(impact).reduce((max, i) => Math.max(max, i.started), 0)
    return { completedAll, started }
  }, [impact])

  /* ── IA ──────────────────────────────────────────────────────────────────── */
  const runAi = async () => {
    const want: SurgeryAiWant[] = []
    if (wantMeta) want.push('meta')
    if (wantBridge) want.push('bridge')
    if (want.length === 0) return

    setAiBusy(true)
    try {
      await consumeAiOperation('module', t('admin.surgery.merge_ai_label'), campaignId)
      const plan = await planMergeWithAi({ moduleIds: order, want })
      if (wantMeta && plan.title_es) setTitle(plan.title_es)
      setAiPlan(plan)
      toast.success(t('admin.surgery.ai_done'))
    } catch (e) {
      if (isQuotaExceeded(e)) {
        toast.error(t('admin.surgery.ai_quota'))
      } else {
        console.error('[ModuleMergeModal] runAi', e)
        toast.error(t('admin.surgery.ai_error'))
      }
    } finally {
      setAiBusy(false)
    }
  }

  /* ── Confirmar ───────────────────────────────────────────────────────────── */
  const confirm = async () => {
    setPhase('merging')
    if (!reduce) await new Promise((r) => setTimeout(r, 620))
    try {
      const pending = await mergeManyModules({
        moduleIds: order,
        meta: {
          title_es: title.trim() || mods[order[0]]?.title_es || '',
          subtitle_es: wantMeta ? aiPlan?.subtitle_es : undefined,
          objectives_es: wantMeta ? aiPlan?.objectives_es : undefined,
          key_takeaways_es: wantMeta ? aiPlan?.key_takeaways_es : undefined,
        },
        bridge:
          wantBridge && aiPlan?.bridge_es?.body_es?.length
            ? {
                heading_es: aiPlan.bridge_es.heading_es || t('admin.surgery.bridge_heading'),
                body_es: aiPlan.bridge_es.body_es,
              }
            : undefined,
      })
      setPhase('done')
      if (!reduce) await new Promise((r) => setTimeout(r, 520))
      onApplied({ pending, keepId: order[0] })
    } catch (e) {
      console.error('[ModuleMergeModal] confirm', e)
      toast.error(t('admin.surgery.merge_error'))
      setPhase('editing')
    }
  }

  /* ── Render ──────────────────────────────────────────────────────────────── */
  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[130] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label={t('admin.surgery.merge_title')}
      >
        <div
          className="absolute inset-0 bg-black/65 backdrop-blur-sm"
          {...backdropDismiss(() => !busy && onClose())}
        />

        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 12 }}
          transition={{ duration: 0.28, ease: EASE }}
          className="relative w-full max-w-3xl"
        >
          <div className="relative flex max-h-[88vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-glass-lg">
            {/* ── Encabezado ── */}
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-[16px] font-semibold text-text">
                  <Combine className="h-4 w-4 text-brand-green" />
                  {t('admin.surgery.merge_title')}
                </h3>
                <p className="mt-0.5 text-[12px] text-text-muted">
                  {t('admin.surgery.merge_subtitle', { n: order.length })}
                </p>
              </div>
              <button
                onClick={onClose}
                disabled={busy}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-glass/6 hover:text-text disabled:opacity-30"
                aria-label={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {phase === 'loading' ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {/* ── Las tarjetas que se van a fundir ── */}
                  <p className="mb-2.5 text-[12px] text-text-muted">{t('admin.surgery.merge_hint')}</p>

                  <motion.div layout className="space-y-1.5">
                    {order.map((id, idx) => {
                      const m = mods[id]
                      if (!m) return null
                      const isHead = idx === 0
                      return (
                        <motion.div
                          key={id}
                          layout
                          transition={SPRING}
                          animate={
                            merging && !reduce
                              ? { y: -idx * 46, scale: 1 - idx * 0.02, opacity: idx === 0 ? 1 : 0.35 }
                              : { y: 0, scale: 1, opacity: 1 }
                          }
                          className={cn(
                            'flex items-center gap-3 rounded-xl border px-3 py-2.5',
                            isHead
                              ? 'border-brand-green/40 bg-brand-green/[0.08]'
                              : 'border-line bg-glass/[0.03]',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold tabular-nums',
                              isHead ? 'bg-brand-green/15 text-brand-green' : 'bg-glass/10 text-text-muted',
                            )}
                          >
                            {idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] text-text">{m.title_es}</p>
                            <p className="text-[11px] text-text-subtle">
                              {t('admin.surgery.module_meta', {
                                sections: m.module_sections.length,
                                min: m.duration_min,
                              })}
                            </p>
                          </div>
                          {isHead && (
                            <span className="shrink-0 rounded-full border border-brand-green/35 bg-brand-green/10 px-2 py-0.5 text-[10px] font-semibold text-brand-green">
                              {t('admin.surgery.keeps_progress')}
                            </span>
                          )}
                          <div className="flex shrink-0 items-center">
                            <button
                              onClick={() => move(idx, -1)}
                              disabled={idx === 0 || busy}
                              aria-label={t('admin.courses.move_up')}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-glass/8 hover:text-text disabled:opacity-25"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => move(idx, 1)}
                              disabled={idx === order.length - 1 || busy}
                              aria-label={t('admin.courses.move_down')}
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-glass/8 hover:text-text disabled:opacity-25"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </motion.div>
                      )
                    })}
                  </motion.div>

                  {/* ── Resultado ── */}
                  <div className="mt-4">
                    <OutcomeCard
                      tone="green"
                      eyebrow={t('admin.surgery.merged_result')}
                      title={title}
                      onTitleChange={setTitle}
                      stats={[
                        { value: String(merged.timeline.length), label: t('admin.surgery.sections') },
                        { value: String(merged.minutes), label: t('admin.surgery.minutes') },
                        { value: String(merged.quizzes), label: t('admin.surgery.quizzes') },
                      ]}
                    />
                  </div>

                  {/* ── Orden real de las secciones, con la costura marcada ── */}
                  <div className="mt-3 rounded-2xl border border-line bg-glass/[0.02] p-3">
                    <p className="mb-2 text-[11.5px] font-semibold text-text-muted">
                      {t('admin.surgery.final_order')}
                    </p>
                    <div className="max-h-52 overflow-y-auto pr-1">
                      {merged.timeline.map((s, i) => (
                        <div key={s.id}>
                          {s.seam && <Seam label={t('admin.surgery.seam')} glow={merging} />}
                          <motion.div
                            layout
                            transition={SPRING}
                            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5"
                          >
                            <span className="w-5 shrink-0 text-right text-[10.5px] tabular-nums text-text-subtle">
                              {i + 1}
                            </span>
                            <span
                              className={cn(
                                'h-1.5 w-1.5 shrink-0 rounded-full',
                                s.from === 0 ? 'bg-brand-green' : 'bg-brand-magenta',
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate text-[12px] text-text-muted">
                              {s.heading}
                            </span>
                          </motion.div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Qué hace la IA ── */}
                  <div className="mt-4 rounded-2xl border border-line bg-glass/[0.02] p-3.5">
                    <p className="mb-2.5 text-[12.5px] font-semibold text-text">
                      {t('admin.surgery.ai_section_title')}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <AiToggle
                        checked={wantMeta}
                        onChange={setWantMeta}
                        disabled={aiBusy || busy}
                        label={t('admin.surgery.ai_merge_meta')}
                        hint={t('admin.surgery.ai_merge_meta_hint')}
                      />
                      <AiToggle
                        checked={wantBridge}
                        onChange={setWantBridge}
                        disabled={aiBusy || busy}
                        label={t('admin.surgery.ai_bridge_merge')}
                        hint={t('admin.surgery.ai_bridge_merge_hint')}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <AiRunButton busy={aiBusy} disabled={busy || (!wantMeta && !wantBridge)} onClick={runAi}>
                        {aiBusy ? t('admin.surgery.ai_running') : t('admin.surgery.ai_run')}
                      </AiRunButton>
                      <AiReviewNotice variant="inline" className="flex-1" />
                    </div>
                  </div>

                  {/* ── A quién afecta ── */}
                  {(affected.completedAll > 0 || affected.started > 0) && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: EASE }}
                      className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-2.5"
                    >
                      <Users className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <p className="text-[12px] leading-relaxed text-text-muted">
                        <span className="block">{t('admin.surgery.impact_merge')}</span>
                        {affected.started > 0 && (
                          <span className="block">
                            {t('admin.surgery.impact_started', { n: affected.started })}
                          </span>
                        )}
                      </p>
                    </motion.div>
                  )}
                </div>

                {/* ── Pie ── */}
                <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
                  <p className="text-[11.5px] text-text-subtle">{t('admin.surgery.undo_hint')}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={onClose}
                      disabled={busy}
                      className="h-10 rounded-xl px-3.5 text-[12.5px] font-medium text-text-muted transition-colors hover:bg-glass/8 hover:text-text disabled:opacity-30"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={confirm}
                      disabled={busy}
                      className="flex h-10 items-center gap-2 rounded-xl border border-brand-green/40 bg-brand-green/15 px-4 text-[12.5px] font-semibold text-brand-green transition-colors hover:bg-brand-green/25 disabled:opacity-60"
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        {phase === 'done' ? (
                          <motion.span
                            key="ok"
                            initial={{ scale: 0, rotate: -90 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={SPRING}
                          >
                            <Check className="h-4 w-4" />
                          </motion.span>
                        ) : phase === 'merging' ? (
                          <motion.span key="busy">
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </motion.span>
                        ) : (
                          <motion.span key="idle">
                            <Combine className="h-4 w-4" />
                          </motion.span>
                        )}
                      </AnimatePresence>
                      {t('admin.surgery.merge_confirm')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}

/** La costura entre dos módulos: una línea que se enciende al confirmar. */
function Seam({ label, glow }: { label: string; glow: boolean }) {
  return (
    <div className="relative my-1 flex items-center gap-2 py-0.5">
      <motion.span
        aria-hidden
        className="h-px flex-1 rounded-full bg-gradient-to-r from-brand-green/0 via-brand-green/70 to-brand-magenta/70"
        animate={glow ? { opacity: [0.5, 1, 0.5], scaleY: [1, 3, 1] } : { opacity: 0.5, scaleY: 1 }}
        transition={glow ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
      />
      <span className="shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider text-text-subtle">
        {label}
      </span>
      <motion.span
        aria-hidden
        className="h-px flex-1 rounded-full bg-gradient-to-r from-brand-magenta/70 to-brand-magenta/0"
        animate={glow ? { opacity: [0.5, 1, 0.5], scaleY: [1, 3, 1] } : { opacity: 0.5, scaleY: 1 }}
        transition={glow ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
      />
    </div>
  )
}
