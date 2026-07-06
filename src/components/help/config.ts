/**
 * Parámetros de control de costo del asistente. La idea: que la IA NO salga
 * rápido. Primero el bot insiste con respuestas locales; la opción de IA solo
 * se desbloquea tras varias preguntas, y aun así con un tope diario por usuario.
 *
 * ⚠️ `AI_DAILY_LIMIT` debe coincidir con el mismo valor en la Edge Function
 * `supabase/functions/help-chat/index.ts` (que es quien lo valida de verdad).
 */

/** Preguntas del usuario en la conversación antes de ofrecer la opción de IA. */
export const AI_UNLOCK_AFTER = 3

/** Máximo de consultas a la IA por usuario y día (también validado en el servidor). */
export const AI_DAILY_LIMIT = 5

/** Clave de "hoy" (YYYY-M-D) para el contador diario en el navegador. */
export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
