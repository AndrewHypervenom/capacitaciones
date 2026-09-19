/**
 * Última señal de que hay alguien frente al módulo.
 *
 * El cronómetro de módulo (useModuleTimer) solo se pausaba con la pestaña oculta,
 * así que un módulo abierto y visible en un PC que nadie usaba seguía contando:
 * hubo aprendices con 67 h en un módulo de 45 min (pantallas de monitoreo que se
 * quedan encendidas todo el fin de semana). Con esto el cronómetro también se
 * pausa por inactividad.
 *
 * Cuenta como actividad:
 *   - mouse, teclado, scroll, rueda y toques en la página;
 *   - un video reproduciéndose: los <video> nativos por su `timeupdate` (se escucha
 *     en captura porque no burbujea) y YouTube/Vimeo avisando con noteActivity(),
 *     porque dentro de un iframe los eventos no llegan a la página.
 */

let lastActivityAt = Date.now();
let listening = false;

export function noteActivity(): void {
  lastActivityAt = Date.now();
}

export function msSinceActivity(): number {
  return Date.now() - lastActivityAt;
}

const EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

/** Instala los escuchas una sola vez por página; llamarlo de más no pasa nada. */
export function startActivityTracking(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  lastActivityAt = Date.now();
  for (const ev of EVENTS) {
    document.addEventListener(ev, noteActivity, { capture: true, passive: true });
  }
  document.addEventListener('timeupdate', noteActivity, true);
  // Volver a la pestaña es en sí una señal de que alguien está ahí.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) noteActivity();
  });
}
