/// <reference types="vite/client" />
import { supabase } from '@/lib/supabase'
import { usePresenceStore, viewKeyForRoute } from '@/stores/presenceStore'

/**
 * Registro de tráfico: una fila por VISTA visitada, viva mientras la persona
 * siga ahí. Alimenta el histórico de /admin/traffic (tabla traffic_events).
 *
 * ── Por qué late ────────────────────────────────────────────────────────
 * La primera versión escribía la fila SOLO al salir de la vista. Consecuencia:
 * quien llevaba veinte minutos leyendo un módulo no existía en la base hasta
 * que navegara, así que la curva de "cuántas personas a la vez" no veía a nadie
 * y el pico salía en 1 aunque hubiera cinco personas dentro.
 *
 * Ahora la fila se INSERTA a los pocos segundos de entrar y se ACTUALIZA cada
 * BEAT_MS mientras la persona siga activa, moviendo `last_seen_at`. Es el mismo
 * principio con el que se cuentan los espectadores simultáneos de un directo:
 * estás dentro mientras sigas latiendo. Una fila por vista, no una por latido,
 * así que los contadores de "vistas" siguen siendo honestos.
 *
 * ── Qué NO cuenta ───────────────────────────────────────────────────────
 * El latido se detiene con la pestaña oculta y tras 3 min sin tocar nada (mismo
 * criterio de ausencia que la presencia). `last_seen_at` se congela ahí, así que
 * una pestaña abandonada toda la noche no suma ni presencia ni tiempo.
 *
 * No confundir con `stores/presenceStore`: aquella es efímera y responde "¿quién
 * está ahora mismo?"; esta persiste y responde "¿cuánto se usó y cuándo?".
 */

const SESSION_KEY = 'traffic_sid'
/** Quieto más de esto = no está usando el sitio (igual que la presencia). */
const IDLE_AFTER_MS = 3 * 60_000
/**
 * Umbral de quietud en las pantallas de ESTUDIO. Leer un módulo largo sin hacer
 * scroll ni tocar nada durante más de tres minutos es lo normal, no ausencia:
 * con el umbral corto los tramos salían cortados en 1 o 2 minutos y el tiempo
 * de lectura se subestimaba sistemáticamente.
 */
const IDLE_AFTER_MS_STUDY = 10 * 60_000

/** Cuánto se le concede a esta ruta antes de darla por ausente. */
function idleLimitFor(route: string | null): number {
  return route && /^\/modules\//.test(route) ? IDLE_AFTER_MS_STUDY : IDLE_AFTER_MS
}

/**
 * Cada cuánto se refresca `last_seen_at` de la vista abierta. Más corto da una
 * curva más fina; más largo, menos escrituras. 30 s es holgado para franjas de
 * 5 minutos y son actualizaciones de dos columnas.
 */
const BEAT_MS = 30_000
/** Por debajo de esto la vista fue un rebote técnico, no una visita. */
const MIN_DWELL_MS = 1_500
/** Techo por vista: protege de un reloj corrido o una pestaña rara. */
const MAX_ACTIVE_MS = 4 * 60 * 60_000

