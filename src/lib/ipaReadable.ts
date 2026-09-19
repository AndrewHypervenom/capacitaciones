/**
 * «Así suena» a partir del AFI.
 *
 * El AFI (/ˈbõ ˈdʒia/) es exacto pero casi nadie lo lee. Esto lo pasa a
 * letras normales del idioma de quien aprende, con la sílaba fuerte en
 * MAYÚSCULAS: /ˈbõ ˈdʒia ˈtudu ˈbẽj̃/ → «bon DJI-a TU-du bein».
 *
 * Es el respaldo para lo que se generó antes de que la IA mandara `sounds`
 * (o cuando lo dejó vacío). Si la entrada trae su «Así suena», manda esa.
 */

type Reader = 'es' | 'en' | 'pt'

const NASAL = '\u0303'
/** Diacríticos que no cambian la lectura con letras normales. */
const DROP = /[\u0361\u0300-\u0302\u0304-\u032e\u0330-\u036f\u02b0-\u02b2\u02b7\u02bc\u02c0\u02e0-\u02e4\u02d0\u02d1\u203f\u0294()]/g

const VOWELS: Record<string, Record<Reader, string>> = {
  a: { es: 'a', en: 'ah', pt: 'a' }, ɐ: { es: 'a', en: 'uh', pt: 'a' }, ɑ: { es: 'a', en: 'ah', pt: 'a' },
  æ: { es: 'a', en: 'a', pt: 'é' }, ʌ: { es: 'a', en: 'uh', pt: 'â' }, ɒ: { es: 'o', en: 'o', pt: 'ó' },
  e: { es: 'e', en: 'eh', pt: 'ê' }, ɛ: { es: 'e', en: 'eh', pt: 'é' }, ə: { es: 'e', en: 'uh', pt: 'e' },
  ɜ: { es: 'e', en: 'er', pt: 'e' }, ɚ: { es: 'er', en: 'er', pt: 'er' }, ɝ: { es: 'er', en: 'er', pt: 'er' },
  i: { es: 'i', en: 'ee', pt: 'i' }, ɪ: { es: 'i', en: 'i', pt: 'i' }, ɨ: { es: 'i', en: 'i', pt: 'i' },
  o: { es: 'o', en: 'oh', pt: 'ô' }, ɔ: { es: 'o', en: 'aw', pt: 'ó' },
  u: { es: 'u', en: 'oo', pt: 'u' }, ʊ: { es: 'u', en: 'oo', pt: 'u' }, ɯ: { es: 'u', en: 'oo', pt: 'u' },
  y: { es: 'iu', en: 'ew', pt: 'iu' }, ø: { es: 'e', en: 'uh', pt: 'e' }, œ: { es: 'e', en: 'uh', pt: 'é' },
}

