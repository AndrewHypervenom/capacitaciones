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
  Plus,
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
import { rowText } from '@/lib/contentLang'
import {
  chunkEven,
  estimateSectionMinutes,
  getModuleWithSectionsRaw,
  getSurgeryImpact,
  planSplitWithAi,
  sectionProfile,
  sectionReadableText,
  splitDuration,
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
 * Un corte. Lleva id propio y estable: la parte que arranca en él se identifica
 * por ese id, así que moverlo no le quita el título que ya se le escribió, y
 * quitarlo no le pasa el título de una parte a la vecina.
 */
interface Cut {
  id: string
  /** Índice de la sección con la que arranca la parte. */
  at: number
}

/** La primera parte no arranca en ningún corte: es la que conserva el módulo. */
const HEAD = 'head'

/**
 * Lo que la IA redacta para cada parte, ya en forma editable. Se guarda como
 * borrador propio (no como respuesta cruda de la IA) para que todo lo que se ve
 * en pantalla sea exactamente lo que se va a guardar.
 */
interface PartDraft {
  subtitle_es: string
  objectives_es: string[]
  key_takeaways_es: string[]
  /** Entrada al principio de la parte (todas menos la primera). */
  intro_es: string
  /** Cierre al final de la parte (todas menos la última). */
  closing_es: string
}

const emptyDraft = (): PartDraft => ({
  subtitle_es: '',
  objectives_es: [],
  key_takeaways_es: [],
  intro_es: '',
  closing_es: '',
})

/** Frases con contenido; si no queda ninguna se devuelve `undefined` (no tocar). */
const cleanList = (list: string[]): string[] | undefined => {
  const out = list.map((s) => s.trim()).filter(Boolean)
  return out.length > 0 ? out : undefined
}

/** Las partes se alternan en verde y magenta: dos vecinas nunca se confunden. */
const toneOf = (k: number): 'green' | 'magenta' => (k % 2 === 0 ? 'green' : 'magenta')

interface ModuleSplitModalProps {
  moduleId: string
  campaignId: string
  onClose: () => void
  /** El contenido ya quedó separado; el padre muestra la franja de Deshacer. */
  onApplied: (result: { pending: PendingSurgery; newModuleIds: string[]; parts: number }) => void
}

type Phase = 'loading' | 'editing' | 'cutting' | 'done'

/**
 * SEPARAR UN MÓDULO LARGO EN LAS PARTES QUE HAGAN FALTA.
 *
 * La interacción es la misma de siempre, multiplicada: cada línea de corte se
 * arrastra, y entre dos secciones cualquiera se puede añadir otra. Cada parte se
 * tiñe de su color en vivo y las tarjetas de resultado recalculan secciones y
 * minutos. No hay pasos, no hay asistente: se ve el resultado antes de confirmarlo.
 *
 * No hay mínimos ni máximos de partes ni de minutos. La IA (opcional) decide
 * cuántas partes y dónde, por cambio de tema y carga — no por una fórmula — y
 * todo lo que proponga se puede mover, quitar o editar antes de confirmar.
 */
export function ModuleSplitModal({ moduleId, campaignId, onClose, onApplied }: ModuleSplitModalProps) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()

  const [phase, setPhase] = useState<Phase>('loading')
  const [mod, setMod] = useState<DbModuleWithSections | null>(null)
  const [sections, setSections] = useState<DbSectionRow[]>([])
  const [cuts, setCuts] = useState<Cut[]>([])
  const [dragId, setDragId] = useState<string | null>(null)
  const [impact, setImpact] = useState<SurgeryImpact | null>(null)

  const cutSeq = useRef(0)
  const newCutId = () => `cut-${++cutSeq.current}`

  // Por parte (clave = HEAD o id del corte donde arranca). Sin entrada = valor
  // por omisión: el título se numera solo y los minutos siguen al cálculo.
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [mins, setMins] = useState<Record<string, number>>({})

  // Interruptores de IA. Por defecto solo los títulos: es lo que casi siempre
  // hace falta y lo más barato; sugerir cortes y redactar enlaces se piden aparte.
  const [wantCut, setWantCut] = useState(false)
  const [wantMeta, setWantMeta] = useState(true)
  const [wantBridge, setWantBridge] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  /** Por qué la IA cortó ahí, por id de corte. Se borra si el corte se mueve. */
  const [reasons, setReasons] = useState<Record<string, string>>({})
  /** Criterio general con el que la IA eligió cuántas partes. */
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  // Lo que redactó la IA, ya editable. `null` = todavía no ha corrido.
  const [draft, setDraft] = useState<Record<string, PartDraft> | null>(null)
  const [draftOpen, setDraftOpen] = useState(true)
  /** Qué corregirle a la IA para el siguiente intento. */
  const [aiNote, setAiNote] = useState('')
  /** Qué interruptores se llegaron a APLICAR de verdad (no solo a marcar). */
  const [appliedWant, setAppliedWant] = useState<SurgeryAiWant[]>([])

  /** Sección cuyo texto está desplegado, para leerlo sin salir del modal. */
  const [peek, setPeek] = useState<string | null>(null)

  /** `preview` enseña cómo quedan los módulos SIN tocar la base de datos. */
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

  const partKeys = useMemo(() => [HEAD, ...cuts.map((c) => c.id)], [cuts])
  const partCount = partKeys.length
  /** Dónde empieza y termina cada parte: [0, corte1, corte2, …, n]. */
  const bounds = useMemo(() => [0, ...cuts.map((c) => c.at), sections.length], [cuts, sections.length])

  const draftOf = (key: string): PartDraft => draft?.[key] ?? emptyDraft()
  const patch = (key: string, p: Partial<PartDraft>) =>
    setDraft((d) => (d ? { ...d, [key]: { ...(d[key] ?? emptyDraft()), ...p } } : d))

  const baseTitle = mod ? rowText(mod) : ''
  const defaultTitle = (k: number) => (k === 0 ? baseTitle : `${baseTitle} (${k + 1})`)
  const titleOf = (key: string, k: number) => titles[key] ?? defaultTitle(k)

  const rowRefs = useRef<Array<HTMLDivElement | null>>([])

  const busy = phase === 'cutting' || phase === 'done'

  /* ── Carga ───────────────────────────────────────────────────────────────── */
  // `onClose` y `t` cambian de identidad en cada render del padre (y al cambiar
  // de idioma). Si el efecto de carga dependiera de ellos, cualquier re-render
  // del editor volvería a cargar el módulo y devolvería los cortes al inicio,
  // borrando el gesto del capacitador. Van por referencia: el efecto solo
  // depende del módulo.
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
        const data = await getModuleWithSectionsRaw(moduleId)
        if (!alive) return
        const ordered = [...data.module_sections].sort((a, b) => a.sort_order - b.sort_order)
        setMod(data)
        setSections(ordered)
        setCuts(ordered.length >= 2 ? [{ id: `cut-${++cutSeq.current}`, at: Math.max(1, Math.round(ordered.length / 2)) }] : [])
        setPhase('editing')
        const imp = await getSurgeryImpact([moduleId])
        if (alive) setImpact(imp[moduleId] ?? null)
      } catch (e) {
        console.error('[ModuleSplitModal] load', e)
        toast.error(tRef.current('admin.surgery.load_error'))
        onCloseRef.current()
      }
    })()
    return () => {
      alive = false
    }
  }, [moduleId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  /* ── Minutos estimados por sección ───────────────────────────────────────── */
  // Pesan el texto, las preguntas, los juegos y sobre todo los videos: un módulo
  // de una hora con dos videos largos es casi todo video, no todo texto.
  const sectionMinutes = useMemo(
    () => estimateSectionMinutes(mod?.duration_min || 1, sections),
    [mod, sections],
  )

  /* ── Mover, añadir y quitar cortes ───────────────────────────────────────── */
  // Los cortes se leen por referencia: si el arrastre dependiera del estado,
  // cada movimiento del puntero recrearía los oyentes en pleno gesto.
  const cutsRef = useRef(cuts)
  useEffect(() => {
    cutsRef.current = cuts
  }, [cuts])

  /** Hasta dónde puede ir un corte sin dejar vacía ninguna de sus dos partes. */
  const rangeOf = useCallback(
    (id: string): [number, number] => {
      const list = cutsRef.current
      const i = list.findIndex((c) => c.id === id)
      const lo = i > 0 ? list[i - 1].at + 1 : 1
      const hi = i < list.length - 1 ? list[i + 1].at - 1 : sections.length - 1
      return [lo, Math.max(lo, hi)]
    },
    [sections.length],
  )

  const moveCut = useCallback(
    (id: string, at: number) => {
      const [lo, hi] = rangeOf(id)
      const next = Math.min(Math.max(at, lo), hi)
      setCuts((list) => list.map((c) => (c.id === id && c.at !== next ? { ...c, at: next } : c)))
      // La razón de la IA explicaba OTRO punto de corte: ya no aplica.
      setReasons((r) => {
        const cur = cutsRef.current.find((c) => c.id === id)
        if (!r[id] || cur?.at === next) return r
        const { [id]: _drop, ...rest } = r
        return rest
      })
    },
    [rangeOf],
  )

  const addCutAt = (at: number) => {
    if (at < 1 || at > sections.length - 1 || cuts.some((c) => c.at === at)) return
    setCuts((list) => [...list, { id: newCutId(), at }].sort((a, b) => a.at - b.at))
  }

  /**
   * "Añadir corte" sin decir dónde: parte en dos la parte más pesada, por su
   * punto medio en minutos. Casi nunca es el sitio final, pero deja la línea
   * donde más falta hace y desde ahí se arrastra.
   */
  const bestNewCut = useMemo(() => {
    let best: number | null = null
    let bestLoad = -1
    for (let k = 0; k < bounds.length - 1; k++) {
      const from = bounds[k]
      const to = bounds[k + 1]
      if (to - from < 2) continue
      const load = sectionMinutes.slice(from, to).reduce((a, b) => a + b, 0)
      if (load <= bestLoad) continue
      let acc = 0
      let at = from + 1
      let bestGap = Infinity
      for (let j = from; j < to - 1; j++) {
        acc += sectionMinutes[j]
        const gap = Math.abs(acc - load / 2)
        if (gap < bestGap) {
          bestGap = gap
          at = j + 1
        }
      }
      best = at
      bestLoad = load
    }
    return best
  }, [bounds, sectionMinutes])

  const removeCut = (id: string) => {
    if (cuts.length <= 1) return
    setCuts((list) => list.filter((c) => c.id !== id))
    setReasons((r) => {
      const { [id]: _drop, ...rest } = r
      return rest
    })
  }

  /** Hueco más cercano al puntero, midiendo el borde superior de cada fila. */
  const nearestGap = useCallback(
    (clientY: number, id: string) => {
      const [lo, hi] = rangeOf(id)
      let best = lo
      let bestDist = Infinity
      for (let i = lo; i <= hi; i++) {
        const el = rowRefs.current[i]
        if (!el) continue
        const dist = Math.abs(el.getBoundingClientRect().top - clientY)
        if (dist < bestDist) {
          bestDist = dist
          best = i
        }
      }
      return best
    },
    [rangeOf],
  )

  useEffect(() => {
    if (!dragId) return
    const onMove = (e: PointerEvent) => {
      e.preventDefault()
      moveCut(dragId, nearestGap(e.clientY, dragId))
    }
    const stop = () => setDragId(null)
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [dragId, nearestGap, moveCut])

  /* ── Cifras en vivo ──────────────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const autoMin = sections.length >= 2 && cuts.length > 0
      ? splitDuration(mod?.duration_min || 1, sections, cuts.map((c) => c.at))
      : [mod?.duration_min || 1]
    return bounds.slice(0, -1).map((from, k) => {
      const slice = sections.slice(from, bounds[k + 1])
      const profiles = slice.map(sectionProfile)
      return {
        sections: slice.length,
        min: autoMin[k] ?? 1,
        quizzes: profiles.reduce((sum, p) => sum + p.quizzes, 0),
        videos: profiles.reduce((sum, p) => sum + p.videos, 0),
      }
    })
  }, [sections, cuts, bounds, mod])

  const minutesOf = (key: string, k: number) => mins[key] ?? stats[k]?.min ?? 1

  /* ── Cómo quedan los módulos ─────────────────────────────────────────────── */
  // Reproduce exactamente lo que hará `splitModule`, incluidos los repartos por
  // omisión: sin IA los objetivos se reparten en tramos y los puntos clave se
  // quedan con la parte 1. Si la vista previa mintiera aquí, no serviría de nada.
  const preview = useMemo<PreviewModule[]>(() => {
    const toSection = (s: DbSectionRow): PreviewSection => ({
      id: s.id,
      heading: rowText(s, 'heading') || t('admin.surgery.untitled_section'),
      body: sectionReadableText(s),
      hasQuiz: (s.section_quizzes ?? []).length > 0,
      hasMedia: !!s.media_url,
    })
    const objectiveChunks = chunkEven(mod?.objectives_es ?? [], partKeys.length)
    const last = partKeys.length - 1

    return partKeys.map((key, k) => {
      const d = draft?.[key]
      const intro = k > 0 ? d?.intro_es.trim() : ''
      const closing = k < last ? d?.closing_es.trim() : ''
      return {
        tone: toneOf(k),
        eyebrow: t('admin.surgery.part_n', { n: k + 1 }),
        title: (titles[key] ?? (k === 0 ? rowText(mod) : `${rowText(mod)} (${k + 1})`)).trim() || rowText(mod),
        subtitle: d?.subtitle_es.trim() || rowText(mod, 'subtitle') || undefined,
        minutes: mins[key] ?? stats[k]?.min ?? 1,
        objectives: cleanList(d?.objectives_es ?? []) ?? objectiveChunks[k] ?? [],
        // Solo la parte 1 conserva los puntos clave del original.
        takeaways: cleanList(d?.key_takeaways_es ?? []) ?? (k === 0 ? (mod?.key_takeaways_es ?? []) : []),
        sections: [
          ...(intro ? [{ id: `intro-${key}`, heading: INTRO_HEADING, body: [intro], isNew: true }] : []),
          ...sections.slice(bounds[k], bounds[k + 1]).map(toSection),
          ...(closing ? [{ id: `closing-${key}`, heading: CLOSING_HEADING, body: [closing], isNew: true }] : []),
        ],
      }
    })
  }, [mod, sections, partKeys, bounds, titles, mins, stats, draft, t])

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
        cuts: wantCut ? undefined : cuts.map((c) => c.at),
        instruction,
      })

      // Con cortes nuevos, las partes son otras: los minutos escritos a mano
      // para las de antes ya no significan nada.
      let nextCuts = cuts
      if (wantCut) {
        if (plan.cuts && plan.cuts.length > 0) {
          nextCuts = plan.cuts.map((at) => ({ id: newCutId(), at }))
          setCuts(nextCuts)
          setMins({})
          setReasons(
            Object.fromEntries(
              nextCuts
                .map((c, i) => [c.id, plan.cutReasons?.[i]?.trim() ?? ''] as const)
                .filter(([, r]) => r),
            ),
          )
        } else if (plan.cuts) {
          toast.info(t('admin.surgery.ai_no_split'))
        } else {
          // Ni cortes ni "no separes": la respuesta no sirvió. Se dice, en vez
          // de dejar la línea donde estaba como si la IA la hubiera elegido.
          toast.error(t('admin.surgery.ai_no_cuts'))
          return
        }
        setAiSummary(plan.summary ?? null)
      }

      const keys = [HEAD, ...nextCuts.map((c) => c.id)]
      const parts = plan.parts ?? []
      if (wantMeta) {
        setTitles((prev) => {
          const next = { ...prev }
          keys.forEach((key, k) => {
            const title = parts[k]?.title_es
            if (title) next[key] = title
          })
          return next
        })
      }
      // El borrador se rellena con lo que haya venido y se despliega solo: es la
      // única forma de que "revisa lo que propuso la IA" se pueda cumplir.
      setDraft((prev) => {
        const next: Record<string, PartDraft> = { ...(prev ?? {}) }
        keys.forEach((key, k) => {
          const p = parts[k]
          next[key] = {
            ...(next[key] ?? emptyDraft()),
            ...(wantMeta
              ? {
                  subtitle_es: p?.subtitle_es ?? '',
                  objectives_es: p?.objectives_es ?? [],
                  key_takeaways_es: p?.key_takeaways_es ?? [],
                }
              : {}),
            ...(wantBridge
              ? {
                  intro_es: k > 0 ? (p?.intro_es ?? '') : '',
                  closing_es: k < keys.length - 1 ? (p?.closing_es ?? '') : '',
                }
              : {}),
          }
        })
        return next
      })
      setAppliedWant(want)
      setDraftOpen(true)
      // Pidió textos y no llegó ninguno: decir "listo" con todo vacío engaña.
      const gotText = parts.some(
        (p) => p.title_es || p.subtitle_es || p.objectives_es?.length || p.intro_es || p.closing_es,
      )
      if ((wantMeta || wantBridge) && !gotText) toast.error(t('admin.surgery.ai_empty'))
      else toast.success(t('admin.surgery.ai_done'))
    } catch (e) {
      if (isQuotaExceeded(e)) {
        toast.error(t('admin.surgery.ai_quota'))
      } else {
        console.error('[ModuleSplitModal] runAi', e)
        // Mientras la Edge Function no se redespliegue la IA puede fallar, pero
        // separar a mano sigue funcionando.
        toast.error(t('admin.surgery.ai_error'))
      }
    } finally {
      setAiBusy(false)
    }
  }

  /**
   * Tira todo lo que redactó la IA y deja los títulos como estaban. Los cortes
   * NO se tocan: son una decisión visible en pantalla que se mueve arrastrando,
   * no un texto escondido — revertirlos sin avisar sería peor.
   */
  const discardAi = () => {
    setDraft(null)
    setReasons({})
    setAiSummary(null)
    setAiNote('')
    setAppliedWant([])
    setTitles({})
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
    if (!mod || cuts.length === 0) return
    setPhase('cutting')
    // Se deja respirar la animación del corte antes de tocar la BD: el trabajo
    // real casi siempre tarda menos que el gesto y sin esto no se ve nada.
    if (!reduce) await new Promise((r) => setTimeout(r, 620))
    const last = partKeys.length - 1
    try {
      const outcome = await splitModule({
        moduleId,
        cuts: cuts.map((c) => c.at),
        parts: partKeys.map((key, k) => {
          const d = draft?.[key]
          return {
            title_es: titleOf(key, k).trim() || (k === 0 ? mod.title_es : `${mod.title_es} (${k + 1})`),
            subtitle_es: d?.subtitle_es.trim() || undefined,
            objectives_es: d ? cleanList(d.objectives_es) : undefined,
            key_takeaways_es: d ? cleanList(d.key_takeaways_es) : undefined,
            duration_min: mins[key],
          }
        }),
        // Se guarda lo que se ve escrito, no lo que dijo el interruptor: si el
        // capacitador borró el texto de un enlace, esa sección no se crea.
        bridges: partKeys.map((key, k) => ({
          intro_es: k > 0 ? draft?.[key]?.intro_es.trim() || undefined : undefined,
          closing_es: k < last ? draft?.[key]?.closing_es.trim() || undefined : undefined,
        })),
      })
      setPhase('done')
      if (!reduce) await new Promise((r) => setTimeout(r, 520))
      onApplied({ pending: outcome, newModuleIds: outcome.newModuleIds, parts: partKeys.length })
    } catch (e) {
      console.error('[ModuleSplitModal] confirm', e)
      toast.error(t('admin.surgery.split_error'))
      setPhase('editing')
    }
  }

  /* ── Render ──────────────────────────────────────────────────────────────── */
  const cutting = phase === 'cutting' || phase === 'done'
  const totalMinutes = partKeys.reduce((sum, key, k) => sum + minutesOf(key, k), 0) || 1

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
                  {mod ? rowText(mod) : '…'}
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
                  {/* Instrucción + añadir corte donde más falta hace. */}
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-2 text-[12px] text-text-muted">
                      <GripVertical className="h-3.5 w-3.5 shrink-0 text-brand-magenta" />
                      {t('admin.surgery.split_hint')}
                    </p>
                    <Tooltip
                      label={t(bestNewCut === null ? 'admin.surgery.add_cut_none_tip' : 'admin.surgery.add_cut_tip')}
                      maxWidth={260}
                      className="shrink-0"
                    >
                      <button
                        type="button"
                        onClick={() => bestNewCut !== null && addCutAt(bestNewCut)}
                        disabled={busy || bestNewCut === null}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-glass/8 hover:text-text disabled:opacity-40 disabled:pointer-events-none"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t('admin.surgery.add_cut')}
                      </button>
                    </Tooltip>
                  </div>

                  {/* ── Criterio de la IA ── */}
                  <AnimatePresence initial={false}>
                    {aiSummary && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <p className="mb-3 flex items-start gap-2 rounded-xl border border-brand-magenta/25 bg-brand-magenta/[0.05] px-3 py-2 text-[12px] leading-relaxed text-text-muted">
                          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-magenta" />
                          <span>
                            <span className="font-semibold text-text">{t('admin.surgery.ai_summary_label')}: </span>
                            {aiSummary}
                          </span>
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* ── Lista de secciones con las líneas de corte ── */}
                  <div className="select-none">
                    <PartLabel tone="green" label={t('admin.surgery.part_n', { n: 1 })} />
                    {sections.map((s, i) => {
                      const k = bounds.findIndex((b, j) => j < bounds.length - 1 && i >= b && i < bounds[j + 1])
                      const cut = cuts.find((c) => c.at === i)
                      const tone = toneOf(k)
                      return (
                        <div key={s.id}>
                          {cut ? (
                            <CutLine
                              id={cut.id}
                              dragging={dragId === cut.id}
                              reason={reasons[cut.id] ?? null}
                              partLabel={t('admin.surgery.part_n', { n: k + 1 })}
                              tone={tone}
                              onGrab={() => setDragId(cut.id)}
                              onKeyMove={(d) => moveCut(cut.id, cut.at + d)}
                              onRemove={cuts.length > 1 ? () => removeCut(cut.id) : undefined}
                              label={t('admin.surgery.cut_handle')}
                              removeLabel={t('admin.surgery.remove_cut')}
                              cutting={cutting}
                            />
                          ) : (
                            i > 0 &&
                            !busy &&
                            !dragId && <GapAdd label={t('admin.surgery.add_cut_here')} onAdd={() => addCutAt(i)} />
                          )}
                          <motion.div
                            layout
                            ref={(el) => {
                              rowRefs.current[i] = el
                            }}
                            transition={SPRING}
                            animate={
                              cutting && !reduce
                                ? { y: (k - (partCount - 1) / 2) * 14, opacity: 0.55, scale: 0.98 }
                                : { y: 0, opacity: 1, scale: 1 }
                            }
                            className={cn(
                              'mb-1.5 flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                              tone === 'magenta'
                                ? 'border-brand-magenta/30 bg-brand-magenta/[0.06]'
                                : 'border-brand-green/30 bg-brand-green/[0.06]',
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold tabular-nums',
                                tone === 'magenta'
                                  ? 'bg-brand-magenta/15 text-brand-magenta'
                                  : 'bg-brand-green/15 text-brand-green',
                              )}
                            >
                              {i - bounds[k] + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                              {rowText(s, 'heading') || t('admin.surgery.untitled_section')}
                            </span>
                            <span className="flex shrink-0 items-center gap-2 text-text-subtle">
                              <span className="text-[10.5px] tabular-nums">
                                ~{Math.max(1, Math.round(sectionMinutes[i] ?? 1))} {t('admin.surgery.minutes')}
                              </span>
                              {s.media_url && <ImageIcon className="h-3.5 w-3.5" />}
                              {(s.section_quizzes ?? []).length > 0 && (
                                <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px]">
                                  {t('admin.surgery.quiz_tag')}
                                </span>
                              )}
                              {/* Leer el texto de la sección sin salir del modal:
                                  sin esto no hay forma de saber qué cae en cada parte. */}
                              <Tooltip
                                label={t(peek === s.id ? 'admin.surgery.hide_section' : 'admin.surgery.peek_section')}
                                className="shrink-0"
                              >
                              <button
                                type="button"
                                onClick={() => setPeek(peek === s.id ? null : s.id)}
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
                                lines={sectionReadableText(s)}
                                empty={t('admin.surgery.section_empty')}
                              />
                            )}
                          </AnimatePresence>
                        </div>
                      )
                    })}
                  </div>

                  {/* ── Cómo queda repartido ── */}
                  <div className="mt-4">
                    <p className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-text-subtle">
                      {t('admin.surgery.balance_label')}
                    </p>
                    <div className="flex h-7 w-full gap-1 overflow-hidden rounded-lg">
                      {partKeys.map((key, k) => {
                        const m = minutesOf(key, k)
                        return (
                          <motion.div
                            key={key}
                            layout
                            transition={SPRING}
                            className="flex min-w-[28px]"
                            style={{ flexGrow: m, flexBasis: 0 }}
                          >
                          <Tooltip
                            label={`${titleOf(key, k) || t('admin.surgery.untitled_module')} · ${m} ${t('admin.surgery.minutes')}`}
                            className="flex w-full"
                          >
                            <div
                              className={cn(
                                'flex w-full items-center justify-center overflow-hidden rounded-md text-[10.5px] font-semibold tabular-nums',
                                toneOf(k) === 'green'
                                  ? 'bg-brand-green/20 text-brand-green'
                                  : 'bg-brand-magenta/20 text-brand-magenta',
                              )}
                            >
                              <span className="truncate px-1">
                                {m / totalMinutes > 0.09 ? `${k + 1} · ${m} ${t('admin.surgery.minutes')}` : k + 1}
                              </span>
                            </div>
                          </Tooltip>
                          </motion.div>
                        )
                      })}
                    </div>
                  </div>

                  {/* ── Resultado en vivo ── */}
                  <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                    {partKeys.map((key, k) => (
                      <OutcomeCard
                        key={key}
                        tone={toneOf(k)}
                        eyebrow={t('admin.surgery.part_n', { n: k + 1 })}
                        title={titleOf(key, k)}
                        titleLabel={t('admin.surgery.title_label')}
                        onTitleChange={(v) => setTitles((prev) => ({ ...prev, [key]: v }))}
                        disabled={busy}
                        minutes={{
                          value: minutesOf(key, k),
                          auto: stats[k]?.min ?? 1,
                          overridden: mins[key] !== undefined,
                          onChange: (v) =>
                            setMins((prev) => {
                              if (v === null) {
                                const { [key]: _drop, ...rest } = prev
                                return rest
                              }
                              return { ...prev, [key]: v }
                            }),
                          label: t('admin.surgery.duration_label'),
                          suffix: t('admin.surgery.minutes'),
                          resetLabel: t('admin.surgery.duration_reset'),
                          autoHint: t('admin.surgery.duration_reset_tip'),
                        }}
                        stats={[
                          { value: String(stats[k]?.sections ?? 0), label: t('admin.surgery.sections') },
                          { value: String(stats[k]?.quizzes ?? 0), label: t('admin.surgery.quizzes') },
                        ]}
                      />
                    ))}
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
                          {partKeys.map((key, k) => {
                            const d = draftOf(key)
                            return (
                              <div key={key} className="space-y-2.5">
                                <p
                                  className={cn(
                                    'truncate text-[10.5px] font-semibold uppercase tracking-wider',
                                    toneOf(k) === 'green' ? 'text-brand-green' : 'text-brand-magenta',
                                  )}
                                >
                                  {t('admin.surgery.part_n', { n: k + 1 })} · {titleOf(key, k)}
                                </p>
                                {k > 0 && (
                                  <SurgeryField
                                    rows={3}
                                    label={t('admin.surgery.field_intro')}
                                    value={d.intro_es}
                                    onChange={(v) => patch(key, { intro_es: v })}
                                    placeholder={t('admin.surgery.field_bridge_ph')}
                                    disabled={busy}
                                  />
                                )}
                                <SurgeryField
                                  label={t('admin.surgery.field_subtitle')}
                                  value={d.subtitle_es}
                                  onChange={(v) => patch(key, { subtitle_es: v })}
                                  placeholder={t('admin.surgery.field_subtitle_ph')}
                                  disabled={busy}
                                />
                                <SurgeryList
                                  label={t('admin.surgery.field_objectives')}
                                  items={d.objectives_es}
                                  onChange={(v) => patch(key, { objectives_es: v })}
                                  addLabel={t('admin.surgery.add_item')}
                                  removeLabel={t('admin.surgery.remove_item')}
                                  placeholder={t('admin.surgery.field_objectives_ph')}
                                  disabled={busy}
                                />
                                <SurgeryList
                                  label={t('admin.surgery.field_takeaways')}
                                  items={d.key_takeaways_es}
                                  onChange={(v) => patch(key, { key_takeaways_es: v })}
                                  addLabel={t('admin.surgery.add_item')}
                                  removeLabel={t('admin.surgery.remove_item')}
                                  placeholder={t('admin.surgery.field_takeaways_ph')}
                                  disabled={busy}
                                />
                                {k < partCount - 1 && (
                                  <SurgeryField
                                    rows={3}
                                    label={t('admin.surgery.field_closing')}
                                    value={d.closing_es}
                                    onChange={(v) => patch(key, { closing_es: v })}
                                    placeholder={t('admin.surgery.field_bridge_ph')}
                                    disabled={busy}
                                  />
                                )}
                              </div>
                            )
                          })}
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
                      label={
                        aiPending
                          ? t('admin.surgery.ai_pending_title')
                          : t('admin.surgery.split_confirm_tip', { count: partCount })
                      }
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
                      {t('admin.surgery.split_confirm', { count: partCount })}
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

