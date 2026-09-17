/**
 * Llevar la vista hasta una tarjeta concreta, dentro del panel de gestión.
 *
 * `el.scrollIntoView()` parece lo obvio y aquí no basta: /admin no scrollea en
 * la ventana sino DENTRO de un contenedor (`overflow-auto` en AdminRouter), y
 * además la ficha sigue creciendo un rato después de pintarse —portadas,
 * módulos, tipografías—, así que un solo intento apunta a una posición que deja
 * de ser la buena medio segundo más tarde.
 *
 * Por eso esto hace tres cosas: busca el contenedor que de verdad scrollea,
 * calcula la posición contra ÉL, y repite el cálculo un par de veces mientras la
 * página termina de asentarse.
 */

/** El ancestro que de verdad puede scrollear (o null: entonces manda la ventana). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const { overflowY } = getComputedStyle(node)
    const scrolls = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
    if (scrolls && node.scrollHeight > node.clientHeight + 4) return node
    node = node.parentElement
  }
  return null
}

function scrollOnce(el: HTMLElement, smooth: boolean) {
  const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto'
  const scroller = scrollParent(el)
  if (!scroller) {
    el.scrollIntoView({ behavior, block: 'center' })
    return
  }
  const elBox = el.getBoundingClientRect()
  const boxTop = scroller.getBoundingClientRect().top
  // Centrada en la parte visible del contenedor, sin pasarse de sus extremos.
  const target = elBox.top - boxTop + scroller.scrollTop - (scroller.clientHeight - elBox.height) / 2
  const max = scroller.scrollHeight - scroller.clientHeight
  scroller.scrollTo({ top: Math.max(0, Math.min(target, max)), behavior })
}

/**
 * Espera a que la tarjeta exista (puede estar en una pestaña que acaba de
 * abrirse) y la trae a la vista. Devuelve una función para cancelar: si quien
 * mira se va de la pantalla antes, no se le mueve nada por debajo.
 */
export function scrollToCard(
  getEl: () => HTMLElement | null,
  opts: { smooth?: boolean; timeoutMs?: number } = {},
): () => void {
  const { smooth = true, timeoutMs = 2000 } = opts
  const started = Date.now()
  let cancelled = false
  const timers: number[] = []

  const attempt = () => {
    if (cancelled) return
    const el = getEl()
    if (!el) {
      if (Date.now() - started > timeoutMs) return
      timers.push(window.requestAnimationFrame(attempt))
      return
    }
    scrollOnce(el, smooth)
    // Reajustes: la ficha crece después de pintarse y la primera posición se
    // queda corta. Son baratos y arreglan justo el caso que se veía mal.
    for (const delay of [350, 800]) {
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return
          const again = getEl()
          if (again) scrollOnce(again, smooth)
        }, delay),
      )
    }
  }

  attempt()

  return () => {
    cancelled = true
    for (const id of timers) {
      window.clearTimeout(id)
      window.cancelAnimationFrame(id)
    }
  }
}
