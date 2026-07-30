/**
 * Detalles de arrastre que dnd-kit no cubre por sí solo.
 *
 * El problema: al arrastrar con el ratón, el navegador va SELECCIONANDO el texto
 * de la página por donde pasa el cursor (queda todo resaltado en azul). Marcar el
 * elemento arrastrado como `select-none` no basta, porque la selección se ancla
 * en el contenido de alrededor en cuanto el puntero sale de él.
 *
 * La solución: mientras dura el arrastre, la página entera deja de ser
 * seleccionable (clase `is-dragging` en <body>, ver src/styles/globals.css) y se
 * limpia cualquier selección que hubiera quedado empezada.
 */

const DRAG_CLASS = 'is-dragging'

export function beginDragUx(): void {
  if (typeof document === 'undefined') return
  document.body.classList.add(DRAG_CLASS)
  clearSelection()
}

export function endDragUx(): void {
  if (typeof document === 'undefined') return
  document.body.classList.remove(DRAG_CLASS)
  clearSelection()
}

function clearSelection(): void {
  try {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) sel.removeAllRanges()
  } catch {
    /* algunos navegadores lo bloquean dentro de iframes; no es crítico */
  }
}

type Listeners = Record<string, unknown> | undefined

/**
 * Envuelve los `listeners` de dnd-kit para matar la selección ANTES de que
 * empiece. Entre el `mousedown` y el instante en que dnd-kit activa el arrastre
 * (6 px de movimiento, o 180 ms manteniendo pulsado en modo táctil) el navegador
 * ya empezó a seleccionar; `preventDefault` en `mousedown` lo evita.
 *
 * OJO: hay que COMPONER, no reemplazar. dnd-kit trae su propio `onMouseDown` en
 * `listeners`; si se pisa con uno nuevo, el arrastre deja de funcionar.
 *
 * `preventDefault` también quita el foco, así que lo devolvemos a mano para no
 * romper el manejo por teclado (Tab + Espacio + flechas).
 */
export function withNoSelectDrag(listeners: Listeners) {
  const original = listeners?.onMouseDown as
    | ((e: React.MouseEvent<HTMLElement>) => void)
    | undefined
  return {
    ...listeners,
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
      original?.(e)
      // Botón izquierdo únicamente: el menú contextual y el clic central siguen igual.
      if (e.button !== 0) return
      e.preventDefault()
      e.currentTarget.focus?.()
    },
  }
}
