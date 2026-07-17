import { create } from 'zustand'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

// ─── Presencia colaborativa en tiempo real ─────────────────────────────
// Estilo Google Docs / Excel de SharePoint: cada usuario emite su "presencia" a
// canales de Supabase Realtime Presence (efímero, en memoria — no requiere
// tablas ni SQL). Sirve para que dos personas no editen el mismo recurso a la
// vez y se pisen los guardados.
//
// El estado que emite cada persona incluye qué recurso está EDITANDO en este
// momento (módulo/curso/mundo), lo que permite:
//   1. Mostrar avatares apilados de coeditores dentro del editor.
//   2. Marcar en las listas qué ítems tienen a alguien trabajando.
//   3. Advertir el conflicto cuando dos personas abren el mismo módulo.
//
// ─── Quién ve a quién ───────────────────────────────────────────────────
// La visibilidad se aplica en DOS capas, y ese es el punto importante:
//
//   1. Capa de red (`presenceChannelsFor`): a qué canales te suscribes y con qué
//      detalle te anuncias en cada uno. Un capacitador solo se suscribe a los de
//      SUS campañas, así que la presencia de un capacitador sin campañas en
//      común nunca le llega. El superadmin escucha todos los canales de campaña
//      pero no publica su ubicación en ellos.
//   2. Capa de pantalla (`canSeePeer`): filtra lo que sí llega. El aprendiz
//      emite (para que el superadmin lo vea) pero no ve a nadie.
//
// Reglas: superadmin ve a todos · capacitador ve capacitadores con campaña
// compartida · aprendiz no ve a nadie.
//
// El superadmin es el caso fino: los capacitadores lo ven "en línea" pero sin
// ubicación, porque su panel tiene vistas que no les corresponden. La excepción
// es editar: mientras tiene abierto un recurso de una campaña de ellos, sí
// publica ahí su ubicación exacta (`editingChannelFor`), que para eso existe
// todo esto — que no editen lo mismo a la vez.
//
// Límite conocido: sin RLS de Realtime (canales privados), quien comparte canal
// puede leerlo desde la consola del navegador. Por eso el reparto de canales de
// arriba es lo que de verdad separa; el filtro de pantalla es la segunda capa.

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

/**
 * Reparto de canales de una persona. `emit` son los canales donde publico mi
 * presencia completa (y por tanto también recibo la de quien esté ahí);
 * `emitRedacted` son aquellos donde publico solo mi identidad, sin ubicación; y
 * `listen` son canales donde solo escucho, sin anunciarme.
 */
export interface PresenceChannels {
  emit: string[]
  emitRedacted: string[]
  listen: string[]
}

/** Canal donde se anuncian entre sí los superadmin (los capacitadores no entran). */
const SUPERADMIN_CHANNEL = 'presence:superadmin'

/**
 * Canal por el que el superadmin se anuncia ante los capacitadores SIN decir
 * dónde está. El panel del superadmin tiene vistas que un capacitador no debe
 * conocer, así que aquí solo viaja su identidad ("Superadmin · en línea").
 * Su ubicación exacta la publica aparte, en el canal de la campaña del recurso
 * que esté editando — y solo mientras lo edita.
 */
const SUPERADMIN_LITE_CHANNEL = 'presence:superadmin-lite'

/**
 * Canal de los aprendices sin campaña. Sin él serían invisibles hasta para el
 * superadmin, que debe ver a todo el mundo. Solo el superadmin lo escucha, y
 * entre aprendices nadie se ve (`canSeePeer`), así que no filtra nada.
 */
const UNASSIGNED_CHANNEL = 'presence:unassigned'

/** Canal de presencia de una campaña. */
export function campaignChannel(campaignId: string): string {
  return `presence:campaign:${campaignId}`
}