interface Visit {
  /** Id generado aquí para poder ACTUALIZAR la fila en cada latido. */
  id: string
  route: string
  viewKey: string
  /** Milisegundos activos ya acumulados (los tramos cerrados). */
  activeMs: number
  /** Inicio del tramo activo en curso, o null si está en pausa. */
  since: number | null
  startedAt: number
  /** false = la fila todavía no existe en la base. */
  inserted: boolean
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
let beatTimer: ReturnType<typeof setInterval> | null = null
let listening = false

/** Móvil / tableta / escritorio a partir del user agent. Suficiente para un KPI. */
function detectDevice(): string {
  const ua = navigator.userAgent
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet'
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return 'mobile'
  return 'desktop'
}

/**
 * Id de la visita al SITIO. Vive en sessionStorage: sobrevive a recargas y a
 * moverse por el sitio, pero cerrar la pestaña empieza una sesión nueva — que es
 * justo lo que "sesión" significa aquí. En navegación privada puede lanzar; si
 * falla, se usa un id en memoria y la sesión dura lo que dure la página cargada.
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
  idleTimer = setTimeout(() => { pause() }, idleLimitFor(visit?.route ?? lastRoute))
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
    // bloquea, app que el sistema mata en segundo plano): cerramos la fila ya.
    void flush(true)
  } else {
    // Al volver, `flush` dejó `visit` en null: si no se reabre aquí, el resto de
    // la estadía en esta misma pantalla no se contaría hasta la siguiente
    // navegación. Se abre una visita nueva (dos filas para una estadía partida,
    // que es exactamente lo que pasó).
    if (!visit && lastRoute) openVisit(lastRoute)
    markActive()
  }
}

// ─── Escritura ──────────────────────────────────────────────────────────
function payload(v: Visit, now: number) {
  return {
    id: v.id,
    user_id: userId!,
    session_id: ensureSessionId(),
    role,
    campaign_id: currentCampaignId(),
    route: v.route,
    view_key: v.viewKey,
    active_ms: Math.round(activeMsOf(v, now)),
    device: detectDevice(),
    // El par started_at / last_seen_at ES el intervalo de presencia. Sin él la
    // fila sería un instante y no habría forma de saber cuántos coincidieron.
    started_at: new Date(v.startedAt).toISOString(),
    last_seen_at: new Date(now).toISOString(),
  }
}

/**
 * Escritura con `fetch(..., { keepalive: true })` contra PostgREST, para los
 * cierres durante `pagehide`: ahí el cliente de Supabase no alcanza a terminar
 * su petición normal y la última vista de cada sesión se perdería siempre. No se
 * usa `sendBeacon` porque no permite mandar la cabecera Authorization, y sin ella
 * la RLS rechaza la escritura.
 */
async function writeKeepalive(v: Visit, now: number, insert: boolean): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return
  const url = import.meta.env.VITE_SUPABASE_URL as string
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const headers = {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${token}`,
    Prefer: 'return=minimal',
  }
  const body = payload(v, now)
  if (!insert) {
    await fetch(`${url}/rest/v1/traffic_events?id=eq.${v.id}`, {
      method: 'PATCH',
      keepalive: true,
      headers,
      body: JSON.stringify({ active_ms: body.active_ms, last_seen_at: body.last_seen_at }),
    })
  } else {
    await fetch(`${url}/rest/v1/traffic_events`, {
      method: 'POST', keepalive: true, headers, body: JSON.stringify(body),
    })
  }
}

/**
 * Crea la fila la primera vez y la refresca en los latidos siguientes.
 * Devuelve si quedó escrita: el cliente de Supabase NO lanza, devuelve `error`,
 * así que hay que mirarlo o daríamos por insertada una fila que no existe (y
 * todos los latidos siguientes actualizarían la nada).
 */
async function write(v: Visit, now: number, keepalive: boolean, insert: boolean): Promise<boolean> {
  try {
    if (keepalive) { await writeKeepalive(v, now, insert); return true }
    const body = payload(v, now)
    if (!insert) {
      const { error } = await supabase.from('traffic_events')
        .update({ active_ms: body.active_ms, last_seen_at: body.last_seen_at })
        .eq('id', v.id)
      return !error
    }
    const { error } = await supabase.from('traffic_events').insert(body)
    return !error
  } catch {
    // Medir el tráfico jamás puede estorbar al que navega.
    return false
  }
}

/**
 * Latido: mantiene viva la fila de la vista abierta.
 *
 * No escribe si el reloj está en pausa (pestaña oculta o 3 min sin tocar nada):
 * ahí `last_seen_at` debe quedarse quieto, que es lo que hace que una pestaña
 * abandonada deje de contar como persona presente.
 */
function beat(): void {
  const v = visit
  if (!v || !userId || v.since == null) return
  const now = Date.now()
  if (now - v.startedAt < MIN_DWELL_MS) return
  // `insert` va como ARGUMENTO y no se lee de `v.inserted` dentro de `write`.
  // La bandera se sube aquí, antes de esperar la respuesta, para que dos latidos
  // seguidos no creen dos filas — y leerla dentro de `write` significaba que la
  // primera escritura ya la veía en true y salía como UPDATE de una fila
  // inexistente. PostgREST contesta 204 a eso (cero filas tocadas, sin error),
  // así que la fila no se creaba nunca y nadie se enteraba.
  const insert = !v.inserted
  v.inserted = true
  void write(v, now, false, insert).then((ok) => { if (!ok && insert) v.inserted = false })
}

/** Cierra la visita en curso y escribe su estado final. */
function flush(keepalive = false): void {
  const v = visit
  if (!v || !userId) return
  visit = null

  const now = Date.now()
  // Rebote técnico (/admin/overview → /admin/progress): si nunca llegó a
  // escribirse, no se escribe ahora. Si ya existía la fila hay que cerrarla igual.
  if (now - v.startedAt < MIN_DWELL_MS && !v.inserted) return

  void write(v, now, keepalive, !v.inserted)
}

function onPageHide(): void {
  pause()
  flush(true)
}

// ─── API pública ────────────────────────────────────────────────────────
/** Empieza a medir. Idempotente: llamarlo dos veces no duplica listeners. */
export function startTrafficTracking(opts: {
  userId: string
  role: string | null
  campaignId: string | null
  /** Ruta en la que está la persona AHORA (la que cargó el navegador). */
  route: string
}): void {
  userId = opts.userId
  role = opts.role
  homeCampaignId = opts.campaignId
  ensureSessionId()

  // La primera vista de la sesión se abre AQUÍ y no en `trackRoute`. Al cargar
  // la página el perfil todavía no ha llegado, así que el efecto de la ruta ya
  // corrió sin `userId` y se salió; como la ruta no cambia, no vuelve a correr.
  // Sin esto, quien entra y se queda quieto en la pantalla de destino no deja
  // ninguna fila: solo se registraba a partir de la SEGUNDA navegación.
  if (!visit) openVisit(opts.route)

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
  if (!beatTimer) beatTimer = setInterval(beat, BEAT_MS)
  armIdleTimer()
}

/** Corta la medición (logout). Escribe lo que quedaba pendiente. */
export function stopTrafficTracking(): void {
  pause()
  flush()
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  if (beatTimer) { clearInterval(beatTimer); beatTimer = null }
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
    id: crypto.randomUUID(),
    route,
    viewKey: viewKeyForRoute(route),
    activeMs: 0,
    since: document.visibilityState === 'hidden' ? null : Date.now(),
    startedAt: Date.now(),
    inserted: false,
  }
  armIdleTimer()
  // Primer registro pronto, sin esperar el latido completo: así alguien que
  // acaba de entrar ya aparece en la franja de 5 minutos en curso. La guarda por
  // id evita que este disparo tardío reviva una visita que ya se cerró.
  const id = visit.id
  setTimeout(() => { if (visit?.id === id) beat() }, MIN_DWELL_MS + 500)
}

/** Declara que se entró a una ruta. Cierra y escribe la anterior. */
export function trackRoute(route: string): void {
  if (!userId) return
  if (visit?.route === route) return
  pause()
  flush()
  openVisit(route)
}
