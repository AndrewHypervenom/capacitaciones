/**
 * Sincroniza entre pestañas los stores que viven en `localStorage`.
 *
 * Sin esto, cada pestaña arrancaba leyendo el localStorage UNA vez y a partir de
 * ahí mandaba su copia en memoria. La última pestaña en escribir pisaba a la
 * otra con un estado viejo: se completaba un módulo en una pestaña y al volver a
 * la otra "no estaba", o el resultado de una generación de IA desaparecía.
 *
 * El evento `storage` del navegador solo se dispara en las OTRAS pestañas (nunca
 * en la que escribió), que es exactamente el disparador que hace falta. Al
 * recibirlo, cada store decide cómo incorporar lo ajeno:
 *
 * - **fusión aditiva** cuando perder datos sería grave (progreso, corridas de IA).
 * - **rehidratar** cuando es una preferencia y basta con la última voluntad.
 */
import { useProgressStore, type ProgressState } from '@/stores/progressStore'
import { useSimAiStore, type SimAiRun } from '@/stores/simAiStore'
import { useUserStore } from '@/stores/userStore'
import { useNotificationPrefs } from '@/stores/notificationPrefsStore'
import { useCampaignScope } from '@/stores/campaignScopeStore'
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode'

/** Envoltura que escribe el middleware `persist` de zustand. */
interface PersistEnvelope<T> {
  state: T
  version?: number
}

function readPersisted<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PersistEnvelope<T>
    return (parsed?.state ?? null) as T | null
  } catch {
    return null
  }
}

/** Store con `persist`: zustand le cuelga `.persist.rehydrate()`. */
interface Rehydratable {
  persist: { rehydrate: () => void | Promise<void> }
}

/** Preferencias: la última voluntad gana, no hay nada que fusionar. */
const REHYDRATE_ON_CHANGE: Record<string, Rehydratable> = {
  'learningai.user': useUserStore as unknown as Rehydratable,
  'learningai.notifPrefs': useNotificationPrefs as unknown as Rehydratable,
  'campaign-scope': useCampaignScope as unknown as Rehydratable,
}

function syncProgress(raw: string | null) {
  // Vista previa del capacitador: su progreso vive en memoria y no debe mezclarse
  // con el real de la pestaña de al lado (ver previewMode.ts).
  if (IS_LEARNER_PREVIEW) return
  const incoming = readPersisted<Partial<ProgressState>>(raw)
  if (incoming) useProgressStore.getState().mergeFromTab(incoming)
}

function syncSimAi(raw: string | null) {
  const incoming = readPersisted<{
    runs?: Record<string, SimAiRun>
    appliedKeys?: Record<string, string>
  }>(raw)
  if (!incoming?.runs) return

  const local = useSimAiStore.getState()
  const runs: Record<string, SimAiRun> = { ...incoming.runs, ...local.runs }

  // Una corrida 'running' solo existe de verdad en la pestaña que la lanzó: su
  // petición viaja desde ahí. Lo que la otra pestaña tenga guardado de esa misma
  // clave es una foto anterior, así que la local manda mientras siga corriendo.
  // Al revés: si la otra pestaña ya la terminó, ese resultado —que costó
  // tokens— es lo que vale.
  for (const [key, mine] of Object.entries(local.runs)) {
    const theirs = incoming.runs[key]
    if (!theirs) continue
    if (mine.status === 'running') runs[key] = mine
    else if (theirs.status === 'done' && mine.status !== 'done') runs[key] = theirs
  }

  const appliedKeys = { ...incoming.appliedKeys, ...local.appliedKeys }

  // CRÍTICO: si la fusión no aporta nada, no escribir. Cada `setState` reescribe
  // el localStorage, lo que dispara el evento `storage` en la otra pestaña, que
  // volvería a fusionar y a escribir: un ping-pong infinito entre las dos.
  const same =
    JSON.stringify(Object.keys(runs).sort()) === JSON.stringify(Object.keys(local.runs).sort())
    && Object.entries(runs).every(([k, r]) => r === local.runs[k])
    && JSON.stringify(appliedKeys) === JSON.stringify(local.appliedKeys)
  if (same) return

  useSimAiStore.setState({ runs, appliedKeys })
}

const MERGE_ON_CHANGE: Record<string, (raw: string | null) => void> = {
  'learningai.progress': syncProgress,
  'sim-ai-runs': syncSimAi,
}

let started = false

/** Se llama una vez al arrancar la app (App.tsx). */
export function initTabSync(): void {
  if (started || typeof window === 'undefined') return
  started = true

  window.addEventListener('storage', (e) => {
    if (!e.key) return
    // Reescritura idéntica: no hay nada nuevo que incorporar. Los navegadores ya
    // suelen no emitir el evento en ese caso, pero no depender de eso es lo que
    // garantiza que rehidratar no pueda encadenarse entre pestañas sin fin.
    if (e.newValue === e.oldValue) return

    const merge = MERGE_ON_CHANGE[e.key]
    if (merge) {
      merge(e.newValue)
      return
    }

    const store = REHYDRATE_ON_CHANGE[e.key]
    // `newValue` nulo = la llave se borró (cerrar sesión, limpiar): rehidratar
    // igual, para que esta pestaña también se entere de que ya no hay nada.
    if (store) void store.persist.rehydrate()
  })
}
