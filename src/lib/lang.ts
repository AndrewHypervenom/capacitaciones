import type { Language } from '@/stores/userStore'

/**
 * Lectura de los campos multiidioma que guardan el español en la columna base
 * y las traducciones en `campo_en` / `campo_pt`.
 *
 * Por qué esta forma y no `campo_es/_en/_pt`: es la que ya usaban
 * `achievement_defs` (`label`, `label_en`, `label_pt`), y sobre todo permite
 * agregar los idiomas a tablas viejas —`worlds`, `world_regions`,
 * `world_levels`, `arena_quizzes`— sin renombrar la columna que hoy lee media
 * app. El contenido existente sigue funcionando: si falta la traducción, se ve
 * el español, que es exactamente lo que se veía antes.
 */

/** El texto en el idioma pedido, cayendo al español si no está traducido. */
export function pickLang(
  row: Record<string, unknown> | null | undefined,
  field: string,
  lang: Language,
): string {
  if (!row) return ''
  const base = typeof row[field] === 'string' ? (row[field] as string) : ''
  if (lang === 'es') return base
  const translated = row[`${field}_${lang}`]
  return typeof translated === 'string' && translated.trim() ? translated : base
}

/**
 * Devuelve la fila con los campos pedidos ya resueltos al idioma actual.
 * Útil para no tocar el JSX: el componente sigue leyendo `world.name`.
 */
export function localizeRow<T extends object>(
  row: T,
  fields: string[],
  lang: Language,
): T {
  if (lang === 'es') return row
  const src = row as Record<string, unknown>
  const out = { ...src }
  for (const f of fields) {
    if (typeof src[f] === 'string') out[f] = pickLang(src, f, lang)
  }
  return out as T
}

export function localizeRows<T extends object>(
  rows: T[],
  fields: string[],
  lang: Language,
): T[] {
  if (lang === 'es') return rows
  return rows.map((r) => localizeRow(r, fields, lang))
}

// ── Arenas: los pasos del quiz viven en un JSON aparte por idioma ──────────

interface RawOption { id?: string; text?: string; explanation?: string }
interface RawStep { id?: string; question?: string; context?: string; options?: RawOption[] }

/**
 * Mezcla `steps` (español) con `steps_en` / `steps_pt`.
 *
 * Se empareja por `id`, NUNCA por posición: el player baraja las opciones y una
 * traducción a la que le falte una pregunta desalinearía todo el quiz. Lo que
 * decide qué respuesta es correcta (`correct`) sale siempre del original.
 */
export function localizeSteps(
  steps: unknown,
  translated: unknown,
  lang: Language,
): Record<string, unknown>[] {
  const base = Array.isArray(steps) ? (steps as RawStep[]) : []
  if (lang === 'es' || !Array.isArray(translated)) return base as Record<string, unknown>[]

  const tSteps = translated as RawStep[]
  const byId = new Map<string, RawStep>()
  for (const s of tSteps) if (s?.id) byId.set(s.id, s)

  return base.map((s) => {
    const t = s.id ? byId.get(s.id) : undefined
    if (!t) return s as Record<string, unknown>
    const tOpts = new Map<string, RawOption>()
    for (const o of t.options ?? []) if (o?.id) tOpts.set(o.id, o)
    return {
      ...s,
      question: t.question?.trim() || s.question,
      context: t.context?.trim() || s.context,
      options: (s.options ?? []).map((o) => {
        const to = o.id ? tOpts.get(o.id) : undefined
        if (!to) return o
        return {
          ...o, // `correct` y `id` se conservan del original a propósito
          text: to.text?.trim() || o.text,
          explanation: to.explanation?.trim() || o.explanation,
        }
      }),
    }
  })
}
