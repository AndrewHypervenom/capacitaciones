import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

// ─── Presencia colaborativa en tiempo real ─────────────────────────────
// Estilo Google Docs / Excel de SharePoint: cada miembro del staff (capacitador
// o superadmin) que está dentro del panel emite su "presencia" a un canal por
// campaña usando Supabase Realtime Presence (efímero, en memoria — no requiere
// tablas ni SQL). Así todos ven quién está viendo/editando qué en vivo.
//
// El estado que emite cada persona incluye qué recurso está EDITANDO en este
// momento (módulo/curso/mundo), lo que permite:
//   1. Mostrar avatares apilados de coeditores dentro del editor.
//   2. Marcar en las listas qué ítems tienen a alguien trabajando.
//   3. Advertir el conflicto cuando dos personas abren el mismo módulo.

export type PresenceResourceType =
  | 'module'
  | 'course'
  | 'world'
  | 'simulation'
  | 'choice'

export interface PresenceActivity {
  type: PresenceResourceType
  id: string
  /** Título legible del recurso (para tooltips y avisos). */
  title: string
  /**
   * Sub-ubicación exacta dentro del recurso: sección abierta, pestaña del editor,
   * nivel del mundo… Es lo que distingue "los dos estamos en el mismo módulo" de
   * "los dos estamos en la MISMA sección" (el choque real).
   */
  detail?: string
  /**
   * Campaña dueña del recurso. Quien mira varias campañas (superadmin, o un
   * capacitador con equipos) necesita saberla para plantarse en la campaña
   * correcta al ir a ver dónde está la otra persona.
   */
  campaignId?: string
  /**
   * 'edit' = lo tiene abierto en un editor (puede guardar y pisar cambios).
   * 'view' = solo lo está consumiendo (aprendiz estudiando, vista previa).
   * El aviso de coedición solo cuenta a los 'edit'.
   */
  mode?: 'edit' | 'view'
  /** true = escribiendo/con cambios sin guardar; false = solo mirando. */
  dirty?: boolean
}

/** Un compañero presente en el espacio de trabajo. */
export interface Peer {
  user_id: string
  name: string
  avatar_url: string | null
  /** Color estable derivado del user_id (anillo del avatar, cursor, etc.). */
  color: string
  /** Recurso que está editando ahora mismo, o null si solo navega. */
  activity: PresenceActivity | null
  /** Ruta actual (p. ej. /admin/modules) para contexto. */
  route: string
  /**
   * Campaña que la persona está mirando ahora, sea cual sea la vista (la del
   * selector en las listas, la del recurso en los editores). Es lo que permite
   * que seguir a alguien plante al que sigue en la campaña correcta aunque la
   * otra persona no esté dentro de ningún recurso.
   */
  campaign_id?: string | null
  /** Rol del usuario (superadmin | capacitador | learner) para la etiqueta. */
  role?: string
  /** ISO timestamp de la última vez que se le vio activo. */
  online_at: string
}

interface Me {
  user_id: string
  name: string
  avatar_url: string | null
  role?: string
}

// Paleta de anillos: colores vivos y distinguibles, buenos en claro y oscuro.
const RING_COLORS = [
  '#10D451', // verde corporativo
  '#B33D9E', // magenta corporativo
  '#3B82F6', // azul
  '#F59E0B', // ámbar
  '#EF4444', // rojo
  '#14B8A6', // teal
  '#8B5CF6', // violeta
  '#EC4899', // rosa
  '#F97316', // naranja
  '#06B6D4', // cian
]

/** Ventana para agrupar cambios de presencia en un solo track(). Ver `push`. */
const PUSH_COALESCE_MS = 350

/** Cuánto dura el señalamiento al seguir a alguien antes de apagarse solo. */
const FOCUS_TTL_MS = 8_000