/** Rótulo de la primera parte, arriba de la lista (las demás lo llevan en su corte). */
function PartLabel({ tone, label }: { tone: 'green' | 'magenta'; label: string }) {
  return (
    <p
      className={cn(
        'mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-wider',
        tone === 'green' ? 'text-brand-green' : 'text-brand-magenta',
      )}
    >
      {label}
    </p>
  )
}

/**
 * Hueco entre dos secciones donde se puede añadir un corte. Invisible hasta que
 * se pasa el ratón (o se llega con el teclado): con varias secciones, un botón
 * fijo en cada hueco llenaría la lista de ruido.
 */
function GapAdd({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="group relative -mt-1 mb-0.5 h-2">
      <button
        type="button"
        onClick={onAdd}
        className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-brand-magenta/40 bg-surface px-2 py-0.5 text-[10.5px] font-semibold text-brand-magenta opacity-0 shadow-[0_0_14px_-6px_rgba(179,61,158,0.9)] transition-opacity hover:bg-brand-magenta/10 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Scissors className="h-3 w-3" />
        {label}
      </button>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Una línea de corte. Cada una tiene su `layoutId`: al cambiar de hueco no se
   destruye y se vuelve a crear, VUELA hasta la nueva posición con resorte. Ese
   vuelo es lo que hace que el gesto se sienta físico.
   ──────────────────────────────────────────────────────────────────────────── */
function CutLine({
  id,
  dragging,
  reason,
  partLabel,
  tone,
  onGrab,
  onKeyMove,
  onRemove,
  label,
  removeLabel,
  cutting,
}: {
  id: string
  dragging: boolean
  reason: string | null
  /** Nombre de la parte que arranca en este corte. */
  partLabel: string
  tone: 'green' | 'magenta'
  onGrab: () => void
  onKeyMove: (delta: number) => void
  /** Sin él no se puede quitar (es el único corte). */
  onRemove?: () => void
  label: string
  removeLabel: string
  cutting: boolean
}) {
  const accent = tone === 'green' ? 'text-brand-green' : 'text-brand-magenta'
  return (
    <motion.div
      layoutId={`module-cut-line-${id}`}
      transition={SPRING}
      className="relative mb-1.5 mt-2.5 flex items-center gap-2 py-1"
    >
      <span className={cn('shrink-0 text-[10.5px] font-semibold uppercase tracking-wider', accent)}>
        {partLabel}
      </span>

      {/* Riel luminoso: une el color de la parte anterior con el de la nueva. */}
      <motion.span
        aria-hidden
        className="h-px flex-1 rounded-full"
        style={{
          background:
            tone === 'magenta'
              ? 'linear-gradient(90deg, rgba(16,212,81,0) 0%, rgba(16,212,81,0.9) 60%, rgba(179,61,158,0.9) 100%)'
              : 'linear-gradient(90deg, rgba(179,61,158,0) 0%, rgba(179,61,158,0.9) 60%, rgba(16,212,81,0.9) 100%)',
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
          if ((e.key === 'Delete' || e.key === 'Backspace') && onRemove) {
            e.preventDefault()
            onRemove()
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
            tone === 'magenta'
              ? 'linear-gradient(90deg, rgba(179,61,158,0.9) 0%, rgba(179,61,158,0.9) 40%, rgba(179,61,158,0) 100%)'
              : 'linear-gradient(90deg, rgba(16,212,81,0.9) 0%, rgba(16,212,81,0.9) 40%, rgba(16,212,81,0) 100%)',
        }}
        animate={{ opacity: dragging || cutting ? 1 : 0.65, scaleY: dragging ? 3 : 1 }}
        transition={{ duration: 0.2 }}
      />

      {onRemove && !cutting && (
        <Tooltip label={removeLabel} className="shrink-0">
          <button
            type="button"
            onClick={onRemove}
            aria-label={removeLabel}
            className="flex h-6 w-6 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-glass/10 hover:text-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      )}

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
