import { useEffect } from 'react'
import { create } from 'zustand'

/**
 * Salud de los servicios (Supabase) vista desde el navegador de cada persona.
 *
 * Por qué existe: cuando la base o el gateway se degradan —la firma clásica es
 * `57014 canceling statement due to statement timeout` en los logs— el sitio no
 * se cae: se pone lentísimo y las pantallas quedan cargando. Sin un aviso, cada
 * quien lo vive como "la plataforma está rota" y lo reporta como bug.
 *
 * Cómo se mide: NO se consulta ninguna página de estado externa (status.supabase.com
 * no permite CORS y, además, un incidente puede afectar solo a este proyecto sin
 * aparecer ahí). Se instrumenta el propio `fetch` del cliente de Supabase y se mira
 * lo que de verdad le pasa a esta persona: cuántas peticiones fallan con 5xx/timeout
 * y cuántas tardan de más en la última ventana de tiempo.
 *
 * No requiere SQL ni desplegar Edge Functions.
 */

export type ServiceStatus =
  /** Todo normal. */
  | 'ok'
  /** Responde, pero tarde: la mayoría de las peticiones recientes son lentas. */
  | 'slow'
  /** Varias peticiones seguidas fallaron (5xx, timeout de sentencia, red caída). */
  | 'down'
  /** El equipo no tiene internet: no es culpa del servidor. */
  | 'offline'

/** Ventana de observación: solo cuentan las peticiones del último minuto. */
const WINDOW_MS = 60_000
/** Tope de muestras guardadas (la app dispara muchas peticiones por vista). */
const MAX_SAMPLES = 60
/** A partir de aquí una petición normal se considera lenta. */
const SLOW_MS = 6_000
/** Mínimo de muestras antes de opinar: con 1 o 2 fallos no se alarma a nadie. */
const MIN_SAMPLES = 3
/** Proporción de la ventana que debe estar mal para encender el aviso. */
const BAD_RATIO = 0.5
const SLOW_RATIO = 0.6

/**
 * Códigos que delatan un problema del lado del servidor.
 * `500` es el que devuelve PostgREST cuando Postgres cancela la consulta por
 * `statement_timeout` (57014); `502/503/504` vienen del gateway saturado.
 */
const BAD_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524])

interface Sample {
  at: number
  bad: boolean
  slow: boolean
}

let samples: Sample[] = []

interface ServiceHealthState {
  status: ServiceStatus
  /** Momento en que se entró al estado actual (para no parpadear en la UI). */
  since: number
}

export const useServiceHealthStore = create<ServiceHealthState>(() => ({
  status: 'ok',
  since: Date.now(),
}))

/**
 * Solo se vigilan la API de datos y la de auth. Quedan fuera a propósito:
 *  · `/functions/v1/` — las generaciones con IA tardan minutos por diseño,
 *  · `/storage/v1/`  — subir un video de 40 MB es lento sin que nada falle.
 * Contarlas convertiría el uso normal en una falsa alarma permanente.
 */
function shouldWatch(url: string): boolean {
  return url.includes('/rest/v1/') || url.includes('/auth/v1/')
}

/** Una petición cancelada por nosotros (AbortController) no es una falla. */
function isAbort(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  )
}

function record(ms: number, bad: boolean) {
  samples.push({ at: Date.now(), bad, slow: !bad && ms >= SLOW_MS })
  if (samples.length > MAX_SAMPLES) samples = samples.slice(-MAX_SAMPLES)
  recomputeStatus()
}

/** Recalcula el estado con lo ocurrido en la ventana; se llama al registrar y por reloj. */
export function recomputeStatus() {
  const cutoff = Date.now() - WINDOW_MS
  samples = samples.filter((s) => s.at >= cutoff)

  let next: ServiceStatus = 'ok'
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    next = 'offline'
  } else if (samples.length >= MIN_SAMPLES) {
    const bad = samples.filter((s) => s.bad).length
    const slow = samples.filter((s) => s.slow).length
    if (bad / samples.length >= BAD_RATIO) next = 'down'
    else if ((bad + slow) / samples.length >= SLOW_RATIO) next = 'slow'
  }

  const cur = useServiceHealthStore.getState().status
  if (cur !== next) useServiceHealthStore.setState({ status: next, since: Date.now() })
}

/**
 * `fetch` instrumentado que se le pasa al cliente de Supabase. Mide y reporta,
 * pero nunca altera el resultado: si algo aquí fallara, la app seguiría igual.
 */
export const healthFetch: typeof fetch = async (input, init) => {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const watch = shouldWatch(url)
  const t0 = Date.now()
  try {
    const res = await fetch(input, init)
    if (watch) record(Date.now() - t0, BAD_STATUSES.has(res.status))
    return res
  } catch (err) {
    if (watch && !isAbort(err)) record(Date.now() - t0, true)
    throw err
  }
}

/**
 * Estado reactivo para la UI. Además del store, mantiene un reloj: si deja de
 * haber tráfico, las muestras vencen y el aviso se apaga solo al normalizarse.
 */
export function useServiceStatus(): ServiceStatus {
  const status = useServiceHealthStore((s) => s.status)
  useEffect(() => {
    const id = window.setInterval(recomputeStatus, 5_000)
    const onNet = () => recomputeStatus()
    window.addEventListener('online', onNet)
    window.addEventListener('offline', onNet)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('online', onNet)
      window.removeEventListener('offline', onNet)
    }
  }, [])
  return status
}
