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

async function post<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No autenticado')

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sim-groq`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
      signal,
    },
  )

  const result = await response.json()
  if (!response.ok || result.error) {
    throw new Error(result.error ?? 'Error en la simulación con IA')
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
