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

  /** Conecta al canal de la campaña y empieza a emitir presencia. Idempotente. */
  connect: (campaignId: string, me: Me) => void
  /** Se desconecta y limpia el estado. */
  disconnect: () => void
  /** Declara qué recurso estoy editando (o null si dejo de editar). */
  setActivity: (activity: PresenceActivity | null) => void
  /** Marca/desmarca cambios sin guardar en el recurso actual. */
  setDirty: (dirty: boolean) => void
  /** Actualiza la ruta actual (para contexto de "dónde está"). */
  setRoute: (route: string) => void
}

export const usePresenceStore = create<PresenceState>((set, get) => {
  // Reenvía mi estado actual al canal (presence.track).
  const push = async () => {
    const { channel, me, activity, route } = get()
    if (!channel || !me) return
    try {
      await channel.track({
        user_id: me.user_id,
        name: me.name,
        avatar_url: me.avatar_url,
        color: colorForUser(me.user_id),
        activity,
        route,
        role: me.role,
        online_at: new Date().toISOString(),
      })
    } catch {
      /* canal aún no suscrito; se reintenta al SUBSCRIBED */
    }
  }

  return {
    peers: [],
    me: null,
    campaignId: null,
    channel: null,
    activity: null,
    route: typeof window !== 'undefined' ? window.location.pathname : '',

    connect: (campaignId, me) => {
      const state = get()
      // Ya conectado a la misma campaña con el mismo usuario → no reconectar.
      if (
        state.channel &&
        state.campaignId === campaignId &&
        state.me?.user_id === me.user_id
      ) {
        set({ me })
        void push()
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
          if (status === 'SUBSCRIBED') void push()
        })

      set({ channel, campaignId, me, peers: [] })
    },

    disconnect: () => {
      const { channel } = get()
      if (channel) supabase.removeChannel(channel)
      set({ channel: null, campaignId: null, me: null, peers: [], activity: null })
    },

    setActivity: (activity) => {
      set({ activity })
      void push()
    },

    setDirty: (dirty) => {
      const { activity } = get()
      if (!activity || activity.dirty === dirty) return
      set({ activity: { ...activity, dirty } })
      void push()
    },

    setRoute: (route) => {
      if (get().route === route) return
      set({ route })
      void push()
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

/** Clave i18n de la vista donde está un compañero según su ruta. */
export function viewKeyForRoute(route: string): string {
  for (const [re, key] of VIEW_PATTERNS) {
    if (re.test(route)) return key
  }
  return 'presence.views.somewhere'
}

/** Selector: compañeros que están en un recurso concreto (excluye al propio). */
export function peersForResource(
  peers: Peer[],
  type: PresenceResourceType,
  id: string,
): Peer[] {
  return peers.filter((p) => p.activity?.type === type && p.activity.id === id)
}
