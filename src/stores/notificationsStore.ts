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

interface NotificationsState {
  items: AppNotification[]
  loaded: boolean
  /** Notificaciones de reset recién aplicadas en esta carga (para el toast). */
  justApplied: AppNotification[]
  /** Trae del servidor, aplica los resets pendientes a la caché local y avisa. */
  refresh: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  /** Limpia la lista de "recién aplicadas" tras mostrar el aviso. */
  clearJustApplied: () => void
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: [],
  loaded: false,
  justApplied: [],

  refresh: async () => {
    let items: AppNotification[]
    try {
      items = await getMyNotifications()
    } catch {
      return // silencioso: no romper la UI si falla
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
    })
  },

  markRead: async (id) => {
    set({
      items: get().items.map((n) =>
        n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n,
      ),
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
    set({ items: get().items.map((n) => (n.read_at ? n : { ...n, read_at: now })) })
    try {
      await markAllNotificationsRead(unread)
    } catch {
      /* ignorar */
    }
  },

  clearJustApplied: () => set({ justApplied: [] }),
}))