/** Consonantes de dos signos primero, para que «tʃ» no se lea «t» + «sh». */
const CONSONANTS: Array<[string, Record<Reader, string>]> = [
  ['tʃ', { es: 'ch', en: 'ch', pt: 'tch' }], ['dʒ', { es: 'dj', en: 'j', pt: 'dj' }],
  ['ts', { es: 'ts', en: 'ts', pt: 'ts' }], ['dz', { es: 'ds', en: 'dz', pt: 'dz' }],
  ['ʃ', { es: 'sh', en: 'sh', pt: 'ch' }], ['ʒ', { es: 'y', en: 'zh', pt: 'j' }],
  ['ɕ', { es: 'sh', en: 'sh', pt: 'ch' }], ['ʑ', { es: 'y', en: 'zh', pt: 'j' }],
  ['θ', { es: 'z', en: 'th', pt: 'th' }], ['ð', { es: 'd', en: 'th', pt: 'd' }],
  ['ŋ', { es: 'ng', en: 'ng', pt: 'ng' }], ['ɲ', { es: 'ñ', en: 'ny', pt: 'nh' }],
  ['ʎ', { es: 'll', en: 'ly', pt: 'lh' }], ['ɫ', { es: 'l', en: 'l', pt: 'l' }],
  ['ɾ', { es: 'r', en: 'r', pt: 'r' }], ['r', { es: 'rr', en: 'rr', pt: 'rr' }], ['ɹ', { es: 'r', en: 'r', pt: 'r' }],
  ['ʁ', { es: 'j', en: 'h', pt: 'rr' }], ['χ', { es: 'j', en: 'kh', pt: 'rr' }], ['x', { es: 'j', en: 'kh', pt: 'rr' }],
  ['h', { es: 'j', en: 'h', pt: 'rr' }], ['ɦ', { es: 'j', en: 'h', pt: 'rr' }], ['c', { es: 'k', en: 'k', pt: 'k' }],
  ['ɣ', { es: 'g', en: 'g', pt: 'g' }], ['β', { es: 'b', en: 'v', pt: 'v' }], ['ɡ', { es: 'g', en: 'g', pt: 'g' }],
  ['z', { es: 's', en: 'z', pt: 'z' }], ['s', { es: 's', en: 's', pt: 's' }],
  ['k', { es: 'k', en: 'k', pt: 'k' }], ['g', { es: 'g', en: 'g', pt: 'g' }],
  ['p', { es: 'p', en: 'p', pt: 'p' }], ['b', { es: 'b', en: 'b', pt: 'b' }],
  ['t', { es: 't', en: 't', pt: 't' }], ['d', { es: 'd', en: 'd', pt: 'd' }],
  ['f', { es: 'f', en: 'f', pt: 'f' }], ['v', { es: 'v', en: 'v', pt: 'v' }],
  ['m', { es: 'm', en: 'm', pt: 'm' }], ['n', { es: 'n', en: 'n', pt: 'n' }],
  ['l', { es: 'l', en: 'l', pt: 'l' }],
]

const GLIDES: Record<string, Record<Reader, { onset: string; after: string }>> = {
  j: { es: { onset: 'y', after: 'i' }, en: { onset: 'y', after: 'y' }, pt: { onset: 'i', after: 'i' } },
  w: { es: { onset: 'u', after: 'u' }, en: { onset: 'w', after: 'w' }, pt: { onset: 'u', after: 'u' } },
  ɥ: { es: { onset: 'u', after: 'u' }, en: { onset: 'w', after: 'w' }, pt: { onset: 'u', after: 'u' } },
}

interface Seg { kind: 'V' | 'G' | 'C'; ipa: string; nasal: boolean }

function segment(chunk: string): Seg[] {
  const out: Seg[] = []
  let i = 0
  while (i < chunk.length) {
    const rest = chunk.slice(i)
    const two = CONSONANTS.find(([k]) => k.length === 2 && rest.startsWith(k))
    let seg: Seg | null = null
    let len = 1
    if (two) { seg = { kind: 'C', ipa: two[0], nasal: false }; len = 2 }
    // «i/u» (o «ɪ/ʊ») justo después de otra vocal cierran un diptongo: «aw», «ej».
    else if ('iɪuʊ'.includes(chunk[i]) && out[out.length - 1]?.kind === 'V') seg = { kind: 'G', ipa: 'iɪ'.includes(chunk[i]) ? 'j' : 'w', nasal: false }
    else if (VOWELS[chunk[i]]) seg = { kind: 'V', ipa: chunk[i], nasal: false }
    else if (GLIDES[chunk[i]]) seg = { kind: 'G', ipa: chunk[i], nasal: false }
    else if (CONSONANTS.some(([k]) => k === chunk[i])) seg = { kind: 'C', ipa: chunk[i], nasal: false }
    i += len
    // Marcas que van pegadas al signo anterior.
    while (i < chunk.length && (chunk[i] === NASAL || chunk[i] === '\u032f')) {
      if (seg && chunk[i] === NASAL) seg.nasal = true
      // Vocal con la marca de «no hace sílaba»: se lee como semivocal.
      if (seg && chunk[i] === '\u032f' && seg.kind === 'V') seg = { ...seg, kind: 'G', ipa: seg.ipa === 'u' || seg.ipa === 'ʊ' ? 'w' : 'j' }
      i++
    }
    if (seg) out.push(seg)
  }
  return out
}

