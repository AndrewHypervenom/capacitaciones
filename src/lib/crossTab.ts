/**
 * Bus de mensajes entre pestañas del mismo navegador.
 *
 * El problema que resuelve: cada pestaña es una app independiente con su propia
 * copia en memoria. Si en la pestaña A se guarda una simulación y en la B seguía
 * abierta la versión anterior, la B no se entera: muestra datos viejos y —peor—
 * al guardar los escribe encima de lo que hizo A. Eso es lo que se veía como
 * "queda como borrador" o "no me trae lo último".
 *
 * La solución NO es limitar el sitio a una sola pestaña (trabajar con dos es
 * legítimo: el editor en una y el catálogo en otra), sino avisar. Cada pestaña
 * publica lo que cambió y las demás refrescan.
 *
 * Transporte: `BroadcastChannel` cuando existe; si no (Safari viejo), se cae a
 * escribir una llave efímera en `localStorage`, que dispara el evento `storage`
 * en las OTRAS pestañas (nunca en la que escribe: justo lo que se necesita).
 */

/** Identidad de esta pestaña: sirve para ignorar los ecos propios. */
export const TAB_ID: string =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t${Date.now()}${Math.random().toString(36).slice(2)}`

const CHANNEL_NAME = 'learningai.tabs'
const FALLBACK_KEY = 'learningai.tabmsg'

/** Temas que se anuncian. Añadir uno nuevo es solo agregarlo aquí. */
export interface TabMessages {
  /** Alguien creó/editó/borró algo en la base: quien lo muestre debe recargar. */
  'data:changed': { topic: string; id?: string }
  /** Una pestaña reescribió un store persistido en localStorage. */
  'store:written': { key: string }
}

type TabMessageType = keyof TabMessages

interface Envelope {
  type: TabMessageType
  payload: unknown
  from: string
  at: number
}

type Handler = (payload: never) => void

const handlers = new Map<TabMessageType, Set<Handler>>()

let channel: BroadcastChannel | null = null
let started = false

function dispatch(env: Envelope) {
  // Eco propio: BroadcastChannel no se lo entrega al emisor, pero el fallback de
  // localStorage sí puede rebotar en recargas. Filtrar por si acaso.
  if (env.from === TAB_ID) return
  const set = handlers.get(env.type)
  if (!set) return
  for (const fn of set) {
    try {
      ;(fn as (p: unknown) => void)(env.payload)
    } catch {
      /* un suscriptor roto no puede tumbar a los demás */
    }
  }
}

function start() {
  if (started || typeof window === 'undefined') return
  started = true

  if ('BroadcastChannel' in window) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.onmessage = (e) => dispatch(e.data as Envelope)
    } catch {
      channel = null
    }
  }

  // El listener de `storage` se registra siempre: además del fallback del bus,
  // es lo que detecta las escrituras de los stores persistidos (ver tabSync.ts).
  window.addEventListener('storage', (e) => {
    if (e.key !== FALLBACK_KEY || !e.newValue) return
    try {
      dispatch(JSON.parse(e.newValue) as Envelope)
    } catch {
      /* JSON corrupto: ignorar */
    }
  })
}

/** Avisa a las demás pestañas. En la propia no dispara nada. */
export function publishTab<K extends TabMessageType>(type: K, payload: TabMessages[K]): void {
  start()
  const env: Envelope = { type, payload, from: TAB_ID, at: Date.now() }
  if (channel) {
    try {
      channel.postMessage(env)
      return
    } catch {
      /* canal cerrado: seguir por localStorage */
    }
  }
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(env))
  } catch {
    /* almacenamiento lleno o bloqueado: el aviso se pierde, no es crítico */
  }
}

/** Se suscribe a un tema. Devuelve la función para desuscribirse. */
export function onTabMessage<K extends TabMessageType>(
  type: K,
  cb: (payload: TabMessages[K]) => void,
): () => void {
  start()
  let set = handlers.get(type)
  if (!set) {
    set = new Set()
    handlers.set(type, set)
  }
  set.add(cb as Handler)
  return () => {
    set!.delete(cb as Handler)
  }
}

/**
 * Anuncia que un tipo de contenido cambió. Se llama DESPUÉS de que la base
 * confirmó la escritura, para que quien recargue lea lo nuevo y no lo anterior.
 *
 * Los temas son los mismos nombres que usa `useFreshOnFocus`.
 */
export function notifyDataChanged(topic: string, id?: string): void {
  publishTab('data:changed', { topic, id })
}
