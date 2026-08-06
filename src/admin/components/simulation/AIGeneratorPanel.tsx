import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, ChevronDown, BookOpen, AlertTriangle, CheckCircle2, RotateCcw, Clock, X, Wand2, Languages, FileText, Upload, Loader2, PhoneIncoming, PhoneOutgoing, Radar } from 'lucide-react'
import { GenerationProgress } from '@/admin/components/GenerationProgress'
import { ease, Stagger, StaggerItem, Magnetic } from '@/components/ui/motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import {
  SCENARIO_LENGTH_NODES, simDocNeedsCondense, estimateDocPages,
  type GeneratedDialogue, type GeneratedChoice, type GeneratedScenario,
  type ScenarioLength, type CallType,
} from '@/services/ai.service'
import { extractDocumentText, ACCEPTED_DOC_EXTENSIONS } from '@/lib/documentExtract'
import { useSimAiStore, SIM_CACHE_KEY, type SimAiInput } from '@/stores/simAiStore'
import { Button } from '@/components/ui/Button'
import { AiCreditsNotice, AiCreditsDot } from '@/components/ui/AiCreditsNotice'
import { AiQuotaNotice } from '@/components/ui/AiQuotaNotice'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { cn } from '@/lib/cn'
import i18n from '@/i18n'

