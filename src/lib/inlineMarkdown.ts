/**
 * Formato en línea (negrita / cursiva / enlace) del Markdown ligero del sitio.
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
 * Enlaces: `[texto](destino "pista")`. La pista es opcional y es la que sale en
 * el globo al pasar el mouse (nunca el `title` del navegador: ver ui/Tooltip).
 * El enlace es UNA MARCA MÁS sobre las letras, igual que la negrita — así el
 * editor puede reescribir el texto entero sin perderlo.
 *
 * Los asteriscos que no cierran formato se muestran TAL CUAL: una contrasena
 * como `Positivosmais2026*` o un `3 * 4` deben verse completos. Solo son
 * marcadores los que abren y cierran de verdad; para forzar uno literal dentro
 * de texto con formato se usa `\*` (igual con `\[` y `\\`).
 */

export type LinkMark = { href: string; title?: string }

export type InlineNode =
  | { type: 'text'; value: string; start: number }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'link'; href: string; title?: string; children: InlineNode[] }

/** Marcas activas sobre una letra. */
export type Marks = { b: boolean; i: boolean; link?: LinkMark }
export type MarkName = 'b' | 'i'

/* ── Destinos permitidos ─────────────────────────────────────────────────
 * El texto lo escribe un capacitador, pero lo lee todo el mundo: un
 * `javascript:` en la descripción de un curso sería un enlace que ejecuta
 * código en la sesión de quien lo abre. Solo pasan los esquemas de siempre y
 * las rutas del propio sitio. */
const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i

/**
 * Devuelve el destino si es seguro, o `null` si no lo es (entonces el texto se
 * muestra sin enlace, nunca el markdown crudo).
 */
export function sanitizeHref(href: string): string | null {
  const h = href.trim()
  if (!h) return null
  if (h.startsWith('/') || h.startsWith('#')) return h   // ruta del propio sitio
  if (SAFE_SCHEME.test(h)) return h
  return null
}

/**
 * Lo que el capacitador escribió → destino usable. `positivos.com/x` sin
 * esquema es lo que teclea cualquiera, y sin esto el navegador lo tomaría como
 * ruta relativa del sitio y llevaría a una página que no existe.
 */
export function normalizeHref(href: string): string {
  const h = href.trim()
  if (!h) return ''
  if (h.startsWith('/') || h.startsWith('#') || SAFE_SCHEME.test(h)) return h
  if (h.includes('@') && !h.includes(' ') && !h.includes('/')) return `mailto:${h}`
  return `https://${h}`
}

/** Caracteres que `\` vuelve literales. */
const ESCAPABLE = new Set(['*', '\\', '[', ']'])

/** Nº de asteriscos seguidos a partir de `i`. */
function runLength(s: string, i: number): number {
  let j = i
  while (j < s.length && s[j] === '*') j++
  return j - i
}

/** Escapa lo que dentro de un tramo con formato podria leerse como marcador. */
function escapeInline(s: string): string {
  return s.replace(/([\\*[\]])/g, '\\$1')
}

/**
 * Busca el cierre: la siguiente racha de EXACTAMENTE `n` asteriscos. Exigir
 * longitud exacta es lo que permite que `*a **b** c*` cierre la cursiva al
 * final y no en medio de la negrita. Los asteriscos escapados (`\*`) no cuentan.
 */
function findCloser(s: string, from: number, n: number): number {
  for (let j = from; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue }
    if (s[j] !== '*') continue
    const r = runLength(s, j)
    if (r === n && j > from) return j
    j += r - 1
  }
  return -1
}

/**
 * Intenta leer `[texto](destino "pista")` a partir de `i`. Los corchetes y
 * paréntesis se balancean (una URL de Wikipedia trae paréntesis dentro) y los
 * escapados no cuentan. Devuelve `null` si ahí no hay un enlace completo: en
 * ese caso el `[` es texto normal, no un marcador roto a la vista.
 */
