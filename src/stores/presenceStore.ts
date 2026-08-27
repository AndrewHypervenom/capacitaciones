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
//   2. Capa de pantalla (`canSeePeer` + `redactForViewer`): filtra lo que sí
//      llega y, cuando corresponde, lo recorta.
//
// Reglas: superadmin ve a todos · capacitador ve capacitadores con campaña
// compartida · aprendiz ve a otros aprendices de su campaña, pero SOLO su
// identidad ("está en línea"), nunca dónde están ni qué estudian.
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
  // Una opinión de la bandeja. No es contenido que se edite: se declara para que
  // dos personas del equipo sepan que están atendiendo la MISMA opinión antes de
  // escribirle dos veces a quien la mandó.
  | 'feedback'

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

// ─── Estar "en línea" tiene que significar estar de verdad ──────────────
// Una pestaña abierta no es una persona presente: el equipo se bloquea, se
// suspende, o alguien deja la pestaña de fondo toda la tarde. Mientras el
// navegador viva, el latido seguiría emitiendo y esa persona saldría "activa"
// para todos los demás, que es justo lo que hace inútil a la presencia.
//
// Se ataca por los dos lados:
//   1. Emisión (`goAway`): dejo de anunciarme (untrack) en cuanto no hay señales
//      de que estoy aquí. Los demás reciben `leave` y desaparezco al instante.
//   2. Recepción (`syncPeers`): descarto a quien lleva demasiado sin dar señal,
//      porque un equipo apagado de golpe no alcanza a despedirse y su presencia
//      puede quedarse colgada en el canal. La señal de vida es el ping por
//      broadcast (ver `pingNow`), que llega bastante más seguido que el `track`
//      y permite retirar al que se apagó en ~30 s en vez de un minuto.

/**
 * Sin una sola interacción durante este rato → ausente (equipo bloqueado, AFK).
 * Tres minutos y no menos: alguien viendo un video o leyendo una sección larga
 * puede pasar un buen rato sin tocar nada y sigue estando ahí.
 */
const IDLE_AFTER_MS = 180_000

/**
 * Pestaña oculta durante este rato → ausente. Es más corto que la inactividad
 * porque una pestaña de fondo es señal directa de que la persona no está ahí,
 * mientras que estar leyendo sin tocar nada sí es estar presente.
 */
const HIDDEN_AFTER_MS = 45_000

/** Cada cuánto se revisa la ausencia propia y se purgan los fantasmas ajenos. */
const PRESENCE_TICK_MS = 10_000

/** Cada cuánto re-emito mi presencia mientras estoy activo. */
const HEARTBEAT_MS = 20_000

/**
 * Milisegundos sin latido a partir de los cuales un peer se considera dudoso:
 * se pinta atenuado y con el aviso de "sin señal reciente". Dos latidos
 * perdidos — puede ser solo una mala conexión.
 */
export const STALE_AFTER_MS = 45_000

/**
 * Milisegundos sin señal de vida a partir de los cuales el peer se retira de la
 * lista, cuando lo ÚNICO que se recibe de él son sus `track`. A esta altura no
 * es una mala conexión: es un equipo apagado o suspendido que dejó su presencia
 * colgada en el canal sin llegar a emitir `leave`.
 *
 * Tres latidos perdidos. Antes eran 100 s y se sentía eterno: quien cerraba el
 * portátil seguía "activo" casi dos minutos, que es justo el rato en el que
 * alguien mira la lista y decide escribirle a quien ya no está.
 */
const GONE_AFTER_MS = 60_000

// ─── Ping: señal de vida barata ─────────────────────────────────────────
// Para retirar antes a quien se apagó de golpe habría que latir más seguido,
// pero el latido es un `track`: reescribe el estado de presencia y dispara un
// `sync` en todos los que escuchan el canal. Subirle la frecuencia es
// exactamente lo que una vez dejó el canal mudo con 'timed out'.
//
// Así que la señal de vida va aparte, por `broadcast`: un mensaje con el
// user_id y nada más. No toca el estado de presencia, no provoca sync y no
// re-renderiza nada — solo refresca un reloj interno. El `track` sigue siendo
// quien transporta el ESTADO (dónde estoy, qué edito) a su ritmo de siempre.

/** Cada cuánto emito la señal de vida. */
const PING_MS = 8_000

