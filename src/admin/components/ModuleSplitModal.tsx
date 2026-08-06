import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Scissors,
  Users,
  X,
} from 'lucide-react'
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
  planSplitWithAi,
  splitModule,
  type DbModuleWithSections,
  type DbSectionRow,
  type PendingSurgery,
  type SurgeryAiWant,
  type SurgeryImpact,
} from '@/services/moduleSurgery.service'
import { AiRunButton, AiToggle, EASE, OutcomeCard, SPRING } from './ModuleSurgeryBits'

interface ModuleSplitModalProps {
  moduleId: string
  campaignId: string
  onClose: () => void
  /** El contenido ya quedó separado; el padre muestra la franja de Deshacer. */
  onApplied: (result: { pending: PendingSurgery; newModuleId: string }) => void
}

type Phase = 'loading' | 'editing' | 'cutting' | 'done'

/**
 * SEPARAR UN MÓDULO LARGO EN DOS.
 *
 * Toda la interacción es una sola: arrastrar la línea de corte. Lo de arriba se
 * tiñe de verde (parte 1) y lo de abajo de magenta (parte 2), en vivo, mientras
 * las dos tarjetas de resultado recalculan secciones y minutos. No hay pasos, no
 * hay asistente: se ve el resultado antes de confirmarlo.
 *
 * La IA es opcional y granular — el capacitador marca qué quiere que haga con
 * tres interruptores (sugerir el corte, redactar títulos, escribir el enlace) y
 * puede editar todo lo que la IA proponga antes de confirmar.
 */
