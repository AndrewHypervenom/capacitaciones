import { useEffect, useRef } from 'react'
import { onTabMessage } from '@/lib/crossTab'

/**
 * Vuelve a cargar los datos cuando la pantalla puede haber quedado vieja.
 *
 * Una lista o un editor leen de la base UNA vez, al montar. Con dos pestañas
 * abiertas —el editor en una, el catálogo en otra— la segunda seguía mostrando
 * la foto del momento en que se abrió: se guardaba algo en una pestaña y en la
 * otra no aparecía, o aparecía como "Borrador" porque esa era la versión que
 * tenía cargada. De ahí los reprocesos.
 *
 * Se recarga por dos motivos:
 *
 * 1. **Otra pestaña avisó** que cambió algo de este tema (`notifyDataChanged`).
 *    Es inmediato y preciso.
 * 2. **La pestaña vuelve a estar visible**. Cubre lo que no pasó por el bus:
 *    otra persona editando desde otro equipo, o la pestaña que estuvo horas de
 *    fondo. Va con un mínimo entre recargas para no golpear la base al alternar.
 *
 * No sirve para pantallas con cambios sin guardar: recargar borraría lo escrito.
 * Para esos casos existe `useStaleGuard`, que avisa en vez de sobrescribir.
 */
export function useFreshOnFocus(
  reload: () => void | Promise<void>,
  opts: {
    /** Temas que disparan recarga inmediata. Ej: ['simulations']. */
    topics?: string[]
    /** Mínimo entre recargas por foco (ms). Por defecto 10 s. */
    minIntervalMs?: number
    /** Poner en false mientras la pantalla aún no tiene qué recargar. */
    enabled?: boolean
  } = {},
): void {
  const { topics = [], minIntervalMs = 10_000, enabled = true } = opts

  // `reload` suele ser una función nueva en cada render; el ref evita volver a
  // registrar los listeners (y con ellos, recargas espurias) en cada uno. Se
  // actualiza en un efecto: solo se lee cuando ya hubo foco o aviso.
  const reloadRef = useRef(reload)
  useEffect(() => {
    reloadRef.current = reload
  })

  // Momento de la última carga. Arranca en 0 y lo fija el efecto al montar: leer
  // el reloj durante el render sería impuro.
  const lastRunRef = useRef(0)
  const topicsKey = topics.join('|')

  useEffect(() => {
    if (!enabled) return
    // Se acaba de montar (la pantalla cargó sola): la ventana mínima empieza aquí.
    if (lastRunRef.current === 0) lastRunRef.current = Date.now()

    const run = () => {
      lastRunRef.current = Date.now()
      void reloadRef.current()
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRunRef.current < minIntervalMs) return
      run()
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    const wanted = new Set(topicsKey ? topicsKey.split('|') : [])
    const off = wanted.size
      ? onTabMessage('data:changed', (msg) => {
          if (wanted.has(msg.topic)) run()
        })
      : null

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      off?.()
    }
  }, [enabled, minIntervalMs, topicsKey])
}
