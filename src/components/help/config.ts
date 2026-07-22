/**
 * Parámetros de control de costo del asistente, diferenciados por rol.
 *
 * El asistente es AHORA "IA-first": cada pregunta la responde Claude Haiku, que
 * conoce todo el manual de la plataforma y el contexto en vivo del usuario. El
 * único freno de costo es el tope diario por usuario (Haiku es económico y el
 * prompt del manual se cachea). La base local (FAQ) queda solo como red de
 * seguridad cuando se agota el cupo o falla la conexión.
 *
 * - Aprendiz (miles de usuarios): tope diario generoso pero acotado.
 * - Staff (capacitador/superadmin, pocos usuarios): tope alto.
 *
 * ⚠️ Los límites diarios deben coincidir con los de la Edge Function
 * `supabase/functions/help-chat/index.ts` (que es quien los valida de verdad).
 */

/** Tope diario de consultas a la IA por usuario. */
export const AI_DAILY_LIMIT_LEARNER = 25
export const AI_DAILY_LIMIT_STAFF = 120

/** Tope diario de consultas a la IA según el rol. */
export function aiDailyLimit(isStaff: boolean): number {
  return isStaff ? AI_DAILY_LIMIT_STAFF : AI_DAILY_LIMIT_LEARNER
}

/** Clave de "hoy" (YYYY-M-D) para el contador diario en el navegador. */
export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
