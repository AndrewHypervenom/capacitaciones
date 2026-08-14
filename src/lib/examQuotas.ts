/* ────────────────────────────────────────────────────────────────────────────
   Cuántas preguntas le tocan a cada tema, en un solo sitio.

   Redondear cada tema por su cuenta (`Math.round(total * pct / 100)`) es lo que
   hacía que las cuentas no cuadraran: con 20 preguntas y tres temas al 33/33/34
   salían 7 + 7 + 7 = 21 preguntas de un examen de 20, y el semáforo pedía
   escribir una pregunta que nunca iba a entrar. Aquí se reparte con el método
   del resto mayor — el mismo que usa `split100` para los porcentajes — así que
   la suma de las cuotas es exactamente la parte del examen que cubren los
   temas: `total` cuando los pesos suman 100, y menos si suman menos.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Reparte `total` preguntas entre los temas según su peso en %.
 *
 * Devuelve un arreglo del mismo largo que `weightsPct`. Un tema con peso 0
 * nunca recibe preguntas, ni siquiera del sobrante del redondeo.
 */
export function questionQuotas(total: number, weightsPct: number[]): number[] {
  const n = weightsPct.length
  if (n === 0) return []
  const zeros = Array<number>(n).fill(0)
  if (!Number.isFinite(total) || total <= 0) return zeros

  const safe = weightsPct.map((w) => (Number.isFinite(w) && w > 0 ? w : 0))
  if (safe.every((w) => w === 0)) return zeros

  // Lo que le toca a cada tema con decimales, y el total al que hay que llegar:
  // si los pesos no suman 100, las cuotas tampoco deben sumar el examen entero.
  const exact = safe.map((w) => (total * w) / 100)
  const target = Math.round(exact.reduce((s, v) => s + v, 0))

  const out = exact.map(Math.floor)
  let left = target - out.reduce((s, v) => s + v, 0)

  const order = exact
    .map((v, i) => ({ i, rest: v - Math.floor(v) }))
    .filter(({ i }) => safe[i] > 0)
    .sort((a, b) => b.rest - a.rest || safe[b.i] - safe[a.i])

  for (const { i } of order) {
    if (left <= 0) break
    out[i] += 1
    left -= 1
  }
  return out
}

/** Igual que `questionQuotas`, pero indexado por el id del tema. */
export function quotaMap(
  total: number,
  domains: { id: string; weight_pct: number }[],
): Map<string, number> {
  const quotas = questionQuotas(total, domains.map((d) => d.weight_pct))
  return new Map(domains.map((d, i) => [d.id, quotas[i] ?? 0]))
}