/**
 * A qué canales se conecta cada rol. Es la capa que de verdad separa la
 * información (ver la nota de arriba).
 *
 * - superadmin: escucha todas las campañas sin emitir en ellas, así ve a todo el
 *   mundo. Se anuncia completo entre superadmins y redactado (sin ubicación)
 *   ante los capacitadores. Su ubicación solo sale del canal de superadmins
 *   cuando `editingChannelFor` lo publica en la campaña que está editando.
 * - capacitador: emite y escucha en los canales de sus campañas. Si no comparte
 *   campaña con nadie, no coincide con nadie ahí. Escucha además el canal
 *   redactado del superadmin.
 * - aprendiz: emite en el de su campaña para que el superadmin lo vea; lo que
 *   reciba lo descarta `canSeePeer`.
 *
 * Un capacitador sin campañas no emite ni recibe presencia de nadie salvo el
 * "en línea" del superadmin. Es coherente con que el panel le muestre "No tienes
 * campañas asignadas": no puede editar nada, así que no hay coedición que avisar.
 */
export function presenceChannelsFor(opts: {
  role: string | null | undefined
  campaignIds: string[]
}): PresenceChannels {
  const { role, campaignIds } = opts
  const channels = Array.from(new Set(campaignIds.filter(Boolean))).map(campaignChannel)
  if (role === 'superadmin') {
    return {
      emit: [SUPERADMIN_CHANNEL],
      emitRedacted: [SUPERADMIN_LITE_CHANNEL],
      listen: [...channels, UNASSIGNED_CHANNEL],
    }
  }
  if (role === 'capacitador') {
    return { emit: channels, emitRedacted: [], listen: [SUPERADMIN_LITE_CHANNEL] }
  }
  return {
    emit: channels.length > 0 ? channels : role === 'learner' ? [UNASSIGNED_CHANNEL] : [],
    emitRedacted: [],
    listen: [],
  }
}

/**
 * Canal donde publicar mi ubicación exacta ADEMÁS de los fijos, o null.
 *
 * Solo aplica al superadmin: mientras edita un recurso, se anuncia completo en
 * el canal de la campaña de ESE recurso, para que sus capacitadores lo vean y no
 * abran lo mismo. Fuera de eso no publica ubicación en ninguna campaña, así que
 * sus vistas reservadas y lo que toque en otras campañas no se filtran.
 *
 * Requiere `mode: 'edit'`: mirar no pisa el trabajo de nadie, y anunciarse por
 * mirar sí revelaría de más.
 */
export function editingChannelFor(
  role: string | null | undefined,
  activity: PresenceActivity | null,
): string | null {
  if (role !== 'superadmin') return null
  if (!activity?.campaignId || (activity.mode ?? 'edit') !== 'edit') return null
  return campaignChannel(activity.campaignId)
}

/**
 * ¿Puedo ver a esta persona en pantalla? Segunda capa: lo que la capa de red no
 * pudo evitar que llegue (mi propia campaña) se filtra aquí.
 */
export function canSeePeer(myRole: string | null | undefined, peerRole: string | null | undefined): boolean {
  if (myRole === 'superadmin') return true
  // El capacitador ve capacitadores (estar en el canal ya implica campaña
  // compartida) y al superadmin, que llega sin ubicación salvo que esté editando
  // algo de esta campaña. No ve aprendices.
  if (myRole === 'capacitador') return peerRole === 'capacitador' || peerRole === 'superadmin'
  return false
}

interface PresenceState {
  peers: Peer[]
  me: Me | null
  channels: PresenceChannels | null
  activity: PresenceActivity | null
  route: string
  viewCampaignId: string | null

  /** Declara qué campaña estoy mirando (selector de las listas, o el recurso). */
  setViewCampaign: (campaignId: string | null) => void

  /** Conecta a los canales indicados y empieza a emitir presencia. Idempotente. */
  connect: (channels: PresenceChannels, me: Me) => void
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

