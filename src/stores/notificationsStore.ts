import { create } from 'zustand'
import {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
} from '@/services/notifications.service'
import { useProgressStore } from '@/stores/progressStore'

// Ids de notificaciones de reset ya APLICADAS a la caché local (para no volver a
// limpiar ni a avisar en cada carga). Vive en localStorage, aparte del store.
const APPLIED_KEY = 'learningai.appliedResets'

function loadApplied(): Set<string> {
  try {
    const raw = localStorage.getItem(APPLIED_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}
function saveApplied(set: Set<string>) {
  try {
    localStorage.setItem(APPLIED_KEY, JSON.stringify([...set]))
  } catch {
    /* espacio lleno o modo privado: ignorar */
  }
}

// Huella de lo ya visto en esta sesión: id → nº de eventos agrupados en esa
// notificación (payload.count; 1 si no agrupa). Sirve para distinguir "esto
// acaba de pasar" de "esto ya estaba ahí cuando abrí la app" — sin ella, entrar
// al panel dispararía el sonido de todo lo pendiente de la semana. Vive fuera
// del estado porque no se pinta: solo se compara.
const seen = new Map<string, number>()

function eventCount(n: AppNotification): number {
  const c = Number(n.payload?.count)
  return Number.isFinite(c) && c > 0 ? c : 1
}

interface NotificationsState {
  items: AppNotification[]
  loaded: boolean
  /** Notificaciones de reset recién aplicadas en esta carga (para el toast). */
  justApplied: AppNotification[]
  /**
   * Avisos que acaban de llegar (o que crecieron por agrupación) DESPUÉS de la
   * primera carga. Es lo que dispara sonido y aviso emergente.
   */
  justArrived: AppNotification[]
  /** Trae del servidor, aplica los resets pendientes a la caché local y avisa. */
  refresh: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  /** Limpia la lista de "recién aplicadas" tras mostrar el aviso. */
  clearJustApplied: () => void
  /** Descarta un aviso emergente ya mostrado (o todos, sin id). */
  clearJustArrived: (id?: string) => void
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: [],
  loaded: false,
  justApplied: [],
  justArrived: [],

  refresh: async () => {
    let items: AppNotification[]
    try {
      items = await getMyNotifications()
    } catch {
      return // silencioso: no romper la UI si falla
    }

    // ¿Qué es nuevo respecto a lo que ya habíamos visto? Solo cuentan las no
    // leídas: marcar como leído en otra pestaña no debe volver a sonar aquí.
    const firstLoad = !get().loaded
    const arrived: AppNotification[] = []
    for (const n of items) {
      const count = eventCount(n)
      const before = seen.get(n.id)
      if (!firstLoad && !n.read_at && (before === undefined || count > before)) {
        arrived.push(n)
      }
      seen.set(n.id, count)
    }

    // Aplicar a la caché local los resets que aún no se hayan aplicado.
    const applied = loadApplied()
    const newlyApplied: AppNotification[] = []
    const applyReset = useProgressStore.getState().applyReset
    for (const n of items) {
      if (n.kind !== 'reset' || applied.has(n.id)) continue
      applyReset(n.payload)
      applied.add(n.id)
      newlyApplied.push(n)
    }
    if (newlyApplied.length > 0) saveApplied(applied)

    set({
      items,
      loaded: true,
      justApplied: newlyApplied.length > 0 ? newlyApplied : get().justApplied,
      // Un aviso que vuelve a llegar (agrupación) reemplaza al suyo anterior en
      // la cola: siempre se ve una sola tarjeta por persona, con lo último.
      justArrived:
        arrived.length > 0
          ? [...get().justArrived.filter((p) => !arrived.some((a) => a.id === p.id)), ...arrived]
          : get().justArrived,
    })
  },

  markRead: async (id) => {
    set({
      items: get().items.map((n) =>
        n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n,
      ),
      // Leerlo en la campana también retira su tarjeta emergente: es el mismo
      // aviso visto por dos sitios, no dos pendientes distintos.
      justArrived: get().justArrived.filter((n) => n.id !== id),
    })
    try {
      await markNotificationRead(id)
    } catch {
      /* el espejo a BD puede fallar sin romper la UI */
    }
  },

  markAllRead: async () => {
    const unread = get().items.filter((n) => !n.read_at).map((n) => n.id)
    if (unread.length === 0) return
    const now = new Date().toISOString()
    set({
      items: get().items.map((n) => (n.read_at ? n : { ...n, read_at: now })),
      justArrived: [],
    })
    try {
      await markAllNotificationsRead(unread)
    } catch {
      /* ignorar */
    }
  },

  clearJustApplied: () => set({ justApplied: [] }),

  clearJustArrived: (id) =>
    set({ justArrived: id ? get().justArrived.filter((n) => n.id !== id) : [] }),
}))
