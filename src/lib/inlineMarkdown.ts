/**
 * Formato en línea (negrita / cursiva) del Markdown ligero del sitio.
 *
 * Un solo módulo hace las tres cosas para que editor y vista final nunca se
 * contradigan:
 *  - `parseInline`  → árbol para renderizar (soporta anidado: **negrita con
 *                     *cursiva* dentro**, y ***ambas*** a la vez).
 *  - `flattenInline`→ texto plano + qué marcas tiene cada letra + de qué
 *                     posición del texto crudo salió (para mapear selecciones).
 *  - `toggleInlineMark` → alterna una marca sobre la selección: si TODO lo
 *                     seleccionado ya está en negrita, se la quita; si no, se
 *                     la pone. Y solo a lo seleccionado, ni una letra más.
 *
 * Los asteriscos que no cierran se descartan (tolerante a fallos), igual que
 * antes: es preferible a mostrarlos crudos al aprendiz.
 */

export type InlineNode =
  | { type: 'text'; value: string; start: number }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }

/** Marcas activas sobre una letra. */
export type Marks = { b: boolean; i: boolean }
export type MarkName = 'b' | 'i'

/** Nº de asteriscos seguidos a partir de `i`. */
function runLength(s: string, i: number): number {
  let j = i
  while (j < s.length && s[j] === '*') j++
  return j - i
}

/**
 * Busca el cierre: la siguiente racha de EXACTAMENTE `n` asteriscos. Exigir
 * longitud exacta es lo que permite que `*a **b** c*` cierre la cursiva al
 * final y no en medio de la negrita.
 */
function findCloser(s: string, from: number, n: number): number {
  for (let j = from; j < s.length; j++) {
    if (s[j] !== '*') continue
    const r = runLength(s, j)
    if (r === n && j > from) return j
    j += r - 1
  }
  return -1
}

function wrapNodes(children: InlineNode[], n: number): InlineNode {
  if (n === 1) return { type: 'em', children }
  if (n === 2) return { type: 'strong', children }
  return { type: 'strong', children: [{ type: 'em', children }] }
}

/** Parsea el formato en línea. `offset` = posición del fragmento en el texto original. */
export function parseInline(src: string, offset = 0): InlineNode[] {
  const out: InlineNode[] = []
  let buf = ''
  let bufStart = offset
  let i = 0

  const flush = () => {
    if (buf) out.push({ type: 'text', value: buf, start: bufStart })
    buf = ''
  }

  while (i < src.length) {
    if (src[i] !== '*') {
      if (!buf) bufStart = offset + i
      buf += src[i]
      i++
      continue
    }
    const run = runLength(src, i)
    const n = Math.min(run, 3)
    const contentStart = i + run
    const close = findCloser(src, contentStart, n)
    if (close === -1) { i += run; continue } // asterisco suelto → se descarta
    flush()
    out.push(wrapNodes(parseInline(src.slice(contentStart, close), offset + contentStart), n))
    i = close + n
  }
  flush()
  return out
}

/**
 * Aplana a texto visible + marcas por letra + índice en el texto crudo.
 * `rawIndex[k]` es dónde vive en el markdown la letra visible nº k.
 */
export function flattenInline(raw: string): { text: string; marks: Marks[]; rawIndex: number[] } {
  const chars: string[] = []
  const marks: Marks[] = []
  const rawIndex: number[] = []

  const walk = (nodes: InlineNode[], m: Marks) => {
    for (const n of nodes) {
      if (n.type === 'text') {
        for (let k = 0; k < n.value.length; k++) {
          chars.push(n.value[k])
          marks.push({ ...m })
          rawIndex.push(n.start + k)
        }
      } else if (n.type === 'strong') {
        walk(n.children, { ...m, b: true })
      } else {
        walk(n.children, { ...m, i: true })
      }
    }
  }

  walk(parseInline(raw), { b: false, i: false })
  return { text: chars.join(''), marks, rawIndex }
}

/**
 * Vuelve a escribir el markdown desde el texto y sus marcas.
 * Dos cuidados que evitan formato "roto" invisible para el capacitador:
 *  - los marcadores se pegan al texto (los espacios de los bordes quedan fuera),
 *  - nunca cruzan un salto de línea: se reabren en cada renglón.
 */
export function serializeInline(text: string, marks: Marks[]): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const m = marks[i] ?? { b: false, i: false }
    let j = i
    while (j < text.length && marks[j].b === m.b && marks[j].i === m.i) j++
    const chunk = text.slice(i, j)
    i = j

    if (!m.b && !m.i) { out += chunk; continue }
    const d = m.b && m.i ? '***' : m.b ? '**' : '*'
    out += chunk
      .split('\n')
      .map((seg) => {
        const lead = seg.match(/^\s*/)![0]
        const core = seg.slice(lead.length).replace(/\s*$/, '')
        if (!core) return seg
        return lead + d + core + d + seg.slice(lead.length + core.length)
      })
      .join('\n')
  }
  return out
}