/**
 * Milisegundos sin señal a partir de los cuales se retira a un peer del que SÍ
 * recibimos pings. Tres pings perdidos.
 *
 * El umbral rápido solo se aplica a quien ha demostrado que emite pings. De
 * quien nunca mandó uno —una pestaña con la versión anterior durante el
 * despliegue, o un `broadcast` que no llega— seguimos fiándonos de sus `track`
 * con el umbral conservador. Sin esa distinción, el día del despliegue todo el
 * que tuviera el bundle viejo desaparecería de las listas estando presente.
 */
const GONE_PINGED_MS = 30_000

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

/**
 * ¿Las dos listas de compañeros dicen lo mismo? El barrido periódico recalcula
 * `peers` cada pocos segundos; sin esta comparación, cada pasada publicaría un
 * array nuevo y volvería a renderizar media aplicación sin que nada cambiara.
 */
function samePeers(a: Peer[], b: Peer[]): boolean {
  if (a.length !== b.length) return false
  return a.every((p, i) => {
    const q = b[i]
    return (
      p.user_id === q.user_id &&
      p.name === q.name &&
      p.avatar_url === q.avatar_url &&
      p.route === q.route &&
      p.role === q.role &&
      p.campaign_id === q.campaign_id &&
      p.online_at === q.online_at &&
      sameActivity(p.activity, q.activity)
    )
  })
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
 * - aprendiz: emite en el de su campaña para que el superadmin lo vea, y ahí
 *   mismo se encuentra con los demás aprendices de su campaña. De lo que reciba,
 *   `canSeePeer` descarta al staff y `redactForViewer` le quita la ubicación al
 *   resto: le queda "estas personas están en línea" y nada más.
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
  // El aprendiz ve SOLO a otros aprendices de su campaña (comparten el canal),
  // y únicamente como compañía: nunca dónde están (ver `redactForViewer`).
  // Al staff no lo ve: quién está gestionando qué no es asunto suyo.
  if (myRole === 'learner') return peerRole === 'learner'
  return false
}

/**
 * Qué puede ver en pantalla quien mira. El aprendiz recibe compañeros por el
 * canal de su campaña con su ubicación dentro (todos emiten completo ahí para
 * que el superadmin los vea), pero para él eso es dato ajeno: saber qué módulo
 * está estudiando otra persona no le aporta nada y sí revela su desempeño.
 *
 * Aquí se recorta a lo mínimo que hace falta para sentirse acompañado: quién es
 * (nombre y foto, que ya son públicos en la plataforma) y que está en línea.
 * Sin ruta, sin recurso, sin campaña.
 *
 * Es la razón por la que la barra del aprendiz no muestra "En: ..." nunca:
 * sencillamente no tiene el dato, ni siquiera en memoria.
 */
export function redactForViewer(myRole: string | null | undefined, peer: Peer): Peer {
  if (myRole !== 'learner') return peer
  return { ...peer, activity: null, route: '', campaign_id: null }
}

/**
 * Nombre corto para mostrar a un compañero: nombre de pila + inicial del
 * siguiente ("Andres Felipe Fajardo Pachon" → "Andres F.").
 *
 * El nombre de pila solo no basta: en una misma campaña es normal que haya dos
 * Andrés, y verlos como dos filas idénticas no distingue a nadie. La inicial
 * desambigua sin llegar a revelar el apellido completo, que es exactamente el
 * dato que no tiene por qué circular entre compañeros.
 */
