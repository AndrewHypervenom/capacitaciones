import type { MouseEvent as ReactMouseEvent } from 'react';

/**
 * Cierra un modal SOLO cuando el clic empieza y termina sobre el fondo (backdrop).
 *
 * Evita el bug clásico: al seleccionar texto dentro del modal y soltar el mouse
 * por fuera, el navegador dispara un `click` sobre el backdrop y el modal se cierra.
 * Aquí exigimos que el `mousedown` y el `click` ocurran sobre el mismo elemento de
 * fondo, así que arrastrar una selección hacia afuera ya no lo cierra.
 *
 * Uso: en el elemento de fondo (o contenedor que actúa como fondo):
 *   <div {...backdropDismiss(onClose)} className="absolute inset-0 ..." />
 *
 * El seguimiento del origen del clic es a nivel de módulo porque las interacciones
 * del mouse son secuenciales: nunca hay dos `mousedown` sin resolver a la vez.
 */
let downTarget: EventTarget | null = null;

export function backdropDismiss(onClose: () => void) {
  return {
    onMouseDown: (e: ReactMouseEvent) => {
      downTarget = e.target;
    },
    onClick: (e: ReactMouseEvent) => {
      if (e.target === e.currentTarget && downTarget === e.currentTarget) {
        onClose();
      }
      downTarget = null;
    },
  };
}