function formatMs(ms: number) {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function useCacheTimer() {
  const [remaining, setRemaining] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const tick = () => {
      const stored = localStorage.getItem(SIM_CACHE_KEY)
      if (!stored) { setRemaining(0); return }
      const rem = Number(stored) - Date.now()
      if (rem <= 0) {
        setRemaining(0)
        localStorage.removeItem(SIM_CACHE_KEY)
        if (intervalRef.current) clearInterval(intervalRef.current)
      } else {
        setRemaining(rem)
      }
    }
    tick()
    intervalRef.current = setInterval(tick, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  return remaining
}

interface Module { id: string; title_es: string }

const CALL_TYPES = [
  { id: 'inbound' as const, Icon: PhoneIncoming },
  { id: 'outbound' as const, Icon: PhoneOutgoing },
  { id: 'auto' as const, Icon: Radar },
]

/**
 * Elegir entrante/saliente. Es la decisión que más cambia el guion (quién habla
 * primero, quién trae el problema, qué se evalúa), así que cada opción dice en una
 * línea qué significa y debajo se explica quién abre la llamada.
 */
function CallTypePicker({ value, onChange }: { value: CallType; onChange: (v: CallType) => void }) {
  return (
    <div>
      <label className="text-xs font-medium text-text-muted mb-1.5 block">
        {i18n.t('admin.simulations.ai_gen.call_type_label')}
      </label>

      <div className="grid gap-2 sm:grid-cols-3">
        {CALL_TYPES.map(({ id, Icon }) => {
          const active = value === id
          return (
            <motion.button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              aria-pressed={active}
              className={cn(
                'relative overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-colors',
                active ? 'border-neon-green/45' : 'border-glass-border/20 hover:border-glass-border/40',
              )}
            >
              {/* El resplandor viaja de una tarjeta a otra en vez de encenderse y apagarse. */}
              {active && (
                <motion.span
                  layoutId="call-type-glow"
                  className="absolute inset-0 bg-neon-green/10"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative flex items-center gap-2">
                <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-neon-green' : 'text-text-subtle')} />
                <span className={cn('text-xs font-medium', active ? 'text-text' : 'text-text-muted')}>
                  {i18n.t(`admin.simulations.ai_gen.call_type_${id}`)}
                </span>
              </span>
              <span className="relative mt-1 block text-[11px] leading-snug text-text-subtle">
                {i18n.t(`admin.simulations.ai_gen.call_type_${id}_who`)}
              </span>
            </motion.button>
          )
        })}
      </div>

      {/* Quién habla primero: lo que el capacitador necesita entender antes de generar. */}
      <div className="mt-2 overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={value}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease }}
            className="text-[11px] leading-relaxed text-text-subtle"
          >
            {i18n.t(`admin.simulations.ai_gen.call_type_${value}_first`)}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Insignia de qué tipo de llamada quedó (la elegida, o la que Claude detectó). */
function CallTypeBadge({ callType }: { callType: string }) {
  const outbound = callType === 'outbound'
  const Icon = outbound ? PhoneOutgoing : PhoneIncoming
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-medium border',
        outbound
          ? 'bg-brand-magenta/10 border-brand-magenta/25 text-brand-magenta'
          : 'bg-brand-green/10 border-brand-green/25 text-brand-green',
      )}
    >
      <Icon className="h-3 w-3" />
      {i18n.t(`admin.simulations.ai_gen.call_type_badge_${outbound ? 'outbound' : 'inbound'}`)}
    </motion.span>
  )
}

interface Props {
  type: 'dialogue' | 'choice'
  onApply: (generated: GeneratedDialogue | GeneratedChoice) => void
  defaultOpen?: boolean
  campaignId?: string | null
  /**
   * Escenario actual del editor. Si tiene contenido, se habilita "Mejorar con
   * IA": la IA pule y extiende lo que ya se armó (útil para simulaciones
   * hechas a mano). Si es null, solo se puede generar desde cero.
   */
  currentContent?: GeneratedScenario | null
}

export function AIGeneratorPanel({ type, onApply, defaultOpen = false, campaignId: campaignIdProp, currentContent }: Props) {
  const { campaignId: authCampaignId } = useAuth()
  const campaignId = campaignIdProp || authCampaignId
  const remaining = useCacheTimer()
  // La corrida NO vive en este componente: vive en el store global. Así el proceso
  // sigue aunque el capacitador se vaya a otra vista (igual que crear un curso con
  // IA), el indicador de abajo a la izquierda lo acompaña por todo el sitio y al
  // volver acá el resultado lo está esperando.
  //
  // La clave se fija en el primer render: al guardar, la URL pasa de `/new` a
  // `/:id` sin desmontar el editor y la corrida en vuelo no se puede perder.
  const [runKey] = useState(() => `${type}:${window.location.pathname}`)
  // Al volver a esta pantalla con una corrida viva (o con su resultado esperando),
  // el panel arranca abierto: es exactamente lo que se viene a buscar.
  const [open, setOpen] = useState<boolean>(() => defaultOpen || !!useSimAiStore.getState().runs[runKey])
  const [description, setDescription] = useState('')
  const [modules, setModules] = useState<Module[]>([])
  const [selectedModuleId, setSelectedModuleId] = useState('')
  // Media por defecto: 'long' son ~28 momentos y con un documento largo se iba hasta
  // los 7 minutos. Quien quiera el escenario más extenso lo elige a propósito.
  const [length, setLength] = useState<ScenarioLength>('medium')
  // Inbound/outbound cambia por completo quién abre la llamada y qué se evalúa. Por
  // defecto 'auto': con un guion cargado, Claude lo deduce mejor que una corazonada.
  const [callType, setCallType] = useState<CallType>('auto')
  // Por defecto la IA escribe solo en español: es bastante más rápido y el capacitador
  // primero quiere ver el escenario. La traducción se pide después con "Traducir".
  const [translateNow, setTranslateNow] = useState(false)
  // Documento de apoyo: se lee en el navegador (mismo extractor que "Generar
  // contenido") y viaja solo como contexto del prompt; no se guarda en la base.
  const [doc, setDoc] = useState<{ name: string; text: string } | null>(null)
  const [docReading, setDocReading] = useState<string | null>(null)
  const [docError, setDocError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const reduce = useReducedMotion()
  const canImprove = !!currentContent

  const run = useSimAiStore((s) => s.runs[runKey])
  const startRun = useSimAiStore((s) => s.start)
  const cancelRun = useSimAiStore((s) => s.cancel)
  const clearRun = useSimAiStore((s) => s.clear)

  const loading = run?.status === 'running'
  const preview = (run?.status === 'done' ? run.result : null) as GeneratedDialogue | GeneratedChoice | null
  const error = run?.status === 'error' ? run.error ?? null : null
  // Progreso REAL: los pasos se arman según lo que de verdad va a ocurrir y avanzan
  // con el proceso, en vez de correr un temporizador de mentiras.
  const runSteps = run?.steps ?? []
  const stepIdx = run?.stepIdx ?? 0
  const note = run?.note
  const subProgress = run?.subProgress
  const runTitle = run?.title ?? i18n.t('admin.simulations.ai_gen.title_generating')

  useEffect(() => {
    if (!campaignId) return
    supabase
      .from('modules')
      .select('id, title_es')
      .eq('campaign_id', campaignId)
      .eq('is_published', true)
      .order('sort_order')
      .then(({ data }) => setModules(data ?? []))
  }, [campaignId])

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    await readDoc(file)
  }

  /** Soltar el archivo sobre la zona: mismo camino que el selector. */
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    await readDoc(e.dataTransfer.files?.[0])
  }

  const readDoc = async (file: File | undefined) => {
    if (!file) return
    setDocError(null)
    setDocReading(file.name)
    try {
      // Solo texto: las figuras no aportan al guion y encarecen la petición.
      const extracted = await extractDocumentText(file)
      const text = extracted.text.trim()
      if (!text) {
        // Un PDF escaneado sí trae páginas rasterizadas, pero acá NO se usan: la
        // simulación viaja como texto (a diferencia de "Generar contenido", que sí
        // las lee con visión). Sin este caso el capacitador veía "No se pudo leer
        // el documento" y creía que el archivo estaba dañado.
        const scanned = extracted.kind === 'pdf' && extracted.contextImages.length > 0
        throw new Error(i18n.t(scanned
          ? 'admin.simulations.ai_gen.doc_scanned_pdf'
          : 'admin.simulations.ai_gen.doc_error'))
      }
      setDoc({ name: extracted.fileName, text })
    } catch (err) {
      setDoc(null)
      setDocError(err instanceof Error ? err.message : i18n.t('admin.simulations.ai_gen.doc_error'))
    } finally {
      setDocReading(null)
    }
  }

  const runAi = (mode: 'generate' | 'improve' | 'translate') => {
    // Con documento la descripción es opcional: el escenario puede salir del material.
    if (mode === 'generate' && !description.trim() && !doc) return
    if (mode !== 'generate' && !currentContent) return

    const input: SimAiInput = {
      type, mode, description,
      moduleId: selectedModuleId || undefined,
      doc,
      length, callType,
      translateNow,
      existing: mode === 'generate' ? null : currentContent,
      campaignId,
    }
    startRun(runKey, window.location.pathname, input)
  }

  const handleGenerate = () => runAi('generate')
  const handleImprove = () => runAi('improve')
  const handleTranslate = () => runAi('translate')

  /** Regenerar repite EXACTAMENTE la corrida anterior (con su documento y sus opciones). */
  const handleRegenerate = () => {
    if (!run) return
    startRun(runKey, run.returnPath, run.input)
  }

  const handleCancel = () => cancelRun(runKey)

  const handleApply = () => {
    if (preview) {
      onApply(preview)
      clearRun(runKey)
      setOpen(false)
    }
  }

  return (
    <motion.div
      layout={reduce ? false : 'position'}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={cn(
        'mb-6 rounded-2xl border overflow-hidden relative',
        open ? 'bg-neon-green/4 border-neon-green/20' : 'bg-glass/4 border-glass-border/10 hover:border-glass-border/20',
      )}
    >
      {/* Barra de vida: mientras la IA trabaja, el panel entero respira. */}
      <AnimatePresence>
        {loading && !reduce && (
          <motion.span
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-x-0 top-0 h-px overflow-hidden"
          >
            <motion.span
              className="block h-px w-1/3 bg-gradient-to-r from-transparent via-neon-green to-transparent"
              animate={{ x: ['-100%', '400%'] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
            />
          </motion.span>
        )}
      </AnimatePresence>

      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-5 py-3.5 text-left">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <motion.span
            className="relative shrink-0"
            animate={loading && !reduce ? { rotate: [0, 12, -8, 0], scale: [1, 1.12, 1] } : { rotate: 0, scale: 1 }}
            transition={loading ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
          >
            <Sparkles className="h-4 w-4 text-neon-green" />
            <AiCreditsDot className="absolute -top-1 -right-1" />
          </motion.span>
          <span className="text-sm font-medium text-text">{i18n.t('admin.simulations.ai_gen.generate_ai')}</span>
          <span className="text-xs text-text-subtle truncate">
            {i18n.t(doc ? 'admin.simulations.ai_gen.generate_ai_sub_doc' : 'admin.simulations.ai_gen.generate_ai_sub')}
          </span>
        </div>
        <AnimatePresence>
          {remaining > 0 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-green/8 border border-brand-green/20 text-brand-green text-[10px] font-medium shrink-0"
            >
              <Clock className="h-3 w-3" />
              {formatMs(remaining)}
            </motion.div>
          )}
        </AnimatePresence>
        {/* Un solo chevron que gira: cambiar de icono se sentía como un salto. */}
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.3, ease }} className="shrink-0">
          <ChevronDown className="h-4 w-4 text-text-muted" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="body"
          initial={reduce ? undefined : { height: 0, opacity: 0 }}
          animate={reduce ? undefined : { height: 'auto', opacity: 1 }}
          exit={reduce ? undefined : { height: 0, opacity: 0 }}
          transition={{ duration: 0.38, ease }}
          className="overflow-hidden"
        >
        <Stagger gap={0.05} className="px-5 pb-5 space-y-4 border-t border-glass-border/10">
          <AiCreditsNotice className="mt-4" />
          <AiQuotaNotice className="mt-4" />
          <AiReviewNotice className="mt-4" />
          <StaggerItem className="pt-4">
            <label className="text-xs font-medium text-text-muted mb-1.5 block">
              {i18n.t('admin.simulations.ai_gen.what_scenario_about')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={i18n.t('admin.simulations.ai_gen.ph_prompt')}
              rows={3}
              className="w-full glass border border-glass-border/20 rounded-xl px-3 py-2.5 text-sm text-text bg-transparent resize-none focus:outline-none focus:border-neon-green/40 placeholder:text-text-subtle"
            />
            <p className="text-[11px] text-text-subtle mt-1">{i18n.t('admin.simulations.ai_gen.prompt_hint')}</p>
          </StaggerItem>

          <StaggerItem>
            <CallTypePicker value={callType} onChange={setCallType} />
          </StaggerItem>

          {/* Extensión: la IA se quedaba en el mínimo y salían escenarios de 4 pasos. */}
          <StaggerItem>
            <label className="text-xs font-medium text-text-muted mb-1.5 block">
              {i18n.t('admin.simulations.ai_gen.length_label')}
            </label>
            <div className="flex gap-1 p-0.5 rounded-xl glass w-fit">
              {(['short', 'medium', 'long'] as ScenarioLength[]).map((l) => (
                <motion.button
                  key={l}
                  onClick={() => setLength(l)}
                  whileTap={reduce ? undefined : { scale: 0.96 }}
                  className={cn(
                    'relative px-3 py-2 rounded-lg text-[11px] font-medium transition-colors',
                    length === l ? 'text-neon-green' : 'text-text-subtle hover:text-text-muted',
                  )}
                >
                  {/* La píldora se DESLIZA entre opciones en vez de saltar. */}
                  {length === l && (
                    <motion.span
                      layoutId="sim-length-pill"
                      className="absolute inset-0 rounded-lg bg-neon-green/12"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative block">
                    {i18n.t(`admin.simulations.ai_gen.length_${l}`)}
                    <span className="ml-1 text-[10px] opacity-70">~{SCENARIO_LENGTH_NODES[l]}</span>
                    {/* El tiempo esperado va junto a la opción: es la mitad de la decisión. */}
                    <span className="block text-[10px] opacity-60 tabular-nums">
                      {i18n.t(`admin.simulations.ai_gen.length_eta_${l}`)}
                    </span>
                  </span>
                </motion.button>
              ))}
            </div>
            <p className="text-[11px] text-text-subtle mt-1">{i18n.t('admin.simulations.ai_gen.length_hint')}</p>
            <AnimatePresence>
              {doc && length === 'long' && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="text-[11px] text-brand-violet/90 mt-1 leading-relaxed overflow-hidden"
                >
                  {i18n.t('admin.simulations.ai_gen.length_eta_doc')}
                </motion.p>
              )}
            </AnimatePresence>
          </StaggerItem>

          {/* Idiomas: por defecto solo español; traducir después es más rápido y evita rehacer. */}
          <StaggerItem>
            <button
              type="button"
              onClick={() => setTranslateNow((v) => !v)}
              aria-pressed={translateNow}
              className="flex items-start gap-2.5 text-left w-full group"
            >
              {/* Interruptor real: el check nativo se veía de formulario de 2005. */}
              <span
                className={cn(
                  'mt-0.5 relative h-5 w-9 shrink-0 rounded-full border transition-colors',
                  translateNow ? 'bg-brand-green/25 border-brand-green/50' : 'bg-glass/10 border-glass-border/25',
                )}
              >
                <motion.span
                  layout
                  transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                  className={cn(
                    'absolute top-[2px] h-3.5 w-3.5 rounded-full',
                    translateNow ? 'left-[18px] bg-brand-green' : 'left-[2px] bg-text-subtle',
                  )}
                />
              </span>
              <span className="text-xs text-text-muted">
                {i18n.t('admin.simulations.ai_gen.translate_now')}
                <span className="block text-[11px] text-text-subtle mt-0.5">
                  {i18n.t('admin.simulations.ai_gen.translate_now_hint')}
                </span>
              </span>
            </button>
          </StaggerItem>

          {/* Documento de apoyo: lo que hace que la simulación se sienta del negocio
              real (banca, seguros, telco) y no una llamada de call center genérica. */}
          <StaggerItem>
            <label className="text-xs font-medium text-text-muted mb-1.5 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              {i18n.t('admin.simulations.ai_gen.doc_label')} <span className="text-text-subtle font-normal">{i18n.t('admin.simulations.ai_gen.optional')}</span>
            </label>
            <input ref={fileRef} type="file" accept={ACCEPTED_DOC_EXTENSIONS} className="hidden" onChange={handleFile} />

            {/* Los tres estados (vacío / leyendo / listo) se relevan con transición:
                antes el bloque cambiaba de golpe y parecía un parpadeo. */}
            <AnimatePresence mode="wait" initial={false}>
              {docReading ? (
                <motion.div
                  key="reading"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.24, ease }}
                  className="flex items-center gap-2 rounded-xl glass border border-glass-border/20 px-3 py-2.5 text-xs text-text-muted"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-neon-green" />
                  {i18n.t('admin.simulations.ai_gen.doc_reading', { name: docReading })}
                </motion.div>
              ) : doc ? (
                <motion.div
                  key="ready"
                  initial={{ opacity: 0, y: 6, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  className="rounded-xl glass border border-neon-green/25 px-3 py-2.5 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-neon-green shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-text font-medium truncate">{doc.name}</p>
                      <p className="text-[11px] text-text-subtle">
                        {i18n.t('admin.simulations.ai_gen.doc_ready', { pages: estimateDocPages(doc.text) })}
                      </p>
                    </div>
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="text-[11px] text-text-muted hover:text-text px-2 py-1 rounded-lg hover:bg-glass/8 transition-colors"
                    >
                      {i18n.t('admin.simulations.ai_gen.doc_replace')}
                    </button>
                    <motion.button
                      onClick={() => setDoc(null)}
                      whileHover={reduce ? undefined : { rotate: 90 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                      aria-label={i18n.t('admin.simulations.ai_gen.doc_remove')}
                      className="text-text-subtle hover:text-danger p-1 rounded-lg hover:bg-glass/8 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </motion.button>
                  </div>
                  {simDocNeedsCondense(doc.text) && (
                    <p className="text-[11px] text-text-subtle leading-relaxed border-t border-glass-border/10 pt-2">
                      {i18n.t('admin.simulations.ai_gen.doc_long_notice')}
                    </p>
                  )}
                </motion.div>
              ) : (
                <motion.button
                  key="empty"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => fileRef.current?.click()}
                  // Soltar el archivo encima también funciona: es lo primero que
                  // intenta cualquiera con un manual abierto en el escritorio.
                  onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-4 text-xs transition-colors',
                    dragging
                      ? 'border-neon-green/60 bg-neon-green/8 text-neon-green'
                      : 'border-glass-border/30 text-text-muted hover:text-text hover:border-neon-green/40',
                  )}
                >
                  <motion.span
                    animate={dragging && !reduce ? { y: [-2, 2, -2] } : { y: 0 }}
                    transition={dragging ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </motion.span>
                  {i18n.t(dragging ? 'admin.simulations.ai_gen.doc_drop' : 'admin.simulations.ai_gen.doc_upload')}
                </motion.button>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {docError && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="text-[11px] text-danger mt-1.5 leading-relaxed overflow-hidden"
                >
                  {docError}
                </motion.p>
              )}
            </AnimatePresence>
            <p className="text-[11px] text-text-subtle mt-1 leading-relaxed">
              {i18n.t('admin.simulations.ai_gen.doc_hint')}
            </p>
          </StaggerItem>

          {modules.length > 0 && (
            <StaggerItem>
              <label className="text-xs font-medium text-text-muted mb-1.5 flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5" />
                {i18n.t('admin.simulations.ai_gen.base_on_module')} <span className="text-text-subtle font-normal">{i18n.t('admin.simulations.ai_gen.optional')}</span>
              </label>
              <FilterDropdown
                value={selectedModuleId}
                onChange={setSelectedModuleId}
                options={[
                  { value: '', label: i18n.t('admin.simulations.ai_gen.no_module_option') },
                  ...modules.map((m) => ({ value: m.id, label: m.title_es })),
                ]}
              />
            </StaggerItem>
          )}

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.28, ease }}
                className="overflow-hidden"
              >
                <div className="flex items-start gap-2 text-sm text-danger p-3 rounded-xl bg-danger/8 border border-danger/20">
                  <motion.span
                    initial={reduce ? undefined : { rotate: -12 }}
                    animate={{ rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 12 }}
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  </motion.span>
                  <span>{error}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <GenerationProgress
            steps={runSteps}
            active={loading}
            stepIndex={stepIdx}
            note={note}
            subProgress={subProgress}
            title={runTitle}
            // La espera se anuncia desde el principio; el aviso tardío suena a excusa.
            hint={i18n.t(`admin.simulations.ai_gen.length_eta_${length}`) + (doc ? ` · ${i18n.t('admin.simulations.ai_gen.length_eta_doc')}` : '')}
          />

          <AnimatePresence>
            {loading && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                {/* Irse de la pantalla ya no cancela nada: hay que decirlo. */}
                <p className="text-[11px] leading-relaxed text-text-subtle flex-1 min-w-[12rem]">
                  {i18n.t('admin.simulations.ai_gen.bg_hint')}
                </p>
                <button
                  onClick={handleCancel}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-glass-border/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:border-glass-border/40 transition-colors"
                >
                  <X className="h-3.5 w-3.5" /> {i18n.t('bgtask.cancel')}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait" initial={false}>
            {preview && !loading ? (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              >
                <PreviewBox generated={preview} type={type} onApply={handleApply} onRegenerate={handleRegenerate} />
              </motion.div>
            ) : !loading ? (
              <motion.div
                key="actions"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease }}
              >
                <div className="flex flex-wrap justify-end gap-2">
                  {canImprove && (
                    <Button onClick={handleTranslate} variant="ghost" size="sm">
                      <Languages className="h-4 w-4" /> {i18n.t('admin.simulations.ai_gen.translate_current')}
                    </Button>
                  )}
                  {canImprove && (
                    <Button onClick={handleImprove} variant="secondary" size="sm">
                      <Wand2 className="h-4 w-4" /> {i18n.t('admin.simulations.ai_gen.improve_current')}
                    </Button>
                  )}
                  {/* La acción principal se imanta al cursor: es la que queremos que se toque. */}
                  <Magnetic strength={0.25}>
                    <Button onClick={handleGenerate} disabled={!description.trim() && !doc} size="sm">
                      <Sparkles className="h-4 w-4" /> {i18n.t('admin.simulations.ai_gen.generate_scenario')}
                    </Button>
                  </Magnetic>
                </div>
                {canImprove && (
                  <div className="text-[11px] text-text-subtle text-right mt-1.5 space-y-0.5">
                    <p>{i18n.t('admin.simulations.ai_gen.improve_hint')}</p>
                    <p>{i18n.t('admin.simulations.ai_gen.translate_hint')}</p>
                  </div>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </Stagger>
        </motion.div>
      )}
      </AnimatePresence>
    </motion.div>
  )
}

function PreviewBox({
  generated, type, onApply, onRegenerate,
}: {
  generated: GeneratedDialogue | GeneratedChoice
  type: 'dialogue' | 'choice'
  onApply: () => void
  onRegenerate: () => void
}) {
  const { metadata, nodes } = generated
  const nodeEntries = Object.entries(nodes as Record<string, Record<string, unknown>>)
  const meta = metadata as unknown as Record<string, unknown>

  const reduce = useReducedMotion()

  return (
    <div className="relative bg-glass/6 border border-neon-green/20 rounded-xl p-4 space-y-4 overflow-hidden">
      {/* Un barrido de luz que cruza la tarjeta una sola vez: celebra el resultado
          sin convertirse en un adorno permanente. */}
      {!reduce && (
        <motion.span
          aria-hidden
          initial={{ x: '-120%' }}
          animate={{ x: '120%' }}
          transition={{ duration: 1.1, ease, delay: 0.15 }}
          className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-neon-green/8 to-transparent"
        />
      )}

      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <motion.span
            initial={reduce ? undefined : { scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          >
            <CheckCircle2 className="h-4 w-4 text-brand-green" />
          </motion.span>
          <span className="text-sm font-medium text-text">{i18n.t('admin.simulations.ai_gen.scenario_generated')}</span>
          {/* Con "Detectar sola" esto es la respuesta: qué decidió Claude leyendo el guion. */}
          {typeof meta.call_type === 'string' && <CallTypeBadge callType={meta.call_type} />}
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            onClick={onRegenerate}
            whileHover={reduce ? undefined : { rotate: -180 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            aria-label="Regenerar"
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors p-1.5 rounded-lg hover:bg-glass/8"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </motion.button>
          <Magnetic strength={0.25}>
            <Button size="sm" onClick={onApply}>{i18n.t('admin.simulations.ai_gen.load_in_editor')}</Button>
          </Magnetic>
        </div>
      </div>

      <div className="relative grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <div>
          <div className="text-text-subtle mb-0.5">{i18n.t('admin.simulations.ai_gen.field_title')}</div>
          <div className="text-text font-medium">{String(meta.title_es ?? '')}</div>
        </div>
        {type === 'dialogue' && (
          <>
            <div>
              <div className="text-text-subtle mb-0.5">{i18n.t('admin.simulations.ai_gen.client_country')}</div>
              <div className="text-text">{String(meta.customer_name ?? '')} · {String(meta.country ?? '')}</div>
            </div>
            <div>
              <div className="text-text-subtle mb-0.5">{i18n.t('admin.simulations.ai_gen.difficulty')}</div>
              <div className="text-text">{String(meta.difficulty ?? '')}/3</div>
            </div>
            <div>
              <div className="text-text-subtle mb-0.5">{i18n.t('admin.simulations.ai_gen.call_reason')}</div>
              <div className="text-text truncate">{String(meta.customer_reason_es ?? '')}</div>
            </div>
          </>
        )}
        {type === 'choice' && (
          <div>
            <div className="text-text-subtle mb-0.5">{i18n.t('admin.simulations.ai_gen.level')}</div>
            <div className="text-text">{String(meta.level ?? '')}</div>
          </div>
        )}
        <div>
          <div className="text-text-subtle mb-0.5">{i18n.t('admin.simulations.ai_gen.steps')}</div>
          <div className="text-text">{i18n.t('admin.simulations.ai_gen_moments', { count: nodeEntries.length })}</div>
        </div>
      </div>

      <div className="relative">
        <div className="text-[11px] font-medium text-text-subtle uppercase tracking-wide mb-2">{i18n.t('admin.simulations.ai_gen.conversation_flow')}</div>
        {/* El flujo se revela momento a momento: se lee como una conversación que
            se va armando, no como un volcado de datos. */}
        <Stagger gap={0.035} className="space-y-2 max-h-52 overflow-y-auto pr-1">
          {nodeEntries.map(([nid, node]) => {
            const line = type === 'dialogue'
              ? String((node.customerLine as Record<string, string>)?.es ?? '')
              : String((node.message as Record<string, string>)?.es ?? '')
            const isStart = nid === generated.start_node_id
            const isTerminal = Boolean(node.terminal || node.isEnd)
            return (
              <StaggerItem key={nid} className="flex items-start gap-2 text-xs">
                <span className={cn(
                  'shrink-0 w-1.5 h-1.5 rounded-full mt-[5px]',
                  isStart ? 'bg-brand-green' : isTerminal ? 'bg-brand-magenta' : 'bg-glass-border/40',
                )} />
                <div className="min-w-0">
                  <span className="font-mono text-[10px] text-text-subtle">{nid}</span>
                  {line && (
                    <p className="text-text-muted mt-0.5 leading-snug">
                      "{line.slice(0, 90)}{line.length > 90 ? '…' : ''}"
                    </p>
                  )}
                </div>
              </StaggerItem>
            )
          })}
        </Stagger>
        <div className="flex gap-4 mt-2 text-[10px] text-text-subtle">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-green inline-block" /> Inicio
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-magenta inline-block" /> Final
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-glass-border/40 inline-block" /> Paso intermedio
          </span>
        </div>
      </div>
    </div>
  )
}
