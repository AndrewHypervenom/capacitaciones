import { fold } from '@/lib/normalize'

/* ─── Búsqueda tolerante para listas de opciones ────────────────────────────
 *
 * Lo que tiene que aguantar, porque es como escribe la gente de verdad:
 *   · sin tildes ni mayúsculas ............ «rocio» → «Rocío»
 *   · palabras en cualquier orden ........ «salud seguridad» → «Seguridad y Salud»
 *   · pedazos del principio de palabra ... «seg sal» → «Seguridad y Salud»
 *   · siglas ............................. «sst» → «Seguridad y Salud en el Trabajo»
 *   · sin espacios ....................... «powerbi» → «Power BI»
 *   · errores de dedo .................... «segurdad», «mexcio» → como SUGERENCIA
 *
 * Los errores de dedo NO se mezclan con los aciertos: si hay aciertos se
 * enseñan solo ellos; si no hay ninguno, se ofrecen los parecidos bajo un
 * «¿Quisiste decir…?». Así una lista filtrada nunca trae ruido, y un vacío
 * casi nunca es un vacío.
 */

/** Palabras que no cuentan para las siglas («SST» = Seguridad y Salud en el Trabajo). */
const STOPWORDS = new Set([
  'y', 'e', 'o', 'u', 'de', 'del', 'la', 'las', 'el', 'los', 'en', 'a', 'al',
  'con', 'por', 'para', 'the', 'of', 'and', 'for', 'to', 'in', 'da', 'do', 'dos', 'das', 'com',
])

export interface PreparedText {
  folded: string
  compact: string
  words: string[]
  initials: string
  /** Para cada unidad UTF-16 del texto plegado, su posición en el original. */
  toOriginal: number[]
}

/** Pliega el texto recordando de qué posición del original viene cada letra. */
export function prepareText(original: string): PreparedText {
  let folded = ''
  const toOriginal: number[] = []
  for (let i = 0; i < original.length; i++) {
    const f = original[i].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    for (let k = 0; k < f.length; k++) {
      folded += f[k]
      toOriginal.push(i)
    }
  }
  const words = folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return {
    folded,
    compact: words.join(''),
    words,
    initials: words.filter((w) => !STOPWORDS.has(w)).map((w) => w[0]).join(''),
    toOriginal,
  }
}

function queryTokens(query: string): string[] {
  return fold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** Distancia de edición con trasposiciones («mexcio» ↔ «mexico» = 1). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev2 = new Array<number>(b.length + 1).fill(0)
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1)
      }
      cur.push(v)
      rowMin = Math.min(rowMin, v)
    }
    if (rowMin > max) return max + 1
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j]
    prev = cur
  }
  return prev[b.length]
}

/** Cuántos errores se le perdonan a una palabra según lo larga que es. */
function allowedTypos(len: number): number {
  if (len <= 3) return 0
  if (len <= 5) return 1
  if (len <= 8) return 2
  return 3
}

/** Puntaje de un token exacto (sin errores de dedo); 0 = no aparece. */
function exactScore(token: string, p: PreparedText): number {
  if (p.words.includes(token)) return 5
  if (p.words.some((w) => w.startsWith(token))) return 4
  if (token.length >= 2 && p.initials.startsWith(token)) return 3.5
  if (p.folded.includes(token)) return 2
  if (token.length >= 3 && p.compact.includes(token)) return 2
  return 0
}

/** Errores de dedo que hacen falta para que el token case con alguna palabra. */
function typoDistance(token: string, p: PreparedText): number {
  const max = allowedTypos(token.length)
  if (max === 0) return Infinity
  let best = Infinity
  for (const w of p.words) {
    // Contra la palabra entera y contra su principio: «segurd» ya es «seguridad».
    const candidates = [w]
    if (w.length > token.length) {
      candidates.push(w.slice(0, token.length), w.slice(0, token.length + 1))
    }
    for (const c of candidates) {
      const d = editDistance(token, c, max)
      if (d <= max && d < best) best = d
    }
    if (best === 1) break
  }
  return best
}

export interface SmartSearchResult<T> {
  /** Lo que casa de verdad, del más parecido al menos. */
  hits: T[]
  /** Solo si `hits` está vacío: parecidos por error de dedo. */
  suggestions: T[]
}

/**
 * Filtra y ordena `items` por `query`. `prepared` debe venir de `prepareText`
 * sobre el texto de cada item (se prepara una vez, no en cada tecla).
 */
export function smartSearch<T>(
  items: T[],
  prepared: PreparedText[],
  query: string,
  maxSuggestions = 5,
): SmartSearchResult<T> {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return { hits: items, suggestions: [] }

  const hits: Array<{ item: T; score: number; pos: number; idx: number }> = []
  const near: Array<{ item: T; dist: number; idx: number }> = []

  items.forEach((item, idx) => {
    const p = prepared[idx]
    let score = 0
    let dist = 0
    let exact = true
    for (const tok of tokens) {
      const s = exactScore(tok, p)
      if (s > 0) {
        score += s
        continue
      }
      exact = false
      const d = typoDistance(tok, p)
      if (!Number.isFinite(d)) {
        dist = Infinity
        break
      }
      dist += d
    }
    if (!Number.isFinite(dist)) return
    if (exact) {
      // A igual puntaje, antes lo que empieza por lo buscado.
      hits.push({ item, score, pos: p.folded.indexOf(tokens[0]), idx })
    } else {
      near.push({ item, dist, idx })
    }
  })

  if (hits.length > 0) {
    hits.sort((a, b) => b.score - a.score || a.pos - b.pos || a.idx - b.idx)
    return { hits: hits.map((h) => h.item), suggestions: [] }
  }
  near.sort((a, b) => a.dist - b.dist || a.idx - b.idx)
  return { hits: [], suggestions: near.slice(0, maxSuggestions).map((n) => n.item) }
}

/**
 * Tramos del texto ORIGINAL que resaltar (lo que casó de lo buscado), ya
 * fusionados y en orden. Vacío si no hay nada que resaltar.
 */
export function highlightRanges(p: PreparedText, query: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const tok of queryTokens(query)) {
    // Preferimos el principio de una palabra; si no, la primera aparición.
    // Los tokens son solo letras y números: no hay nada que escapar.
    const m = new RegExp(`(^|[^\\p{L}\\p{N}])${tok}`, 'u').exec(p.folded)
    const at = m ? m.index + m[1].length : p.folded.indexOf(tok)
    if (at < 0) continue
    const start = p.toOriginal[at]
    const end = p.toOriginal[at + tok.length - 1] + 1
    out.push([start, end])
  }
  out.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const r of out) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}