/** ¿Dos actividades dicen exactamente lo mismo? Evita emitir de más. */
function sameActivity(a: PresenceActivity | null, b: PresenceActivity | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.type === b.type &&
    a.id === b.id &&
    a.title === b.title &&
    a.detail === b.detail &&
    a.mode === b.mode &&
    a.campaignId === b.campaignId &&
    !!a.dirty === !!b.dirty
  )
}

/** Color estable y determinista a partir del id de usuario. */
export function colorForUser(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  return RING_COLORS[Math.abs(hash) % RING_COLORS.length]
}

interface PresenceState {
  peers: Peer[]
  me: Me | null
  campaignId: string | null
  channel: RealtimeChannel | null
  activity: PresenceActivity | null
  route: string
  viewCampaignId: string | null

  /** Declara qué campaña estoy mirando (selector de las listas, o el recurso). */
  setViewCampaign: (campaignId: string | null) => void

  /** Conecta al canal de la campaña y empieza a emitir presencia. Idempotente. */
  connect: (campaignId: string, me: Me) => void
  /** Se desconecta y limpia el estado. */
  disconnect: () => void
  /** Declara qué recurso estoy editando (o null si dejo de editar). */
  setActivity: (activity: PresenceActivity | null) => void
  /** Actualiza campos del recurso actual sin reemplazarlo (título, sección…). */
  patchActivity: (patch: Partial<PresenceActivity>) => void
  /** Marca/desmarca cambios sin guardar en el recurso actual. */
  setDirty: (dirty: boolean) => void
  /** Actualiza la sub-ubicación dentro del recurso actual (sección, pestaña…). */
  setDetail: (detail: string | undefined) => void
  /** Actualiza la ruta actual (para contexto de "dónde está"). */
  setRoute: (route: string) => void

  /**
   * Foco activo: a quién estoy siguiendo ahora mismo. Lo pone la barra de
   * presencia al pulsar a alguien y lo leen la vista de destino (para cambiar de
   * campaña y resaltar) y el aviso de vista. Vive en el store y no en la URL
   * porque es un gesto efímero de la sesión: recargar no debería repetirlo.
   */
  focus: PresenceFocus | null
  followPeer: (focus: PresenceFocus) => void
  clearFocus: () => void
}

