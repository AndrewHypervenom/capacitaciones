/**
 * Navegación global para código fuera de componentes (servicios, tareas en 2º
 * plano). Los botones de acción de las notificaciones de IA la usan para abrir el
 * resultado (curso/módulo/mundo) sin depender del componente que inició la tarea,
 * que puede haberse desmontado. Cae a `window.location` si el router aún no montó.
 */
let navFn: ((to: string) => void) | null = null;

export function setGlobalNavigate(fn: (to: string) => void) {
  navFn = fn;
}

export function globalNavigate(to: string) {
  if (navFn) navFn(to);
  else window.location.assign(to);
}
