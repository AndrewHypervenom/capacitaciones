import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
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
  saveAiDraft, deleteAiDraftByRunKey, type AiScenarioDraft,
} from '@/services/aiDrafts.service'
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
  /**
   * Rescatada del almacenamiento tras recargar la página. El resultado está
   * completo, pero el contexto pesado de la corrida (el documento de apoyo y el
   * escenario de partida) NO se guarda, así que "Regenerar" no puede repetirla
   * igual y se oculta.
   */
  restored?: boolean
  /** Cuándo terminó (ms). Ordena y fecha los borradores en la lista de simulaciones. */
  finishedAt?: number
  /** Fila en ai_scenario_drafts. Si falta, el borrador solo vive en este navegador. */
  draftId?: string
  /** Nombre real del escenario, en cuanto la IA lo decide (al armar el esqueleto). */
  resolvedTitle?: string
}

interface SimAiState {
  runs: Record<string, SimAiRun>
  /**
   * Borradores que YA se cargaron en un editor pero cuya simulación todavía no se
   * ha guardado (clave de la corrida → ruta del editor). Su fila en la base sigue
   * viva a propósito: cargar en el editor no es guardar, y si el capacitador se va
   * sin guardar el escenario tiene que seguir estando.
   */
  appliedKeys: Record<string, string>
  start: (key: string, returnPath: string, input: SimAiInput) => void
  /**
   * Mete en el store un borrador que venía de la base (generado en otro navegador
   * u otra sesión), para que el editor lo encuentre igual que si acabara de salir.
   */
  adopt: (draft: AiScenarioDraft) => void
  cancel: (key: string) => void
  /** Descarta la corrida A PROPÓSITO: se va del navegador y de la base. */
  clear: (key: string) => void
  /** El resultado se cargó en el editor. El respaldo en la base se conserva. */
  applied: (key: string) => void
  /** El editor guardó de verdad: recién ahí sobran los borradores que cargó. */
  flushAppliedDrafts: (returnPath: string) => void
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

/**
 * Cómo se llama esto mientras se genera. En orden de qué tan fiel es al resultado:
 * el título que la IA ya decidió, el del escenario de partida, lo que pidió el
 * capacitador, o el nombre del documento que subió. "Sin título" es el último
 * recurso, no el primero: una tarjeta que dice "sin título" durante cinco minutos
 * no deja saber qué se está generando.
 */
function bgTitle(input: SimAiInput, resolved?: string): string {
  const name = resolved?.trim()
    || input.existing?.metadata?.title_es?.trim()
    || (input.mode !== 'edit' ? input.description.trim().slice(0, 48) : '')
    || input.doc?.name?.replace(/\.[^.]+$/, '')
    || i18n.t('admin.simulations.ai_gen.bg_untitled')
  return i18n.t(`admin.simulations.ai_gen.bg_title_${input.mode}`, { name })
}

/** Cuántas corridas terminadas se conservan entre recargas (las más recientes). */
const MAX_PERSISTED = 6

/**
 * Copia ligera para guardar en el navegador. Se tira lo pesado y NO reutilizable:
 * el texto del documento de apoyo y el escenario de partida pueden pesar cientos
 * de kB y llenar el localStorage. El resultado (lo que costó tokens) sí se guarda
 * entero.
 */
function slim(run: SimAiRun): SimAiRun {
  const { doc, existing: _existing, ...input } = run.input
  return {
    ...run,
    input: { ...input, doc: doc ? { name: doc.name, text: '' } : null, existing: null },
  }
}

export const useSimAiStore = create<SimAiState>()(persist((set, get) => {
  /** Parche sobre la corrida SOLO si sigue siendo la misma (no pisa una nueva). */
  const patch = (key: string, taskId: string, p: Partial<SimAiRun>) => {
    const run = get().runs[key]
    if (!run || run.taskId !== taskId) return
    set({ runs: { ...get().runs, [key]: { ...run, ...p } } })
  }

  return {
    runs: {},
    appliedKeys: {},

    start: (key, returnPath, input) => {
      // Una corrida por editor: la nueva reemplaza (y cancela) a la anterior.
      const previous = get().runs[key]
      get().cancel(key)
      // Si la anterior ya había terminado, su tarjeta pegajosa se queda para siempre
      // apuntando a un resultado que esta corrida está por reemplazar.
      if (previous && previous.status !== 'running') bgTask.dismiss(previous.taskId)

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
        // Aviso de "ya sé cómo se llama": solo renombra, no toca el paso ni el
        // detalle (si no, borraría el "escribiendo el momento 8 de 24" en curso).
        if (p.title && !p.detail && p.total === undefined) {
          patch(key, taskId, { resolvedTitle: p.title })
          bgTask.update(taskId, { title: bgTitle(input, p.title) })
          return
        }
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
            finishedAt: Date.now(),
            stepIdx: steps.length - 1,
            note: undefined,
            subProgress: undefined,
          })

          // El nombre definitivo (la IA pudo afinarlo al escribir los diálogos).
          const finalTitle = String(
            (result.metadata as unknown as Record<string, unknown>).title_es ?? '',
          ).trim()
          if (finalTitle) patch(key, taskId, { resolvedTitle: finalTitle })
          bgTask.update(taskId, {
            title: i18n.t(
              input.mode === 'edit'
                ? 'admin.simulations.ai_edit.bg_title_ready'
                : 'admin.simulations.ai_gen.bg_title_ready',
              { name: finalTitle || i18n.t('admin.simulations.ai_gen.bg_untitled') },
            ),
          })

          // A la base ANTES de cantar victoria: desde aquí el escenario ya no depende
          // de que este navegador siga vivo. Si la base falla NO se convierte en un
          // error de generación — el escenario está bien y sigue guardado en local;
          // solo se pierde el respaldo entre dispositivos.
          try {
            const draft = await saveAiDraft({
              runKey: key,
              returnPath,
              type: input.type,
              mode: input.mode,
              title: finalTitle,
              campaignId: input.campaignId,
              payload: result,
            })
            patch(key, taskId, { draftId: draft.id })
          } catch (err) {
            console.warn('[simAi] no se pudo respaldar el borrador en la base', err)
          }
          // sticky: el escenario está esperando a que alguien lo cargue en el editor.
          // Si la tarjeta se auto-ocultara (8 s) mientras el capacitador anda en otra
          // pantalla, el resultado quedaría sin rastro visible y los tokens tirados.
          bgTask.succeed(taskId, {
            detail: summary
              ? i18n.t('admin.simulations.ai_edit.bg_done', {
                  count: summary.changed.length + summary.added.length + summary.removed.length,
                })
              : i18n.t('admin.simulations.ai_gen.bg_done'),
            action,
            sticky: true,
            dismissHint: i18n.t('admin.simulations.ai_gen.kept_as_draft'),
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
          // También pegajosa: el error se lee cuando el capacitador vuelve, no antes.
          bgTask.fail(taskId, { detail: message, action, sticky: true })
        }
      })()
    },

    adopt: (draft) => {
      // Una corrida viva manda sobre el respaldo: nunca se pisa trabajo en curso.
      const existing = get().runs[draft.runKey]
      if (existing?.status === 'running') return
      set({
        runs: {
          ...get().runs,
          [draft.runKey]: {
            key: draft.runKey,
            returnPath: draft.returnPath,
            taskId: '',
            input: {
              type: draft.type, mode: draft.mode, description: '',
              length: 'medium', callType: 'auto', translateNow: false,
              existing: null, campaignId: draft.campaignId,
            },
            status: 'done',
            steps: [], stepIdx: 0,
            title: runTitle(draft.mode),
            result: draft.payload,
            // Sin el documento ni el escenario de partida no se puede repetir la
            // corrida: el editor oculta "Regenerar".
            restored: true,
            finishedAt: new Date(draft.createdAt).getTime(),
            draftId: draft.id,
            resolvedTitle: draft.title || undefined,
          },
        },
      })
    },

    cancel: (key) => {
      const run = get().runs[key]
      if (!run || run.status !== 'running') return
      // Aborta el AbortController que vive en el bgTask (mismo que el indicador global).
      useBgTaskStore.getState().requestCancel(run.taskId)
    },

    clear: (key) => {
      const { [key]: gone, ...rest } = get().runs
      set({ runs: rest })
      if (!gone) return
      // El resultado ya se aplicó (o se descartó): la tarjeta pegajosa se va con él.
      bgTask.dismiss(gone.taskId)
      // Y el respaldo también, si llegó a haberlo. Un fallo acá solo deja un
      // borrador de más en la lista: nunca hace perder trabajo.
      if (gone.draftId || gone.status === 'done') {
        void deleteAiDraftByRunKey(key).catch(() => {})
      }
      const { [key]: _dropped, ...keys } = get().appliedKeys
      set({ appliedKeys: keys })
    },

    applied: (key) => {
      const run = get().runs[key]
      const { [key]: _gone, ...rest } = get().runs
      set({
        runs: rest,
        // Cargar en el editor NO es guardar: el respaldo se anota como pendiente y
        // sigue apareciendo en "Borradores" hasta que la simulación se guarde.
        appliedKeys: run ? { ...get().appliedKeys, [key]: run.returnPath } : get().appliedKeys,
      })
      if (run) bgTask.dismiss(run.taskId)
    },

    flushAppliedDrafts: (returnPath) => {
      const entries = Object.entries(get().appliedKeys).filter(([, p]) => p === returnPath)
      if (!entries.length) return
      set({
        appliedKeys: Object.fromEntries(
          Object.entries(get().appliedKeys).filter(([, p]) => p !== returnPath),
        ),
      })
      for (const [key] of entries) void deleteAiDraftByRunKey(key).catch(() => {})
    },
  }
}, {
  name: 'sim-ai-runs',
  storage: createJSONStorage(() => localStorage),
  // Sobrevivir a un F5 es el punto: una simulación generada cuesta tokens y no se
  // puede recuperar del servidor, así que el resultado vive en el navegador hasta
  // que alguien lo aplica o lo descarta.
  partialize: (state) => ({
    runs: Object.fromEntries(
      Object.entries(state.runs).slice(-MAX_PERSISTED).map(([k, r]) => [k, slim(r)]),
    ),
    // Si se recarga entre "cargar en el editor" y "guardar", el borrador sigue
    // pendiente de limpiar: sin esto quedaría para siempre en la base.
    appliedKeys: state.appliedKeys,
  }),
}))