export const usePresenceStore = create<PresenceState>((set, get) => {
  // Latido: re-emite la presencia periódicamente aunque el usuario no navegue,
  // para que su "online_at" siempre esté fresco y los demás puedan distinguir
  // sesiones vivas de fantasmas (pestañas muertas que aún no dispararon leave).
  let heartbeat: ReturnType<typeof setInterval> | null = null
  // Ver `push`: agrupa las ráfagas de cambios en un solo track().
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  // Ver `followPeer`: apaga el foco pasado un rato.
  let focusTimer: ReturnType<typeof setTimeout> | null = null

  // Reenvía mi estado actual al canal (presence.track).
  const pushNow = async () => {
    const { channel, me, activity, route, viewCampaignId } = get()
    if (!channel || !me) return
    try {
      const status = await channel.track({
        user_id: me.user_id,
        name: me.name,
        avatar_url: me.avatar_url,
        color: colorForUser(me.user_id),
        activity,
        route,
        campaign_id: activity?.campaignId ?? viewCampaignId,
        role: me.role,
        online_at: new Date().toISOString(),
      })
      // 'timed out' = el canal quedó mudo (típico tras saturarlo). No se
      // recupera solo: hay que rearmarlo o la persona desaparece de la lista
      // para todos los demás sin que nada falle a la vista.
      if (status !== 'ok') revive()
    } catch {
      /* canal aún no suscrito; se reintenta al SUBSCRIBED */
    }
  }

  /**
   * Agrupa las ráfagas: al abrir un editor cambian varias cosas en pocos ms (el
   * título que termina de cargar, la sección que se selecciona, el efecto que se
   * rearma). Un track() por cada cambio satura el canal de Realtime, que empieza
   * a responder 'timed out' y deja de emitir presencia para siempre. Con esto,
   * una ráfaga = un solo track.
   */
  const push = () => {
    if (pushTimer) return
    pushTimer = setTimeout(() => {
      pushTimer = null
      void pushNow()
    }, PUSH_COALESCE_MS)
  }

  // Rearma el canal cuando se cae. Con espera creciente para no insistir en
  // bucle si el problema es del servidor.
  let reviving = false
  let reviveDelay = 2_000
  const revive = () => {
    const { campaignId, me } = get()
    if (reviving || !campaignId || !me) return
    reviving = true
    setTimeout(() => {
      reviving = false
      reviveDelay = Math.min(reviveDelay * 2, 30_000)
      const { campaignId: cid, me: m } = get()
      if (!cid || !m) return
      // Forzamos la reconexión saltándonos el atajo de "ya conectado".
      const { channel } = get()
      if (channel) supabase.removeChannel(channel)
      set({ channel: null })
      get().connect(cid, m)
    }, reviveDelay)
  }

  return {
    peers: [],
    me: null,
    campaignId: null,
    channel: null,
    activity: null,
    route: typeof window !== 'undefined' ? window.location.pathname : '',
    viewCampaignId: null,

    setViewCampaign: (campaignId) => {
      if (get().viewCampaignId === campaignId) return
      set({ viewCampaignId: campaignId })
      push()
    },

    connect: (campaignId, me) => {
      const state = get()
      // Ya conectado a la misma campaña con el mismo usuario → no reconectar.
      if (
        state.channel &&
        state.campaignId === campaignId &&
        state.me?.user_id === me.user_id
      ) {
        set({ me })
        push()
        return
      }
      // Cambió la campaña o el usuario → limpiar canal previo.
      if (state.channel) {
        supabase.removeChannel(state.channel)
      }

      const channel = supabase.channel(`workspace-presence:${campaignId}`, {
        config: { presence: { key: me.user_id } },
      })

      const syncPeers = () => {
        const raw = channel.presenceState<Peer>()
        const myId = get().me?.user_id
        const seen = new Map<string, Peer>()
        for (const key of Object.keys(raw)) {
          // Cada key puede tener varias "metas" (varias pestañas). Tomamos la
          // más reciente por online_at.
          const metas = raw[key]
          if (!metas?.length) continue
          const latest = [...metas].sort((a, b) =>
            (b.online_at ?? '').localeCompare(a.online_at ?? ''),
          )[0]
          if (!latest?.user_id || latest.user_id === myId) continue
          seen.set(latest.user_id, latest)
        }
        set({ peers: Array.from(seen.values()) })
      }

      channel
        .on('presence', { event: 'sync' }, syncPeers)
        .on('presence', { event: 'join' }, syncPeers)
        .on('presence', { event: 'leave' }, syncPeers)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            reviveDelay = 2_000 // el canal está sano: se reinicia la espera
            void pushNow()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            revive()
          }
        })

      if (heartbeat) clearInterval(heartbeat)
      // El latido va directo: no tiene sentido agruparlo y es el que detecta
      // (vía pushNow → revive) que el canal se quedó mudo.
      heartbeat = setInterval(() => void pushNow(), 25_000)

      set({ channel, campaignId, me, peers: [] })
    },

    disconnect: () => {
      const { channel } = get()
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
      if (channel) supabase.removeChannel(channel)
      set({ channel: null, campaignId: null, me: null, peers: [], activity: null })
    },

    setActivity: (activity) => {
      const prev = get().activity
      if (sameActivity(prev, activity)) return
      set({ activity })
      push()
    },

    patchActivity: (patch) => {
      const { activity } = get()
      if (!activity) return
      const next = { ...activity, ...patch }
      if (sameActivity(activity, next)) return
      set({ activity: next })
      push()
    },

    setDirty: (dirty) => {
      get().patchActivity({ dirty })
    },

    setDetail: (detail) => {
      get().patchActivity({ detail })
    },

    setRoute: (route) => {
      if (get().route === route) return
      set({ route })
      push()
    },

    focus: null,

    followPeer: (focus) => {
      if (focusTimer) clearTimeout(focusTimer)
      set({ focus })
      // El foco es un señalamiento, no un modo: se apaga solo.
      focusTimer = setTimeout(() => set({ focus: null }), FOCUS_TTL_MS)
    },

    clearFocus: () => {
      if (focusTimer) { clearTimeout(focusTimer); focusTimer = null }
      set({ focus: null })
    },
  }
})