/** Texto visible sin ningún marcador (para recortes, buscadores, etc.). */
export function plainInline(raw: string): string {
  return flattenInline(raw).text
}

/** Cuántas letras visibles hay antes de la posición `rawPos` del texto crudo. */
function plainPosForRaw(rawIndex: number[], rawPos: number): number {
  let n = 0
  while (n < rawIndex.length && rawIndex[n] < rawPos) n++
  return n
}

/**
 * Alterna negrita/cursiva sobre la selección.
 *
 * - Si todo lo seleccionado ya tiene la marca → se la quita (segundo clic =
 *   deshacer, que es lo que espera cualquiera que venga de Word).
 * - Si no → se la pone, conservando la otra marca (negrita + cursiva conviven).
 * - Se ignoran los espacios de los bordes de la selección: el formato queda
 *   exactamente sobre las palabras elegidas.
 * - Sin selección, inserta el texto de ejemplo ya formateado y lo deja
 *   seleccionado para escribir encima.
 *
 * Devuelve el nuevo markdown y dónde debe quedar la selección en él.
 */
export function toggleInlineMark(
  raw: string,
  selStart: number,
  selEnd: number,
  mark: MarkName,
  placeholder: string,
): { value: string; start: number; end: number } {
  const { text, marks, rawIndex } = flattenInline(raw)

  // Selección cruda → rango de letras visibles.
  let from = -1
  let to = -1
  for (let k = 0; k < rawIndex.length; k++) {
    if (rawIndex[k] >= selStart && rawIndex[k] < selEnd) {
      if (from === -1) from = k
      to = k + 1
    }
  }
  if (from === -1) { from = to = plainPosForRaw(rawIndex, selStart) }

  // Los espacios de los bordes no se formatean.
  while (from < to && /\s/.test(text[from])) from++
  while (to > from && /\s/.test(text[to - 1])) to--

  const at = (i: number): Marks => marks[i] ?? { b: false, i: false }
  const withMark = (m: Marks, on: boolean): Marks =>
    mark === 'b' ? { ...m, b: on } : { ...m, i: on }

  // Sin nada seleccionado: insertar ejemplo ya formateado.
  if (from >= to) {
    const pos = Math.min(Math.max(from, 0), text.length)
    const base = withMark(at(pos > 0 ? pos - 1 : 0), true)
    const nextText = text.slice(0, pos) + placeholder + text.slice(pos)
    const nextMarks = [
      ...marks.slice(0, pos),
      ...Array.from({ length: placeholder.length }, () => ({ ...base })),
      ...marks.slice(pos),
    ]
    return locate(serializeInline(nextText, nextMarks), pos, pos + placeholder.length)
  }

  let allSet = true
  for (let k = from; k < to; k++) if (!at(k)[mark]) { allSet = false; break }

  const nextMarks = marks.map((m, k) => (k >= from && k < to ? withMark(m, !allSet) : m))
  return locate(serializeInline(text, nextMarks), from, to)
}

/**
 * Qué marcas tiene la selección actual, para poder encender los botones de la
 * barra. Una marca cuenta como activa solo si la tiene TODO lo seleccionado
 * (con el cursor suelto, se mira la letra anterior, como en cualquier editor).
 */
export function marksAtSelection(raw: string, selStart: number, selEnd: number): Marks {
  const { text, marks, rawIndex } = flattenInline(raw)
  if (!text.length) return { b: false, i: false }

  let from = -1
  let to = -1
  for (let k = 0; k < rawIndex.length; k++) {
    if (rawIndex[k] >= selStart && rawIndex[k] < selEnd) {
      if (from === -1) from = k
      to = k + 1
    }
  }
  if (from === -1) {
    const pos = plainPosForRaw(rawIndex, selStart)
    return pos > 0 ? { ...marks[pos - 1] } : { b: false, i: false }
  }
  while (from < to && /\s/.test(text[from])) from++
  while (to > from && /\s/.test(text[to - 1])) to--
  if (from >= to) return { b: false, i: false }

  let b = true
  let i = true
  for (let k = from; k < to; k++) {
    if (!marks[k].b) b = false
    if (!marks[k].i) i = false
  }
  return { b, i }
}

/** Traduce un rango de letras visibles a posiciones del markdown resultante. */
function locate(value: string, from: number, to: number): { value: string; start: number; end: number } {
  const { rawIndex } = flattenInline(value)
  const start = rawIndex[from] ?? value.length
  const end = to > from ? (rawIndex[to - 1] ?? value.length - 1) + 1 : start
  return { value, start, end }
}