/** Parte un trozo en sílabas: entre dos vocales, la última consonante abre la siguiente. */
function syllables(segs: Seg[]): Seg[][] {
  const nuclei = segs.map((s, i) => (s.kind === 'V' ? i : -1)).filter((i) => i >= 0)
  if (nuclei.length <= 1) return segs.length ? [segs] : []
  const cuts: number[] = []
  for (let n = 1; n < nuclei.length; n++) {
    const prev = nuclei[n - 1]
    const next = nuclei[n]
    const between = next - prev - 1
    if (between === 0) { cuts.push(next); continue }
    // Semivocal pegada a la vocal anterior («ej», «aw») se queda en la sílaba anterior.
    let start = prev + 1
    while (start < next && segs[start].kind === 'G' && next - start > 1) start++
    const cons = next - start
    if (cons <= 1) { cuts.push(start); continue }
    // Grupos que abren sílaba en los tres idiomas: consonante + r/l («tra», «bla»).
    const last = segs[next - 1].ipa
    const beforeLast = segs[next - 2]
    const liquid = ['ɾ', 'r', 'ɹ', 'l'].includes(last) && beforeLast.kind === 'C' && ['p', 'b', 't', 'd', 'k', 'g', 'ɡ', 'f', 'v'].includes(beforeLast.ipa)
    cuts.push(next - (liquid ? 2 : 1))
  }
  const out: Seg[][] = []
  let from = 0
  for (const c of cuts) { out.push(segs.slice(from, c)); from = c }
  out.push(segs.slice(from))
  return out.filter((s) => s.length)
}

/** Vocal + semivocal que se escriben juntas: «ej» → «ei» («ay» para quien lee inglés). */
const DIPHTHONGS: Record<string, Record<Reader, string>> = {
  'e+j': { es: 'ei', en: 'ay', pt: 'ei' }, 'ɛ+j': { es: 'ei', en: 'ay', pt: 'éi' },
  'a+j': { es: 'ai', en: 'eye', pt: 'ai' }, 'ɐ+j': { es: 'ai', en: 'eye', pt: 'ai' },
  'o+j': { es: 'oi', en: 'oy', pt: 'ôi' }, 'ɔ+j': { es: 'oi', en: 'oy', pt: 'ói' },
  'u+j': { es: 'ui', en: 'ooey', pt: 'ui' }, 'i+j': { es: 'i', en: 'ee', pt: 'i' },
  'a+w': { es: 'au', en: 'ow', pt: 'au' }, 'ɐ+w': { es: 'au', en: 'ow', pt: 'au' },
  'o+w': { es: 'ou', en: 'oh', pt: 'ou' }, 'ə+w': { es: 'ou', en: 'oh', pt: 'ou' },
  'ɔ+w': { es: 'ou', en: 'ow', pt: 'óu' }, 'e+w': { es: 'eu', en: 'ew', pt: 'êu' },
  'ɛ+w': { es: 'eu', en: 'ew', pt: 'éu' }, 'i+w': { es: 'iu', en: 'ew', pt: 'iu' },
  'u+w': { es: 'u', en: 'oo', pt: 'u' },
}

const NASAL_CONS = ['m', 'n', 'ɲ', 'ŋ']

