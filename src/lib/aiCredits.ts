import { create } from 'zustand'
import i18n from '@/i18n'
import { getAiCreditsOut, setAiCreditsOut, reportAiCreditsOut } from '@/services/appSettings.service'

/**
 * Estado de los créditos de la API de Claude (Anthropic).
 *
 * La fuente de verdad es un ajuste GLOBAL en la base (`app_settings.ai_credits_out`)
 * que el superadmin prende/apaga desde /admin/ai-usage. Así el aviso es igual para
 * todos los capacitadores, sin tocar código ni redesplegar.
 *
 * Dos señales se combinan:
 *  1. `manualOut` — el flag global de la base (lo controla el superadmin).
 *  2. `detectedOut` — se enciende solo si una generación falla porque Anthropic
 *     devuelve "credit balance is too low" (red de seguridad si el flag global
 *     estaba en `false` pero de verdad se acabó el saldo).
 */

/**
 * Valor por defecto mientras NO se haya podido leer la base (p. ej. el SQL de
 * `app_settings` todavía no se corrió). Hoy no hay créditos, así que arranca en
 * `true`: es más seguro avisar de más que dejar generar creyendo que hay saldo.
 * Una vez que exista el ajuste en la base, ese valor manda.
 */
const DEFAULT_AI_CREDITS_OUT = true

/** ¿El mensaje de error corresponde a "sin créditos / saldo insuficiente" de Anthropic? */
export function isAiCreditError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  return (
    msg.includes('credit balance') ||
    msg.includes('credit balance is too low') ||
    msg.includes('insufficient') ||
    msg.includes('billing') ||
    (msg.includes('quota') && msg.includes('exceed')) ||
    // Anthropic responde 400 con este texto cuando el saldo llega a cero.
    /error 400[\s\S]*credit/.test(msg)
  )
}

interface AiCreditsState {
  /** Flag global leído de la base (o el default mientras carga). */
  manualOut: boolean
  /** Ya se leyó al menos una vez el ajuste desde la base. */
  loaded: boolean
  /** Se puso `true` al detectar en vivo un error de saldo insuficiente. */
  detectedOut: boolean
  setManualOut: (v: boolean) => void
  markLoaded: (v: boolean) => void
  markOut: () => void
  /** Se llama tras una generación exitosa: si había saldo, limpia la detección. */
  markOk: () => void
}

export const useAiCreditsStore = create<AiCreditsState>((set) => ({
  manualOut: DEFAULT_AI_CREDITS_OUT,
  loaded: false,
  detectedOut: false,
  setManualOut: (v) => set({ manualOut: v }),
  markLoaded: (v) => set({ manualOut: v, loaded: true }),
  // Detección en vivo: enciende el aviso local Y global (manualOut) al instante,
  // y lo persiste en la base para que TODOS lo vean tras recargar. Apagarlo queda
  // en manos del superadmin (cuando recargue créditos).
  markOut: () => {
    set({ detectedOut: true, manualOut: true })
    void reportAiCreditsOut()
  },
  markOk: () => set({ detectedOut: false }),
}))

/**
 * Carga el flag global desde la base (una vez, al iniciar sesión). Si el ajuste
 * no existe todavía, conserva el default. No lanza: un fallo de red no debe
 * romper el arranque de la app.
 */
export async function loadAiCreditsSetting(): Promise<void> {
  try {
    const out = await getAiCreditsOut()
    if (out === null) {
      useAiCreditsStore.setState({ loaded: true })
    } else {
      useAiCreditsStore.getState().markLoaded(out)
    }
  } catch {
    useAiCreditsStore.setState({ loaded: true })
  }
}

/**
 * Cambia el flag global (persiste en la base y actualiza el estado local al toque).
 * Solo el superadmin pasa la RLS de escritura; si falla, revierte el optimismo.
 */
export async function updateAiCreditsSetting(out: boolean): Promise<void> {
  const prev = useAiCreditsStore.getState().manualOut
  useAiCreditsStore.getState().setManualOut(out)
  try {
    await setAiCreditsOut(out)
    // Si el superadmin marca "sí hay créditos", también limpiamos la detección
    // en vivo para que el aviso desaparezca de inmediato.
    if (!out) useAiCreditsStore.getState().markOk()
  } catch (e) {
    useAiCreditsStore.getState().setManualOut(prev)
    throw e
  }
}

/** ¿Debemos avisar que no hay créditos? (flag global o detectado en vivo). */
export function isAiOutOfCredits(): boolean {
  const s = useAiCreditsStore.getState()
  return s.manualOut || s.detectedOut
}

/** Hook reactivo para la UI: se re-renderiza si cambia cualquiera de las dos señales. */
export function useAiOutOfCredits(): boolean {
  return useAiCreditsStore((s) => s.manualOut || s.detectedOut)
}

/** Mensaje amable y localizado para mostrarle al capacitador/superadmin. */
export function aiCreditsMessage(): string {
  return i18n.t('ai_credits.error')
}

/**
 * Punto único para lanzar errores de las llamadas de IA. Si el error es por saldo,
 * marca el estado global y reemplaza el texto técnico de Anthropic ("Anthropic API
 * error 400: {...}") por un mensaje claro. Cualquier otro error se propaga tal cual.
 */
export function throwAiError(rawMessage: string): never {
  if (isAiCreditError(rawMessage)) {
    useAiCreditsStore.getState().markOut()
    throw new Error(aiCreditsMessage())
  }
  throw new Error(rawMessage)
}
