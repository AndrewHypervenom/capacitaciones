/// <reference types="vite/client" />
import { supabase } from '@/lib/supabase'
import { usePresenceStore, viewKeyForRoute } from '@/stores/presenceStore'

/**
 * Registro de tráfico: una fila por VISTA visitada, con el tiempo ACTIVO que se
 * pasó en ella. Alimenta el histórico de /admin/traffic (tabla traffic_events).
 *
 * No confundir con la presencia (stores/presenceStore): aquella es efímera y
 * responde "¿quién está ahora mismo?"; esta persiste y responde "¿cuánto se usó
 * y cuándo?". Se escriben aparte a propósito.
 *
 * Reglas que hacen que el dato sea honesto y barato:
 *  · El reloj se PAUSA con la pestaña oculta y tras 3 min sin tocar nada — el
 *    mismo criterio de ausencia de la presencia. Una pestaña abierta toda la
 *    noche no es una hora de uso.
 *  · Solo se escribe al SALIR de la vista (y al cerrar), nunca en cada latido:
 *    una fila por navegación, no una por minuto.
 *  · Las vistas de menos de MIN_DWELL_MS se descartan: son redirecciones
 *    (/admin/overview → /admin/progress) y ensuciarían el "top de vistas".
 *  · Nada de esto puede romper la navegación: todo error se traga en silencio.
 */

const SESSION_KEY = 'traffic_sid'
/** Quieto más de esto = no está usando el sitio (igual que la presencia). */
const IDLE_AFTER_MS = 3 * 60_000
/** Por debajo de esto la vista fue un rebote técnico, no una visita. */
const MIN_DWELL_MS = 1_500
/** Techo por vista: protege de un reloj corrido o una pestaña rara. */
const MAX_ACTIVE_MS = 60 * 60_000

interface Visit {
  route: string
  viewKey: string
  /** Milisegundos activos ya acumulados (los tramos cerrados). */
  activeMs: number
  /** Inicio del tramo activo en curso, o null si está en pausa. */
  since: number | null
  startedAt: number
}

let userId: string | null = null
let role: string | null = null
let homeCampaignId: string | null = null
let sessionId: string | null = null
let visit: Visit | null = null
/** Última ruta declarada, para poder reabrir la visita al volver a la pestaña. */
let lastRoute: string | null = null
let lastInput = Date.now()
let idleTimer: ReturnType<typeof setTimeout> | null = null
let listening = false

/** Móvil / tableta / escritorio a partir del user agent. Suficiente para un KPI. */
function detectDevice(): string {
  const ua = navigator.userAgent
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet'
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return 'mobile'
  return 'desktop'
}

/**
 * Id de la visita. Vive en sessionStorage: sobrevive a recargas y a moverse por
 * el sitio, pero cerrar la pestaña empieza una sesión nueva — que es justo lo
 * que "sesión" significa aquí. En navegación privada puede lanzar; si falla, se
 * usa un id en memoria y la sesión dura lo que dure la página cargada.
 */
function ensureSessionId(): string {
  if (sessionId) return sessionId
  try {
    const stored = sessionStorage.getItem(SESSION_KEY)
    if (stored) { sessionId = stored; return stored }
  } catch { /* almacenamiento bloqueado */ }
  const fresh = crypto.randomUUID()
  try { sessionStorage.setItem(SESSION_KEY, fresh) } catch { /* ídem */ }
  sessionId = fresh
  return fresh
}

/** Campaña que la persona está MIRANDO ahora (no la suya de plantilla). */
function currentCampaignId(): string | null {
  const viewing = usePresenceStore.getState().viewCampaignId
  return viewing ?? homeCampaignId
}

function activeMsOf(v: Visit, now = Date.now()): number {
  const running = v.since != null ? now - v.since : 0
  return Math.min(MAX_ACTIVE_MS, Math.max(0, v.activeMs + running))
}

// ─── Pausar / reanudar el reloj ─────────────────────────────────────────
function pause(): void {
  if (!visit || visit.since == null) return
  visit.activeMs = Math.min(MAX_ACTIVE_MS, visit.activeMs + (Date.now() - visit.since))
  visit.since = null
}

function resume(): void {
  if (!visit || visit.since != null) return
  visit.since = Date.now()
}

function armIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { pause() }, IDLE_AFTER_MS)
}

function markActive(): void {
  const now = Date.now()
  // Estrangulado a 1 s: estos listeners cuelgan de scroll y pointermove.
  if (now - lastInput < 1_000 && visit?.since != null) return
  lastInput = now
  if (document.visibilityState !== 'hidden') resume()
  armIdleTimer()
}

