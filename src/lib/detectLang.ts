import type { AiLang } from '@/lib/aiLang'

/**
 * Detector de idioma barato (es / en / pt), por palabras funcionales.
 *
 * Por qué existe: desde que el contenido se genera en el idioma de la interfaz, la
 * columna base (`campo_es`) ya no siempre trae español — puede traer portugués o
 * inglés, según lo que tuviera puesto el capacitador al crearlo. La base de datos no
 * guarda cuál fue ese idioma, y agregarle una columna a media docena de tablas para
 * eso no vale la pena: se deduce leyendo el texto, que además arregla el contenido
 * viejo sin migrar nada.
 *
 * No pretende ser un detector general: solo separa tres idiomas conocidos en textos
 * de capacitación. Ante la duda devuelve el respaldo (español), que es como se
 * comportaba el sitio antes.
 */

/** Palabras funcionales que casi no se comparten entre los tres idiomas. */
const MARKERS: Record<AiLang, string[]> = {
  es: [
    'el', 'la', 'los', 'las', 'un', 'una', 'del', 'que', 'para', 'con', 'por', 'como',
    'este', 'esta', 'cuando', 'donde', 'pero', 'porque', 'debe', 'puede', 'tiene',
    'siempre', 'también', 'más', 'sus', 'está', 'son', 'ser', 'hacer', 'cliente',
    'usuario', 'asesor', 'llamada',
  ],
  en: [
    'the', 'and', 'of', 'to', 'for', 'with', 'that', 'this', 'from', 'you', 'your',
    'must', 'should', 'can', 'will', 'when', 'where', 'because', 'always', 'their',
    'are', 'is', 'be', 'customer', 'agent', 'call',
  ],
  pt: [
    'o', 'os', 'as', 'um', 'uma', 'do', 'da', 'dos', 'das', 'que', 'para', 'com',
    'por', 'como', 'este', 'esta', 'quando', 'onde', 'mas', 'porque', 'deve', 'pode',
    'tem', 'sempre', 'também', 'mais', 'seus', 'está', 'são', 'ser', 'fazer',
    'cliente', 'usuário', 'atendente', 'chamada', 'não', 'você',
  ],
}

/** Caracteres y secuencias que inclinan la balanza sin depender del vocabulario. */
const HINTS: { lang: AiLang; re: RegExp; weight: number }[] = [
  { lang: 'es', re: /[ñ¿¡]/g, weight: 3 },
  { lang: 'pt', re: /[ãõçâê]/g, weight: 3 },
  { lang: 'pt', re: /\b(não|você|então|informações|atendimento)\b/gi, weight: 4 },
  { lang: 'en', re: /\b(the|and|with|that)\b/gi, weight: 1 },
]

/** Cuántos caracteres se miran como máximo: con esto sobra y evita textos enormes. */
const SAMPLE_LIMIT = 4000

/** El idioma en el que está escrito un texto. Ante la duda, `fallback`. */
export function detectLang(text: string, fallback: AiLang = 'es'): AiLang {
  const sample = (text ?? '').slice(0, SAMPLE_LIMIT).toLowerCase()
  const words = sample.match(/[a-záéíóúüñçãõâêôà]+/g) ?? []
  // Un puñado de palabras no alcanza para decidir nada (un título de dos palabras
  // puede ser idéntico en los tres idiomas).
  if (words.length < 8) return fallback

  const score: Record<AiLang, number> = { es: 0, en: 0, pt: 0 }
  for (const w of words) {
    for (const lang of ['es', 'en', 'pt'] as AiLang[]) {
      if (MARKERS[lang].includes(w)) score[lang] += 1
    }
  }
  for (const h of HINTS) {
    score[h.lang] += (sample.match(h.re)?.length ?? 0) * h.weight
  }

  const best = (['es', 'en', 'pt'] as AiLang[]).reduce((a, b) => (score[b] > score[a] ? b : a))
  // Empate o casi: no hay evidencia suficiente, se queda con el respaldo.
  const runnerUp = Math.max(...(['es', 'en', 'pt'] as AiLang[]).filter((l) => l !== best).map((l) => score[l]))
  if (score[best] === 0 || score[best] - runnerUp < 2) return fallback
  return best
}

/**
 * Junta el texto de las claves BASE de un JSON multiidioma (`es` y `campo_es`) y
 * detecta en qué idioma está realmente escrito. Es lo que permite traducir bien
 * contenido creado con el sitio en otro idioma.
 */
export function detectBaseLang(value: unknown, fallback: AiLang = 'es'): AiLang {
  const parts: string[] = []
  const walk = (v: unknown) => {
    if (parts.join(' ').length > SAMPLE_LIMIT) return
    if (Array.isArray(v)) { for (const x of v) walk(x); return }
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    if (typeof o.es === 'string') parts.push(o.es)
    for (const k of Object.keys(o)) {
      if (k.endsWith('_es') && typeof o[k] === 'string') parts.push(o[k] as string)
      else if (k.endsWith('_es') && Array.isArray(o[k])) {
        parts.push((o[k] as unknown[]).filter((x) => typeof x === 'string').join(' '))
      } else if (k !== 'es' && typeof o[k] === 'object') walk(o[k])
    }
  }
  walk(value)
  return detectLang(parts.join('\n'), fallback)
}
