/**
 * Curva suave con interpolación MONÓTONA (Fritsch-Carlson): pasa por todos los
 * puntos sin sobrepasarse. Clave con outliers fuertes (p. ej. el día que se
 * dispara el gasto, o el pico de gente a las 9 a. m.): una spline cardinal se
 * pasaría de largo e inventaría ondas —y valles bajo cero— que no existen.
 *
 * Devuelve el atributo `d` de un <path>. Vive aquí y no dentro de una página
 * porque lo comparten los gráficos de Uso de IA y de Tráfico.
 */
export function smoothLine(pts: { x: number; y: number }[]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`
  const f = (v: number) => v.toFixed(1)
  if (n === 2) return `M ${f(pts[0].x)} ${f(pts[0].y)} L ${f(pts[1].x)} ${f(pts[1].y)}`

  const dx: number[] = [], dy: number[] = [], m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x
    dy[i] = pts[i + 1].y - pts[i].y
    m[i] = dy[i] / (dx[i] || 1)
  }
  const t = new Array(n)
  t[0] = m[0]; t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i], b = t[i + 1] / m[i]
    const h = Math.hypot(a, b)
    if (h > 3) { const k = 3 / h; t[i] = k * a * m[i]; t[i + 1] = k * b * m[i] }
  }
  const d = [`M ${f(pts[0].x)} ${f(pts[0].y)}`]
  for (let i = 0; i < n - 1; i++) {
    const x1 = pts[i].x + dx[i] / 3, y1 = pts[i].y + t[i] * dx[i] / 3
    const x2 = pts[i + 1].x - dx[i] / 3, y2 = pts[i + 1].y - t[i + 1] * dx[i] / 3
    d.push(`C ${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(pts[i + 1].x)} ${f(pts[i + 1].y)}`)
  }
  return d.join(' ')
}