  // Canales vivos. `emitChannels` (completo) y `redactedChannels` (solo
  // identidad) son subconjuntos de `allChannels`: en los de solo escucha
  // (superadmin sobre las campañas) nunca se llama track.
  let emitChannels: RealtimeChannel[] = []
  let redactedChannels: RealtimeChannel[] = []
  let allChannels: RealtimeChannel[] = []
  const channelsByName = new Map<string, RealtimeChannel>()
  // Canal de campaña donde el superadmin está publicando su ubicación por estar
  // editando. Se recuerda para poder retirarse (untrack) al dejar de editar.
  let editingChannelName: string | null = null

  /** Anuncio completo: dónde estoy exactamente. */
  const fullPayload = () => {
    const { me, activity, route, viewCampaignId } = get()
    if (!me) return null
    return {
      user_id: me.user_id,
      name: me.name,
      avatar_url: me.avatar_url,
      color: colorForUser(me.user_id),
      activity,
      route,
      campaign_id: activity?.campaignId ?? viewCampaignId,
      role: me.role,
      online_at: new Date().toISOString(),
    }
  }

  /**
   * Anuncio redactado: existo, pero no digo dónde. Sin `activity`, sin `route` y
   * sin `campaign_id` — nada de aquí puede delatar una vista reservada.
   */
  const redactedPayload = () => {
    const { me } = get()
    if (!me) return null
    return {
      user_id: me.user_id,
      name: me.name,
      avatar_url: me.avatar_url,
      color: colorForUser(me.user_id),
      activity: null,
      route: '',
      campaign_id: null,
      role: me.role,
      online_at: new Date().toISOString(),
    }
  }

  const trackOn = async (channel: RealtimeChannel, payload: object) => {
    try {
      const status = await channel.track(payload)
      // 'timed out' = el canal quedó mudo (típico tras saturarlo). No se
      // recupera solo: hay que rearmarlo o la persona desaparece de la lista
      // para todos los demás sin que nada falle a la vista.
      if (status !== 'ok') revive()
    } catch {
      /* canal aún no suscrito; se reintenta al SUBSCRIBED */
    }
  }