export function ModuleSplitModal({ moduleId, campaignId, onClose, onApplied }: ModuleSplitModalProps) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()

  const [phase, setPhase] = useState<Phase>('loading')
  const [mod, setMod] = useState<DbModuleWithSections | null>(null)
  const [sections, setSections] = useState<DbSectionRow[]>([])
  const [cutIndex, setCutIndex] = useState(1)
  const [dragging, setDragging] = useState(false)
  const [impact, setImpact] = useState<SurgeryImpact | null>(null)

  const [titleA, setTitleA] = useState('')
  const [titleB, setTitleB] = useState('')

  // Interruptores de IA. Por defecto solo los títulos: es lo que casi siempre
  // hace falta y lo más barato; sugerir corte y redactar enlaces se piden aparte.
  const [wantCut, setWantCut] = useState(false)
  const [wantMeta, setWantMeta] = useState(true)
  const [wantBridge, setWantBridge] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [cutReason, setCutReason] = useState<string | null>(null)
  const [aiPlan, setAiPlan] = useState<{
    a?: { subtitle_es?: string | null; objectives_es?: string[]; key_takeaways_es?: string[]; closing_es?: string }
    b?: { subtitle_es?: string | null; objectives_es?: string[]; key_takeaways_es?: string[]; intro_es?: string }
  } | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])

  const busy = phase === 'cutting' || phase === 'done'

  /* ── Carga ───────────────────────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const data = await getModuleWithSectionsRaw(moduleId)
        if (!alive) return
        const ordered = [...data.module_sections].sort((a, b) => a.sort_order - b.sort_order)
        setMod(data)
        setSections(ordered)
        setCutIndex(Math.max(1, Math.round(ordered.length / 2)))
        setTitleA(data.title_es)
        setTitleB(`${data.title_es} (2)`)
        setPhase('editing')
        const imp = await getSurgeryImpact([moduleId])
        if (alive) setImpact(imp[moduleId] ?? null)
      } catch (e) {
        console.error('[ModuleSplitModal] load', e)
        toast.error(t('admin.surgery.load_error'))
        onClose()
      }
    })()
    return () => {
      alive = false
    }
  }, [moduleId, onClose, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  /* ── Arrastre de la línea de corte ───────────────────────────────────────── */
  // El corte válido va de 1 a n-1: ninguna de las dos partes puede quedar vacía.
  const clampCut = useCallback(
    (i: number) => Math.min(Math.max(i, 1), Math.max(1, sections.length - 1)),
    [sections.length],
  )

  /** Hueco más cercano al puntero, midiendo el borde superior de cada fila. */
  const nearestGap = useCallback(
    (clientY: number) => {
      let best = cutIndex
      let bestDist = Infinity
      for (let i = 1; i < sections.length; i++) {
        const el = rowRefs.current[i]
        if (!el) continue
        const dist = Math.abs(el.getBoundingClientRect().top - clientY)
        if (dist < bestDist) {
          bestDist = dist
          best = i
        }
      }
      return clampCut(best)
    },
    [sections.length, cutIndex, clampCut],
  )

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => {
      e.preventDefault()
      setCutIndex(nearestGap(e.clientY))
    }
    const stop = () => setDragging(false)
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [dragging, nearestGap])

  /* ── Cifras en vivo ──────────────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const weight = (s: DbSectionRow) => Math.max(1, (s.body_es ?? []).join(' ').length)
    const total = sections.reduce((sum, s) => sum + weight(s), 0) || 1
    const first = sections.slice(0, cutIndex).reduce((sum, s) => sum + weight(s), 0)
    const totalMin = mod?.duration_min || 1
    const minA = Math.max(1, Math.round((totalMin * first) / total))
    const quizzesA = sections.slice(0, cutIndex).filter((s) => (s.section_quizzes ?? []).length > 0).length
    const quizzesB = sections.slice(cutIndex).filter((s) => (s.section_quizzes ?? []).length > 0).length
    return {
      a: { sections: cutIndex, min: minA, quizzes: quizzesA },
      b: { sections: sections.length - cutIndex, min: Math.max(1, totalMin - minA), quizzes: quizzesB },
    }
  }, [sections, cutIndex, mod])

  /* ── IA ──────────────────────────────────────────────────────────────────── */
  const runAi = async () => {
    const want: SurgeryAiWant[] = []
    if (wantCut) want.push('cut')
    if (wantMeta) want.push('meta')
    if (wantBridge) want.push('bridge')
    if (want.length === 0) return

    setAiBusy(true)
    try {
      await consumeAiOperation('module', t('admin.surgery.split_ai_label'), campaignId)
      const plan = await planSplitWithAi({ moduleId, want, cutIndex: wantCut ? undefined : cutIndex })

      if (wantCut && typeof plan.cutIndex === 'number') {
        setCutIndex(clampCut(plan.cutIndex))
        setCutReason(plan.cutReason ?? null)
      }
      const [a, b] = plan.parts ?? []
      if (wantMeta) {
        if (a?.title_es) setTitleA(a.title_es)
        if (b?.title_es) setTitleB(b.title_es)
      }
      setAiPlan({
        a: wantMeta || wantBridge ? a : undefined,
        b: wantMeta || wantBridge ? b : undefined,
      })
      toast.success(t('admin.surgery.ai_done'))
    } catch (e) {
      if (isQuotaExceeded(e)) {
        toast.error(t('admin.surgery.ai_quota'))
      } else {
        console.error('[ModuleSplitModal] runAi', e)
        // La acción `split_plan` es nueva en la Edge Function: mientras no se
        // redespliegue, la IA falla pero separar a mano sigue funcionando.
        toast.error(t('admin.surgery.ai_error'))
      }
    } finally {
      setAiBusy(false)
    }
  }

  /* ── Confirmar ───────────────────────────────────────────────────────────── */
  const confirm = async () => {
    if (!mod) return
    setPhase('cutting')
    // Se deja respirar la animación del corte antes de tocar la BD: el trabajo
    // real casi siempre tarda menos que el gesto y sin esto no se ve nada.
    if (!reduce) await new Promise((r) => setTimeout(r, 620))
    try {
      const outcome = await splitModule({
        moduleId,
        cutIndex,
        parts: [
          {
            title_es: titleA.trim() || mod.title_es,
            subtitle_es: aiPlan?.a?.subtitle_es,
            objectives_es: aiPlan?.a?.objectives_es,
            key_takeaways_es: aiPlan?.a?.key_takeaways_es,
          },
          {
            title_es: titleB.trim() || `${mod.title_es} (2)`,
            subtitle_es: aiPlan?.b?.subtitle_es,
            objectives_es: aiPlan?.b?.objectives_es,
            key_takeaways_es: aiPlan?.b?.key_takeaways_es,
          },
        ],
        bridge: wantBridge
          ? { closing_es: aiPlan?.a?.closing_es, intro_es: aiPlan?.b?.intro_es }
          : undefined,
      })
      setPhase('done')
      if (!reduce) await new Promise((r) => setTimeout(r, 520))
      onApplied({ pending: outcome, newModuleId: outcome.newModuleId })
    } catch (e) {
      console.error('[ModuleSplitModal] confirm', e)
      toast.error(t('admin.surgery.split_error'))
      setPhase('editing')
    }
  }

  /* ── Render ──────────────────────────────────────────────────────────────── */
  const cutting = phase === 'cutting' || phase === 'done'

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[130] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label={t('admin.surgery.split_title')}
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
                  <Scissors className="h-4 w-4 text-brand-magenta" />
                  {t('admin.surgery.split_title')}
                </h3>
                <p className="mt-0.5 truncate text-[12px] text-text-muted">
                  {mod ? mod.title_es : '…'}
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
            ) : sections.length < 2 ? (
              <div className="px-6 py-12 text-center">
                <Scissors className="mx-auto mb-3 h-8 w-8 text-text-subtle" />
                <p className="text-[13px] text-text-muted">{t('admin.surgery.too_short')}</p>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {/* Instrucción única: no hay más que aprender que esto. */}
                  <p className="mb-3 flex items-center gap-2 text-[12px] text-text-muted">
                    <GripVertical className="h-3.5 w-3.5 text-brand-magenta" />
                    {t('admin.surgery.split_hint')}
                  </p>

                  {/* ── Lista de secciones con la línea de corte ── */}
                  <div ref={listRef} className="select-none">
                    {sections.map((s, i) => {
                      const isPartB = i >= cutIndex
                      const showCut = i === cutIndex
                      return (
                        <div key={s.id}>
                          {showCut && (
                            <CutLine
                              dragging={dragging}
                              reason={cutReason}
                              onGrab={() => setDragging(true)}
                              onKeyMove={(d) => setCutIndex(clampCut(cutIndex + d))}
                              label={t('admin.surgery.cut_handle')}
                              cutting={cutting}
                            />
                          )}
                          <motion.div
                            layout
                            ref={(el) => {
                              rowRefs.current[i] = el
                            }}
                            transition={SPRING}
                            animate={
                              cutting && !reduce
                                ? { y: isPartB ? 26 : -26, opacity: 0.55, scale: 0.98 }
                                : { y: 0, opacity: 1, scale: 1 }
                            }
                            onClick={() => !busy && i > 0 && setCutIndex(clampCut(i))}
                            className={cn(
                              'mb-1.5 flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                              isPartB
                                ? 'border-brand-magenta/30 bg-brand-magenta/[0.06]'
                                : 'border-brand-green/30 bg-brand-green/[0.06]',
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold tabular-nums',
                                isPartB
                                  ? 'bg-brand-magenta/15 text-brand-magenta'
                                  : 'bg-brand-green/15 text-brand-green',
                              )}
                            >
                              {isPartB ? i - cutIndex + 1 : i + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                              {s.heading_es || t('admin.surgery.untitled_section')}
                            </span>
                            <span className="flex shrink-0 items-center gap-2 text-text-subtle">
                              {s.media_url && <ImageIcon className="h-3.5 w-3.5" />}
                              {(s.section_quizzes ?? []).length > 0 && (
                                <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px]">
                                  {t('admin.surgery.quiz_tag')}
                                </span>
                              )}
                            </span>
                          </motion.div>
                        </div>
                      )
                    })}
                  </div>

                  {/* ── Resultado en vivo ── */}
                  <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                    <OutcomeCard
                      tone="green"
                      eyebrow={t('admin.surgery.part_one')}
                      title={titleA}
                      onTitleChange={setTitleA}
                      stats={[
                        { value: String(stats.a.sections), label: t('admin.surgery.sections') },
                        { value: `${stats.a.min}`, label: t('admin.surgery.minutes') },
                        { value: String(stats.a.quizzes), label: t('admin.surgery.quizzes') },
                      ]}
                    />
                    <OutcomeCard
                      tone="magenta"
                      eyebrow={t('admin.surgery.part_two')}
                      title={titleB}
                      onTitleChange={setTitleB}
                      stats={[
                        { value: String(stats.b.sections), label: t('admin.surgery.sections') },
                        { value: `${stats.b.min}`, label: t('admin.surgery.minutes') },
                        { value: String(stats.b.quizzes), label: t('admin.surgery.quizzes') },
                      ]}
                    />
                  </div>

                  {/* ── Qué hace la IA ── */}
                  <div className="mt-4 rounded-2xl border border-line bg-glass/[0.02] p-3.5">
                    <p className="mb-2.5 text-[12.5px] font-semibold text-text">
                      {t('admin.surgery.ai_section_title')}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <AiToggle
                        checked={wantCut}
                        onChange={setWantCut}
                        disabled={aiBusy || busy}
                        label={t('admin.surgery.ai_cut')}
                        hint={t('admin.surgery.ai_cut_hint')}
                      />
                      <AiToggle
                        checked={wantMeta}
                        onChange={setWantMeta}
                        disabled={aiBusy || busy}
                        label={t('admin.surgery.ai_meta')}
                        hint={t('admin.surgery.ai_meta_hint')}
                      />
                      <AiToggle
                        checked={wantBridge}
                        onChange={setWantBridge}
                        disabled={aiBusy || busy}
                        label={t('admin.surgery.ai_bridge_split')}
                        hint={t('admin.surgery.ai_bridge_split_hint')}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <AiRunButton
                        busy={aiBusy}
                        disabled={busy || (!wantCut && !wantMeta && !wantBridge)}
                        onClick={runAi}
                      >
                        {aiBusy ? t('admin.surgery.ai_running') : t('admin.surgery.ai_run')}
                      </AiRunButton>
                      <AiReviewNotice variant="inline" className="flex-1" />
                    </div>
                  </div>

                  {/* ── A quién afecta ── */}
                  {impact && (impact.completed > 0 || impact.started > 0) && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: EASE }}
                      className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-2.5"
                    >
                      <Users className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <p className="text-[12px] leading-relaxed text-text-muted">
                        {impact.completed > 0 && (
                          <span className="block">
                            {t('admin.surgery.impact_split_completed', { n: impact.completed })}
                          </span>
                        )}
                        {impact.started > 0 && (
                          <span className="block">
                            {t('admin.surgery.impact_started', { n: impact.started })}
                          </span>
                        )}
                      </p>
                    </motion.div>
                  )}
                </div>

                {/* ── Pie ── */}
                <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
                  <p className="text-[11.5px] text-text-subtle">
                    {t('admin.surgery.undo_hint')}
                  </p>
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
                      className="flex h-10 items-center gap-2 rounded-xl border border-brand-magenta/40 bg-brand-magenta/15 px-4 text-[12.5px] font-semibold text-brand-magenta transition-colors hover:bg-brand-magenta/25 disabled:opacity-60"
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
                        ) : phase === 'cutting' ? (
                          <motion.span key="busy">
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </motion.span>
                        ) : (
                          <motion.span key="idle">
                            <Scissors className="h-4 w-4" />
                          </motion.span>
                        )}
                      </AnimatePresence>
                      {t('admin.surgery.split_confirm')}
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