function onVisibility(): void {
  if (document.visibilityState === 'hidden') {
    pause()
    // Ocultar la pestaña puede ser el último evento que veamos (móvil que se
    // bloquea, app que el sistema mata en segundo plano): cerramos la fila ya,
    // aunque la persona siga en la misma vista.
    void flush(true)
  } else {
    // Al volver, `flush` dejó `visit` en null: si no se reabre aquí, el resto
    // de la estadía en esta misma pantalla no se contaría hasta la siguiente
    // navegación. Se abre una visita nueva (dos filas para una estadía partida,
    // que es exactamente lo que pasó).
    if (!visit && lastRoute) openVisit(lastRoute)
    markActive()
  }
}

// ─── Escritura ──────────────────────────────────────────────────────────
/**
 * Cierra la visita en curso y la escribe.
 *
 * `keepalive` la manda con `fetch(..., { keepalive: true })` contra PostgREST:
 * durante `pagehide` el cliente de Supabase no alcanza a terminar su petición
 * normal y la última vista de cada sesión se perdería siempre. No se usa
 * `sendBeacon` porque no permite mandar la cabecera Authorization, y sin ella la
 * RLS rechaza la fila.
 */
async function flush(keepalive = false): Promise<void> {
  const v = visit
  if (!v || !userId) return
  visit = null

  const ms = activeMsOf(v)
  const dwell = Date.now() - v.startedAt
  if (dwell < MIN_DWELL_MS) return

  const row = {
    user_id: userId,
    session_id: ensureSessionId(),
    role,
    campaign_id: currentCampaignId(),
    route: v.route,
    view_key: v.viewKey,
    active_ms: Math.round(ms),
    device: detectDevice(),
    // Sin esto la fila es un INSTANTE (el momento de salir) y la curva de
    // "cuántos a la vez" no puede existir: quien lleva media hora leyendo no
    // aparecería en ninguna franja hasta que navegue. Con started_at la fila es
    // el intervalo en que la persona estuvo presente.
    started_at: new Date(v.startedAt).toISOString(),
  }

  try {
    if (keepalive) {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return
      const url = import.meta.env.VITE_SUPABASE_URL as string
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string
      await fetch(`${url}/rest/v1/traffic_events`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: `Bearer ${token}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(row),
      })
      return
    }
    await supabase.from('traffic_events').insert(row)
  } catch {
    // Medir el tráfico jamás puede estorbar al que navega.
  }
}

function onPageHide(): void {
  pause()
  void flush(true)
}

// ─── API pública ────────────────────────────────────────────────────────
/** Empieza a medir. Idempotente: llamarlo dos veces no duplica listeners. */
export function startTrafficTracking(opts: {
  userId: string
  role: string | null
  campaignId: string | null
}): void {
  userId = opts.userId
  role = opts.role
  homeCampaignId = opts.campaignId
  ensureSessionId()
  if (listening) return
  listening = true

  // `capture: true` porque el panel scrollea dentro de contenedores propios y
  // un listener en burbuja sobre document se perdería esos scrolls.
  const opt = { capture: true, passive: true } as AddEventListenerOptions
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart']) {
    document.addEventListener(ev, markActive, opt)
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
  armIdleTimer()
}

/** Corta la medición (logout). Escribe lo que quedaba pendiente. */
export function stopTrafficTracking(): void {
  pause()
  void flush()
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  if (listening) {
    const opt = { capture: true } as AddEventListenerOptions
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart']) {
      document.removeEventListener(ev, markActive, opt)
    }
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onPageHide)
    listening = false
  }
  userId = null
  role = null
  homeCampaignId = null
  visit = null
  lastRoute = null
  // La sesión NO se borra: si vuelve a entrar en la misma pestaña sigue siendo
  // la misma visita al sitio.
}

function openVisit(route: string): void {
  lastInput = Date.now()
  lastRoute = route
  visit = {
    route,
    viewKey: viewKeyForRoute(route),
    activeMs: 0,
    since: document.visibilityState === 'hidden' ? null : Date.now(),
    startedAt: Date.now(),
  }
  armIdleTimer()
}

/** Declara que se entró a una ruta. Cierra y escribe la anterior. */
export function trackRoute(route: string): void {
  if (!userId) return
  if (visit?.route === route) return
  pause()
  void flush()
  openVisit(route)
}
