import { create } from 'zustand'
import i18n from '@/i18n'
import { globalNavigate } from '@/lib/nav'
import { bgTask, useBgTaskStore } from '@/stores/bgTaskStore'
import {
  generateSimulation, translateScenario, getModuleContextText, simDocNeedsCondense,
  editSimulation, applyScenarioPatch,
  type GeneratedScenario, type ScenarioLength, type SimProgress, type CallType,
  type ScenarioEditSummary,
} from '@/services/ai.service'
import { consumeAiOperation, isQuotaExceeded } from '@/services/aiQuota.service'
import {
  type GenerationStep,
  SIM_STEP_READ_MODULE, SIM_STEP_CONDENSE_DOC, SIM_STEP_OUTLINE,
  SIM_STEP_WRITE, SIM_STEP_IMPROVE, SIM_STEP_EDIT, SIM_STEP_TRANSLATE, SIM_STEP_FINALIZE,
} from '@/admin/components/GenerationProgress'

/** Caché de prompt de simulaciones (el panel muestra el tiempo restante). */
export const SIM_CACHE_KEY = 'ai_sim_cache_expires'
const CACHE_DURATION_MS = 5 * 60 * 1000

export type SimAiMode = 'generate' | 'improve' | 'translate' | 'edit'

/** Todo lo que necesita una corrida; se guarda para poder "Regenerar" igual. */
export interface SimAiInput {
  type: 'dialogue' | 'choice'
  mode: SimAiMode
  description: string
  moduleId?: string
  doc?: { name: string; text: string } | null
  length: ScenarioLength
  callType: CallType
  translateNow: boolean
  /** Escenario actual del editor: base de "Mejorar", "Traducir" y "Ajustar". */
  existing?: GeneratedScenario | null
  campaignId?: string | null
  /** Modo 'edit': qué hay que cambiar, en palabras del capacitador. */
  instructions?: string
  /** Modo 'edit': momentos elegidos. Vacío = la IA decide dónde tocar. */
  focusIds?: string[]
}

export interface SimAiRun {
  key: string
  /** Ruta del editor que la lanzó: la acción del indicador global vuelve acá. */
  returnPath: string
  taskId: string
  input: SimAiInput
  status: 'running' | 'done' | 'error'
  steps: GenerationStep[]
  stepIdx: number
  note?: string
  /** Momentos escritos / totales dentro del paso actual. */
  subProgress?: { done: number; total: number }
  title: string
  error?: string
  result?: GeneratedScenario
  /** Solo en modo 'edit': qué tocó la IA, para revisarlo antes de aplicar. */
  summary?: ScenarioEditSummary
}

interface SimAiState {
  runs: Record<string, SimAiRun>
  start: (key: string, returnPath: string, input: SimAiInput) => void
  cancel: (key: string) => void
  /** Olvida la corrida (al aplicar el resultado o descartar el error). */
  clear: (key: string) => void
}

/** Pasos REALES de esta corrida: se arman con lo que de verdad va a ocurrir. */
function buildSteps(input: SimAiInput): GenerationStep[] {
  const { mode, moduleId, doc } = input
  // El ajuste dirigido es UNA pasada: ni esqueleto ni lotes, solo los momentos tocados.
  if (mode === 'edit') return [SIM_STEP_EDIT, SIM_STEP_FINALIZE]

  const usesModule = mode !== 'translate' && !!moduleId
  const usesDoc = mode !== 'translate' && !!doc
  const steps: GenerationStep[] = []
  if (usesModule) steps.push(SIM_STEP_READ_MODULE)
  if (usesDoc && simDocNeedsCondense(doc!.text)) steps.push(SIM_STEP_CONDENSE_DOC)
  if (mode !== 'translate') {
    steps.push(SIM_STEP_OUTLINE)
    steps.push(mode === 'improve' ? SIM_STEP_IMPROVE : SIM_STEP_WRITE)
  }
  if (mode === 'translate' || input.translateNow) steps.push(SIM_STEP_TRANSLATE)
  steps.push(SIM_STEP_FINALIZE)
  return steps
}

function runTitle(mode: SimAiMode): string {
  return i18n.t(
    mode === 'translate' ? 'admin.simulations.ai_gen.title_translating'
    : mode === 'edit' ? 'admin.simulations.ai_edit.title_editing'
    : 'admin.simulations.ai_gen.title_generating',
  )
}

/** Título corto para el indicador global (se ve desde cualquier pantalla). */
function bgTitle(input: SimAiInput): string {
  const name = (input.mode === 'edit' ? input.existing?.metadata?.title_es : input.description.trim().slice(0, 40))
    || input.existing?.metadata?.title_es
    || i18n.t('admin.simulations.ai_gen.bg_untitled')
  return i18n.t(`admin.simulations.ai_gen.bg_title_${input.mode}`, { name })
}

