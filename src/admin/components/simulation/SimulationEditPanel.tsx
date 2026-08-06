import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Wrench, ChevronDown, X, CheckCircle2, AlertTriangle, Undo2, Target, MessageSquarePlus } from 'lucide-react'
import { GenerationProgress } from '@/admin/components/GenerationProgress'
import { ease, Stagger, StaggerItem, Magnetic } from '@/components/ui/motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { type GeneratedDialogue, type GeneratedChoice, type GeneratedScenario } from '@/services/ai.service'
import { useSimAiStore, type SimAiInput } from '@/stores/simAiStore'
import { ScenarioDiff } from './ScenarioDiff'
import { Button } from '@/components/ui/Button'
import { AiCreditsNotice, AiCreditsDot } from '@/components/ui/AiCreditsNotice'
import { AiQuotaNotice } from '@/components/ui/AiQuotaNotice'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { cn } from '@/lib/cn'
import i18n from '@/i18n'

interface Props {
  type: 'dialogue' | 'choice'
  /** Escenario tal como está hoy en el editor. Sin contenido, el panel no aplica. */
  current: GeneratedScenario | null
  /** Carga en el editor el escenario ya ajustado (mismo camino que "Generar"). */
  onApply: (scenario: GeneratedDialogue | GeneratedChoice) => void
  campaignId?: string | null
}

/** Primera línea del momento, para reconocerlo sin abrirlo. */
function momentText(node: unknown, type: 'dialogue' | 'choice'): string {
  const n = (node ?? {}) as Record<string, Record<string, string> | undefined>
  const line = type === 'dialogue' ? n.customerLine?.es : n.message?.es
  return (line ?? '').trim()
}

/**
 * AJUSTAR CON IA — la alternativa a borrar la simulación y volver a generarla.
 *
 * El capacitador escribe qué quiere cambiar ("que el cliente exija un supervisor
 * antes de aceptar", "cambia la objeción por una de plazos de entrega"), opcionalmente
 * marca en qué momentos, y la IA devuelve SOLO esos momentos reescritos. Lo demás
 * queda intacto. Antes de tocar nada se muestra la lista de cambios, y después de
 * aplicarlos queda un "Deshacer" por si el remedio fue peor.
 */