/** Una sílaba en letras. `next` es el primer sonido de la sílaba que sigue. */
function spell(syl: Seg[], reader: Reader, next: Seg | undefined): string {
  let out = ''
  let pendingN = false
  const flushN = (before: Seg | undefined) => {
    // «õ» antes de «m/n» ya suena nasal: «KO-mu», no «KON-mu».
    if (pendingN && !(before && NASAL_CONS.includes(before.ipa))) out += 'n'
    pendingN = false
  }
  for (let i = 0; i < syl.length; i++) {
    const s = syl[i]
    if (s.kind === 'V') {
      flushN(s)
      const g = syl[i + 1]
      const pair = g?.kind === 'G' ? DIPHTHONGS[`${s.ipa}+${g.ipa}`]?.[reader] : undefined
      if (pair) {
        out += pair
        pendingN = s.nasal || g.nasal
        i++
        continue
      }
      out += VOWELS[s.ipa][reader]
      if (s.nasal) pendingN = true
      continue
    }
    if (s.kind === 'G') {
      const glide = GLIDES[s.ipa][reader]
      const hasVowelBefore = syl.slice(0, i).some((x) => x.kind === 'V')
      out += hasVowelBefore ? glide.after : glide.onset
      if (s.nasal) pendingN = true
      continue
    }
    flushN(s)
    const hasVowelBefore = syl.slice(0, i).some((x) => x.kind === 'V')
    // La «r» fuerte al final de sílaba («tarde» → /taʁ/) se lee como una «r» normal.
    if (hasVowelBefore && ['ʁ', 'χ', 'x', 'h'].includes(s.ipa)) { out += 'r'; continue }
    const map = CONSONANTS.find(([k]) => k === s.ipa)?.[1][reader] ?? ''
    // En español «ge/gi» se leen «je/ji»: se escribe «gue/gui».
    const nextV = syl[i + 1]
    if (reader === 'es' && map === 'g' && nextV?.kind === 'V' && ['e', 'ɛ', 'ə', 'i', 'ɪ'].includes(nextV.ipa)) out += 'gu'
    else out += map
  }
  flushN(next)
  return out
}

function word(ipaWord: string, reader: Reader): string {
  // ˈ y ˌ marcan dónde empieza una sílaba; «.» también.
  const parts: Array<{ text: string; stressed: boolean }> = []
  let buf = ''
  let stressed = false
  for (const ch of ipaWord) {
    if (ch === 'ˈ' || ch === 'ˌ' || ch === '.' || ch === "'") {
      if (buf) parts.push({ text: buf, stressed })
      buf = ''
      stressed = ch === 'ˈ' || ch === "'"
      continue
    }
    buf += ch
  }
  if (buf) parts.push({ text: buf, stressed })

  const syls: Array<{ segs: Seg[]; stressed: boolean }> = []
  for (const p of parts) {
    syllables(segment(p.text)).forEach((segs, i) => syls.push({ segs, stressed: p.stressed && i === 0 }))
  }
  const multi = syls.filter((s) => s.segs.some((x) => x.kind === 'V')).length > 1
  const pieces = syls.map((s, i) => {
    const text = spell(s.segs, reader, syls[i + 1]?.segs[0])
    // Solo se grita la sílaba fuerte si la palabra tiene más de una.
    return multi && s.stressed ? text.toUpperCase() : text
  }).filter(Boolean)
  return pieces.join(multi ? '-' : '')
}

/** AFI → «Así suena» con letras del idioma de quien lee. '' si no hay nada que leer. */
export function ipaToReadable(ipa: string | undefined | null, reader: Reader): string {
  if (!ipa) return ''
  const clean = ipa
    // «ç» se descompone en «c» + cedilla: se cambia antes por su equivalente.
    .replace(/ç/g, 'x')
    .normalize('NFD')
    .replace(/^[\s/[]+|[\s/\]]+$/g, '')
    .replace(DROP, '')
    .toLowerCase()
  if (!clean) return ''
  return clean
    .split(/[\s/|‖,]+/)
    .map((w) => word(w, reader))
    .filter(Boolean)
    .join(' ')
}
