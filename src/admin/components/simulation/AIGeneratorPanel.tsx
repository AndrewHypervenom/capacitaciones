import { useState, useEffect, useRef, useCallback } from 'react'
import { Sparkles, ChevronDown, ChevronUp, BookOpen, AlertTriangle, CheckCircle2, RotateCcw, Clock, X } from 'lucide-react'
import { GenerationProgress, SIMULATION_GENERATION_STEPS } from '@/admin/components/GenerationProgress'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { generateSimulation, getModuleContextText, type CacheUsage, type GeneratedDialogue, type GeneratedChoice } from '@/services/ai.service'
import { Button } from '@/components/ui/Button'
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
}

export function AIGeneratorPanel({ type, onApply, defaultOpen = false }: Props) {
  const { campaignId } = useAuth()
  const { remaining, notifyCache } = useCacheTimer()
  const [open, setOpen] = useState(defaultOpen)
  const [description, setDescription] = useState('')
  const [modules, setModules] = useState<Module[]>([])
  const [selectedModuleId, setSelectedModuleId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<GeneratedDialogue | GeneratedChoice | null>(null)
  const abortRef = useRef<AbortController | null>(null)

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

  const handleGenerate = async () => {
    if (!description.trim()) return
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    setPreview(null)
    try {
      let moduleContext: string | undefined
      if (selectedModuleId) moduleContext = await getModuleContextText(selectedModuleId)
      const result = await generateSimulation({ type, description, moduleContext }, controller.signal)
      setPreview(result.data)
      notifyCache(result.usage)
    } catch (e) {
      // Cancelación del usuario: no es un error, se descarta en silencio.
      if (controller.signal.aborted || (e as Error)?.name === 'AbortError') return
      setError((e as Error).message)
    } finally {
      abortRef.current = null
      setLoading(false)
    }
  }

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
      open ? 'bg-brand-violet/4 border-brand-violet/20' : 'bg-glass/4 border-glass-border/10 hover:border-glass-border/20',
    )}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-5 py-3.5 text-left">
        <div className="flex items-center gap-2 flex-1">
          <Sparkles className="h-4 w-4 text-brand-violet shrink-0" />
          <span className="text-sm font-medium text-text">i18n.t('admin.simulations.ai_gen.generate_ai')</span>
          <span className="text-xs text-text-subtle">i18n.t('admin.simulations.ai_gen.generate_ai_sub')</span>
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
          <div className="pt-4">
            <label className="text-xs font-medium text-text-muted mb-1.5 block">
              {i18n.t('admin.simulations.ai_gen.what_scenario_about')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={i18n.t('admin.simulations.ai_gen.ph_prompt')}
              rows={3}
              className="w-full glass border border-glass-border/20 rounded-xl px-3 py-2.5 text-sm text-text bg-transparent resize-none focus:outline-none focus:border-brand-violet/40 placeholder:text-text-subtle"
            />
            <p className="text-[11px] text-text-subtle mt-1">i18n.t('admin.simulations.ai_gen.prompt_hint')</p>
          </div>

          {modules.length > 0 && (
            <div>
              <label className="text-xs font-medium text-text-muted mb-1.5 flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5" />
                {i18n.t('admin.simulations.ai_gen.base_on_module')} <span className="text-text-subtle font-normal">i18n.t('admin.simulations.ai_gen.optional')</span>
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
            steps={SIMULATION_GENERATION_STEPS}
            active={loading}
            title={i18n.t('admin.simulations.ai_gen.title_generating')}
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
            <PreviewBox generated={preview} type={type} onApply={handleApply} onRegenerate={handleGenerate} />
          )}

          {!preview && !loading && (
            <div className="flex justify-end">
              <Button onClick={handleGenerate} disabled={!description.trim()} size="sm">
                <Sparkles className="h-4 w-4" /> Generar escenario
              </Button>
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
    <div className="bg-glass/6 border border-brand-violet/20 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm font-medium text-text">i18n.t('admin.simulations.ai_gen.scenario_generated')</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRegenerate}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors px-2 py-1 rounded-lg hover:bg-glass/8"
          >
            <RotateCcw className="h-3 w-3" /> Regenerar
          </button>
          <Button size="sm" onClick={onApply}>i18n.t('admin.simulations.ai_gen.load_in_editor')</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <div>
          <div className="text-text-subtle mb-0.5">i18n.t('admin.simulations.ai_gen.field_title')</div>
          <div className="text-text font-medium">{String(meta.title_es ?? '')}</div>
        </div>
        {type === 'dialogue' && (
          <>
            <div>
              <div className="text-text-subtle mb-0.5">i18n.t('admin.simulations.ai_gen.client_country')</div>
              <div className="text-text">{String(meta.customer_name ?? '')} · {String(meta.country ?? '')}</div>
            </div>
            <div>
              <div className="text-text-subtle mb-0.5">i18n.t('admin.simulations.ai_gen.difficulty')</div>
              <div className="text-text">{String(meta.difficulty ?? '')}/3</div>
            </div>
            <div>
              <div className="text-text-subtle mb-0.5">i18n.t('admin.simulations.ai_gen.call_reason')</div>
              <div className="text-text truncate">{String(meta.customer_reason_es ?? '')}</div>
            </div>
          </>
        )}
        {type === 'choice' && (
          <div>
            <div className="text-text-subtle mb-0.5">i18n.t('admin.simulations.ai_gen.level')</div>
            <div className="text-text">{String(meta.level ?? '')}</div>
          </div>
        )}
        <div>
          <div className="text-text-subtle mb-0.5">{i18n.t('admin.simulations.ai_gen.steps')}</div>
          <div className="text-text">{i18n.t('admin.simulations.ai_gen_moments', { count: nodeEntries.length })}</div>
        </div>
      </div>

      <div>
        <div className="text-[11px] font-medium text-text-subtle uppercase tracking-wide mb-2">i18n.t('admin.simulations.ai_gen.conversation_flow')</div>
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