  // Reenvía mi estado actual a los canales donde me anuncio (presence.track).
  const pushNow = async () => {
    const { me, activity } = get()
    if (!me) return
    const full = fullPayload()
    const redacted = redactedPayload()
    if (!full || !redacted) return

    for (const channel of emitChannels) await trackOn(channel, full)
    for (const channel of redactedChannels) await trackOn(channel, redacted)

    // Ubicación exacta del superadmin en la campaña que edita: aparece al entrar
    // al recurso y se retira en cuanto lo deja.
    const next = editingChannelFor(me.role, activity)
    if (editingChannelName && editingChannelName !== next) {
      await channelsByName.get(editingChannelName)?.untrack().catch(() => {})
      editingChannelName = null
    }
    if (next) {
      const channel = channelsByName.get(next)
      // Sin canal suscrito no hay a dónde publicar: pasa si al superadmin le
      // llega un recurso de una campaña creada después de conectarse.
      if (channel) {
        await trackOn(channel, full)
        editingChannelName = next
      }
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

  /** ¿Los dos repartos de canales son el mismo? Evita reconectar de gratis. */
  const sameChannels = (a: PresenceChannels | null, b: PresenceChannels): boolean => {
    if (!a) return false
    const key = (c: PresenceChannels) =>
      [c.emit, c.emitRedacted, c.listen].map((l) => [...l].sort().join(',')).join('|')
    return key(a) === key(b)
  }

  // Junta la presencia de TODOS los canales (el superadmin escucha varios) y
  // deja fuera a quien no me toca ver. Al deduplicar por user_id, alguien que
  // aparece en dos canales míos cuenta una sola vez.
  const syncPeers = () => {
    const { me } = get()
    const myId = me?.user_id
    const seen = new Map<string, Peer>()
    for (const channel of allChannels) {
      const raw = channel.presenceState<Peer>()
      for (const key of Object.keys(raw)) {
        // Cada key puede tener varias "metas" (varias pestañas). Tomamos la
        // más reciente por online_at.
        const metas = raw[key]
        if (!metas?.length) continue
        const latest = [...metas].sort((a, b) =>
          (b.online_at ?? '').localeCompare(a.online_at ?? ''),
        )[0]
        if (!latest?.user_id || latest.user_id === myId) continue
        if (!canSeePeer(me?.role, latest.role)) continue
        const prev = seen.get(latest.user_id)
        // La misma persona puede llegar por dos canales: el superadmin se
        // anuncia redactado y, si edita algo de esta campaña, también completo.
        // Gana siempre el anuncio que trae ubicación, sea o no el más reciente.
        if (prev) {
          if (prev.activity && !latest.activity) continue
          if (!!prev.activity === !!latest.activity && (prev.online_at ?? '') >= (latest.online_at ?? '')) continue
        }
        seen.set(latest.user_id, latest)
      }
    }
    set({ peers: Array.from(seen.values()) })
  }

  const teardown = () => {
    for (const channel of allChannels) supabase.removeChannel(channel)
    emitChannels = []
    redactedChannels = []
    allChannels = []
    channelsByName.clear()
    editingChannelName = null
  }

  // Rearma los canales cuando se caen. Con espera creciente para no insistir en
  // bucle si el problema es del servidor.
  let reviving = false
  let reviveDelay = 2_000
  const revive = () => {
    const { channels, me } = get()
    if (reviving || !channels || !me) return
    reviving = true
    setTimeout(() => {
      reviving = false
      reviveDelay = Math.min(reviveDelay * 2, 30_000)
      const { channels: c, me: m } = get()
      if (!c || !m) return
      // Forzamos la reconexión saltándonos el atajo de "ya conectado".
      teardown()
      set({ channels: null })
      get().connect(c, m)
    }, reviveDelay)
  }

  return {
    peers: [],
    me: null,
    channels: null,
    activity: null,
    route: typeof window !== 'undefined' ? window.location.pathname : '',
    viewCampaignId: null,

    setViewCampaign: (campaignId) => {
      if (get().viewCampaignId === campaignId) return
      set({ viewCampaignId: campaignId })
      push()
    },

    connect: (channels, me) => {
      const state = get()
      // Mismos canales y mismo usuario → no reconectar.
      if (sameChannels(state.channels, channels) && state.me?.user_id === me.user_id) {
        set({ me })
        push()
        return
      }
      // Cambiaron los canales o el usuario → limpiar los previos.
      teardown()

      const open = (name: string, kind: 'full' | 'redacted' | 'listen') => {
        const channel = supabase.channel(name, {
          config: { presence: { key: me.user_id } },
        })
        channel
          .on('presence', { event: 'sync' }, syncPeers)
          .on('presence', { event: 'join' }, syncPeers)
          .on('presence', { event: 'leave' }, syncPeers)
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              reviveDelay = 2_000 // el canal está sano: se reinicia la espera
              if (kind !== 'listen') void pushNow()
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              revive()
            }
          })
        allChannels.push(channel)
        channelsByName.set(name, channel)
        if (kind === 'full') emitChannels.push(channel)
        if (kind === 'redacted') redactedChannels.push(channel)
      }

      for (const name of channels.emit) open(name, 'full')
      // Identidad sin ubicación (el superadmin ante los capacitadores).
      for (const name of channels.emitRedacted) open(name, 'redacted')
      // Solo escucha: aquí NO se llama track por defecto, y por eso el superadmin
      // no aparece en las campañas que vigila salvo que esté editando en ellas
      // (ver `editingChannelFor` en pushNow).
      for (const name of channels.listen) open(name, 'listen')

      if (heartbeat) clearInterval(heartbeat)
      // El latido va directo: no tiene sentido agruparlo y es el que detecta
      // (vía pushNow → revive) que el canal se quedó mudo.
      heartbeat = setInterval(() => void pushNow(), 25_000)

      set({ channels, me, peers: [] })
    },

    disconnect: () => {
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
      teardown()
      set({ channels: null, me: null, peers: [], activity: null })
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
