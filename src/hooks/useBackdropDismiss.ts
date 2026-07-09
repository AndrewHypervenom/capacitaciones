import { useRef } from 'react'

/**
 * Devuelve handlers para el backdrop de un modal que solo lo cierran cuando
 * el clic empieza Y termina sobre el propio backdrop.
 *
 * Evita el bug de que al seleccionar texto dentro del modal y soltar el mouse
 * fuera (sobre el backdrop) se dispare un `click` en el backdrop y lo cierre.
 *
 * Uso:
 *   const backdrop = useBackdropDismiss(() => setOpen(false), !loading)
 *   <div className="fixed inset-0 ..." {...backdrop}> ... </div>
 *
 * @param onDismiss  Callback para cerrar el modal.
 * @param enabled    Si es false, no cierra (p. ej. mientras hay una operación en curso).
 */
export function useBackdropDismiss(onDismiss: () => void, enabled = true) {
  const downOnBackdrop = useRef(false)

  return {
    onMouseDown: (e: React.MouseEvent) => {
      // Solo marcamos como candidato si el press empezó en el backdrop mismo.
      downOnBackdrop.current = e.target === e.currentTarget
    },
    onClick: (e: React.MouseEvent) => {
      const shouldClose = enabled && downOnBackdrop.current && e.target === e.currentTarget
      downOnBackdrop.current = false
      if (shouldClose) onDismiss()
    },
  }
}