/* ────────────────────────────────────────────────────────────────────────────
   La línea de corte. Es un solo elemento con `layoutId`: al cambiar de hueco no
   se destruye y se vuelve a crear, VUELA hasta la nueva posición con resorte.
   Ese vuelo es lo que hace que el gesto se sienta físico.
   ──────────────────────────────────────────────────────────────────────────── */
function CutLine({
  dragging,
  reason,
  onGrab,
  onKeyMove,
  label,
  cutting,
}: {
  dragging: boolean
  reason: string | null
  onGrab: () => void
  onKeyMove: (delta: number) => void
  label: string
  cutting: boolean
}) {
  return (
    <motion.div
      layoutId="module-cut-line"
      transition={SPRING}
      className="relative my-1.5 flex items-center gap-2 py-1"
    >
      {/* Riel luminoso: verde a la izquierda, magenta a la derecha. */}
      <motion.span
        aria-hidden
        className="h-px flex-1 rounded-full"
        style={{
          background:
            'linear-gradient(90deg, rgba(16,212,81,0) 0%, rgba(16,212,81,0.9) 60%, rgba(179,61,158,0.9) 100%)',
        }}
        animate={{ opacity: dragging || cutting ? 1 : 0.65, scaleY: dragging ? 3 : 1 }}
        transition={{ duration: 0.2 }}
      />

      <motion.button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault()
          onGrab()
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            onKeyMove(-1)
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            onKeyMove(1)
          }
        }}
        aria-label={label}
        animate={
          cutting
            ? { scale: [1, 1.35, 0.9], rotate: [0, -18, 8] }
            : dragging
              ? { scale: 1.12 }
              : { scale: 1 }
        }
        whileHover={{ scale: 1.08 }}
        transition={cutting ? { duration: 0.55, ease: EASE } : SPRING}
        className={cn(
          'relative z-10 flex shrink-0 cursor-grab items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold outline-none active:cursor-grabbing',
          dragging
            ? 'border-brand-magenta bg-brand-magenta/25 text-brand-magenta shadow-[0_0_24px_-4px_rgba(179,61,158,0.9)]'
            : 'border-brand-magenta/45 bg-surface text-brand-magenta shadow-[0_0_16px_-8px_rgba(179,61,158,0.9)]',
        )}
      >
        {/* Latido que llama la atención cuando la línea está quieta. */}
        {!dragging && !cutting && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border border-brand-magenta/60"
            animate={{ scale: [1, 1.45], opacity: [0.55, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <Scissors className="h-3 w-3" />
        <GripVertical className="h-3 w-3 opacity-70" />
      </motion.button>

      <motion.span
        aria-hidden
        className="h-px flex-1 rounded-full"
        style={{
          background:
            'linear-gradient(90deg, rgba(179,61,158,0.9) 0%, rgba(179,61,158,0.9) 40%, rgba(179,61,158,0) 100%)',
        }}
        animate={{ opacity: dragging || cutting ? 1 : 0.65, scaleY: dragging ? 3 : 1 }}
        transition={{ duration: 0.2 }}
      />

      {/* Por qué la IA cortó ahí. Aparece pegado a la línea y se va con ella. */}
      <AnimatePresence>
        {reason && !dragging && (
          <motion.span
            initial={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="pointer-events-none absolute -top-4 left-1/2 max-w-[80%] -translate-x-1/2 truncate rounded-full border border-brand-magenta/30 bg-surface px-2 py-0.5 text-[10px] text-text-muted"
          >
            {reason}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