export const useSimAiStore = create<SimAiState>()((set, get) => {
  /** Parche sobre la corrida SOLO si sigue siendo la misma (no pisa una nueva). */
  const patch = (key: string, taskId: string, p: Partial<SimAiRun>) => {
    const run = get().runs[key]
    if (!run || run.taskId !== taskId) return
    set({ runs: { ...get().runs, [key]: { ...run, ...p } } })
  }

  return {
    runs: {},

    start: (key, returnPath, input) => {
      // Una corrida por editor: la nueva reemplaza (y cancela) a la anterior.
      get().cancel(key)

      const steps = buildSteps(input)
      const idxOf = (s: GenerationStep) => steps.indexOf(s)
      const { id: taskId, signal } = bgTask.startCancelable(
        bgTitle(input),
        i18n.t(steps[0].label),
      )

      set({
        runs: {
          ...get().runs,
          [key]: {
            key, returnPath, taskId, input,
            status: 'running', steps, stepIdx: 0,
            title: runTitle(input.mode),
          },
        },
      })

      const action = {
        label: i18n.t('admin.simulations.ai_gen.bg_open_editor'),
        run: () => globalNavigate(returnPath),
      }

      const onProgress = (p: SimProgress) => {
        const step = p.stage === 'translating' ? SIM_STEP_TRANSLATE
          : p.stage === 'document' ? SIM_STEP_CONDENSE_DOC
          : p.stage === 'outline' ? SIM_STEP_OUTLINE
          : p.stage === 'editing' ? SIM_STEP_EDIT
          : input.mode === 'improve' ? SIM_STEP_IMPROVE : SIM_STEP_WRITE
        const i = idxOf(step)
        patch(key, taskId, {
          ...(i >= 0 ? { stepIdx: i } : {}),
          note: p.detail,
          subProgress: p.total ? { done: p.done ?? 0, total: p.total } : undefined,
        })
        // El indicador global cuenta lo mismo, en una línea.
        bgTask.update(taskId, {
          detail: p.total
            ? `${i18n.t(step.label)} · ${p.done ?? 0}/${p.total}`
            : i18n.t(step.label),
        })
      }

      void (async () => {
        try {
          // Cupo diario: generar, mejorar o traducir cuenta como UNA operación.
          await consumeAiOperation(
            input.mode === 'translate' ? 'translation' : 'simulation',
            input.description.slice(0, 80) || runTitle(input.mode),
            input.campaignId,
          )

          let moduleContext: string | undefined
          if (input.mode !== 'translate' && input.moduleId) {
            patch(key, taskId, { note: i18n.t('admin.simulations.ai_gen.note_reading_module') })
            moduleContext = await getModuleContextText(input.moduleId)
            patch(key, taskId, { stepIdx: idxOf(SIM_STEP_READ_MODULE) + 1 })
          }

          let result: GeneratedScenario
          let summary: ScenarioEditSummary | undefined
          if (input.mode === 'edit') {
            const { patch: editPatch } = await editSimulation({
              type: input.type,
              current: input.existing!,
              instructions: input.instructions ?? '',
              focusIds: input.focusIds,
              moduleContext,
              documentContext: input.doc?.text,
              documentName: input.doc?.name,
            }, signal, onProgress)
            const applied = applyScenarioPatch(input.existing!, editPatch, input.type)
            result = applied.scenario
            summary = applied.summary
          } else if (input.mode === 'translate') {
            result = await translateScenario(input.existing!, signal, onProgress)
          } else {
            const usesDoc = !!input.doc
            const out = await generateSimulation({
              type: input.type,
              description: input.description,
              moduleContext,
              documentContext: usesDoc ? input.doc!.text : undefined,
              documentName: usesDoc ? input.doc!.name : undefined,
              length: input.length,
              callType: input.callType,
              translate: input.translateNow,
              existing: input.mode === 'improve' ? input.existing ?? undefined : undefined,
            }, signal, onProgress)
            result = out.data
            if (out.usage.cache_creation_input_tokens > 0) {
              localStorage.setItem(SIM_CACHE_KEY, String(Date.now() + CACHE_DURATION_MS))
            }
          }

          patch(key, taskId, {
            status: 'done',
            result,
            summary,
            stepIdx: steps.length - 1,
            note: undefined,
            subProgress: undefined,
          })
          bgTask.succeed(taskId, {
            detail: summary
              ? i18n.t('admin.simulations.ai_edit.bg_done', {
                  count: summary.changed.length + summary.added.length + summary.removed.length,
                })
              : i18n.t('admin.simulations.ai_gen.bg_done'),
            action,
          })
        } catch (e) {
          // Cancelación: la corrida desaparece, el editor queda como estaba. Ojo: se
          // borra SOLO si sigue siendo esta corrida — al relanzar (Regenerar) la
          // anterior se aborta y su rechazo llega cuando ya hay una nueva en marcha.
          if (signal.aborted || (e as Error)?.name === 'AbortError') {
            if (get().runs[key]?.taskId === taskId) get().clear(key)
            bgTask.markCanceled(taskId, i18n.t('bgtask.canceled'))
            return
          }
          const message = isQuotaExceeded(e)
            ? i18n.t('admin.ai_limits.blocked_task')
            : (e as Error).message
          patch(key, taskId, { status: 'error', error: message, note: undefined, subProgress: undefined })
          bgTask.fail(taskId, message)
        }
      })()
    },

    cancel: (key) => {
      const run = get().runs[key]
      if (!run || run.status !== 'running') return
      // Aborta el AbortController que vive en el bgTask (mismo que el indicador global).
      useBgTaskStore.getState().requestCancel(run.taskId)
    },

    clear: (key) => {
      const { [key]: _gone, ...rest } = get().runs
      set({ runs: rest })
    },
  }
})