/** Ya se rescataron las corridas de la sesión anterior (una sola vez por carga). */
let recovered = false

/**
 * Vuelve a poner en el indicador las corridas que quedaron guardadas. Se llama al
 * montar la app, no al rehidratar el store, porque necesita i18n ya cargado.
 *
 * Una corrida que estaba 'running' cuando se recargó la página está muerta: la
 * petición viajaba desde este navegador y no hay forma de retomarla. Se marca como
 * error explícito en vez de dejarla girando para siempre.
 */
export function recoverSimAiRuns() {
  if (recovered) return
  recovered = true
  const runs = useSimAiStore.getState().runs
  if (!Object.keys(runs).length) return

  const next: Record<string, SimAiRun> = {}
  for (const [key, entry] of Object.entries(runs)) {
    // El nombre puede venir del resultado guardado aunque no se anotara aparte.
    const saved: SimAiRun = {
      ...entry,
      resolvedTitle:
        entry.resolvedTitle
        || String((entry.result?.metadata as unknown as Record<string, unknown>)?.title_es ?? '').trim()
        || undefined,
    }
    const run: SimAiRun = saved.status === 'running'
      ? {
          ...saved,
          status: 'error',
          error: i18n.t('admin.simulations.ai_gen.interrupted'),
          note: undefined,
          subProgress: undefined,
        }
      : saved
    const done = run.status === 'done'
    const taskId = bgTask.restore({
      title: done
        ? i18n.t(
            run.input.mode === 'edit'
              ? 'admin.simulations.ai_edit.bg_title_ready'
              : 'admin.simulations.ai_gen.bg_title_ready',
            { name: run.resolvedTitle || i18n.t('admin.simulations.ai_gen.bg_untitled') },
          )
        : bgTitle(run.input, run.resolvedTitle),
      detail: done ? i18n.t('admin.simulations.ai_gen.bg_waiting') : run.error,
      status: done ? 'success' : 'error',
      sticky: true,
      dismissHint: done ? i18n.t('admin.simulations.ai_gen.kept_as_draft') : undefined,
      action: {
        label: i18n.t('admin.simulations.ai_gen.bg_open_editor'),
        run: () => globalNavigate(run.returnPath),
      },
    })
    next[key] = { ...run, restored: true, taskId }
  }
  useSimAiStore.setState({ runs: next })
}
