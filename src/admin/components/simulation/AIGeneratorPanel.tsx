import { useState, useEffect, useRef, useCallback } from 'react'
import { Sparkles, ChevronDown, ChevronUp, BookOpen, AlertTriangle, CheckCircle2, RotateCcw, Clock, X, Wand2, Languages, FileText, Upload, Loader2 } from 'lucide-react'
import {
  GenerationProgress, type GenerationStep,
  SIM_STEP_READ_MODULE, SIM_STEP_CONDENSE_DOC, SIM_STEP_WRITE, SIM_STEP_IMPROVE, SIM_STEP_TRANSLATE, SIM_STEP_FINALIZE,
} from '@/admin/components/GenerationProgress'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import {
  generateSimulation, translateScenario, getModuleContextText, SCENARIO_LENGTH_NODES,
  simDocNeedsCondense, estimateDocPages,
  type CacheUsage, type GeneratedDialogue, type GeneratedChoice, type GeneratedScenario,
  type ScenarioLength, type SimProgress,
} from '@/services/ai.service'
import { extractDocumentText, ACCEPTED_DOC_EXTENSIONS } from '@/lib/documentExtract'
import { Button } from '@/components/ui/Button'
import { AiCreditsNotice, AiCreditsDot } from '@/components/ui/AiCreditsNotice'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { cn } from '@/lib/cn'
import i18n from '@/i18n'

const SIM_CACHE_KEY = 'ai_sim_cache_expires'
const CACHE_DURATION_MS = 5 * 60 * 1000