function matchLink(s: string, i: number): { text: string; textStart: number; href: string; title?: string; end: number } | null {
  if (s[i] !== '[') return null
  let depth = 1
  let j = i + 1
  for (; j < s.length && depth > 0; j++) {
    if (s[j] === '\\') { j++; continue }
    if (s[j] === '[') depth++
    else if (s[j] === ']') depth--
  }
  if (depth !== 0) return null
  const closeBracket = j - 1
  if (s[j] !== '(') return null

  depth = 1
  let k = j + 1
  for (; k < s.length && depth > 0; k++) {
    if (s[k] === '\\') { k++; continue }
    if (s[k] === '(') depth++
    else if (s[k] === ')') depth--
  }
  if (depth !== 0) return null
  const inside = s.slice(j + 1, k - 1)

  // Destino y pista: `url` o `url "pista"`.
  const m = inside.match(/^\s*(\S*?)\s*(?:"([^"]*)")?\s*$/)
  if (!m) return null
  const href = m[1] ?? ''
  if (!href) return null
  return {
    text: s.slice(i + 1, closeBracket),
    textStart: i + 1,
    href,
    title: m[2]?.trim() || undefined,
    end: k,
  }
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
  const literal = (value: string, start: number) => {
    if (!buf) bufStart = start
    buf += value
  }

  while (i < src.length) {
    // `\*`, `\[`, `\\` → el caracter siguiente es literal. Se emite como nodo
    // aparte para que cada nodo de texto siga siendo contiguo en el crudo y el
    // mapeo de selecciones del editor no se descuadre.
    if (src[i] === '\\' && ESCAPABLE.has(src[i + 1])) {
      flush()
      out.push({ type: 'text', value: src[i + 1], start: offset + i })
      i += 2
      continue
    }

    if (src[i] === '[') {
      const link = matchLink(src, i)
      if (link) {
        flush()
        out.push({
          type: 'link',
          href: link.href,
          title: link.title,
          children: parseInline(link.text, offset + link.textStart),
        })
        i = link.end
        continue
      }
      // No es un enlace completo: el corchete es texto.
      literal('[', offset + i)
      i++
      continue
    }

    if (src[i] !== '*') {
      literal(src[i], offset + i)
      i++
      continue
    }
    const run = runLength(src, i)
    const n = Math.min(run, 3)
    const contentStart = i + run
    const close = findCloser(src, contentStart, n)
    if (close === -1) {
      // No cierra: no es formato, es texto. Se muestra tal cual.
      literal(src.slice(i, i + run), offset + i)
      i += run
      continue
    }
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
      } else if (n.type === 'em') {
        walk(n.children, { ...m, i: true })
      } else {
        walk(n.children, { ...m, link: { href: n.href, title: n.title } })
      }
    }
  }

  walk(parseInline(raw), { b: false, i: false })
  return { text: chars.join(''), marks, rawIndex }
}

/** Dos letras pertenecen al mismo enlace si coinciden destino y pista. */
function sameLink(a?: LinkMark, b?: LinkMark): boolean {
  if (!a || !b) return !a && !b
  return a.href === b.href && (a.title ?? '') === (b.title ?? '')
}

/**
 * Envuelve un tramo dejando fuera los espacios de los bordes. `wrap` recibe el
 * núcleo y desde dónde empieza, para que quien envuelve pueda recortar sus
 * propias marcas al mismo trozo.
 */
function wrapEdges(seg: string, wrap: (core: string, at: number) => string): string {
  const lead = seg.match(/^\s*/)![0]
  const core = seg.slice(lead.length).replace(/\s*$/, '')
  if (!core) return seg
  return lead + wrap(core, lead.length) + seg.slice(lead.length + core.length)
}

/** Negrita/cursiva de un tramo que ya comparte enlace (o que no tiene ninguno). */
function serializeMarks(text: string, marks: Marks[]): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const m = marks[i] ?? { b: false, i: false }
    let j = i
    while (j < text.length && marks[j].b === m.b && marks[j].i === m.i) j++
    const chunk = text.slice(i, j)
    i = j

    if (!m.b && !m.i) { out += escapeInline(chunk); continue }
    const d = m.b && m.i ? '***' : m.b ? '**' : '*'
    out += escapeInline(chunk)
      .split('\n')
      .map((seg) => wrapEdges(seg, (core) => d + core + d))
      .join('\n')
  }
  return out
}

/**
 * Vuelve a escribir el markdown desde el texto y sus marcas.
 * Tres cuidados que evitan formato "roto" invisible para el capacitador:
 *  - los marcadores se pegan al texto (los espacios de los bordes quedan fuera),
 *  - nunca cruzan un salto de línea: se reabren en cada renglón,
 *  - dentro de un tramo con formato, un asterisco o corchete literal se escapa
 *    (`\*`, `\[`) para que no se confunda con un marcador.
 */