export function SimulationEditPanel({ type, current, onApply, campaignId }: Props) {
  const reduce = useReducedMotion()
  // Con una corrida viva (o con su propuesta esperando) el panel arranca abierto: es
  // exactamente lo que se viene a buscar al volver a esta pantalla.
  const [open, setOpen] = useState(
    () => !!useSimAiStore.getState().runs[`${type}-edit:${window.location.pathname}`],
  )
  const [instructions, setInstructions] = useState('')
  const [focusIds, setFocusIds] = useState<string[]>([])
  const [showMoments, setShowMoments] = useState(false)
  /** Escenario previo al último ajuste aplicado: lo que restaura "Deshacer". */
  const [undoSnapshot, setUndoSnapshot] = useState<GeneratedScenario | null>(null)
  /** Corrección sobre la propuesta que está en pantalla ("no, más corto"). */
  const [refineOpen, setRefineOpen] = useState(false)
  const [refineText, setRefineText] = useState('')
  /**
   * Lo que se pidió la PRIMERA vez. Las correcciones se apilan sobre la propuesta,
   * pero la instrucción original sigue viajando: si no, a la segunda vuelta la IA
   * olvida para qué se estaba ajustando el momento.
   */
  const [firstInstructions, setFirstInstructions] = useState('')

  // Corrida propia, separada de la del generador: se puede estar ajustando aquí sin
  // pisar (ni ser pisado por) un "Generar escenario". Vive en el store global, así
  // que el ajuste sigue corriendo aunque el capacitador se vaya a otra vista.
  const [runKey] = useState(() => `${type}-edit:${window.location.pathname}`)
  const run = useSimAiStore((s) => s.runs[runKey])
  const startRun = useSimAiStore((s) => s.start)
  const cancelRun = useSimAiStore((s) => s.cancel)
  const clearRun = useSimAiStore((s) => s.clear)
  const appliedRun = useSimAiStore((s) => s.applied)

  const loading = run?.status === 'running'
  const result = run?.status === 'done' ? run.result : null
  const summary = run?.status === 'done' ? run.summary : undefined
  const error = run?.status === 'error' ? run.error ?? null : null

  // Momentos del escenario, con el inicial primero (así se leen como la conversación).
  const moments = useMemo(() => {
    if (!current) return []
    const ids = Object.keys(current.nodes ?? {})
    const start = current.start_node_id
    const ordered = start && ids.includes(start) ? [start, ...ids.filter((i) => i !== start)] : ids
    return ordered.map((id, i) => ({
      id,
      n: i + 1,
      text: momentText((current.nodes as Record<string, unknown>)[id], type),
    }))
  }, [current, type])

  const toggleFocus = (id: string) =>
    setFocusIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const handleRun = () => {
    if (!current || !instructions.trim()) return
    const input: SimAiInput = {
      type,
      mode: 'edit',
      description: '',
      length: 'medium',
      callType: 'auto',
      translateNow: false,
      existing: current,
      instructions: instructions.trim(),
      focusIds,
      campaignId,
    }
    setUndoSnapshot(null)
    setFirstInstructions(instructions.trim())
    setRefineOpen(false)
    setRefineText('')
    startRun(runKey, window.location.pathname, input)
  }

  /**
   * "Pídele que lo mejore": en vez de descartar y volver a escribir todo, la
   * corrección se aplica SOBRE la propuesta que está en pantalla. Lo que ya quedó
   * bien no se vuelve a jugar, y el "antes y después" se sigue midiendo contra lo
   * que hay hoy en el editor (que es lo que importa antes de aplicar).
   */
  const handleRefine = () => {
    if (!result || !refineText.trim()) return
    const original = firstInstructions || run?.input.instructions?.trim() || ''
    const input: SimAiInput = {
      type,
      mode: 'edit',
      description: '',
      length: 'medium',
      callType: 'auto',
      translateNow: false,
      existing: result,
      instructions: i18n.t('admin.simulations.ai_edit.refine_prompt', {
        original,
        correction: refineText.trim(),
      }),
      focusIds,
      campaignId,
    }
    setRefineOpen(false)
    setRefineText('')
    startRun(runKey, window.location.pathname, input)
  }

  const handleApply = () => {
    if (!result) return
    setUndoSnapshot(current)
    onApply(result as GeneratedDialogue | GeneratedChoice)
    // Cargar en el editor no es guardar: el respaldo en la base espera al Guardar.
    appliedRun(runKey)
    // La instrucción se limpia, los momentos elegidos no: es normal encadenar dos
    // ajustes seguidos sobre la misma parte del escenario.
    setInstructions('')
    setFirstInstructions('')
    setRefineOpen(false)
    setRefineText('')
  }

  const handleUndo = () => {
    if (!undoSnapshot) return
    onApply(undoSnapshot as GeneratedDialogue | GeneratedChoice)
    setUndoSnapshot(null)
  }

  const touched = summary
    ? summary.changed.length + summary.added.length + summary.removed.length + (summary.metadata ? 1 : 0)
    : 0

  return (
    <motion.div
      layout={reduce ? false : 'position'}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={cn(
        'mb-6 rounded-2xl border overflow-hidden relative',
        open ? 'bg-brand-violet/5 border-brand-violet/25' : 'bg-glass/4 border-glass-border/10 hover:border-glass-border/20',
      )}
    >
      <AnimatePresence>
        {loading && !reduce && (
          <motion.span
            aria-hidden
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-x-0 top-0 h-px overflow-hidden"
          >
            <motion.span
              className="block h-px w-1/3 bg-gradient-to-r from-transparent via-brand-violet to-transparent"
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
            animate={loading && !reduce ? { rotate: [0, -14, 10, 0] } : { rotate: 0 }}
            transition={loading ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
          >
            <Wrench className="h-4 w-4 text-brand-violet" />
            <AiCreditsDot className="absolute -top-1 -right-1" />
          </motion.span>
          <span className="text-sm font-medium text-text">{i18n.t('admin.simulations.ai_edit.title')}</span>
          <span className="text-xs text-text-subtle truncate">{i18n.t('admin.simulations.ai_edit.subtitle')}</span>
        </div>
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

              {!current ? (
                <StaggerItem className="pt-4">
                  <p className="text-sm text-text-muted leading-relaxed">
                    {i18n.t('admin.simulations.ai_edit.no_content')}
                  </p>
                </StaggerItem>
              ) : (
                <>
                  <StaggerItem className="pt-4">
                    <label className="text-xs font-medium text-text-muted mb-1.5 block">
                      {i18n.t('admin.simulations.ai_edit.what_to_change')}
                    </label>
                    <textarea
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      placeholder={i18n.t('admin.simulations.ai_edit.ph')}
                      rows={4}
                      className="w-full glass border border-glass-border/20 rounded-xl px-3 py-2.5 text-sm text-text bg-transparent resize-none focus:outline-none focus:border-brand-violet/50 placeholder:text-text-subtle"
                    />
                    <p className="text-[11px] text-text-subtle mt-1 leading-relaxed">
                      {i18n.t('admin.simulations.ai_edit.hint')}
                    </p>
                  </StaggerItem>

                  {/* Elegir momentos no es obligatorio, pero es lo que convierte
                      "mejóralo" en "cambia ESTO": el ajuste sale más preciso. */}
                  <StaggerItem>
                    <button
                      type="button"
                      onClick={() => setShowMoments((v) => !v)}
                      className="flex items-center gap-2 text-xs font-medium text-text-muted hover:text-text transition-colors"
                    >
                      <Target className="h-3.5 w-3.5" />
                      {i18n.t('admin.simulations.ai_edit.focus_label')}
                      <span className="text-text-subtle font-normal">
                        {focusIds.length
                          ? i18n.t('admin.simulations.ai_edit.focus_selected', { count: focusIds.length })
                          : i18n.t('admin.simulations.ai_edit.focus_all')}
                      </span>
                      <motion.span animate={{ rotate: showMoments ? 180 : 0 }} transition={{ duration: 0.25, ease }}>
                        <ChevronDown className="h-3.5 w-3.5" />
                      </motion.span>
                    </button>

                    <AnimatePresence initial={false}>
                      {showMoments && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease }}
                          className="overflow-hidden"
                        >
                          <div className="mt-2 space-y-1 max-h-56 overflow-y-auto pr-1">
                            {moments.map((m) => {
                              const active = focusIds.includes(m.id)
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => toggleFocus(m.id)}
                                  aria-pressed={active}
                                  className={cn(
                                    'relative w-full text-left rounded-lg border py-1.5 pr-8 transition-all duration-200',
                                    // El elegido tiene que cantar también en modo claro:
                                    // barra de acento + fondo + anillo + check, no solo un borde.
                                    active
                                      ? 'border-brand-violet/60 bg-brand-violet/10 ring-1 ring-brand-violet/25 shadow-sm pl-4'
                                      : 'border-glass-border/15 hover:border-glass-border/40 hover:bg-glass/5 pl-2.5',
                                  )}
                                >
                                  {active && (
                                    <motion.span
                                      layoutId={reduce ? undefined : `focus-bar-${m.id}`}
                                      initial={reduce ? undefined : { scaleY: 0 }}
                                      animate={{ scaleY: 1 }}
                                      transition={{ duration: 0.22, ease }}
                                      className="absolute left-1 inset-y-1.5 w-1 rounded-full bg-brand-violet"
                                    />
                                  )}
                                  <span className={cn('text-[11px] font-medium', active ? 'text-brand-violet font-semibold' : 'text-text-muted')}>
                                    {i18n.t('admin.simulations.step_n', { n: m.n })}
                                  </span>
                                  {m.text && (
                                    <span className={cn(
                                      'block text-[11px] leading-snug truncate',
                                      active ? 'text-text' : 'text-text-subtle',
                                    )}>
                                      {m.text.slice(0, 80)}{m.text.length > 80 ? '…' : ''}
                                    </span>
                                  )}
                                  <AnimatePresence>
                                    {active && (
                                      <motion.span
                                        initial={reduce ? undefined : { opacity: 0, scale: 0.6 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={reduce ? undefined : { opacity: 0, scale: 0.6 }}
                                        transition={{ duration: 0.18, ease }}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-brand-violet"
                                      >
                                        <CheckCircle2 className="h-4 w-4" />
                                      </motion.span>
                                    )}
                                  </AnimatePresence>
                                </button>
                              )
                            })}
                          </div>
                          {focusIds.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setFocusIds([])}
                              className="mt-1.5 text-[11px] text-text-subtle hover:text-text transition-colors"
                            >
                              {i18n.t('admin.simulations.ai_edit.focus_clear')}
                            </button>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <p className="text-[11px] text-text-subtle mt-1 leading-relaxed">
                      {i18n.t('admin.simulations.ai_edit.focus_hint')}
                    </p>
                  </StaggerItem>
                </>
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
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <GenerationProgress
                steps={run?.steps ?? []}
                active={loading}
                stepIndex={run?.stepIdx ?? 0}
                note={run?.note}
                subProgress={run?.subProgress}
                title={run?.title ?? i18n.t('admin.simulations.ai_edit.title_editing')}
                hint={i18n.t('admin.simulations.ai_edit.eta')}
                patienceKeys={['admin.gen.edit_patience_1', 'admin.gen.edit_patience_2']}
              />

              <AnimatePresence>
                {loading && (
                  <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <p className="text-[11px] leading-relaxed text-text-subtle flex-1 min-w-[12rem]">
                      {i18n.t('admin.simulations.ai_gen.bg_hint')}
                    </p>
                    <button
                      onClick={() => cancelRun(runKey)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-glass-border/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:border-glass-border/40 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" /> {i18n.t('bgtask.cancel')}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Qué propone la IA, ANTES de tocar el editor. */}
              <AnimatePresence mode="wait" initial={false}>
                {result && !loading ? (
                  <motion.div
                    key="result"
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                    className="rounded-xl border border-brand-violet/25 bg-glass/6 p-4 space-y-3"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-brand-violet" />
                      <span className="text-sm font-medium text-text">
                        {i18n.t('admin.simulations.ai_edit.result_title')}
                      </span>
                    </div>

                    {summary && (
                      <div className="flex flex-wrap gap-1.5 text-[10px] font-medium">
                        {summary.changed.length > 0 && (
                          <span className="rounded-lg bg-brand-violet/12 text-brand-violet px-2 py-1">
                            {i18n.t('admin.simulations.ai_edit.count_changed', { count: summary.changed.length })}
                          </span>
                        )}
                        {summary.added.length > 0 && (
                          <span className="rounded-lg bg-brand-green/12 text-brand-green px-2 py-1">
                            {i18n.t('admin.simulations.ai_edit.count_added', { count: summary.added.length })}
                          </span>
                        )}
                        {summary.removed.length > 0 && (
                          <span className="rounded-lg bg-danger/12 text-danger px-2 py-1">
                            {i18n.t('admin.simulations.ai_edit.count_removed', { count: summary.removed.length })}
                          </span>
                        )}
                        {summary.metadata && (
                          <span className="rounded-lg bg-glass/10 text-text-muted px-2 py-1">
                            {i18n.t('admin.simulations.ai_edit.count_metadata')}
                          </span>
                        )}
                        {summary.rewired > 0 && (
                          <span className="rounded-lg bg-glass/10 text-text-muted px-2 py-1">
                            {i18n.t('admin.simulations.ai_edit.count_rewired', { count: summary.rewired })}
                          </span>
                        )}
                      </div>
                    )}

                    {summary?.changes.length ? (
                      <ul className="space-y-1.5">
                        {summary.changes.map((c, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-text-muted leading-snug">
                            <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-violet/60" />
                            <span>{c}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {/* Lo de arriba es lo que la IA DICE que hizo; esto es lo que
                        de verdad va a cambiar si aplicas. */}
                    <ScenarioDiff before={current} after={result as GeneratedScenario} type={type} />

                    {touched === 0 && (
                      <p className="text-xs text-text-subtle leading-relaxed">
                        {i18n.t('admin.simulations.ai_edit.nothing_changed')}
                      </p>
                    )}

                    {/* Corregir sin perder lo propuesto: la alternativa a descartar
                        y volver a escribir la instrucción desde cero. */}
                    <AnimatePresence initial={false}>
                      {refineOpen && (
                        <motion.div
                          initial={reduce ? undefined : { height: 0, opacity: 0 }}
                          animate={reduce ? undefined : { height: 'auto', opacity: 1 }}
                          exit={reduce ? undefined : { height: 0, opacity: 0 }}
                          transition={{ duration: 0.28, ease }}
                          className="overflow-hidden"
                        >
                          <div className="pt-1">
                            <textarea
                              value={refineText}
                              onChange={(e) => setRefineText(e.target.value)}
                              placeholder={i18n.t('admin.simulations.ai_edit.refine_ph')}
                              rows={3}
                              autoFocus
                              className="w-full glass border border-brand-violet/25 rounded-xl px-3 py-2.5 text-sm text-text bg-transparent resize-none focus:outline-none focus:border-brand-violet/60 placeholder:text-text-subtle"
                            />
                            <p className="text-[11px] text-text-subtle mt-1 leading-relaxed">
                              {i18n.t('admin.simulations.ai_edit.refine_hint')}
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                      <Button variant="ghost" size="sm" onClick={() => clearRun(runKey)}>
                        {i18n.t('admin.simulations.ai_edit.discard')}
                      </Button>
                      {refineOpen ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => setRefineOpen(false)}>
                            {i18n.t('admin.simulations.ai_edit.refine_cancel')}
                          </Button>
                          <Magnetic strength={0.25}>
                            <Button size="sm" onClick={handleRefine} disabled={!refineText.trim()}>
                              <Wrench className="h-4 w-4" /> {i18n.t('admin.simulations.ai_edit.refine_send')}
                            </Button>
                          </Magnetic>
                        </>
                      ) : (
                        <>
                          <Button variant="secondary" size="sm" onClick={() => setRefineOpen(true)}>
                            <MessageSquarePlus className="h-4 w-4" /> {i18n.t('admin.simulations.ai_edit.refine')}
                          </Button>
                          <Magnetic strength={0.25}>
                            <Button size="sm" onClick={handleApply} disabled={touched === 0}>
                              {i18n.t('admin.simulations.ai_edit.apply')}
                            </Button>
                          </Magnetic>
                        </>
                      )}
                    </div>
                  </motion.div>
                ) : !loading && current ? (
                  <motion.div
                    key="actions"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, ease }}
                    className="flex flex-wrap items-center justify-end gap-2"
                  >
                    {/* Deshacer vive junto al botón que aplicó: es donde se mira si
                        el ajuste dejó peor la simulación. */}
                    {undoSnapshot && (
                      <button
                        onClick={handleUndo}
                        className="mr-auto inline-flex items-center gap-1.5 rounded-lg border border-glass-border/20 px-2.5 py-1.5 text-[11px] font-medium text-text-muted hover:text-text hover:border-glass-border/40 transition-colors"
                      >
                        <Undo2 className="h-3.5 w-3.5" /> {i18n.t('admin.simulations.ai_edit.undo')}
                      </button>
                    )}
                    <Magnetic strength={0.25}>
                      <Button size="sm" onClick={handleRun} disabled={!instructions.trim()}>
                        <Wrench className="h-4 w-4" /> {i18n.t('admin.simulations.ai_edit.run')}
                      </Button>
                    </Magnetic>
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
