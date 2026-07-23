import { supabase } from '@/lib/supabase'
import type { Language } from '@/stores/userStore'

/** Un turno de la conversación (para mandar el historial a Groq). */
export interface SimTurn {
  from: 'agent' | 'customer'
  text: string
}

export interface CallTurnResult {
  reply: string
  /** ids acumulados del checklist que el agente ya cumplió. */
  satisfied: string[]
  /** 0-2: cuánta empatía mostró en el último mensaje. */
  empathyDelta: number
  resolved: boolean
  ended: boolean
}

export interface SimFeedback {
  summary: string
  strengths: string[]
  improvements: string[]
}

/** Por qué falló la IA, para poder decírselo al aprendiz en pantalla. */
export type SimAiErrorKind = 'timeout' | 'unavailable' | 'not_configured' | 'unknown'

export class SimAiError extends Error {
  constructor(public kind: SimAiErrorKind, message: string) {
    super(message)
    this.name = 'SimAiError'
  }
}

/** Tope de espera: sin esto, una función colgada dejaba la UI en "analizando" para siempre. */
const DEFAULT_TIMEOUT_MS = 30_000

async function post<T>(
  body: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  // El reloj arranca ANTES de getSession: un refresco de token colgado también
  // dejaba la UI esperando sin tope.
  const timeoutCtrl = new AbortController()
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs)
  const onOuterAbort = () => timeoutCtrl.abort()
  signal?.addEventListener('abort', onOuterAbort)

  let response: Response
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new SimAiError('unavailable', 'No autenticado')

    response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sim-groq`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(body),
        signal: timeoutCtrl.signal,
      },
    )
  } catch (err) {
    // Si el que abortó fue el llamador, se propaga tal cual (no es un fallo de IA).
    if (signal?.aborted) throw err
    if (err instanceof SimAiError) throw err
    if ((err as Error).name === 'AbortError') {
      throw new SimAiError('timeout', `La IA no respondió en ${Math.round(timeoutMs / 1000)} s`)
    }
    throw new SimAiError('unavailable', 'No se pudo contactar el servicio de IA')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }

  // La función puede no estar desplegada → respuesta sin JSON.
  const result = await response.json().catch(() => null)
  if (!response.ok || !result || result.error) {
    const msg: string = result?.error ?? `Error ${response.status} en el servicio de IA`
    if (response.status === 404) throw new SimAiError('not_configured', 'El servicio de IA no está desplegado')
    if (/GROQ_API_KEY/i.test(msg)) throw new SimAiError('not_configured', msg)
    throw new SimAiError('unknown', msg)
  }
  return result.data as T
}

/** El cliente (Groq) responde libre al mensaje del agente y evalúa los checks. */
export function callTurn(opts: {
  language: Language
  scenario: {
    title: string
    summary: string
    customerName: string
    reason: string
    difficulty: 1 | 2 | 3
    country?: string
    suggestedScript?: string[]
    checklist: { id: string; label: string }[]
  }
  history: SimTurn[]
  agentText: string
  alreadySatisfied: string[]
}, signal?: AbortSignal): Promise<CallTurnResult> {
  return post<CallTurnResult>({ mode: 'call-turn', ...opts }, signal)
}

/** Retroalimentación personalizada de una llamada terminada. */
export function callFeedback(opts: {
  language: Language
  scenario: { title: string; objective: string; customerName: string }
  transcript: SimTurn[]
  metrics: { scorePct: number; checklistPct?: number; empathyPct?: number; resolved?: boolean }
}, signal?: AbortSignal): Promise<SimFeedback> {
  return post<SimFeedback>({ mode: 'call-feedback', ...opts }, signal)
}

/** Retroalimentación personalizada de una simulación de opción múltiple. */
export function choiceFeedback(opts: {
  language: Language
  scenario: { title: string; objective: string; customerName: string }
  transcript: SimTurn[]
  metrics: { scorePct: number }
}, signal?: AbortSignal): Promise<SimFeedback> {
  return post<SimFeedback>({ mode: 'choice-feedback', ...opts }, signal)
}
