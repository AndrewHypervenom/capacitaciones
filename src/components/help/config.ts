/**
 * Parámetros de control de costo del asistente, diferenciados por rol.
 *
 * - Aprendiz (miles de usuarios): la IA no sale rápido. Se desbloquea tras varias
 *   preguntas y con un tope diario bajo. Modelo económico (Haiku) en el servidor.
 * - Staff (capacitador/superadmin, pocos usuarios): IA disponible de inmediato,
 *   tope alto y modelo más potente (Sonnet) en el servidor.
 *
 * ⚠️ Los límites diarios deben coincidir con los de la Edge Function
 * `supabase/functions/help-chat/index.ts` (que es quien los valida de verdad).
 */

/** Preguntas del aprendiz antes de ofrecer la opción de IA (staff: 0 = inmediato). */
export const AI_UNLOCK_AFTER_LEARNER = 3

/** Tope diario de consultas a la IA por usuario. */
export const AI_DAILY_LIMIT_LEARNER = 5
export const AI_DAILY_LIMIT_STAFF = 50

/** Cuántas preguntas debe hacer el usuario antes de que aparezca la opción de IA. */
export function aiUnlockAfter(isStaff: boolean): number {
  return isStaff ? 0 : AI_UNLOCK_AFTER_LEARNER
}

/** Tope diario de consultas a la IA según el rol. */
export function aiDailyLimit(isStaff: boolean): number {
  return isStaff ? AI_DAILY_LIMIT_STAFF : AI_DAILY_LIMIT_LEARNER
}

/** Clave de "hoy" (YYYY-M-D) para el contador diario en el navegador. */
export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