export function serializeInline(text: string, marks: Marks[]): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const link = marks[i]?.link
    let j = i
    while (j < text.length && sameLink(marks[j]?.link, link)) j++
    const chunk = text.slice(i, j)
    const chunkMarks = marks.slice(i, j)
    i = j

    if (!link) { out += serializeMarks(chunk, chunkMarks); continue }

    // Un enlace por renglón: uno partido a la mitad no existe en markdown.
    const title = link.title ? ` "${link.title.replace(/"/g, "'")}"` : ''
    let at = 0
    out += chunk
      .split('\n')
      .map((seg) => {
        const base = at
        at += seg.length + 1
        return wrapEdges(seg, (core, lead) => {
          const inner = serializeMarks(core, chunkMarks.slice(base + lead, base + lead + core.length))
          return `[${inner}](${link.href}${title})`
        })
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
 * Selección cruda → rango de letras visibles, sin los espacios de los bordes
 * (el formato queda exactamente sobre las palabras elegidas). Devuelve
 * `from === to` cuando no hay nada seleccionado.
 */
function visibleRange(
  rawIndex: number[],
  text: string,
  selStart: number,
  selEnd: number,
): { from: number; to: number } {
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
    return { from: pos, to: pos }
  }
  while (from < to && /\s/.test(text[from])) from++
  while (to > from && /\s/.test(text[to - 1])) to--
  return { from, to }
}

/**
 * Alterna negrita/cursiva sobre la selección.
 *
 * - Si todo lo seleccionado ya tiene la marca → se la quita (segundo clic =
 *   deshacer, que es lo que espera cualquiera que venga de Word).
 * - Si no → se la pone, conservando la otra marca (negrita + cursiva conviven).
 * - Se ignoran los espacios de los bordes de la selección.
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
  const { from, to } = visibleRange(rawIndex, text, selStart, selEnd)

  const at = (i: number): Marks => marks[i] ?? { b: false, i: false }
  const withMark = (m: Marks, on: boolean): Marks =>
    mark === 'b' ? { ...m, b: on } : { ...m, i: on }

  // Sin nada seleccionado: insertar ejemplo ya formateado.
  if (from >= to) {
    const pos = Math.min(Math.max(from, 0), text.length)
    const base = withMark({ ...at(pos > 0 ? pos - 1 : 0), link: undefined }, true)
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
 * Pone (o cambia) el enlace de la selección. Sin nada seleccionado inserta
 * `placeholder` ya enlazado y lo deja seleccionado para escribir encima, igual
 * que hace la negrita.
 */
export function applyLink(
  raw: string,
  selStart: number,
  selEnd: number,
  link: LinkMark,
  placeholder: string,
): { value: string; start: number; end: number } {
  const { text, marks, rawIndex } = flattenInline(raw)
  const { from, to } = visibleRange(rawIndex, text, selStart, selEnd)
  const clean: LinkMark = { href: link.href, title: link.title?.trim() || undefined }

  if (from >= to) {
    const pos = Math.min(Math.max(from, 0), text.length)
    const nextText = text.slice(0, pos) + placeholder + text.slice(pos)
    const nextMarks = [
      ...marks.slice(0, pos),
      ...Array.from({ length: placeholder.length }, () => ({ b: false, i: false, link: clean })),
      ...marks.slice(pos),
    ]
    return locate(serializeInline(nextText, nextMarks), pos, pos + placeholder.length)
  }

  const nextMarks = marks.map((m, k) => (k >= from && k < to ? { ...m, link: clean } : m))
  return locate(serializeInline(text, nextMarks), from, to)
}

/**
 * Quita el enlace. Se quita ENTERO aunque solo esté seleccionada una parte:
 * dejar media palabra enlazada nunca es lo que se pidió al pulsar "quitar".
 */
export function removeLink(
  raw: string,
  selStart: number,
  selEnd: number,
): { value: string; start: number; end: number } {
  const { text, marks, rawIndex } = flattenInline(raw)
  const { from, to } = visibleRange(rawIndex, text, selStart, selEnd)
  // Con el cursor suelto manda la letra anterior, igual que los botones de la
  // barra: es la que hizo que "Quitar enlace" apareciera disponible.
  let a = from < to ? from : Math.max(from - 1, 0)
  const target = marks[a]?.link
  if (!target) return { value: raw, start: selStart, end: selEnd }

  let b = a + 1
  while (a > 0 && sameLink(marks[a - 1]?.link, target)) a--
  while (b < marks.length && sameLink(marks[b]?.link, target)) b++

  const nextMarks = marks.map((m, k) => (k >= a && k < b ? { b: m.b, i: m.i } : m))
  return locate(serializeInline(text, nextMarks), a, b)
}

/**
 * Qué marcas tiene la selección actual, para poder encender los botones de la
 * barra. Una marca cuenta como activa solo si la tiene TODO lo seleccionado
 * (con el cursor suelto, se mira la letra anterior, como en cualquier editor).
 */
export function marksAtSelection(raw: string, selStart: number, selEnd: number): Marks {
  const { text, marks, rawIndex } = flattenInline(raw)
  if (!text.length) return { b: false, i: false }
  const { from, to } = visibleRange(rawIndex, text, selStart, selEnd)

  if (from >= to) {
    // Cursor suelto: manda la letra anterior, salvo al principio del texto.
    const pos = Math.min(from, marks.length)
    return pos > 0 ? { ...marks[pos - 1] } : { b: false, i: false }
  }

  let b = true
  let i = true
  let link: LinkMark | undefined = marks[from].link
  for (let k = from; k < to; k++) {
    if (!marks[k].b) b = false
    if (!marks[k].i) i = false
    if (!sameLink(marks[k].link, link)) link = undefined
  }
  return { b, i, link }
}

/** Traduce un rango de letras visibles a posiciones del markdown resultante. */
function locate(value: string, from: number, to: number): { value: string; start: number; end: number } {
  const { rawIndex } = flattenInline(value)
  const start = rawIndex[from] ?? value.length
  const end = to > from ? (rawIndex[to - 1] ?? value.length - 1) + 1 : start
  return { value, start, end }
}
