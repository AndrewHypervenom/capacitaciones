// Utilidades de fecha/hora seguras entre zonas horarias.

/**
 * Convierte una marca de tiempo ISO a milisegundos epoch ABSOLUTOS (UTC).
 *
 * Por qué existe: si una columna de Postgres es `timestamp` SIN zona horaria,
 * PostgREST la devuelve sin offset (p. ej. "2026-07-16T17:00:00") y
 * `new Date(...)` la interpretaría como hora LOCAL del navegador. Entonces la
 * caducidad del código del Quiz en Vivo caería en un instante distinto en cada
 * país. Aquí forzamos UTC añadiendo "Z" cuando falta el offset, de modo que el
 * mismo `pin_expires_at` represente el MISMO instante en todo el mundo.
 *
 * Si el string ya trae zona ("...Z" o "...+00:00") se respeta tal cual.
 * Devuelve null si el valor es vacío o no parseable.
 */
export function toUtcMs(value: string | null | undefined): number | null {
  if (!value) return null
  const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value)
  const ms = new Date(hasTz ? value : `${value}Z`).getTime()
  return Number.isNaN(ms) ? null : ms
}