export function shortName(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return name || ''
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`
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
  // Revisa mi propia ausencia y purga fantasmas ajenos. Ver los umbrales arriba.
  let tickTimer: ReturnType<typeof setInterval> | null = null
  // Ver `pingNow`: señal de vida, aparte del latido de estado.
  let pingTimer: ReturnType<typeof setInterval> | null = null

  // ¿Estoy ausente? Mientras lo esté no me anuncio en ningún canal: para los
  // demás, sencillamente no estoy.
  let away = false
  // Última señal de que hay una persona al otro lado (no un navegador abierto).
  let lastInput = Date.now()
  // Desde cuándo la pestaña está oculta, o null si está a la vista.
  let hiddenSince: number | null = null
  // Ver `onVisibility`: despedida programada al pasar a segundo plano.
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null
  let unbindAwayListeners: (() => void) | null = null

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

  /**
   * ¿Debería estar ausente ahora mismo? Se calcula con el reloj, nunca con
   * "cuántas veces corrió el temporizador".
   *
   * Es la diferencia entre que esto funcione o no en una pestaña de fondo: el
   * navegador estrangula los `setInterval` de las pestañas ocultas a uno por
   * minuto (y acaba congelándolas), así que el chequeo periódico puede no correr
   * cuando toca. Preguntando esto en cada latido, el latido se autocensura: si
   * llega a destiempo y ya no hay nadie al otro lado, no se anuncia.
   */
  const shouldBeAway = (now = Date.now()) =>
    (hiddenSince !== null && now - hiddenSince > HIDDEN_AFTER_MS) ||
    now - lastInput > IDLE_AFTER_MS

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
    if (!me || away) return
    // Antes de anunciarme, comprobar que sigo aquí. No basta con que `tick` lo
    // vigile: en una pestaña de fondo ambos temporizadores quedan estrangulados
    // al mismo ritmo, y un latido que se cuele antes del chequeo mantiene viva
    // una presencia que ya no corresponde a nadie.
    if (shouldBeAway()) { goAway(); return }
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
   * Señal de vida a los canales donde me anuncio. Va a los mismos canales que el
   * `track` —incluido el de edición del superadmin— porque quien me ve por ahí
   * es justamente quien necesita saber si sigo vivo. En los de solo escucha no:
   * ahí no me anuncio, y un ping delataría mi presencia.
   *
   * Solo viaja el user_id. Ni ruta, ni recurso, ni campaña: no hay nada que
   * redactar, así que sirve igual para el canal completo y para el redactado.
   */
  const pingNow = () => {
    const { me } = get()
    if (!me || away) return
    // El ping es lo que más seguido corre, así que también es lo que antes se da
    // cuenta de que ya no hay nadie al otro lado.
    if (shouldBeAway()) { goAway(); return }
    const targets = new Set<RealtimeChannel>([...emitChannels, ...redactedChannels])
    const editing = editingChannelName ? channelsByName.get(editingChannelName) : null
    if (editing) targets.add(editing)
    for (const channel of targets) {
      // Sin `ack`: es fuego y olvido. Un ping perdido lo cubre el siguiente, y
      // si se pierden tres seguidos la conclusión de que no está es correcta.
      void channel.send({ type: 'broadcast', event: 'ping', payload: { u: me.user_id } })
        .catch(() => {})
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

  /** Me retiro de todos los canales donde me anuncio, sin cerrarlos. */
  const untrackAll = async () => {
    const seen = new Set<RealtimeChannel>([...emitChannels, ...redactedChannels])
    if (editingChannelName) {
      const channel = channelsByName.get(editingChannelName)
      if (channel) seen.add(channel)
      editingChannelName = null
    }
    for (const channel of seen) {
      await channel.untrack().catch(() => {})
    }
  }

  /**
   * Me marco ausente: dejo de anunciarme y los demás reciben `leave`, así que
   * desaparezco de sus listas de inmediato. Los canales siguen suscritos —
   * sigo VIENDO quién está — porque volver es tan barato como mover el ratón.
   */
  const goAway = () => {
    if (away) return
    away = true
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
    void untrackAll()
  }

  /** Vuelvo: me anuncio otra vez de inmediato, sin esperar al siguiente latido. */
  const comeBack = () => {
    if (!away) return
    away = false
    void pushNow()
  }

  /** Hay alguien al otro lado ahora mismo. */
  const markActive = () => {
    lastInput = Date.now()
    if (away) comeBack()
  }

  /**
   * Revisión periódica. Hace dos cosas que el latido no puede hacer solo:
   * decidir si YO sigo aquí, y retirar a quien dejó de latir (su presencia se
   * queda colgada en el canal si el equipo se apagó sin despedirse).
   *
   * Al volver de una suspensión, este tick corre tarde y con `lastInput` viejo,
   * así que lo primero que hace es marcarme ausente — correcto: hasta que no
   * toque algo, no hay prueba de que haya vuelto.
   */
  const tick = () => {
    if (shouldBeAway()) goAway()
    syncPeers()
  }

  /**
   * Señales de que la persona está (o no). El movimiento del ratón entra a
   * propósito: leer una pantalla larga sin hacer clic sigue siendo estar
   * presente, y el manejador es tan barato como asignar un número.
   */
  const bindAwayListeners = () => {
    if (unbindAwayListeners || typeof window === 'undefined') return
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
    // En captura: el panel hace scroll dentro de contenedores propios y ese
    // evento no burbujea hasta window; sin `capture` nadie que solo lea una
    // lista larga contaría como presente.
    for (const ev of events) {
      window.addEventListener(ev, markActive, { passive: true, capture: true })
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince = Date.now()
        // Temporizador propio en vez de esperar al chequeo periódico: al pasar a
        // segundo plano el `setInterval` queda estrangulado y podría tardar
        // minutos en darse cuenta. Este se arma en el instante en que la pestaña
        // se oculta, así que como muy tarde dispara una vez.
        if (hiddenTimer) clearTimeout(hiddenTimer)
        hiddenTimer = setTimeout(goAway, HIDDEN_AFTER_MS + 1_000)
      } else {
        if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null }
        hiddenSince = null
        markActive()
      }
    }
    // Cerrar la pestaña o irse a otra página: despedida explícita. `pagehide`
    // es el que sí se dispara en móvil, donde `beforeunload` no es fiable.
    const onLeave = () => { away = true; void untrackAll() }
    // A propósito NO se usa `blur` de la ventana como señal de ausencia: el foco
    // se va al iframe cada vez que alguien le da play a un video de YouTube, y
    // esa persona está más presente que nunca.
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onLeave)
    window.addEventListener('focus', markActive)
    hiddenSince = document.visibilityState === 'hidden' ? Date.now() : null

    unbindAwayListeners = () => {
      if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null }
      for (const ev of events) window.removeEventListener(ev, markActive, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onLeave)
      window.removeEventListener('focus', markActive)
    }
  }

  /** ¿Los dos repartos de canales son el mismo? Evita reconectar de gratis. */
  const sameChannels = (a: PresenceChannels | null, b: PresenceChannels): boolean => {
    if (!a) return false
    const key = (c: PresenceChannels) =>
      [c.emit, c.emitRedacted, c.listen].map((l) => [...l].sort().join(',')).join('|')
    return key(a) === key(b)
  }

  // Última vez que vi cambiar el latido de cada compañero, medida con el reloj
  // de ESTE equipo. No sirve fiarse del `online_at` que manda cada quien: basta
  // con que un portátil tenga la hora corrida diez minutos para que su presencia
  // se vea eternamente fresca (o eternamente muerta). Aquí solo se usa su sello
  // como "¿cambió respecto a la última vez?"; la antigüedad la mide mi reloj.
  const lastBeat = new Map<string, { stamp: string; at: number }>()

  // Último ping recibido de cada quien, y de quiénes sabemos que emiten pings.
  // Se guardan aparte de `lastBeat` a propósito: si el ping moviera el
  // `online_at` que se publica, el array de peers cambiaría cada 8 s y volvería
  // a renderizar todas las vistas que lo leen. El ping decide si alguien sigue
  // ahí; el `track` sigue siendo el que dice "última vez visto".
  const lastPing = new Map<string, number>()
  const pingCapable = new Set<string>()

  const notePing = (userId: unknown) => {
    if (typeof userId !== 'string' || !userId) return
    if (userId === get().me?.user_id) return
    pingCapable.add(userId)
    lastPing.set(userId, Date.now())
    // A propósito no se llama a `syncPeers`: con varias personas en el canal
    // serían decenas de recálculos por minuto para no cambiar nada. Si el ping
    // resucita a alguien que se había descartado, el barrido lo recoge en la
    // siguiente pasada (10 s como mucho).
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
    // Sello local del latido + descarte de fantasmas. Un equipo que se apaga o
    // se suspende de golpe no alcanza a emitir `leave`, y su presencia se queda
    // colgada en el canal: sin esto seguiría saliendo "activo" indefinidamente.
    const now = Date.now()
    const alive: Peer[] = []
    for (const peer of seen.values()) {
      const stamp = peer.online_at ?? ''
      const prev = lastBeat.get(peer.user_id)
      const at = prev && prev.stamp === stamp ? prev.at : now
      lastBeat.set(peer.user_id, { stamp, at })
      // Vale cualquiera de las dos señales: el ping llega más seguido, pero si
      // por lo que sea no llega, el `track` sigue sirviendo de prueba de vida.
      const seenAt = Math.max(at, lastPing.get(peer.user_id) ?? 0)
      const limit = pingCapable.has(peer.user_id) ? GONE_PINGED_MS : GONE_AFTER_MS
      if (now - seenAt > limit) continue
      // Se reescribe con mi reloj para que "hace X" y el atenuado de dudosos no
      // dependan de la hora del equipo ajeno.
      alive.push({ ...peer, online_at: new Date(at).toISOString() })
    }
    // Nadie a quien seguirle el rastro: los que ya no están en ningún canal.
    for (const id of [...lastBeat.keys()]) {
      if (!seen.has(id)) {
        lastBeat.delete(id)
        lastPing.delete(id)
        pingCapable.delete(id)
      }
    }

    // La redacción va al final, después de deduplicar: la regla de "gana el
    // anuncio con ubicación" necesita ver la ubicación para elegir, aunque quien
    // mira no vaya a recibirla.
    const next = alive.map((p) => redactForViewer(me?.role, p))
    // Sin esto, el barrido periódico dispararía un render cada 10 s en todas las
    // vistas que leen `peers`, aunque no haya cambiado nada.
    if (!samePeers(get().peers, next)) set({ peers: next })
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
      // Reconectar NO es prueba de que la persona haya vuelto: `connect` da por
      // presente a quien entra, y sin esto cada caída de canal resucitaba a un
      // ausente y le regalaba otros tres minutos de "activo". Un equipo bloqueado
      // en Windows mantiene la pestaña `visible`, así que ese chequeo no lo
      // atrapa: la única prueba válida es una interacción real (`markActive`).
      const wasAway = away
      const inputBefore = lastInput
      // Forzamos la reconexión saltándonos el atajo de "ya conectado".
      teardown()
      set({ channels: null })
      get().connect(c, m)
      away = wasAway
      lastInput = inputBefore
      // El `pushNow` del SUBSCRIBED ya ve `away` restaurado y no se anuncia.
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

      // Entrar cuenta como estar: si acabo de iniciar sesión o de cambiar de
      // vista, no arrastro la inactividad de antes. Con la pestaña oculta no,
      // que aquí también se entra al reconectar solo (`revive`) y una caída de
      // canal no es prueba de que la persona haya vuelto al equipo.
      bindAwayListeners()
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        away = false
        lastInput = Date.now()
      }

      const open = (name: string, kind: 'full' | 'redacted' | 'listen') => {
        const channel = supabase.channel(name, {
          config: { presence: { key: me.user_id } },
        })
        channel
          .on('presence', { event: 'sync' }, syncPeers)
          .on('presence', { event: 'join' }, syncPeers)
          .on('presence', { event: 'leave' }, syncPeers)
          // Señal de vida ajena. Se escucha en TODOS los canales, incluidos los
          // de solo escucha: al superadmin le llegan por ahí los pings de las
          // campañas que vigila, que es donde ve a casi todo el mundo.
          .on('broadcast', { event: 'ping' }, (msg) => notePing(msg?.payload?.u))
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
      heartbeat = setInterval(() => void pushNow(), HEARTBEAT_MS)

      if (tickTimer) clearInterval(tickTimer)
      tickTimer = setInterval(tick, PRESENCE_TICK_MS)

      if (pingTimer) clearInterval(pingTimer)
      pingTimer = setInterval(pingNow, PING_MS)

      set({ channels, me, peers: [] })
    },

    disconnect: () => {
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
      unbindAwayListeners?.()
      unbindAwayListeners = null
      away = false
      lastBeat.clear()
      lastPing.clear()
      pingCapable.clear()
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
  [/^\/admin\/limits/, 'presence.views.ai_limits'],
  [/^\/admin\/chat/, 'presence.views.chat'],
  [/^\/admin\/traffic/, 'presence.views.traffic'],
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

/**
 * Segundos desde la última señal de vida de un compañero.
 *
 * `online_at` llega ya reescrito con el reloj de ESTE equipo (ver `syncPeers`),
 * así que el cálculo no depende de que la otra persona tenga la hora bien.
 */
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
