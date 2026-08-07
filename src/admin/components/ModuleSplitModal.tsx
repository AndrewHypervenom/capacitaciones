import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  Eye,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Scissors,
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
  planSplitWithAi,
  splitModule,
  type DbModuleWithSections,
  type DbSectionRow,
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
  type PreviewSection,
} from './ModuleSurgeryBits'

/* Títulos de las secciones puente. Se escriben igual aquí y en el servicio: la
   vista previa tiene que enseñar exactamente lo que se va a guardar. */
const CLOSING_HEADING = 'Cierre'
const INTRO_HEADING = 'Retomemos'

/**
 * Lo que la IA redacta para cada parte, ya en forma editable. Se guarda como
 * borrador propio (no como respuesta cruda de la IA) para que todo lo que se ve
 * en pantalla sea exactamente lo que se va a guardar.
 */
interface PartDraft {
  subtitle_es: string
  objectives_es: string[]
  key_takeaways_es: string[]
  /** Cierre en la parte 1, entrada en la parte 2. */
  bridge_es: string
}

const emptyDraft = (): PartDraft => ({
  subtitle_es: '',
  objectives_es: [],
  key_takeaways_es: [],
  bridge_es: '',
})

/** Frases con contenido; si no queda ninguna se devuelve `undefined` (no tocar). */
const cleanList = (list: string[]): string[] | undefined => {
  const out = list.map((s) => s.trim()).filter(Boolean)
  return out.length > 0 ? out : undefined
}

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
  // `null` = los minutos siguen al reparto automático por peso de texto y se
  // recalculan solos al mover la línea de corte.
  const [minA, setMinA] = useState<number | null>(null)
  const [minB, setMinB] = useState<number | null>(null)

  // Interruptores de IA. Por defecto solo los títulos: es lo que casi siempre
  // hace falta y lo más barato; sugerir corte y redactar enlaces se piden aparte.
  const [wantCut, setWantCut] = useState(false)
  const [wantMeta, setWantMeta] = useState(true)
  const [wantBridge, setWantBridge] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [cutReason, setCutReason] = useState<string | null>(null)
  // Lo que redactó la IA, ya editable. `null` = todavía no ha corrido.
  const [draft, setDraft] = useState<{ a: PartDraft; b: PartDraft } | null>(null)
  const [draftOpen, setDraftOpen] = useState(true)
  /** Qué corregirle a la IA para el siguiente intento. */
  const [aiNote, setAiNote] = useState('')
  /** Qué interruptores se llegaron a APLICAR de verdad (no solo a marcar). */
  const [appliedWant, setAppliedWant] = useState<SurgeryAiWant[]>([])

  /** Sección cuyo texto está desplegado, para leerlo sin salir del modal. */
  const [peek, setPeek] = useState<string | null>(null)

  /** `preview` enseña cómo quedan los dos módulos SIN tocar la base de datos. */
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

  const patch = (side: 'a' | 'b', p: Partial<PartDraft>) =>
    setDraft((d) => (d ? { ...d, [side]: { ...d[side], ...p } } : d))

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

  /* ── Cómo quedan los dos módulos ─────────────────────────────────────────── */
  // Reproduce exactamente lo que hará `splitModule`, incluidos los repartos por
  // omisión: sin IA los objetivos se parten por la mitad y los puntos clave se
  // quedan con la parte 1. Si la vista previa mintiera aquí, no serviría de nada.
  const preview = useMemo<PreviewModule[]>(() => {
    const toSection = (s: DbSectionRow): PreviewSection => ({
      id: s.id,
      heading: s.heading_es || t('admin.surgery.untitled_section'),
      body: s.body_es ?? [],
      hasQuiz: (s.section_quizzes ?? []).length > 0,
      hasMedia: !!s.media_url,
    })

    const objectives = mod?.objectives_es ?? []
    const half = Math.ceil(objectives.length / 2)
    const closing = draft?.a.bridge_es.trim()
    const intro = draft?.b.bridge_es.trim()

    const headSections = sections.slice(0, cutIndex).map(toSection)
    const tailSections = sections.slice(cutIndex).map(toSection)

    return [
      {
        tone: 'green',
        eyebrow: t('admin.surgery.part_one'),
        title: titleA.trim() || (mod?.title_es ?? ''),
        subtitle: draft?.a.subtitle_es.trim() || (mod?.subtitle_es ?? undefined),
        minutes: minA ?? stats.a.min,
        objectives: cleanList(draft?.a.objectives_es ?? []) ?? objectives.slice(0, half),
        takeaways: cleanList(draft?.a.key_takeaways_es ?? []) ?? (mod?.key_takeaways_es ?? []),
        sections: [
          ...headSections,
          ...(closing
            ? [{ id: 'bridge-a', heading: CLOSING_HEADING, body: [closing], isNew: true }]
            : []),
        ],
      },
      {
        tone: 'magenta',
        eyebrow: t('admin.surgery.part_two'),
        title: titleB.trim() || `${mod?.title_es ?? ''} (2)`,
        subtitle: draft?.b.subtitle_es.trim() || (mod?.subtitle_es ?? undefined),
        minutes: minB ?? stats.b.min,
        objectives: cleanList(draft?.b.objectives_es ?? []) ?? objectives.slice(half),
        // La parte 2 nace sin puntos clave salvo que se le escriban.
        takeaways: cleanList(draft?.b.key_takeaways_es ?? []) ?? [],
        sections: [
          ...(intro ? [{ id: 'bridge-b', heading: INTRO_HEADING, body: [intro], isNew: true }] : []),
          ...tailSections,
        ],
      },
    ]
  }, [mod, sections, cutIndex, titleA, titleB, minA, minB, stats, draft, t])

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

  /* ── IA ──────────────────────────────────────────────────────────────────── */
  /** `instruction` = qué corregir del intento anterior; vacío en el primer intento. */
  const runAi = async (instruction?: string) => {
    const want: SurgeryAiWant[] = []
    if (wantCut) want.push('cut')
    if (wantMeta) want.push('meta')
    if (wantBridge) want.push('bridge')
    if (want.length === 0) return

    setAiBusy(true)
    try {
      await consumeAiOperation('module', t('admin.surgery.split_ai_label'), campaignId)
      const plan = await planSplitWithAi({
        moduleId,
        want,
        cutIndex: wantCut ? undefined : cutIndex,
        instruction,
      })

      if (wantCut && typeof plan.cutIndex === 'number') {
        setCutIndex(clampCut(plan.cutIndex))
        setCutReason(plan.cutReason ?? null)
      }
      const [a, b] = plan.parts ?? []
      if (wantMeta) {
        if (a?.title_es) setTitleA(a.title_es)
        if (b?.title_es) setTitleB(b.title_es)
      }
      // El borrador se rellena con lo que haya venido y se despliega solo: es la
      // única forma de que "revisa lo que propuso la IA" se pueda cumplir.
      setDraft((prev) => ({
        a: {
          ...(prev?.a ?? emptyDraft()),
          ...(wantMeta
            ? {
                subtitle_es: a?.subtitle_es ?? '',
                objectives_es: a?.objectives_es ?? [],
                key_takeaways_es: a?.key_takeaways_es ?? [],
              }
            : {}),
          ...(wantBridge ? { bridge_es: a?.closing_es ?? '' } : {}),
        },
        b: {
          ...(prev?.b ?? emptyDraft()),
          ...(wantMeta
            ? {
                subtitle_es: b?.subtitle_es ?? '',
                objectives_es: b?.objectives_es ?? [],
                key_takeaways_es: b?.key_takeaways_es ?? [],
              }
            : {}),
          ...(wantBridge ? { bridge_es: b?.intro_es ?? '' } : {}),
        },
      }))
      setAppliedWant(want)
      setDraftOpen(true)
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

  /**
   * Tira todo lo que redactó la IA y deja los títulos como estaban. El corte NO
   * se toca: es una decisión visible en pantalla que se mueve arrastrando, no un
   * texto escondido — revertirlo sin avisar sería peor.
   */
  const discardAi = () => {
    setDraft(null)
    setCutReason(null)
    setAiNote('')
    setAppliedWant([])
    if (mod) {
      setTitleA(mod.title_es)
      setTitleB(`${mod.title_es} (2)`)
    }
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
    ...(wantCut ? (['cut'] as const) : []),
    ...(wantMeta ? (['meta'] as const) : []),
    ...(wantBridge ? (['bridge'] as const) : []),
  ]
  const aiPending = wantedNow.some((w) => !appliedWant.includes(w))

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
            subtitle_es: draft?.a.subtitle_es.trim() || undefined,
            objectives_es: draft ? cleanList(draft.a.objectives_es) : undefined,
            key_takeaways_es: draft ? cleanList(draft.a.key_takeaways_es) : undefined,
            duration_min: minA ?? undefined,
          },
          {
            title_es: titleB.trim() || `${mod.title_es} (2)`,
            subtitle_es: draft?.b.subtitle_es.trim() || undefined,
            objectives_es: draft ? cleanList(draft.b.objectives_es) : undefined,
            key_takeaways_es: draft ? cleanList(draft.b.key_takeaways_es) : undefined,
            duration_min: minB ?? undefined,
          },
        ],
        // Se guarda lo que se ve escrito, no lo que dijo el interruptor: si el
        // capacitador borró el texto del enlace, no se crea la sección.
        bridge:
          draft && (draft.a.bridge_es.trim() || draft.b.bridge_es.trim())
            ? {
                closing_es: draft.a.bridge_es.trim() || undefined,
                intro_es: draft.b.bridge_es.trim() || undefined,
              }
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
            ) : sections.length < 2 ? (
              <div className="px-6 py-12 text-center">
                <Scissors className="mx-auto mb-3 h-8 w-8 text-text-subtle" />
                <p className="text-[13px] text-text-muted">{t('admin.surgery.too_short')}</p>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {mode === 'preview' ? (
                    <>
                      <p className="mb-3 flex items-center gap-2 text-[12px] text-text-muted">
                        <Eye className="h-3.5 w-3.5 text-brand-magenta" />
                        {t('admin.surgery.preview_hint')}
                      </p>
                      <SurgeryPreview modules={preview} labels={previewLabels} />
                    </>
                  ) : (
                  <>
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
                              {/* Leer el texto de la sección sin salir del modal:
                                  sin esto no hay forma de saber qué cae de cada lado. */}
                              <Tooltip
                                label={t(peek === s.id ? 'admin.surgery.hide_section' : 'admin.surgery.peek_section')}
                                className="shrink-0"
                              >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setPeek(peek === s.id ? null : s.id)
                                }}
                                aria-expanded={peek === s.id}
                                aria-label={t('admin.surgery.peek_section')}
                                className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-glass/10 hover:text-text"
                              >
                                <motion.span
                                  animate={{ rotate: peek === s.id ? 180 : 0 }}
                                  transition={{ duration: 0.2, ease: EASE }}
                                >
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </motion.span>
                              </button>
                              </Tooltip>
                            </span>
                          </motion.div>
                          <AnimatePresence initial={false}>
                            {peek === s.id && (
                              <SectionBody
                                lines={s.body_es ?? []}
                                empty={t('admin.surgery.section_empty')}
                              />
                            )}
                          </AnimatePresence>
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
                      titleLabel={t('admin.surgery.title_label')}
                      onTitleChange={setTitleA}
                      disabled={busy}
                      minutes={{
                        value: minA ?? stats.a.min,
                        auto: stats.a.min,
                        overridden: minA !== null,
                        onChange: setMinA,
                        label: t('admin.surgery.duration_label'),
                        suffix: t('admin.surgery.minutes'),
                        resetLabel: t('admin.surgery.duration_reset'),
                        autoHint: t('admin.surgery.duration_reset_tip'),
                      }}
                      stats={[
                        { value: String(stats.a.sections), label: t('admin.surgery.sections') },
                        { value: String(stats.a.quizzes), label: t('admin.surgery.quizzes') },
                      ]}
                    />
                    <OutcomeCard
                      tone="magenta"
                      eyebrow={t('admin.surgery.part_two')}
                      title={titleB}
                      titleLabel={t('admin.surgery.title_label')}
                      onTitleChange={setTitleB}
                      disabled={busy}
                      minutes={{
                        value: minB ?? stats.b.min,
                        auto: stats.b.min,
                        overridden: minB !== null,
                        onChange: setMinB,
                        label: t('admin.surgery.duration_label'),
                        suffix: t('admin.surgery.minutes'),
                        resetLabel: t('admin.surgery.duration_reset'),
                        autoHint: t('admin.surgery.duration_reset_tip'),
                      }}
                      stats={[
                        { value: String(stats.b.sections), label: t('admin.surgery.sections') },
                        { value: String(stats.b.quizzes), label: t('admin.surgery.quizzes') },
                      ]}
                    />
                  </div>
                  <p className="mt-1.5 px-1 text-[11px] text-text-subtle">
                    {t('admin.surgery.editable_hint')}
                  </p>

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
                        onClick={() => void runAi()}
                        tooltip={t(
                          !wantCut && !wantMeta && !wantBridge
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
                        <div className="grid gap-4 sm:grid-cols-2">
                          {(['a', 'b'] as const).map((side) => (
                            <div key={side} className="space-y-2.5">
                              <p
                                className={cn(
                                  'text-[10.5px] font-semibold uppercase tracking-wider',
                                  side === 'a' ? 'text-brand-green' : 'text-brand-magenta',
                                )}
                              >
                                {side === 'a' ? t('admin.surgery.part_one') : t('admin.surgery.part_two')}
                              </p>
                              <SurgeryField
                                label={t('admin.surgery.field_subtitle')}
                                value={draft[side].subtitle_es}
                                onChange={(v) => patch(side, { subtitle_es: v })}
                                placeholder={t('admin.surgery.field_subtitle_ph')}
                                disabled={busy}
                              />
                              <SurgeryList
                                label={t('admin.surgery.field_objectives')}
                                items={draft[side].objectives_es}
                                onChange={(v) => patch(side, { objectives_es: v })}
                                addLabel={t('admin.surgery.add_item')}
                                removeLabel={t('admin.surgery.remove_item')}
                                placeholder={t('admin.surgery.field_objectives_ph')}
                                disabled={busy}
                              />
                              <SurgeryList
                                label={t('admin.surgery.field_takeaways')}
                                items={draft[side].key_takeaways_es}
                                onChange={(v) => patch(side, { key_takeaways_es: v })}
                                addLabel={t('admin.surgery.add_item')}
                                removeLabel={t('admin.surgery.remove_item')}
                                placeholder={t('admin.surgery.field_takeaways_ph')}
                                disabled={busy}
                              />
                              <SurgeryField
                                rows={3}
                                label={
                                  side === 'a'
                                    ? t('admin.surgery.field_closing')
                                    : t('admin.surgery.field_intro')
                                }
                                value={draft[side].bridge_es}
                                onChange={(v) => patch(side, { bridge_es: v })}
                                placeholder={t('admin.surgery.field_bridge_ph')}
                                disabled={busy}
                              />
                            </div>
                          ))}
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
                      label={t(aiPending ? 'admin.surgery.ai_pending_title' : 'admin.surgery.split_confirm_tip')}
                      maxWidth={300}
                      className="shrink-0"
                    >
                    <button
                      onClick={confirm}
                      disabled={busy || aiPending}
                      className="flex h-10 items-center gap-2 rounded-xl border border-brand-magenta/40 bg-brand-magenta/15 px-4 text-[12.5px] font-semibold text-brand-magenta transition-colors hover:bg-brand-magenta/25 disabled:opacity-40 disabled:pointer-events-none"
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