// ─── Ruta → nombre de vista legible ─────────────────────────────────────
// Para mostrar "puntualmente en qué vista está cada persona" (evitar que dos
// editen el mismo módulo sin saberlo). El primer patrón que calce gana.
const VIEW_PATTERNS: Array<[RegExp, string]> = [
  [/^\/admin\/courses\/[^/]+/, 'presence.views.course_editor'],
  [/^\/admin\/courses/, 'presence.views.courses'],
  [/^\/admin\/modules\/new/, 'presence.views.module_new'],
  [/^\/admin\/modules\/[^/]+\/preview/, 'presence.views.module_preview'],
  [/^\/admin\/modules\/[^/]+/, 'presence.views.module_editor'],
  [/^\/admin\/modules/, 'presence.views.modules'],
  [/^\/admin\/users\/[^/]+/, 'presence.views.user_profile'],
  [/^\/admin\/users/, 'presence.views.users'],
  [/^\/admin\/campaigns/, 'presence.views.campaigns'],
  [/^\/admin\/worlds\/[^/]+/, 'presence.views.world_editor'],
  [/^\/admin\/worlds/, 'presence.views.worlds'],
  [/^\/admin\/progress/, 'presence.views.progress'],
  [/^\/admin\/quiz/, 'presence.views.livequiz_admin'],
  [/^\/admin\/simulations/, 'presence.views.simulations'],
  [/^\/admin\/gamification/, 'presence.views.gamification'],
  [/^\/admin\/activity/, 'presence.views.activity'],
  [/^\/admin\/approvals/, 'presence.views.approvals'],
  [/^\/admin\/overview/, 'presence.views.overview'],
  [/^\/admin\/import/, 'presence.views.import'],
  [/^\/admin\/ai-usage/, 'presence.views.ai_usage'],
  [/^\/admin\/chat/, 'presence.views.chat'],
  [/^\/admin/, 'presence.views.admin_home'],
  [/^\/dashboard/, 'presence.views.dashboard'],
  [/^\/courses\/[^/]+/, 'presence.views.course_view'],
  [/^\/courses/, 'presence.views.catalog'],
  [/^\/modules\/[^/]+/, 'presence.views.module_view'],
  [/^\/profile/, 'presence.views.profile'],
  [/^\/feedback/, 'presence.views.feedback'],
  [/^\/simulator/, 'presence.views.simulator'],
  [/^\/certificate/, 'presence.views.certificate'],
  [/^\/quiz/, 'presence.views.livequiz'],
  [/^\/world/, 'presence.views.world'],
  [/^\/arena/, 'presence.views.arena'],
  [/^\/mission/, 'presence.views.mission'],
]

/** Milisegundos sin latido a partir de los cuales un peer se considera dudoso. */
export const STALE_AFTER_MS = 90_000

/** Segundos desde la última señal de vida de un compañero. */
export function secondsSinceSeen(peer: Peer, now = Date.now()): number {
  const t = Date.parse(peer.online_at ?? '')
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : 0
}

