import { useCallback, useEffect, useState } from 'react'

/**
 * Vigila si un elemento está fuera de la vista.
 *
 * Devuelve un **ref por callback**, no un objeto: con `useRef` el efecto que
 * monta el observador puede correr antes de que el nodo exista (el constructor
 * del examen pinta un esqueleto mientras carga) y entonces no se observa nada
 * nunca. Con el callback, el observador se engancha justo cuando el nodo entra
 * en el DOM y se suelta cuando sale.
 *
 * Con `root: null` basta aunque el panel scrollee en un div propio: el recorte
 * de ese contenedor ya entra en el cálculo de la intersección.
 */
export function useOutOfView(enabled = true, threshold = 0.12) {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [out, setOut] = useState(false)

  useEffect(() => {
    if (!node || !enabled) return
    const io = new IntersectionObserver(([entry]) => setOut(!entry.isIntersecting), { threshold })
    io.observe(node)
    return () => io.disconnect()
  }, [node, enabled, threshold])

  /** Lleva el elemento a la vista (respeta `scroll-mt-*`). */
  const scrollIntoView = useCallback(() => {
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [node])

  return { ref: setNode, node, out: out && enabled, scrollIntoView }
}
