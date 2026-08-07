import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, ArrowRight, CheckCircle2, ListChecks, MessageSquare, PenLine,
  Phone, PhoneOff, Play, RotateCcw, Route, ShieldCheck, Target, X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { countMatches } from '@/lib/normalize'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'
import { RichText } from '@/components/ui/RichText'
import type { Scenario } from '@/data/scenarios'
import { CustomerPanel } from '@/components/simulator/CustomerPanel'
import { ChatTranscript } from '@/components/simulator/ChatTranscript'
import { Checklist } from '@/components/simulator/Checklist'
import { CallTimer } from '@/components/simulator/CallTimer'
import { AgentInput } from '@/components/simulator/AgentInput'
import type { ChoiceNodeData } from './ChoiceNodeForm'
import type { DialogueNodeData } from './DialogueNodeForm'
import {
  bestPoints, checklistHits, exitsOf, isEndNode, matchBranch, nodeText, reviewScenario,
  type Lang, type PreviewIssue, type PreviewNodes, type PreviewType,
} from './simulationPreview'

/**
 * VISTA PREVIA de la simulación que se está escribiendo.
 *
 * Es un ensayo del borrador que hay EN PANTALLA: no guarda, no llama a la IA y
 * no toca el progreso de nadie. Muestra tres cosas a la vez, que es lo que hace
 * falta para revisar un guion sin salir del editor:
 *   1. el teléfono, tal como lo ve el aprendiz;
 *   2. el panel de respuesta (opciones o texto libre), con puntaje en vivo;
 *   3. la revisión del guion — rutas rotas, callejones, momentos inalcanzables —
 *      con un botón que lleva directo al paso que hay que corregir.
 *
 * El recorrido usa el motor guionado (ver `simulationPreview.ts`), así que es
 * instantáneo y determinista.
 */

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

type Tone = 'good' | 'bad' | 'info'

interface Msg {
  id: string
  from: 'client' | 'agent' | 'system'
  text: string
  tone?: Tone
}

interface Ending {
  kind: 'excellent' | 'good' | 'poor' | 'resolved' | 'unresolved' | 'turns' | 'stuck' | 'broken'
  message?: string
  nodeId?: string
}

interface Frame {
  nodeId: string
  messages: Msg[]
  points: number
  steps: number
  path: string[]
  done: string[]
  empathy: number
  ending: Ending | null
  /** Qué pasó con la última decisión/respuesta (se muestra sobre las opciones). */
  lastNote: { tone: Tone; text: string } | null
  /** Cuadro intermedio mientras "el cliente escribe": no cuenta como paso. */
  transient?: boolean
}

export interface PreviewMeta {
  title: string
  clientName: string
  clientSubtitle: string
  reason?: string
  summary?: string
  maxTurns?: number
  passScore?: number | null
  /** Solo simulación de llamada: alimentan el panel real del cliente. */
  country?: 'CO' | 'MX' | 'AR'
  difficulty?: 1 | 2 | 3
  avatarSeed?: number
  /** Solo opción múltiple: alimentan la pantalla de entrada real. */
  description?: string
  objective?: string
  level?: 'basico' | 'medio' | 'avanzado'
}

interface Props {
  type: PreviewType
  nodes: PreviewNodes
  startNodeId: string
  /** Paso desde el que arranca el ensayo (por defecto, el inicial del escenario). */
  fromNodeId?: string | null
  meta: PreviewMeta
  checklist?: { id: string; label: Record<Lang, string>; keywords: string[] }[]
  empathyKeywords?: string[]
  stepLabel: (nodeId: string) => string
  /** Lleva al capacitador a ese paso en el editor (y cierra la vista previa). */
  onGoToStep?: (nodeId: string) => void
  onClose: () => void
}

const uid = () => Math.random().toString(36).slice(2)