function formatMs(ms: number) {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function useCacheTimer() {
  const [remaining, setRemaining] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const notifyCache = useCallback((usage: CacheUsage) => {
    if (usage.cache_creation_input_tokens > 0) {
      localStorage.setItem(SIM_CACHE_KEY, String(Date.now() + CACHE_DURATION_MS))
    }
  }, [])

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

  return { remaining, notifyCache }
}

interface Module { id: string; title_es: string }

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
  const { remaining, notifyCache } = useCacheTimer()
  const [open, setOpen] = useState(defaultOpen)
  const [description, setDescription] = useState('')
  const [modules, setModules] = useState<Module[]>([])
  const [selectedModuleId, setSelectedModuleId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<GeneratedDialogue | GeneratedChoice | null>(null)
  const [length, setLength] = useState<ScenarioLength>('long')
  // Por defecto la IA escribe solo en español: es bastante más rápido y el capacitador
  // primero quiere ver el escenario. La traducción se pide después con "Traducir".
  const [translateNow, setTranslateNow] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // Documento de apoyo: se lee en el navegador (mismo extractor que "Generar
  // contenido") y viaja solo como contexto del prompt; no se guarda en la base.
  const [doc, setDoc] = useState<{ name: string; text: string } | null>(null)
  const [docReading, setDocReading] = useState<string | null>(null)
  const [docError, setDocError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Recuerda si el último preview vino de "Generar" o "Mejorar" para que
  // Regenerar repita la misma acción.
  const lastModeRef = useRef<'generate' | 'improve'>('generate')
  const canImprove = !!currentContent

  // Progreso REAL: los pasos se arman según lo que de verdad va a ocurrir y avanzan
  // con el proceso, en vez de correr un temporizador de mentiras.
  const [runSteps, setRunSteps] = useState<GenerationStep[]>([])
  const [stepIdx, setStepIdx] = useState(0)
  const [note, setNote] = useState<string | undefined>()
  const [runTitle, setRunTitle] = useState<string>(i18n.t('admin.simulations.ai_gen.title_generating'))

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
    if (!file) return
    setDocError(null)
    setDocReading(file.name)
    try {
      // Solo texto: las figuras no aportan al guion y encarecen la petición.
      const extracted = await extractDocumentText(file)
      const text = extracted.text.trim()
      if (!text) throw new Error(i18n.t('admin.simulations.ai_gen.doc_error'))
      setDoc({ name: extracted.fileName, text })
    } catch (err) {
      setDoc(null)
      setDocError(err instanceof Error ? err.message : i18n.t('admin.simulations.ai_gen.doc_error'))
    } finally {
      setDocReading(null)
    }
  }

  const runAi = async (mode: 'generate' | 'improve' | 'translate') => {
    // Con documento la descripción es opcional: el escenario puede salir del material.
    if (mode === 'generate' && !description.trim() && !doc) return
    if (mode !== 'generate' && !currentContent) return
    if (mode !== 'translate') lastModeRef.current = mode

    // Pasos reales de ESTA corrida.
    const usesModule = mode !== 'translate' && !!selectedModuleId
    const usesDoc = mode !== 'translate' && !!doc
    const condenses = usesDoc && simDocNeedsCondense(doc!.text)
    const willTranslate = mode === 'translate' || translateNow
    const steps: GenerationStep[] = []
    if (usesModule) steps.push(SIM_STEP_READ_MODULE)
    if (condenses) steps.push(SIM_STEP_CONDENSE_DOC)
    if (mode !== 'translate') steps.push(mode === 'improve' ? SIM_STEP_IMPROVE : SIM_STEP_WRITE)
    if (willTranslate) steps.push(SIM_STEP_TRANSLATE)
    steps.push(SIM_STEP_FINALIZE)
    const idxOf = (s: GenerationStep) => steps.indexOf(s)

    const controller = new AbortController()
    abortRef.current = controller
    setRunSteps(steps)
    setStepIdx(0)
    setNote(undefined)
    setRunTitle(i18n.t(mode === 'translate'
      ? 'admin.simulations.ai_gen.title_translating'
      : 'admin.simulations.ai_gen.title_generating'))
    setLoading(true)
    setError(null)
    setPreview(null)

    const onProgress = (p: SimProgress) => {
      const step = p.stage === 'translating' ? SIM_STEP_TRANSLATE
        : p.stage === 'document' ? SIM_STEP_CONDENSE_DOC
        : mode === 'improve' ? SIM_STEP_IMPROVE : SIM_STEP_WRITE
      const i = idxOf(step)
      if (i >= 0) setStepIdx(i)
      setNote(p.detail)
    }

    try {
      let moduleContext: string | undefined
      if (usesModule) {
        setNote(i18n.t('admin.simulations.ai_gen.note_reading_module'))
        moduleContext = await getModuleContextText(selectedModuleId)
        setStepIdx(idxOf(SIM_STEP_READ_MODULE) + 1)
      }

      if (mode === 'translate') {
        const translated = await translateScenario(currentContent!, controller.signal, onProgress)
        setStepIdx(steps.length - 1)
        setPreview(translated as GeneratedDialogue | GeneratedChoice)
      } else {
        const result = await generateSimulation({
          type,
          description,
          moduleContext,
          documentContext: usesDoc ? doc!.text : undefined,
          documentName: usesDoc ? doc!.name : undefined,
          length,
          translate: translateNow,
          existing: mode === 'improve' ? currentContent ?? undefined : undefined,
        }, controller.signal, onProgress)
        setStepIdx(steps.length - 1)
        setPreview(result.data)
        notifyCache(result.usage)
      }
    } catch (e) {
      // Cancelación del usuario: no es un error, se descarta en silencio.
      if (controller.signal.aborted || (e as Error)?.name === 'AbortError') return
      setError((e as Error).message)
    } finally {
      abortRef.current = null
      setLoading(false)
      setNote(undefined)
    }
  }

  const handleGenerate = () => runAi('generate')
  const handleImprove = () => runAi('improve')
  const handleTranslate = () => runAi('translate')
  const handleRegenerate = () => runAi(lastModeRef.current)

  const handleCancel = () => abortRef.current?.abort()

  const handleApply = () => {
    if (preview) {
      onApply(preview)
      setPreview(null)
      setOpen(false)
    }
  }

  return (
    <div className={cn(
      'mb-6 rounded-2xl border transition-all overflow-hidden',
      open ? 'bg-neon-green/4 border-neon-green/20' : 'bg-glass/4 border-glass-border/10 hover:border-glass-border/20',
    )}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-5 py-3.5 text-left">
        <div className="flex items-center gap-2 flex-1">
          <span className="relative shrink-0">
            <Sparkles className="h-4 w-4 text-neon-green" />
            <AiCreditsDot className="absolute -top-1 -right-1" />
          </span>
          <span className="text-sm font-medium text-text">{i18n.t('admin.simulations.ai_gen.generate_ai')}</span>
          <span className="text-xs text-text-subtle">
            {i18n.t(doc ? 'admin.simulations.ai_gen.generate_ai_sub_doc' : 'admin.simulations.ai_gen.generate_ai_sub')}
          </span>
        </div>
        {remaining > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-green/8 border border-brand-green/20 text-brand-green text-[10px] font-medium">
            <Clock className="h-3 w-3" />
            {formatMs(remaining)}
          </div>
        )}
        {open ? <ChevronUp className="h-4 w-4 text-text-muted" /> : <ChevronDown className="h-4 w-4 text-text-muted" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-glass-border/10">
          <AiCreditsNotice className="mt-4" />
          <div className="pt-4">
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
          </div>

          {/* Extensión: la IA se quedaba en el mínimo y salían escenarios de 4 pasos. */}
          <div>
            <label className="text-xs font-medium text-text-muted mb-1.5 block">
              {i18n.t('admin.simulations.ai_gen.length_label')}
            </label>
            <div className="flex gap-1 p-0.5 rounded-xl glass w-fit">
              {(['short', 'medium', 'long'] as ScenarioLength[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLength(l)}
                  className={cn(
                    'px-3 py-2 rounded-lg text-[11px] font-medium transition-colors',
                    length === l ? 'bg-neon-green/12 text-neon-green' : 'text-text-subtle hover:text-text-muted',
                  )}
                >
                  {i18n.t(`admin.simulations.ai_gen.length_${l}`)}
                  <span className="ml-1 text-[10px] opacity-70">~{SCENARIO_LENGTH_NODES[l]}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-text-subtle mt-1">{i18n.t('admin.simulations.ai_gen.length_hint')}</p>
          </div>

          {/* Idiomas: por defecto solo español; traducir después es más rápido y evita rehacer. */}
          <div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={translateNow}
                onChange={(e) => setTranslateNow(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand-green"
              />
              <span className="text-xs text-text-muted">
                {i18n.t('admin.simulations.ai_gen.translate_now')}
                <span className="block text-[11px] text-text-subtle mt-0.5">
                  {i18n.t('admin.simulations.ai_gen.translate_now_hint')}
                </span>
              </span>
            </label>
          </div>

          {/* Documento de apoyo: lo que hace que la simulación se sienta del negocio
              real (banca, seguros, telco) y no una llamada de call center genérica. */}
          <div>
            <label className="text-xs font-medium text-text-muted mb-1.5 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              {i18n.t('admin.simulations.ai_gen.doc_label')} <span className="text-text-subtle font-normal">{i18n.t('admin.simulations.ai_gen.optional')}</span>
            </label>
            <input ref={fileRef} type="file" accept={ACCEPTED_DOC_EXTENSIONS} className="hidden" onChange={handleFile} />

            {docReading ? (
              <div className="flex items-center gap-2 rounded-xl glass border border-glass-border/20 px-3 py-2.5 text-xs text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-neon-green" />
                {i18n.t('admin.simulations.ai_gen.doc_reading', { name: docReading })}
              </div>
            ) : doc ? (
              <div className="rounded-xl glass border border-neon-green/25 px-3 py-2.5 space-y-2">
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
                  <button
                    onClick={() => setDoc(null)}
                    aria-label={i18n.t('admin.simulations.ai_gen.doc_remove')}
                    className="text-text-subtle hover:text-danger p-1 rounded-lg hover:bg-glass/8 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {simDocNeedsCondense(doc.text) && (
                  <p className="text-[11px] text-text-subtle leading-relaxed border-t border-glass-border/10 pt-2">
                    {i18n.t('admin.simulations.ai_gen.doc_long_notice')}
                  </p>
                )}
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-glass-border/30 px-3 py-3 text-xs text-text-muted hover:text-text hover:border-neon-green/40 transition-colors"
              >
                <Upload className="h-3.5 w-3.5" />
                {i18n.t('admin.simulations.ai_gen.doc_upload')}
              </button>
            )}

            {docError && (
              <p className="text-[11px] text-danger mt-1.5">{docError}</p>
            )}
            <p className="text-[11px] text-text-subtle mt-1 leading-relaxed">
              {i18n.t('admin.simulations.ai_gen.doc_hint')}
            </p>
          </div>

          {modules.length > 0 && (
            <div>
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
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-danger p-3 rounded-xl bg-danger/8 border border-danger/20">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <GenerationProgress
            steps={runSteps}
            active={loading}
            stepIndex={stepIdx}
            note={note}
            title={runTitle}
          />

          {loading && (
            <div className="flex justify-end">
              <button
                onClick={handleCancel}
                className="inline-flex items-center gap-1.5 rounded-lg border border-glass-border/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:border-glass-border/40 transition-colors"
              >
                <X className="h-3.5 w-3.5" /> {i18n.t('bgtask.cancel')}
              </button>
            </div>
          )}

          {preview && !loading && (
            <PreviewBox generated={preview} type={type} onApply={handleApply} onRegenerate={handleRegenerate} />
          )}

          {!preview && !loading && (
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
              <Button onClick={handleGenerate} disabled={!description.trim() && !doc} size="sm">
                <Sparkles className="h-4 w-4" /> {i18n.t('admin.simulations.ai_gen.generate_scenario')}
              </Button>
            </div>
          )}
          {canImprove && !preview && !loading && (
            <div className="text-[11px] text-text-subtle text-right -mt-2 space-y-0.5">
              <p>{i18n.t('admin.simulations.ai_gen.improve_hint')}</p>
              <p>{i18n.t('admin.simulations.ai_gen.translate_hint')}</p>
            </div>
          )}
        </div>
      )}
    </div>
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

  return (
    <div className="bg-glass/6 border border-neon-green/20 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm font-medium text-text">{i18n.t('admin.simulations.ai_gen.scenario_generated')}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRegenerate}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors px-2 py-1 rounded-lg hover:bg-glass/8"
          >
            <RotateCcw className="h-3 w-3" /> Regenerar
          </button>
          <Button size="sm" onClick={onApply}>{i18n.t('admin.simulations.ai_gen.load_in_editor')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
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

      <div>
        <div className="text-[11px] font-medium text-text-subtle uppercase tracking-wide mb-2">{i18n.t('admin.simulations.ai_gen.conversation_flow')}</div>
        <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
          {nodeEntries.map(([nid, node]) => {
            const line = type === 'dialogue'
              ? String((node.customerLine as Record<string, string>)?.es ?? '')
              : String((node.message as Record<string, string>)?.es ?? '')
            const isStart = nid === generated.start_node_id
            const isTerminal = Boolean(node.terminal || node.isEnd)
            return (
              <div key={nid} className="flex items-start gap-2 text-xs">
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
              </div>
            )
          })}
        </div>
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
