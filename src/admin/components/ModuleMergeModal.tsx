import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Combine,
  Eye,
  Loader2,
  Pencil,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { Tooltip } from '@/components/ui/Tooltip'
import { consumeAiOperation, isQuotaExceeded } from '@/services/aiQuota.service'
import {
  getModuleWithSectionsRaw,
  getSurgeryImpact,
  mergeManyModules,
  planMergeWithAi,
  type DbModuleWithSections,
  type PendingSurgery,
  type SurgeryAiWant,
  type SurgeryImpact,
} from '@/services/moduleSurgery.service'
import {
  AiRetryRow,
  AiRunButton,
  AiToggle,
  DiscardAiButton,
  EASE,
  OutcomeCard,
  SectionBody,
  SPRING,
  SurgeryField,
  SurgeryFold,
  SurgeryList,
  SurgeryPreview,
  type PreviewModule,
} from './ModuleSurgeryBits'

/** Lo que redacta la IA para el módulo unido, ya en forma editable. */
interface MergeDraft {
  subtitle_es: string
  objectives_es: string[]
  key_takeaways_es: string[]
  bridgeHeading: string
  /** Una línea por párrafo de la sección puente. */
  bridgeBody: string
}

/** Frases con contenido; si no queda ninguna se devuelve `undefined` (no tocar). */
const cleanList = (list: string[]): string[] | undefined => {
  const out = list.map((s) => s.trim()).filter(Boolean)
  return out.length > 0 ? out : undefined
}

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
  // Una vez escrito a mano, el título deja de seguir al primero de la lista.
  const [titleTouched, setTitleTouched] = useState(false)
  // `null` = la duración sigue siendo la suma de los módulos.
  const [minutes, setMinutes] = useState<number | null>(null)

  const [wantMeta, setWantMeta] = useState(true)
  const [wantBridge, setWantBridge] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  // Lo que redactó la IA, ya editable. `null` = todavía no ha corrido.
  const [draft, setDraft] = useState<MergeDraft | null>(null)
  const [draftOpen, setDraftOpen] = useState(true)
  /** Qué corregirle a la IA para el siguiente intento. */
  const [aiNote, setAiNote] = useState('')
  /** Qué interruptores se llegaron a APLICAR de verdad (no solo a marcar). */
  const [appliedWant, setAppliedWant] = useState<SurgeryAiWant[]>([])

  /** Sección cuyo texto está desplegado, para leerlo sin salir del modal. */
  const [peek, setPeek] = useState<string | null>(null)

  /** `preview` enseña cómo queda el módulo unido SIN tocar la base de datos. */
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

  const busy = phase === 'merging' || phase === 'done'
  const merging = phase === 'merging' || phase === 'done'

  /* ── Carga ───────────────────────────────────────────────────────────────── */
  // `onClose` y `t` cambian de identidad en cada render del padre (y al cambiar
  // de idioma). Si el efecto de carga dependiera de ellos, cualquier re-render
  // del editor recargaría los módulos y devolvería el orden y el título a su
  // valor por omisión, borrando lo que ya había ajustado el capacitador.
  const onCloseRef = useRef(onClose)
  const tRef = useRef(t)
  useEffect(() => {
    onCloseRef.current = onClose
    tRef.current = t
  })

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
        toast.error(tRef.current('admin.surgery.load_error'))
        onCloseRef.current()
      }
    })()
    return () => {
      alive = false
    }
    // El identificador de los módulos es lo único que debe provocar una recarga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleIds.join(',')])

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
    if (!draft && !titleTouched) setTitle(mods[next[0]]?.title_es ?? '')
  }

  /* ── Cifras y línea de tiempo del resultado ──────────────────────────────── */
  const merged = useMemo(() => {
    const list = order.map((id) => mods[id]).filter(Boolean)
    const timeline: Array<{
      id: string
      heading: string
      body: string[]
      quiz: boolean
      from: number
      seam: boolean
    }> = []
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
          body: s.body_es ?? [],
          quiz: (s.section_quizzes ?? []).length > 0,
          from: mi,
          seam: mi > 0 && si === 0,
        })
      })
    })
    return { list, timeline, minutes, quizzes }
  }, [order, mods, t])

  /* ── Cómo queda el módulo unido ──────────────────────────────────────────── */
  // Reproduce lo que hará `mergeManyModules`, incluido el reparto por omisión:
  // sin IA, objetivos y puntos clave son la unión de los de todos los módulos.
  const preview = useMemo<PreviewModule[]>(() => {
    const uniq = (lists: Array<string[] | null | undefined>) => {
      const seen = new Set<string>()
      const out: string[] = []
      for (const item of lists.flatMap((l) => l ?? [])) {
        const key = item.trim().toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push(item.trim())
      }
      return out
    }

    const list = order.map((id) => mods[id]).filter(Boolean)
    const bridgeBody = (draft?.bridgeBody ?? '')
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean)

    const sections = merged.timeline.flatMap((s) => {
      const row = { id: s.id, heading: s.heading, body: s.body, hasQuiz: s.quiz }
      // El puente se crea en la primera costura, justo antes del segundo módulo.
      if (s.seam && s.from === 1 && bridgeBody.length > 0) {
        return [
          {
            id: 'bridge',
            heading: draft?.bridgeHeading.trim() || t('admin.surgery.bridge_heading'),
            body: bridgeBody,
            isNew: true,
          },
          row,
        ]
      }
      return [row]
    })

    return [
      {
        tone: 'green',
        eyebrow: t('admin.surgery.merged_result'),
        title: title.trim() || (list[0]?.title_es ?? ''),
        subtitle: draft?.subtitle_es.trim() || (list[0]?.subtitle_es ?? undefined),
        minutes: minutes ?? merged.minutes,
        objectives: cleanList(draft?.objectives_es ?? []) ?? uniq(list.map((m) => m.objectives_es)),
        takeaways: cleanList(draft?.key_takeaways_es ?? []) ?? uniq(list.map((m) => m.key_takeaways_es)),
        sections,
      },
    ]
  }, [order, mods, merged, title, minutes, draft, t])

  const previewLabels = {
    objectives: t('admin.surgery.field_objectives'),
    takeaways: t('admin.surgery.field_takeaways'),
    minutes: t('admin.surgery.minutes'),
    sections: t('admin.surgery.sections'),
    quiz: t('admin.surgery.quiz_tag'),
    isNew: t('admin.surgery.section_new'),
    emptyBody: t('admin.surgery.section_empty'),
    noTitle: t('admin.surgery.untitled_module'),
  }

  const affected = useMemo(() => {
    const completedAll = Object.values(impact).reduce((max, i) => Math.max(max, i.completed), 0)
    const started = Object.values(impact).reduce((max, i) => Math.max(max, i.started), 0)
    return { completedAll, started }
  }, [impact])

  /* ── IA ──────────────────────────────────────────────────────────────────── */
  /** `instruction` = qué corregir del intento anterior; vacío en el primer intento. */
  const runAi = async (instruction?: string) => {
    const want: SurgeryAiWant[] = []
    if (wantMeta) want.push('meta')
    if (wantBridge) want.push('bridge')
    if (want.length === 0) return

    setAiBusy(true)
    try {
      await consumeAiOperation('module', t('admin.surgery.merge_ai_label'), campaignId)
      const plan = await planMergeWithAi({ moduleIds: order, want, instruction })
      if (wantMeta && plan.title_es) setTitle(plan.title_es)
      // El borrador se rellena con lo que haya venido y se despliega solo: es la
      // única forma de que "revisa lo que propuso la IA" se pueda cumplir.
      setDraft((prev) => ({
        subtitle_es: wantMeta ? (plan.subtitle_es ?? '') : (prev?.subtitle_es ?? ''),
        objectives_es: wantMeta ? (plan.objectives_es ?? []) : (prev?.objectives_es ?? []),
        key_takeaways_es: wantMeta ? (plan.key_takeaways_es ?? []) : (prev?.key_takeaways_es ?? []),
        bridgeHeading: wantBridge
          ? (plan.bridge_es?.heading_es ?? t('admin.surgery.bridge_heading'))
          : (prev?.bridgeHeading ?? ''),
        bridgeBody: wantBridge
          ? (plan.bridge_es?.body_es ?? []).join('\n')
          : (prev?.bridgeBody ?? ''),
      }))
      setAppliedWant(want)
      setDraftOpen(true)
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

  /** Tira todo lo que redactó la IA y devuelve el título al del primer módulo. */
  const discardAi = () => {
    setDraft(null)
    setAiNote('')
    setAppliedWant([])
    setTitle(mods[order[0]]?.title_es ?? '')
    setTitleTouched(false)
    toast.success(t('admin.surgery.ai_discarded'))
  }

  /**
   * Hay IA marcada que todavía no se ha ejecutado.
   *
   * Confirmar así escribiría en los módulos algo que el capacitador no ha visto
   * nunca — el interruptor promete un trabajo que aún no existe. Se bloquea la
   * confirmación hasta aplicarla (o apagar el interruptor): la IA no puede
   * colarse sin pasar por la revisión.
   */
  const wantedNow: SurgeryAiWant[] = [
    ...(wantMeta ? (['meta'] as const) : []),
    ...(wantBridge ? (['bridge'] as const) : []),
  ]
  const aiPending = wantedNow.some((w) => !appliedWant.includes(w))

  /* ── Confirmar ───────────────────────────────────────────────────────────── */
  const confirm = async () => {
    // Un párrafo por línea escrita, tal cual se ve en el campo.
    const bridgeBody = (draft?.bridgeBody ?? '')
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean)

    setPhase('merging')
    if (!reduce) await new Promise((r) => setTimeout(r, 620))
    try {
      const pending = await mergeManyModules({
        moduleIds: order,
        meta: {
          title_es: title.trim() || mods[order[0]]?.title_es || '',
          duration_min: minutes ?? undefined,
          subtitle_es: draft?.subtitle_es.trim() || undefined,
          objectives_es: draft ? cleanList(draft.objectives_es) : undefined,
          key_takeaways_es: draft ? cleanList(draft.key_takeaways_es) : undefined,
        },
        // Se guarda lo que se ve escrito, no lo que dijo el interruptor: si el
        // capacitador borró el texto del puente, no se crea la sección.
        bridge: bridgeBody
          ? {
              heading_es: draft?.bridgeHeading.trim() || t('admin.surgery.bridge_heading'),
              body_es: bridgeBody,
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
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-glass/6 hover:text-text disabled:opacity-30 disabled:pointer-events-none"
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
                  {mode === 'preview' ? (
                    <>
                      <p className="mb-3 flex items-center gap-2 text-[12px] text-text-muted">
                        <Eye className="h-3.5 w-3.5 text-brand-green" />
                        {t('admin.surgery.preview_hint')}
                      </p>
                      <SurgeryPreview modules={preview} labels={previewLabels} />
                    </>
                  ) : (
                  <>
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
                            <Tooltip label={t('admin.surgery.keeps_progress_tip')} maxWidth={280} className="shrink-0">
                              <span className="rounded-full border border-brand-green/35 bg-brand-green/10 px-2 py-0.5 text-[10px] font-semibold text-brand-green">
                                {t('admin.surgery.keeps_progress')}
                              </span>
                            </Tooltip>
                          )}
                          <div className="flex shrink-0 items-center">
                            <Tooltip label={t('admin.surgery.move_up_tip')} maxWidth={240}>
                              <button
                                onClick={() => move(idx, -1)}
                                disabled={idx === 0 || busy}
                                aria-label={t('admin.courses.move_up')}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-glass/8 hover:text-text disabled:opacity-25 disabled:pointer-events-none"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                            </Tooltip>
                            <Tooltip label={t('admin.surgery.move_down_tip')} maxWidth={240}>
                              <button
                                onClick={() => move(idx, 1)}
                                disabled={idx === order.length - 1 || busy}
                                aria-label={t('admin.courses.move_down')}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-glass/8 hover:text-text disabled:opacity-25 disabled:pointer-events-none"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                            </Tooltip>
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
                      titleLabel={t('admin.surgery.title_label')}
                      disabled={busy}
                      onTitleChange={(v) => {
                        setTitle(v)
                        setTitleTouched(true)
                      }}
                      minutes={{
                        value: minutes ?? merged.minutes,
                        auto: merged.minutes,
                        overridden: minutes !== null,
                        onChange: setMinutes,
                        label: t('admin.surgery.duration_label'),
                        suffix: t('admin.surgery.minutes'),
                        resetLabel: t('admin.surgery.duration_reset'),
                        autoHint: t('admin.surgery.duration_reset_tip'),
                      }}
                      stats={[
                        { value: String(merged.timeline.length), label: t('admin.surgery.sections') },
                        { value: String(merged.quizzes), label: t('admin.surgery.quizzes') },
                      ]}
                    />
                    <p className="mt-1.5 px-1 text-[11px] text-text-subtle">
                      {t('admin.surgery.editable_hint')}
                    </p>
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
                          <Tooltip
                            label={t(peek === s.id ? 'admin.surgery.hide_section' : 'admin.surgery.peek_section')}
                            className="w-full"
                          >
                          <motion.button
                            type="button"
                            layout
                            transition={SPRING}
                            onClick={() => setPeek(peek === s.id ? null : s.id)}
                            aria-expanded={peek === s.id}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-glass/6"
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
                            <motion.span
                              className="shrink-0 text-text-subtle"
                              animate={{ rotate: peek === s.id ? 180 : 0 }}
                              transition={{ duration: 0.2, ease: EASE }}
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </motion.span>
                          </motion.button>
                          </Tooltip>
                          <AnimatePresence initial={false}>
                            {peek === s.id && (
                              <SectionBody lines={s.body} empty={t('admin.surgery.section_empty')} />
                            )}
                          </AnimatePresence>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Qué hace la IA ── */}
                  <div
                    className={cn(
                      'mt-4 rounded-2xl border p-3.5 transition-colors',
                      // Mientras quede IA marcada sin aplicar, el bloque se marca
                      // en ámbar: es lo único que falta para poder confirmar.
                      aiPending
                        ? 'border-amber-500/40 bg-amber-500/[0.05]'
                        : 'border-line bg-glass/[0.02]',
                    )}
                  >
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
                      <AiRunButton
                        busy={aiBusy}
                        disabled={busy || (!wantMeta && !wantBridge)}
                        onClick={() => void runAi()}
                        tooltip={t(
                          !wantMeta && !wantBridge
                            ? 'admin.surgery.ai_run_none_tip'
                            : 'admin.surgery.ai_run_tip',
                        )}
                      >
                        {aiBusy ? t('admin.surgery.ai_running') : t('admin.surgery.ai_run')}
                      </AiRunButton>
                      <AiReviewNotice variant="inline" className="flex-1" />
                    </div>
                  </div>

                  {/* ── Lo que escribió la IA: a la vista y editable ── */}
                  {draft && (
                    <motion.div
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: EASE }}
                      className="mt-3"
                    >
                      <SurgeryFold
                        open={draftOpen}
                        onToggle={() => setDraftOpen((o) => !o)}
                        title={t('admin.surgery.ai_result_title')}
                        badge={t('admin.surgery.ai_result_badge')}
                        action={
                          <DiscardAiButton
                            onDiscard={discardAi}
                            label={t('admin.surgery.ai_discard')}
                            hint={t('admin.surgery.ai_discard_tip')}
                            disabled={busy || aiBusy}
                          />
                        }
                      >
                        <div className="space-y-2.5">
                          <SurgeryField
                            label={t('admin.surgery.field_subtitle')}
                            value={draft.subtitle_es}
                            onChange={(v) => setDraft({ ...draft, subtitle_es: v })}
                            placeholder={t('admin.surgery.field_subtitle_ph')}
                            disabled={busy}
                          />
                          <div className="grid gap-2.5 sm:grid-cols-2">
                            <SurgeryList
                              label={t('admin.surgery.field_objectives')}
                              items={draft.objectives_es}
                              onChange={(v) => setDraft({ ...draft, objectives_es: v })}
                              addLabel={t('admin.surgery.add_item')}
                              removeLabel={t('admin.surgery.remove_item')}
                              placeholder={t('admin.surgery.field_objectives_ph')}
                              disabled={busy}
                            />
                            <SurgeryList
                              label={t('admin.surgery.field_takeaways')}
                              items={draft.key_takeaways_es}
                              onChange={(v) => setDraft({ ...draft, key_takeaways_es: v })}
                              addLabel={t('admin.surgery.add_item')}
                              removeLabel={t('admin.surgery.remove_item')}
                              placeholder={t('admin.surgery.field_takeaways_ph')}
                              disabled={busy}
                            />
                          </div>
                          <SurgeryField
                            label={t('admin.surgery.field_bridge_heading')}
                            value={draft.bridgeHeading}
                            onChange={(v) => setDraft({ ...draft, bridgeHeading: v })}
                            placeholder={t('admin.surgery.bridge_heading')}
                            disabled={busy}
                          />
                          <SurgeryField
                            rows={4}
                            label={t('admin.surgery.field_bridge_body')}
                            value={draft.bridgeBody}
                            onChange={(v) => setDraft({ ...draft, bridgeBody: v })}
                            placeholder={t('admin.surgery.field_bridge_ph')}
                            disabled={busy}
                          />
                        </div>
                        <p className="mt-3 text-[11px] leading-relaxed text-text-subtle">
                          {t('admin.surgery.ai_result_hint')}
                        </p>
                        <AiRetryRow
                          note={aiNote}
                          onNote={setAiNote}
                          onRetry={() => void runAi(aiNote)}
                          busy={aiBusy}
                          disabled={busy}
                          label={t('admin.surgery.ai_retry_label')}
                          placeholder={t('admin.surgery.ai_retry_ph')}
                          button={t('admin.surgery.ai_retry')}
                          tooltip={t('admin.surgery.ai_retry_tip')}
                          emptyTooltip={t('admin.surgery.ai_retry_empty_tip')}
                        />
                      </SurgeryFold>
                    </motion.div>
                  )}

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
                  </>
                  )}
                </div>

                {/* ── Pie ── */}
                <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
                  {aiPending ? (
                    <motion.p
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25, ease: EASE }}
                      className="flex items-center gap-1.5 text-[11.5px] font-medium text-amber-500"
                    >
                      <Sparkles className="h-3.5 w-3.5 shrink-0" />
                      {t('admin.surgery.ai_pending_hint')}
                    </motion.p>
                  ) : (
                    <p className="text-[11.5px] text-text-subtle">{t('admin.surgery.undo_hint')}</p>
                  )}
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={onClose}
                      disabled={busy}
                      className="h-10 rounded-xl px-3.5 text-[12.5px] font-medium text-text-muted transition-colors hover:bg-glass/8 hover:text-text disabled:opacity-30 disabled:pointer-events-none"
                    >
                      {t('common.cancel')}
                    </button>
                    {/* Ver el resultado antes de tocar nada. */}
                    <Tooltip
                      label={t(mode === 'preview' ? 'admin.surgery.back_to_edit_tip' : 'admin.surgery.preview_tip')}
                      maxWidth={280}
                      className="shrink-0"
                    >
                    <button
                      onClick={() => setMode(mode === 'preview' ? 'edit' : 'preview')}
                      disabled={busy}
                      className="flex h-10 items-center gap-2 rounded-xl border border-line px-3.5 text-[12.5px] font-medium text-text-muted transition-colors hover:bg-glass/8 hover:text-text disabled:opacity-30 disabled:pointer-events-none"
                    >
                      {mode === 'preview' ? (
                        <>
                          <Pencil className="h-3.5 w-3.5" />
                          {t('admin.surgery.back_to_edit')}
                        </>
                      ) : (
                        <>
                          <Eye className="h-3.5 w-3.5" />
                          {t('admin.surgery.preview')}
                        </>
                      )}
                    </button>
                    </Tooltip>
                    <Tooltip
                      label={t(aiPending ? 'admin.surgery.ai_pending_title' : 'admin.surgery.merge_confirm_tip', {
                        n: order.length,
                      })}
                      maxWidth={300}
                      className="shrink-0"
                    >
                    <button
                      onClick={confirm}
                      disabled={busy || aiPending}
                      className="flex h-10 items-center gap-2 rounded-xl border border-brand-green/40 bg-brand-green/15 px-4 text-[12.5px] font-semibold text-brand-green transition-colors hover:bg-brand-green/25 disabled:opacity-40 disabled:pointer-events-none"
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
                    </Tooltip>
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