export function SimulationPreviewModal({
  type, nodes, startNodeId, fromNodeId, meta, checklist = [], empathyKeywords = [],
  stepLabel, onGoToStep, onClose,
}: Props) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [lang, setLang] = useState<Lang>('es')
  const [tab, setTab] = useState<'play' | 'review' | 'path'>('play')
  // El aprendiz primero ve de qué se trata y recién entonces entra: la vista
  // previa arranca igual, en esa pantalla de entrada.
  const [phase, setPhase] = useState<'intro' | 'run'>(type === 'choice' ? 'intro' : 'run')
  const [typing, setTyping] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const originId = fromNodeId && nodes[fromNodeId] ? fromNodeId : startNodeId

  const makeFirstFrame = useCallback((l: Lang): Frame => ({
    nodeId: originId,
    messages: nodes[originId]
      ? [{ id: uid(), from: 'client', text: nodeText(nodes[originId], type, l) || t('admin.simulations.preview.empty_line') }]
      : [{ id: uid(), from: 'system', text: t('admin.simulations.preview.issue_start_missing'), tone: 'bad' }],
    points: 0,
    steps: 0,
    path: [originId],
    done: [],
    empathy: 0,
    ending: nodes[originId] ? null : { kind: 'broken' },
    lastNote: null,
  }), [nodes, originId, type, t])

  const [frames, setFrames] = useState<Frame[]>(() => [makeFirstFrame('es')])
  const frame = frames[frames.length - 1]
  // Cronómetro de la llamada: arranca con el ensayo y se congela al terminar.
  const [runStartedAt, setRunStartedAt] = useState(() => Date.now())
  const [runEndedAt, setRunEndedAt] = useState<number | undefined>(undefined)

  const restart = useCallback((l: Lang = lang) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setTyping(false)
    setFrames([makeFirstFrame(l)])
    setRunStartedAt(Date.now())
    setRunEndedAt(undefined)
    // Volver a empezar es volver al principio tal como lo vive el aprendiz: a la
    // pantalla de entrada en opción múltiple, y a la llamada misma en la otra.
    setPhase(type === 'choice' ? 'intro' : 'run')
    setTab('play')
  }, [lang, makeFirstFrame, type])

  /** Entrar a la simulación desde la pantalla de entrada. */
  const enterRun = () => {
    setRunStartedAt(Date.now())
    setPhase('run')
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  // Esc cierra, y el fondo no scrollea. En captura, para ganarle a los atajos del editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prev
    }
  }, [onClose])

  // El chat sigue siempre al último mensaje.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' })
  }, [frames, typing, reduce])

  const issues = useMemo(() => reviewScenario(nodes, startNodeId, type), [nodes, startNodeId, type])
  const errorCount = issues.filter((i) => i.level === 'error').length
  const maxPoints = useMemo(
    () => (type === 'choice' ? bestPoints(nodes, startNodeId) : 0),
    [type, nodes, startNodeId],
  )
  const scorePct = maxPoints > 0 ? Math.max(0, Math.min(100, Math.round((frame.points / maxPoints) * 100))) : 0

  /**
   * Escenario con la forma que esperan los componentes REALES del simulador de
   * llamada (panel del cliente, transcripción, lista de evaluación). Se arma con
   * el borrador para que la vista previa sea la misma pantalla del aprendiz, no
   * una copia parecida que se pueda desincronizar.
   */
  const callScenario = useMemo<Scenario | null>(() => {
    if (type !== 'dialogue') return null
    const l = (s?: string) => ({ es: s ?? '', en: s ?? '', pt: s ?? '' })
    return {
      id: 'preview',
      country: meta.country ?? 'CO',
      difficulty: meta.difficulty ?? 2,
      title: l(meta.title),
      summary: l(meta.summary),
      customer: {
        name: meta.clientName || t('admin.simulations.preview.client_placeholder'),
        phone: meta.clientSubtitle,
        reason: l(meta.reason),
        avatarSeed: meta.avatarSeed ?? 1,
      },
      checklist: checklist.length ? checklist : [],
      empathyKeywords,
      maxTurns: meta.maxTurns ?? 10,
      start: startNodeId,
      nodes: Object.fromEntries(
        Object.entries(nodes).map(([id, n]) => [id, { id, ...(n as DialogueNodeData) }]),
      ),
    } as Scenario
  }, [type, meta, checklist, empathyKeywords, startNodeId, nodes, t])
  const currentNode = nodes[frame.nodeId]
  const live = !frame.ending

  /* ── Avance: se muestra ya lo que dijo el agente y, un instante después, la
        respuesta del cliente. El cuadro intermedio se reemplaza (no se acumula),
        así el historial de "Ruta" queda limpio para rebobinar. ─────────────── */
  const advance = (agentMsg: Msg, next: (base: Frame) => Frame) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const base = frames[frames.length - 1]
    const withAgent: Frame = { ...base, messages: [...base.messages, agentMsg], transient: true }
    setFrames((f) => [...f, withAgent])
    setTyping(true)
    timerRef.current = setTimeout(() => {
      const committed = next({ ...withAgent, transient: false })
      setTyping(false)
      setFrames((f) => [...f.slice(0, -1), committed])
      if (committed.ending) setRunEndedAt(Date.now())
    }, reduce ? 60 : 480)
  }

  /* ── Opción múltiple ─────────────────────────────────────────────────────── */
  const chooseOption = (idx: number) => {
    if (!live || typing) return
    const node = currentNode as ChoiceNodeData
    const opt = (node.options ?? [])[idx]
    if (!opt) return
    const best = Math.max(...(node.options ?? []).map((o) => o.points ?? 0), 0)
    const agentMsg: Msg = { id: uid(), from: 'agent', text: opt.text?.[lang] || opt.text?.es || '…' }

    advance(agentMsg, (base) => {
      const points = base.points + (opt.points ?? 0)
      const lastNote = {
        tone: ((opt.points ?? 0) >= best ? 'good' : (opt.points ?? 0) > 0 ? 'info' : 'bad') as Tone,
        text: opt.feedback?.trim()
          || t('admin.simulations.preview.choice_gain', { letter: LETTERS[idx], points: opt.points ?? 0, best }),
      }
      const target = opt.nextId ? (nodes[opt.nextId] as ChoiceNodeData | undefined) : undefined
      if (!target) {
        return {
          ...base, points, lastNote,
          messages: [...base.messages, {
            id: uid(), from: 'system', tone: 'bad',
            text: t('admin.simulations.preview.broken_from', { step: stepLabel(base.nodeId) }),
          }],
          ending: { kind: 'broken', nodeId: base.nodeId },
        }
      }
      const line = nodeText(target, 'choice', lang)
      const ended = target.isEnd === true
      return {
        ...base,
        nodeId: opt.nextId,
        points,
        steps: base.steps + 1,
        path: [...base.path, opt.nextId],
        lastNote,
        messages: [...base.messages, {
          id: uid(), from: 'client',
          text: line || t('admin.simulations.preview.empty_line'),
        }],
        ending: ended
          ? {
              kind: target.endType ?? 'good',
              nodeId: opt.nextId,
              message: target.endMessage?.[lang] || target.endMessage?.es || '',
            }
          : null,
      }
    })
  }

  /* ── Simulación de llamada (texto libre, motor guionado) ──────────────────── */
  const sendText = (raw: string) => {
    const text = raw.trim()
    if (!text || !live || typing) return
    const node = currentNode as DialogueNodeData
    const m = matchBranch(node, text)
    const agentMsg: Msg = { id: uid(), from: 'agent', text }

    advance(agentMsg, (base) => {
      const hits = checklistHits(checklist, text, new Set(base.done))
      const done = [...base.done, ...hits]
      const empathy = base.empathy + countMatches(text, empathyKeywords)
      const steps = base.steps + 1
      const noteBase = hits.length
        ? t('admin.simulations.preview.checklist_hit', {
            items: hits.map((id) => checklist.find((c) => c.id === id)?.label[lang] || id).join(', '),
          })
        : ''

      // Sin ruta ni respaldo el cliente repetiría la misma línea: acá se dice.
      if (m.via === 'stuck' || !m.next || !nodes[m.next]) {
        const brokenLink = m.via !== 'stuck'
        return {
          ...base, done, empathy, steps,
          lastNote: { tone: 'bad', text: noteBase || t('admin.simulations.preview.no_match') },
          messages: [...base.messages, {
            id: uid(), from: 'system', tone: 'bad',
            text: brokenLink
              ? t('admin.simulations.preview.broken_from', { step: stepLabel(base.nodeId) })
              : t('admin.simulations.preview.stuck_from', { step: stepLabel(base.nodeId) }),
          }],
          ending: { kind: brokenLink ? 'broken' : 'stuck', nodeId: base.nodeId },
        }
      }

      const target = nodes[m.next] as DialogueNodeData
      const matchNote = m.via === 'branch'
        ? t('admin.simulations.preview.matched_keyword', { keyword: m.keyword })
        : t('admin.simulations.preview.matched_fallback')
      const outOfTurns = (meta.maxTurns ?? 0) > 0 && steps >= (meta.maxTurns ?? 0)

      return {
        ...base,
        nodeId: m.next,
        steps,
        done,
        empathy,
        path: [...base.path, m.next],
        lastNote: { tone: m.via === 'branch' ? 'good' : 'info', text: [matchNote, noteBase].filter(Boolean).join(' · ') },
        messages: [...base.messages, {
          id: uid(), from: 'client',
          text: nodeText(target, 'dialogue', lang) || t('admin.simulations.preview.empty_line'),
        }],
        ending: target.terminal
          ? { kind: target.terminal, nodeId: m.next }
          : outOfTurns
            ? { kind: 'turns' }
            : null,
      }
    })
  }

  /** Rebobinar: volver a un momento del recorrido y probar otra respuesta. */
  const rewindTo = (frameIdx: number) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setTyping(false)
    setFrames((f) => f.slice(0, frameIdx + 1))
    setRunEndedAt(undefined)
    setTab('play')
  }

  /** Colgar: termina el ensayo donde esté. */
  const hangUp = () => {
    if (!live) return
    setFrames((f) => [...f.slice(0, -1), { ...frame, ending: { kind: 'turns' } }])
    setRunEndedAt(Date.now())
  }

  const goFix = (nodeId?: string) => {
    if (!nodeId || !onGoToStep) return
    onGoToStep(nodeId)
    onClose()
  }

  /* ── Presentación ────────────────────────────────────────────────────────── */

  const issueText = (code: PreviewIssue['code']) => t(`admin.simulations.preview.issue_${code}`)
  const issueHint = (code: PreviewIssue['code']) => t(`admin.simulations.preview.hint_${code}`)

  const endingTone: Record<Ending['kind'], { color: string; label: string }> = {
    excellent: { color: '#34c759', label: t('admin.simulations.preview.end_excellent') },
    good: { color: '#0071e3', label: t('admin.simulations.preview.end_good') },
    poor: { color: '#ff453a', label: t('admin.simulations.preview.end_poor') },
    resolved: { color: '#34c759', label: t('admin.simulations.preview.end_resolved') },
    unresolved: { color: '#ff453a', label: t('admin.simulations.preview.end_unresolved') },
    turns: { color: '#ff9f0a', label: t('admin.simulations.preview.end_turns') },
    stuck: { color: '#ff9f0a', label: t('admin.simulations.preview.end_stuck') },
    broken: { color: '#ff453a', label: t('admin.simulations.preview.end_broken') },
  }

  /* ── Pantalla de entrada (solo opción múltiple) ───────────────────────────
     La simulación de llamada NO tiene esta pantalla: el aprendiz entra desde la
     tarjeta del curso y la llamada empieza de una vez, así que la vista previa
     hace lo mismo y arranca en la consola. */
  const levelColor = { basico: '#34c759', medio: '#0071e3', avanzado: '#ff453a' }[meta.level ?? 'basico']
  const levelLabel = t(
    `admin.simulations.level_${meta.level === 'avanzado' ? 'advanced' : meta.level === 'medio' ? 'medium' : 'basic'}`,
  )
  const introFacts = ([
    { id: 'customer', label: t('simulator.customer'), value: meta.clientName },
    { id: 'company', label: t('simulator.choice.company'), value: meta.clientSubtitle },
    { id: 'objective', label: t('simulator.choice.objective'), value: meta.objective },
  ]).filter((f) => Boolean(f.value)) as { id: string; label: string; value: string }[]
  const introRules = [
    t('simulator.choice.rule_choose'),
    t('simulator.choice.rule_points'),
    t('simulator.choice.rule_end'),
  ]

  const options = type === 'choice' ? ((currentNode as ChoiceNodeData | undefined)?.options ?? []) : []
  const committedFrames = frames.filter((f) => !f.transient)

  const spring = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 420, damping: 32 }

  const chip = 'inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11.5px] text-text-muted'

  return createPortal(
    <motion.div
      initial={reduce ? undefined : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      {...backdropDismiss(onClose)}
    >
      <motion.div
        initial={reduce ? undefined : { opacity: 0, scale: 0.97, y: 12, filter: 'blur(6px)' }}
        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="flex h-full w-full max-w-[1360px] flex-col overflow-hidden rounded-none border-0 bg-bg sm:h-[94vh] sm:rounded-3xl sm:border sm:border-line sm:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Cabecera ─────────────────────────────────────────────────────── */}
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-3 sm:px-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-green/12 text-brand-green">
            <Play className="h-4 w-4" fill="currentColor" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold leading-tight text-text">
              {t('admin.simulations.preview.title')}
              {meta.title && <span className="font-normal text-text-muted"> · {meta.title}</span>}
            </p>
            <p className="truncate text-[11.5px] leading-tight text-text-subtle">
              {t('admin.simulations.preview.nothing_saved')}
            </p>
          </div>

          {/* Idioma: sirve para revisar las traducciones sin salir de acá. */}
          <div className="hidden items-center gap-0.5 rounded-full border border-line bg-surface p-0.5 sm:flex">
            {(['es', 'en', 'pt'] as Lang[]).map((l) => (
              <button
                key={l}
                // Cambiar de idioma reinicia el ensayo: las burbujas ya dichas
                // quedaron en el idioma anterior y mezclarlas confunde.
                onClick={() => { setLang(l); restart(l) }}
                className={cn(
                  'relative rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors',
                  lang === l ? 'text-brand-green' : 'text-text-subtle hover:text-text-muted',
                )}
              >
                {lang === l && (
                  <motion.span
                    layoutId="preview-lang"
                    className="absolute inset-0 rounded-full bg-brand-green/12"
                    transition={spring}
                  />
                )}
                <span className="relative">{l}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => restart()}
            title={t('admin.simulations.preview.restart')}
            className="flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[12.5px] text-text-muted transition-colors hover:bg-subtle hover:text-text"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t('admin.simulations.preview.restart')}</span>
          </button>
          <button
            onClick={onClose}
            aria-label={t('admin.preview.close')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Pantalla de entrada (opción múltiple) ────────────────────────────
            Lo primero que ve el aprendiz: de qué se trata, con quién habla y cómo
            se evalúa. Recién al aceptar entra a la simulación. */}
        {phase === 'intro' && type === 'choice' && (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
            {/* Misma jerarquía que la página real del aprendiz: a la izquierda lo
                que hay que leer, a la derecha con quién habla, las reglas y el
                botón. Una fila de tarjetas iguales se rompía en cuanto el
                objetivo era un párrafo. */}
            <motion.div
              initial={reduce ? undefined : { opacity: 0, y: 20, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto w-full max-w-5xl"
            >
              <header className="mb-8 text-center">
                <div className="mb-3 text-[12px] uppercase tracking-wider text-text-subtle">
                  {t('simulator.choice_section_title')}
                </div>
                <h1 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.04em] text-text text-balance md:text-[34px]">
                  {meta.title || t('admin.simulations.preview.untitled')}
                </h1>
                <span
                  className="mt-4 inline-block rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest"
                  style={{ color: levelColor, background: `${levelColor}20`, border: `1px solid ${levelColor}40` }}
                >
                  {levelLabel}
                </span>
              </header>

              <div className="grid items-start gap-5 lg:grid-cols-[1.55fr_1fr]">
                <div className="space-y-5">
                  <section className="rounded-2xl border border-line bg-surface p-6 md:p-8">
                    <div className="mb-4 flex items-center gap-2.5">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <Phone className="h-4 w-4" />
                      </span>
                      <h2 className="text-[12px] font-medium uppercase tracking-wider text-text-subtle">
                        {t('simulator.choice.the_case')}
                      </h2>
                    </div>
                    {meta.description
                      ? <RichText text={meta.description} className="text-[15px] leading-[1.7] text-text-muted" />
                      : <p className="text-[14px] text-text-subtle">{t('admin.simulations.preview.no_description')}</p>}
                  </section>

                  {meta.objective && (
                    <section className="rounded-2xl border border-line border-l-[3px] border-l-primary bg-surface p-6 md:p-8">
                      <div className="mb-4 flex items-center gap-2.5">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                          <Target className="h-4 w-4" />
                        </span>
                        <h2 className="text-[12px] font-medium uppercase tracking-wider text-text-subtle">
                          {t('simulator.choice.objective')}
                        </h2>
                      </div>
                      <p className="text-[15px] leading-[1.7] text-text">{meta.objective}</p>
                    </section>
                  )}
                </div>

                <aside className="space-y-5">
                  <section className="rounded-2xl border border-line bg-surface p-6 text-center">
                    <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-[22px] font-semibold text-primary">
                      {(meta.clientName || '?').trim().charAt(0).toUpperCase()}
                    </div>
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-subtle">
                      {t('simulator.customer')}
                    </p>
                    <p className="text-[17px] font-semibold leading-snug tracking-tight text-text">
                      {meta.clientName || t('admin.simulations.preview.client_placeholder')}
                    </p>
                    {meta.clientSubtitle && (
                      <p className="mt-0.5 text-[13px] text-text-muted">{meta.clientSubtitle}</p>
                    )}
                  </section>

                  {/* Las reglas, tal como se las explican al aprendiz. */}
                  <section className="rounded-2xl border border-line bg-surface p-6">
                    <p className="mb-4 text-[13px] font-semibold text-text">{t('simulator.choice.how_it_works')}</p>
                    <ol className="space-y-3.5">
                      {introRules.map((rule, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                            {i + 1}
                          </span>
                          <p className="text-[12.5px] leading-relaxed text-text-muted">{rule}</p>
                        </li>
                      ))}
                    </ol>
                  </section>

                  <motion.button
                    whileHover={reduce ? undefined : { scale: 1.02 }}
                    whileTap={reduce ? undefined : { scale: 0.98 }}
                    onClick={enterRun}
                    className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-full px-8 py-4 text-[16px] font-semibold text-black shadow-[0_10px_30px_-12px_rgba(52,199,89,0.9)]"
                    style={{ background: '#34c759' }}
                  >
                    <Phone className="h-5 w-5" />
                    {t('simulator.choice.accept_call')}
                  </motion.button>

                  {/* Atajo del capacitador: revisar el guion sin jugarlo. */}
                  {issues.length > 0 && (
                    <button
                      onClick={() => { setPhase('run'); setTab('review') }}
                      className="mx-auto flex items-center gap-1.5 text-[12.5px] text-text-muted transition-colors hover:text-text"
                    >
                      <AlertTriangle className={cn('h-3.5 w-3.5', errorCount > 0 ? 'text-danger' : 'text-amber-500')} />
                      {t('admin.simulations.preview.review_from_intro', { n: issues.length })}
                    </button>
                  )}
                </aside>
              </div>
            </motion.div>
          </div>
        )}

        {/* ── Lienzo ───────────────────────────────────────────────────────────
            La escena de la izquierda es LA PANTALLA DEL APRENDIZ, y cada tipo de
            simulación tiene la suya: la de opción múltiple ocurre en el teléfono,
            y la de llamada en la consola real (panel del cliente, transcripción y
            campo de texto, con los mismos componentes del simulador). A la derecha
            van las herramientas del capacitador, que el aprendiz no ve. */}
        {phase === 'run' && (
        <div className={cn(
          'grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-4 sm:p-5 lg:overflow-hidden',
          type === 'choice' ? 'lg:grid-cols-[340px_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,1fr)_370px]',
        )}>
          {/* ── Escena: teléfono (opción múltiple) ──────────────────────────── */}
          {type === 'choice' ? (
          <div className="flex min-h-0 flex-col items-center">
            <div
              className="flex w-full max-w-[340px] flex-1 flex-col overflow-hidden rounded-[38px] border-[7px] border-[#1c1c1e] bg-black shadow-2xl lg:max-h-[640px]"
              style={{ minHeight: 460 }}
            >
              {/* Encabezado de llamada */}
              <div className="relative flex shrink-0 flex-col items-center px-4 pb-4 pt-3">
                <div className="mb-3 h-6 w-24 rounded-full bg-[#1c1c1e]" />
                <div className="relative mb-2 grid h-14 w-14 place-items-center rounded-full border-2 border-[#0071e3]/50 bg-[#0071e3]/20">
                  {!reduce && live && (
                    <motion.span
                      aria-hidden
                      className="absolute inset-0 rounded-full border border-[#34c759]/50"
                      animate={{ scale: [1, 1.35], opacity: [0.6, 0] }}
                      transition={{ duration: 1.9, repeat: Infinity, ease: 'easeOut' }}
                    />
                  )}
                  <span className="text-[22px] font-bold text-white">
                    {(meta.clientName || '?').trim().charAt(0).toUpperCase()}
                  </span>
                </div>
                <p className="m-0 text-[13.5px] font-semibold text-white">
                  {meta.clientName || t('admin.simulations.preview.client_placeholder')}
                </p>
                <p className="m-0 mt-0.5 text-[11.5px] text-[#86868b]">{meta.clientSubtitle}</p>
                <p
                  className="mt-1 font-mono text-[12px] font-semibold"
                  style={{ color: live ? '#34c759' : '#86868b' }}
                >
                  {live ? t('admin.simulations.preview.on_call') : t('admin.simulations.preview.call_over')}
                </p>
              </div>

              {/* Chat */}
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3">
                {frame.messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={reduce ? undefined : { opacity: 0, y: 14, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className={cn(
                      'mb-3 flex flex-col',
                      msg.from === 'agent' ? 'items-end' : msg.from === 'client' ? 'items-start' : 'items-center',
                    )}
                  >
                    {msg.from !== 'system' && (
                      <span className="mb-1 px-0.5 text-[9.5px] text-[#86868b]">
                        {msg.from === 'client'
                          ? meta.clientName || t('admin.simulations.preview.client_placeholder')
                          : t('admin.simulations.preview.you')}
                      </span>
                    )}
                    <div
                      className="max-w-[85%] px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-white"
                      style={
                        msg.from === 'system'
                          ? {
                              background: 'rgba(255,69,58,0.14)',
                              border: '1px solid rgba(255,69,58,0.35)',
                              borderRadius: 14,
                              color: '#ff9f9a',
                              textAlign: 'center',
                              fontSize: 11.5,
                            }
                          : msg.from === 'client'
                            ? { background: 'rgba(255,255,255,0.12)', borderRadius: '4px 18px 18px 18px' }
                            : { background: '#0071e3', borderRadius: '18px 4px 18px 18px' }
                      }
                    >
                      {msg.text}
                    </div>
                  </motion.div>
                ))}

                <AnimatePresence>
                  {typing && (
                    <motion.div
                      key="typing"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mb-3 flex items-center gap-1.5 rounded-[18px_18px_18px_4px] bg-white/10 px-3.5 py-3"
                      style={{ width: 'fit-content' }}
                    >
                      {[0, 1, 2].map((i) => (
                        <motion.span
                          key={i}
                          className="block h-[6px] w-[6px] rounded-full bg-[#86868b]"
                          animate={reduce ? undefined : { y: [0, -4, 0] }}
                          transition={{ duration: 0.55, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Colgar (termina el ensayo) */}
              <div className="flex h-16 shrink-0 items-center justify-center">
                <motion.button
                  whileHover={reduce ? undefined : { scale: 1.07 }}
                  whileTap={reduce ? undefined : { scale: 0.93 }}
                  onClick={() => setFrames((f) => [...f.slice(0, -1), { ...frame, ending: frame.ending ?? { kind: 'turns' } }])}
                  disabled={!live}
                  className="grid h-12 w-12 place-items-center rounded-full bg-[#ff3b30] disabled:opacity-40"
                  aria-label={t('admin.simulations.preview.hang_up')}
                >
                  <PhoneOff className="h-5 w-5 text-white" />
                </motion.button>
              </div>
            </div>

            <p className="mt-2.5 text-center text-[11px] text-text-subtle">
              {stepLabel(frame.nodeId)}
              {frame.nodeId === startNodeId && ` · ${t('admin.simulations.start')}`}
            </p>
          </div>
          ) : (
          /* ── Escena: consola de llamada (simulación real) ─────────────────── */
          <div className="flex min-h-0 flex-col gap-4">
            {/* Barra de llamada, igual que en la corrida real */}
            <div className="surface-card flex h-14 shrink-0 items-center justify-between rounded-full px-5">
              <div className="flex items-center gap-3">
                <span className="relative flex h-2.5 w-2.5">
                  {live && !reduce && (
                    <motion.span
                      aria-hidden
                      className="absolute inline-flex h-full w-full rounded-full bg-brand-green"
                      animate={{ scale: [1, 2.4], opacity: [0.5, 0] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                    />
                  )}
                  <span className={cn(
                    'relative inline-flex h-2.5 w-2.5 rounded-full',
                    live ? 'bg-brand-green shadow-[0_0_10px_rgba(0,213,98,0.55)]' : 'bg-text-subtle',
                  )} />
                </span>
                <span className="text-[12px] uppercase tracking-wider text-text-muted">
                  {live ? t('admin.simulations.preview.on_call') : t('admin.simulations.preview.call_over')}
                </span>
                <span className="mx-1 hidden h-4 w-px bg-line sm:inline" />
                <CallTimer
                  startedAt={runStartedAt}
                  endedAt={runEndedAt}
                  className="hidden font-mono text-[14px] tabular-nums text-text sm:inline"
                />
                <span className={cn(chip, 'hidden md:inline-flex')}>
                  {stepLabel(frame.nodeId)}
                </span>
              </div>
              <button
                onClick={hangUp}
                disabled={!live}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-danger/30 bg-danger/10 px-3.5 text-[12px] font-medium text-danger transition-colors hover:bg-danger/15 disabled:opacity-40"
              >
                <PhoneOff className="h-3.5 w-3.5" />
                {t('admin.simulations.preview.hang_up')}
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
              {callScenario && (
                <div className="hidden lg:block">
                  <CustomerPanel scenario={callScenario} language={lang} live={live} />
                </div>
              )}
              <div className="flex min-h-0 flex-col gap-3">
                {callScenario && (
                  <ChatTranscript
                    scenario={callScenario}
                    isTyping={typing}
                    messages={frame.messages
                      .filter((m) => m.from !== 'system')
                      .map((m, i) => ({
                        id: m.id,
                        from: m.from === 'client' ? ('customer' as const) : ('agent' as const),
                        text: m.text,
                        at: i,
                      }))}
                  />
                )}
                {/* Los avisos del ensayo (ruta rota, sin respaldo) NO son parte de
                    la llamada: van fuera de la transcripción. */}
                {frame.messages.filter((m) => m.from === 'system').slice(-1).map((m) => (
                  <p key={m.id} className="rounded-2xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[12.5px] leading-relaxed text-danger">
                    {m.text}
                  </p>
                ))}
                <AgentInput onSend={sendText} disabled={!live || typing} />
              </div>
            </div>
          </div>
          )}

          {/* Panel derecho */}
          <div className="flex min-h-0 flex-col">
            {/* Métricas + pestañas */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className={chip}>
                <MessageSquare className="h-3 w-3" />
                {type === 'choice'
                  ? t('admin.simulations.preview.decision_n', { n: frame.steps })
                  : t('admin.simulations.preview.turn_n', { n: frame.steps, max: meta.maxTurns ?? '∞' })}
              </span>
              {type === 'choice' && maxPoints > 0 && (
                <span className={chip}>
                  <ShieldCheck className="h-3 w-3" />
                  {frame.points} / {maxPoints} pts · {scorePct}%
                </span>
              )}
              {type === 'dialogue' && checklist.length > 0 && (
                <span className={chip}>
                  <ListChecks className="h-3 w-3" />
                  {frame.done.length} / {checklist.length}
                </span>
              )}
              <div className="ml-auto flex items-center gap-0.5 rounded-full border border-line bg-surface p-0.5">
                {([
                  ['play', t('admin.simulations.preview.tab_play'), 0],
                  ['review', t('admin.simulations.preview.tab_review'), issues.length],
                  ['path', t('admin.simulations.preview.tab_path'), 0],
                ] as const).map(([key, label, count]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={cn(
                      'relative rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
                      tab === key ? 'text-text' : 'text-text-subtle hover:text-text-muted',
                    )}
                  >
                    {tab === key && (
                      <motion.span layoutId="preview-tab" className="absolute inset-0 rounded-full bg-subtle" transition={spring} />
                    )}
                    <span className="relative inline-flex items-center gap-1.5">
                      {label}
                      {count > 0 && (
                        <span className={cn(
                          'rounded-full px-1.5 text-[10px] font-semibold',
                          errorCount > 0 ? 'bg-danger/15 text-danger' : 'bg-amber-400/20 text-amber-500',
                        )}>
                          {count}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 lg:overflow-y-auto lg:pr-1">
              {/* ── Jugar ──────────────────────────────────────────────────── */}
              {tab === 'play' && (
                <div className="space-y-4">
                  {/* Resultado del ensayo */}
                  <AnimatePresence>
                    {frame.ending && (
                      <motion.div
                        key="ending"
                        initial={reduce ? undefined : { opacity: 0, y: 10, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        className="rounded-2xl border border-line bg-surface p-5"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                            style={{ background: `${endingTone[frame.ending.kind].color}22`, color: endingTone[frame.ending.kind].color }}
                          >
                            <CheckCircle2 className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[15px] font-semibold text-text">{endingTone[frame.ending.kind].label}</p>
                            {type === 'choice' && maxPoints > 0 && (
                              <p className="text-[12.5px] text-text-muted">
                                {t('admin.simulations.preview.final_score', { pct: scorePct, points: frame.points, max: maxPoints })}
                                {meta.passScore != null && (
                                  <span className={scorePct >= meta.passScore ? ' text-brand-green' : ' text-danger'}>
                                    {' '}· {t('admin.simulations.preview.pass_at', { n: meta.passScore })}
                                  </span>
                                )}
                              </p>
                            )}
                          </div>
                        </div>
                        {frame.ending.message && (
                          <p className="mt-3 text-[13px] leading-relaxed text-text-muted">{frame.ending.message}</p>
                        )}
                        {(frame.ending.kind === 'stuck' || frame.ending.kind === 'broken') && (
                          <p className="mt-3 rounded-xl border border-danger/25 bg-danger/8 px-3 py-2 text-[12px] leading-relaxed text-danger">
                            {t(`admin.simulations.preview.fix_${frame.ending.kind}`)}
                          </p>
                        )}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            onClick={() => restart()}
                            className="inline-flex items-center gap-1.5 rounded-full bg-brand-green px-4 py-2 text-[12.5px] font-semibold text-white dark:text-black"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> {t('admin.simulations.preview.try_again')}
                          </button>
                          {onGoToStep && frame.ending.nodeId && (
                            <button
                              onClick={() => goFix(frame.ending?.nodeId)}
                              className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12.5px] text-text-muted transition-colors hover:bg-subtle hover:text-text"
                            >
                              <PenLine className="h-3.5 w-3.5" />
                              {t('admin.simulations.preview.edit_step', { step: stepLabel(frame.ending.nodeId) })}
                            </button>
                          )}
                        </div>
                        {type === 'dialogue' && (
                          <p className="mt-3 text-[11px] leading-relaxed text-text-subtle">
                            {t('admin.simulations.preview.real_run_note')}
                          </p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Respuestas */}
                  {live && (
                    <div className="rounded-2xl border border-line bg-surface p-5">
                      <div className="mb-1 flex items-start justify-between gap-3">
                        <p className="text-[15px] font-bold text-text">
                          {type === 'choice'
                            ? t('admin.simulations.preview.your_response')
                            : stepLabel(frame.nodeId)}
                        </p>
                        {onGoToStep && (
                          <button
                            onClick={() => goFix(frame.nodeId)}
                            className="shrink-0 inline-flex items-center gap-1 text-[11.5px] text-text-subtle transition-colors hover:text-text"
                          >
                            <PenLine className="h-3 w-3" /> {t('admin.simulations.preview.edit_this_step')}
                          </button>
                        )}
                      </div>
                      {type === 'choice' && (
                        <p className="mb-4 text-[12.5px] text-text-muted">
                          {t('admin.simulations.preview.select_prompt')}
                        </p>
                      )}

                      <AnimatePresence>
                        {frame.lastNote && (
                          <motion.p
                            key={`note-${frames.length}`}
                            initial={reduce ? undefined : { opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="mb-4 rounded-xl border border-line bg-subtle px-3 py-2 text-[12px]"
                            style={{ color: frame.lastNote.tone === 'good' ? '#34c759' : frame.lastNote.tone === 'bad' ? '#ff453a' : '#0071e3' }}
                          >
                            {frame.lastNote.text}
                          </motion.p>
                        )}
                      </AnimatePresence>

                      {type === 'choice' ? (
                        options.length > 0 ? (
                          <div className="flex flex-col gap-2.5">
                            {options.map((opt, i) => (
                              <motion.button
                                key={i}
                                initial={reduce ? undefined : { opacity: 0, x: 16 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.07, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                                whileHover={reduce ? undefined : { scale: 1.01 }}
                                whileTap={reduce ? undefined : { scale: 0.985 }}
                                onClick={() => chooseOption(i)}
                                disabled={typing}
                                className="flex items-start gap-3 rounded-2xl border border-line bg-subtle p-4 text-left transition-colors hover:bg-line disabled:opacity-50"
                              >
                                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[#0071e3]/40 bg-[#0071e3]/20 text-[11px] font-bold text-[#0071e3]">
                                  {LETTERS[i]}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[13px] leading-[1.55] text-text">
                                    {opt.text?.[lang] || opt.text?.es || (
                                      <em className="text-text-subtle">{t('admin.simulations.preview.empty_option')}</em>
                                    )}
                                  </span>
                                  <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[10.5px] text-text-subtle">
                                    <span className="rounded-full bg-glass/10 px-1.5 py-0.5">
                                      {t('admin.simulations.preview.points_n', { n: opt.points ?? 0 })}
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                      <ArrowRight className="h-3 w-3" />
                                      {opt.nextId && nodes[opt.nextId]
                                        ? stepLabel(opt.nextId)
                                        : <span className="text-danger">{t('admin.simulations.preview.nowhere')}</span>}
                                    </span>
                                  </span>
                                </span>
                              </motion.button>
                            ))}
                          </div>
                        ) : (
                          <p className="rounded-xl border border-danger/25 bg-danger/8 px-3 py-2.5 text-[12.5px] text-danger">
                            {issueText('no_exits')}
                          </p>
                        )
                      ) : null}
                    </div>
                  )}

                  {/* Puntaje en vivo (opción múltiple) */}
                  {type === 'choice' && maxPoints > 0 && (
                    <div className="rounded-2xl border border-line bg-surface p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[12.5px] text-text-muted">{t('admin.simulations.preview.live_score')}</span>
                        <span className="text-[15px] font-bold text-text tabular-nums">{frame.points} / {maxPoints} pts</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-line">
                        <motion.div
                          className="h-full rounded-full bg-brand-green"
                          animate={{ width: `${scorePct}%` }}
                          transition={{ duration: reduce ? 0 : 0.45, ease: 'easeOut' }}
                        />
                      </div>
                      <p className="mt-1.5 text-right text-[11px] text-text-subtle">
                        {t('admin.simulations.preview.pct_of_best', { pct: scorePct })}
                      </p>
                    </div>
                  )}

                  {/* Lista de evaluación: el MISMO componente que ve el aprendiz. */}
                  {type === 'dialogue' && callScenario && checklist.length > 0 && (
                    <div>
                      <Checklist
                        scenario={callScenario}
                        language={lang}
                        completed={new Set(frame.done)}
                      />
                      {empathyKeywords.length > 0 && (
                        <p className="mt-2 text-[11px] text-text-subtle">
                          {t('admin.simulations.preview.empathy_n', { n: frame.empathy })}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Revisión ───────────────────────────────────────────────── */}
              {tab === 'review' && (
                <div className="space-y-2.5">
                  {issues.length === 0 ? (
                    <div className="rounded-2xl border border-brand-green/25 bg-brand-green/8 p-5">
                      <p className="flex items-center gap-2 text-[14px] font-semibold text-brand-green">
                        <ShieldCheck className="h-4.5 w-4.5" /> {t('admin.simulations.preview.all_good')}
                      </p>
                      <p className="mt-1 text-[12.5px] text-text-muted">{t('admin.simulations.preview.all_good_hint')}</p>
                    </div>
                  ) : (
                    issues.map((issue, i) => (
                      <motion.div
                        key={issue.id}
                        initial={reduce ? undefined : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                        className={cn(
                          'flex items-start gap-3 rounded-2xl border p-4',
                          issue.level === 'error'
                            ? 'border-danger/25 bg-danger/6'
                            : 'border-amber-400/25 bg-amber-400/6',
                        )}
                      >
                        <AlertTriangle
                          className={cn('mt-0.5 h-4 w-4 shrink-0', issue.level === 'error' ? 'text-danger' : 'text-amber-500')}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-text">
                            {issue.nodeId && (
                              <span className="text-text-muted">{stepLabel(issue.nodeId)} · </span>
                            )}
                            {issueText(issue.code)}
                          </p>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-text-muted">{issueHint(issue.code)}</p>
                        </div>
                        {onGoToStep && issue.nodeId && (
                          <button
                            onClick={() => goFix(issue.nodeId)}
                            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[11.5px] text-text-muted transition-colors hover:text-text"
                          >
                            <PenLine className="h-3 w-3" /> {t('admin.simulations.preview.fix')}
                          </button>
                        )}
                      </motion.div>
                    ))
                  )}
                </div>
              )}

              {/* ── Ruta ───────────────────────────────────────────────────── */}
              {tab === 'path' && (
                <div className="rounded-2xl border border-line bg-surface p-5">
                  <p className="flex items-center gap-2 text-[13px] font-medium text-text">
                    <Route className="h-4 w-4 text-brand-green" /> {t('admin.simulations.preview.path_title')}
                  </p>
                  <p className="mb-4 mt-1 text-[12px] text-text-muted">{t('admin.simulations.preview.path_hint')}</p>
                  <ol className="space-y-1.5">
                    {committedFrames.map((f, i) => {
                      const isCurrent = i === committedFrames.length - 1
                      const ending = isEndNode(nodes[f.nodeId], type)
                      return (
                        <li key={`${f.nodeId}-${i}`}>
                          <button
                            onClick={() => rewindTo(frames.indexOf(f))}
                            disabled={isCurrent}
                            className={cn(
                              'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[12.5px] transition-colors',
                              isCurrent
                                ? 'border-brand-green/40 bg-brand-green/8 text-text'
                                : 'border-line text-text-muted hover:bg-subtle hover:text-text',
                            )}
                          >
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-subtle text-[11px] font-semibold">
                              {i + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {stepLabel(f.nodeId)}
                              <span className="ml-1.5 text-text-subtle">
                                {(nodeText(nodes[f.nodeId], type, lang) || '').slice(0, 48)}
                              </span>
                            </span>
                            {ending && (
                              <span className="shrink-0 rounded-full bg-brand-magenta/12 px-2 py-0.5 text-[10px] text-brand-magenta">
                                {t('admin.simulations.end')}
                              </span>
                            )}
                            {!isCurrent && <RotateCcw className="h-3.5 w-3.5 shrink-0 opacity-60" />}
                          </button>
                        </li>
                      )
                    })}
                  </ol>

                  <p className="mt-5 text-[11.5px] text-text-subtle">
                    {t('admin.simulations.preview.coverage', {
                      seen: new Set(frame.path).size,
                      total: Object.keys(nodes).length,
                    })}
                  </p>
                  {/* Momentos que todavía no se han probado en este ensayo. */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.keys(nodes)
                      .filter((id) => !frame.path.includes(id))
                      .map((id) => (
                        <button
                          key={id}
                          onClick={() => onGoToStep && goFix(id)}
                          className={cn(
                            'rounded-full border border-line px-2.5 py-1 text-[11px] text-text-subtle',
                            onGoToStep && 'transition-colors hover:text-text',
                            exitsOf(nodes[id], type).length === 0 && !isEndNode(nodes[id], type) && 'border-danger/30 text-danger',
                          )}
                        >
                          {stepLabel(id)}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  )
}

export default SimulationPreviewModal