// ─── Ruta → destino SEGURO al pulsar a una persona ──────────────────────
// Pulsar a alguien lleva al ÁREA donde está, nunca adentro de lo que tiene
// abierto: los editores autoguardan, así que entrar al módulo que otro edita es
// exactamente el choque que la presencia intenta evitar. Mismo criterio con las
// pantallas del aprendiz: abrirlas registraría progreso/tiempo a nombre de quien
// solo venía a mirar. `null` = no hay a dónde ir (rutas personales).
const SAFE_DESTINATIONS: Array<[RegExp, string | null]> = [
  // Editores y detalles → su lista.
  [/^\/admin\/courses\//, '/admin/courses'],
  [/^\/admin\/modules\//, '/admin/modules'],
  [/^\/admin\/worlds\//, '/admin/worlds'],
  [/^\/admin\/users\//, '/admin/users'],
  // Pantallas del aprendiz → el área de gestión equivalente.
  [/^\/modules\//, '/admin/modules'],
  [/^\/courses\//, '/admin/courses'],
  [/^\/(world|arena|mission)/, '/admin/worlds'],
  [/^\/simulator/, '/admin/simulations'],
  [/^\/quiz/, '/admin/quiz'],
  // Rutas personales de la otra persona: no llevan a ningún lado útil.
  [/^\/(profile|feedback|certificate|verify|dashboard)/, null],
  [/^\/courses$/, '/admin/courses'],
  // Cualquier otra vista del panel es una lista: se puede ir tal cual.
  [/^\/admin/, ''],
]

/**
 * A dónde llevar al pulsar a una persona presente. Devuelve null si no hay
 * destino seguro. Cadena vacía = la propia ruta sirve (ya es una lista).
 */
export function safeDestinationForRoute(route: string): string | null {
  if (!route || !route.startsWith('/')) return null
  for (const [re, dest] of SAFE_DESTINATIONS) {
    if (re.test(route)) return dest === '' ? route : dest
  }
  return null
}

/**
 * Lo que la vista de destino necesita para plantarse donde está la otra persona:
 * su campaña (para el selector de quien ve varias) y el recurso a resaltar.
 *
 * `type: 'view'` = la persona está en la vista entera, no en un ítem concreto
 * (p. ej. mirando la lista de cursos). Entonces no hay nada que resaltar y lo
 * honesto es decir justamente eso.
 */
export interface PresenceFocus {
  type: PresenceResourceType | 'view'
  id?: string
  campaignId?: string
  /** Nombre de quien está ahí, para explicar el resalte. */
  peerName: string
  /** Rótulo de la vista donde está (clave i18n), para el aviso de vista entera. */
  viewKey: string
}

/** Foco a enviar al ir tras un compañero. Nunca null: seguir siempre dice algo. */
export function focusForPeer(peer: Peer): PresenceFocus {
  const a = peer.activity
  const viewKey = viewKeyForRoute(peer.route ?? '')
  // La campaña del recurso manda; si la persona no está dentro de ninguno, vale
  // la que esté mirando en la vista (el selector de las listas).
  const campaignId = a?.campaignId ?? peer.campaign_id ?? undefined
  if (!a?.id) return { type: 'view', campaignId, peerName: peer.name, viewKey }
  return { type: a.type, id: a.id, campaignId, peerName: peer.name, viewKey }
}

/** Clave i18n de la vista donde está un compañero según su ruta. */
export function viewKeyForRoute(route: string): string {
  for (const [re, key] of VIEW_PATTERNS) {
    if (re.test(route)) return key
  }
  return 'presence.views.somewhere'
}

/** Clave i18n del tipo de recurso ("el módulo", "el curso"…) para los rótulos. */
export function kindKeyForType(type: PresenceResourceType): string {
  return `presence.kinds.${type}`
}

/**
 * Selector: compañeros que están en un recurso concreto (excluye al propio).
 * `mode` acota a quienes lo tienen abierto en un editor ('edit') o a quienes solo
 * lo consumen ('view'); sin `mode` devuelve a todos.
 */
export function peersForResource(
  peers: Peer[],
  type: PresenceResourceType,
  id: string,
  mode?: 'edit' | 'view',
): Peer[] {
  return peers.filter(
    (p) =>
      p.activity?.type === type &&
      p.activity.id === id &&
      // Las presencias antiguas no traen `mode`; se asumen de edición porque
      // hasta ahora solo los editores publicaban actividad.
      (!mode || (p.activity.mode ?? 'edit') === mode),
  )
}
