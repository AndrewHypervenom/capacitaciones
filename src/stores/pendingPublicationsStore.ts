import { useEffect } from 'react'
import { create } from 'zustand'
import { countPendingCoursePublications } from '@/services/courseApprovals.service'
import { useNotificationsStore } from '@/stores/notificationsStore'
import { useFreshOnFocus } from '@/hooks/useFreshOnFocus'

/**
 * Cuántos cursos están esperando aprobación para publicarse.
 *
 * Es el globo del menú lateral y la tarjeta del panel de inicio: sin él, un
 * curso podía quedarse esperando días porque nadie abre la bandeja y el aviso
 * de la campana se pierde entre los demás.
 *
 * El número sale de `count_pending_course_publications`, NO de las
 * notificaciones sin leer. Es una diferencia que importa: si apruebas un curso
 * desde su editor, el aviso sigue sin leer pero ya no hay nada esperando — un
 * globo contando avisos mentiría justo cuando el trabajo ya está hecho.
 *
 * Lo comparten el menú y el tablero, así que se pide UNA vez y solo cuando algo
 * lo mueve de verdad (ver `usePendingPublicationsSync`).
 */
interface PendingPublicationsState {
  count: number
  loaded: boolean
  /** Vuelve a contar contra el servidor. Nunca lanza. */
  refresh: () => Promise<void>
  /**
   * Fija el número con datos que ya se tienen a mano, sin ir al servidor. Lo usa
   * la bandeja, que acaba de traerse las filas: contarlas ahí sale gratis y una
   * segunda llamada para el mismo número sería tráfico regalado.
   */
  setCount: (n: number) => void
}

export const usePendingPublicationsStore = create<PendingPublicationsState>((set) => ({
  count: 0,
  loaded: false,
  refresh: async () => {
    try {
      set({ count: await countPendingCoursePublications(), loaded: true })
    } catch (e) {
      // Un globo que no carga no puede tumbar el panel: se deja el número que
      // hubiera y se sigue.
      console.error('[pendingPublications] refresh', e)
      set({ loaded: true })
    }
  },
  setCount: (n) => set({ count: n, loaded: true }),
}))

/**
 * Mantiene el contador al día mientras el panel esté abierto. Se monta UNA vez
 * (en AdminRouter). Cuenta de nuevo cuando:
 *
 *  1. **Se entra al panel.** La primera cuenta.
 *  2. **Llega una solicitud por la campana.** Es la única señal en vivo de que
 *     OTRA persona acaba de pedir algo.
 *  3. **Se resuelve algo en otra pestaña.** Por el bus (`writeNotifier` anuncia
 *     el tema 'publications' cuando pasa un aprobar/devolver/bajar). Tema propio
 *     a propósito: colgarlo de 'courses' recontaría con cada guardado de curso.
 *  4. **La pestaña vuelve al frente.** El colador de todo lo demás: otro
 *     aprobador resolviendo desde su equipo, o la pestaña que estuvo horas de
 *     fondo. Con la ventana mínima de `useFreshOnFocus`, no golpea la base al
 *     alternar entre pestañas.
 *
 * Solo pide si quien mira puede aprobar. Para los demás el RPC devuelve cero de
 * todos modos (lo filtra por dentro), así que la llamada sería tráfico gastado
 * en un número que nadie va a ver.
 */
export function usePendingPublicationsSync(enabled: boolean) {
  const refresh = usePendingPublicationsStore((s) => s.refresh)

  // Cuántas solicitudes han entrado por la campana. El número en sí no se pinta:
  // sirve de disparador, porque cambia justo cuando llega una nueva.
  const requestPings = useNotificationsStore(
    (s) => s.items.filter((n) => n.kind === 'course_publish_request').length,
  )

  // (1) y (2): la primera cuenta al entrar, y otra cada vez que la campana trae
  // una solicitud nueva. `useFreshOnFocus` no cubre esto — guarda la función en
  // un ref y solo la dispara con el foco o el bus, nunca al montar.
  useEffect(() => {
    if (!enabled) return
    void refresh()
  }, [enabled, requestPings, refresh])

  // (3) y (4): otra pestaña resolvió algo, o esta vuelve al frente.
  useFreshOnFocus(refresh, { topics: ['publications'], enabled })
}
