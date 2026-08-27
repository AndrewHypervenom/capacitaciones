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
 * Tres señales se combinan:
 *  1. `manualOut` — el flag global de la base (lo controla el superadmin). Solo
 *     cuenta cuando de verdad se leyó (`loaded`): sin dato no se afirma nada.
 *  2. `detectedOut` — se enciende solo si una generación falla porque Anthropic
 *     devuelve "credit balance is too low" (red de seguridad si el flag global
 *     estaba en `false` pero de verdad se acabó el saldo).
 *  3. `provenOk` — una generación acabó de funcionar: hay saldo, y eso manda
 *     sobre cualquier flag viejo o mal leído.
 */

/**
 * Valor por defecto mientras NO se haya podido leer la base (el ajuste no existe
 * o la lectura falló). Arranca en `false`: afirmar "no hay créditos" sin dato es
 * mentirle al capacitador, y el aviso se quedaba pegado aunque la IA funcionara
 * perfecto. Si de verdad se acaba el saldo, la detección en vivo
 * (`throwAiError` → `markOut`) lo enciende al primer intento fallido.
 */
const DEFAULT_AI_CREDITS_OUT = false

/**
 * ¿El mensaje de error corresponde a "sin créditos / saldo insuficiente" de Anthropic?
 *
 * Tiene que ser ESTRICTO: encender esta señal pausa la IA para todo el mundo
 * (`markOut` la persiste con `mark_ai_credits_out`), así que un "insufficient
 * permissions", un límite de peticiones o nuestro propio cupo diario
 * (`AI_QUOTA_EXCEEDED`, que contiene "quota" y "exceeded") no se pueden colar:
 * el saldo siempre se nombra con crédito/saldo/balance.
 */
export function isAiCreditError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  // Cupo diario propio del sitio: es un tope nuestro, no falta de saldo.
  if (msg.includes('ai_quota_exceeded')) return false

  if (!/credit|balance|saldo|cr[ée]dito|fund/.test(msg)) return false

  return (
    msg.includes('credit balance') ||
    msg.includes('credit_balance') ||
    msg.includes('insufficient') ||
    msg.includes('too low') ||
    msg.includes('billing') ||
    // Anthropic responde 400 con este texto cuando el saldo llega a cero.
    /error 400[\s\S]*credit/.test(msg)
  )
}

interface AiCreditsState {
  /** Flag global leído de la base (o el default mientras carga). */
  manualOut: boolean
  /** Ya se leyó al menos una vez el ajuste desde la base. */
  loaded: boolean
  /** La última lectura del ajuste falló (RLS/red): no sabemos el estado real. */
  readFailed: boolean
  /** Se puso `true` al detectar en vivo un error de saldo insuficiente. */
  detectedOut: boolean
  /**
   * Una generación acabó de funcionar en esta sesión: hay saldo, diga lo que
   * diga el flag. Manda sobre `manualOut` para que el aviso no mienta.
   */
  provenOk: boolean
  setManualOut: (v: boolean) => void
  markLoaded: (v: boolean) => void
  markOut: () => void
  /** Se llama tras una generación exitosa: si había saldo, limpia la detección. */
  markOk: () => void
}

export const useAiCreditsStore = create<AiCreditsState>((set) => ({
  manualOut: DEFAULT_AI_CREDITS_OUT,
  loaded: false,
  readFailed: false,
  detectedOut: false,
  provenOk: false,
  setManualOut: (v) => set({ manualOut: v, provenOk: false }),
  markLoaded: (v) => set({ manualOut: v, loaded: true, readFailed: false, provenOk: false }),
  // Detección en vivo: enciende el aviso local Y global (manualOut) al instante,
  // y lo persiste en la base para que TODOS lo vean tras recargar. Apagarlo queda
  // en manos del superadmin (cuando recargue créditos).
  markOut: () => {
    set({ detectedOut: true, manualOut: true, provenOk: false })
    void reportAiCreditsOut()
  },
  // La prueba más fuerte de que sí hay saldo: acaba de generar. Baja el aviso
  // para quien lo vio, aunque el flag global siga prendido (apagarlo para todos
  // sigue siendo del superadmin, en /admin/ai-usage).
  markOk: () => set({ detectedOut: false, provenOk: true }),
}))

/**
 * Carga el flag global desde la base (una vez, al iniciar sesión). Si el ajuste
 * no existe todavía, conserva el default. No lanza: un fallo de red no debe
 * romper el arranque de la app.
 */
export async function loadAiCreditsSetting(): Promise<void> {
  try {
    const { value, failed } = await getAiCreditsOut()
    if (failed) {
      // No se pudo leer (RLS, red): dejamos el aviso apagado y lo anotamos, en
      // vez de dar por hecho lo peor y pausar la IA a ojos del capacitador.
      useAiCreditsStore.setState({ loaded: true, readFailed: true, manualOut: DEFAULT_AI_CREDITS_OUT })
    } else if (value === null) {
      useAiCreditsStore.setState({ loaded: true, readFailed: false })
    } else {
      useAiCreditsStore.getState().markLoaded(value)
    }
  } catch (e) {
    console.warn('[ai_credits] no se pudo leer el ajuste global:', e)
    useAiCreditsStore.setState({ loaded: true, readFailed: true, manualOut: DEFAULT_AI_CREDITS_OUT })
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

/**
 * ¿Debemos avisar que no hay créditos? Solo cuando lo sabemos: el ajuste ya se
 * leyó y dice que sí, o lo detectamos en vivo. Y nunca si una generación acaba
 * de funcionar en esta sesión.
 */
function outOfCredits(s: AiCreditsState): boolean {
  if (s.provenOk) return false
  if (s.detectedOut) return true
  return s.loaded && s.manualOut
}

export function isAiOutOfCredits(): boolean {
  return outOfCredits(useAiCreditsStore.getState())
}

/** Hook reactivo para la UI: se re-renderiza si cambia cualquiera de las señales. */
export function useAiOutOfCredits(): boolean {
  return useAiCreditsStore(outOfCredits)
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
