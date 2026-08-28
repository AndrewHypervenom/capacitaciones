import { useUserStore } from '@/stores/userStore'
import type { Language } from '@/stores/userStore'

/**
 * Idioma en el que arranca a editarse el CONTENIDO (las pestañas ES/EN/PT de los
 * editores).
 *
 * Antes era siempre español. Con el sitio en portugués o en inglés, el
 * capacitador escribía la pregunta creyendo que la escribía en SU idioma y todo
 * caía en los campos `_es`: los otros dos idiomas quedaban vacíos y parecía que
 * el editor "no guardaba en otros idiomas". Arrancar en el idioma del sitio hace
 * que lo que escribe quede donde él cree que queda.
 *
 * Es solo el valor INICIAL: las pestañas siguen mandando y se puede cambiar.
 */
export function initialContentLang(): Language {
  const l = useUserStore.getState().language
  return l === 'en' || l === 'pt' ? l : 'es'
}

/**
 * Texto de una fila de la base para MOSTRAR, sea cual sea el idioma en que se
 * escribió: primero el idioma del sitio y después cualquiera que tenga algo.
 *
 * Las listas del panel leían `title_es`/`heading_es` a pelo, así que un módulo
 * escrito en portugués aparecía como "Sin título". Es solo para pintar: los
 * formularios siguen editando el campo del idioma elegido.
 */
export function rowText(row: unknown, field = 'title'): string {
  const r = row as Record<string, unknown> | null | undefined
  if (!r) return ''
  const order: Language[] = [initialContentLang(), 'es', 'en', 'pt']
  for (const l of order) {
    const v = (r[`${field}_${l}`] as string | null | undefined)?.trim()
    if (v) return v
  }
  return ''
}

/**
 * Elige entre los tres textos de un campo multilingüe: primero el idioma pedido
 * y después CUALQUIERA que tenga contenido.
 *
 * La versión anterior caía siempre al español (`en || es`), así que un curso
 * escrito en portugués se veía en blanco para quien tuviera el sitio en español o
 * en inglés. Traducir es otra cosa: mientras no se traduzca, se enseña lo que hay.
 */
export function pickLang(
  es: string | null | undefined,
  en: string | null | undefined,
  pt: string | null | undefined,
  lang: string,
): string {
  const byLang: Record<string, (string | null | undefined)[]> = {
    en: [en, es, pt],
    pt: [pt, es, en],
    es: [es, en, pt],
  }
  for (const v of byLang[lang] ?? byLang.es) {
    if ((v ?? '').trim()) return v as string
  }
  return ''
}

/** Igual que `pickLang` pero para listas (objetivos, párrafos, temas…). */
export function pickLangList(
  es: string[] | null | undefined,
  en: string[] | null | undefined,
  pt: string[] | null | undefined,
  lang: string,
): string[] {
  const byLang: Record<string, (string[] | null | undefined)[]> = {
    en: [en, es, pt],
    pt: [pt, es, en],
    es: [es, en, pt],
  }
  for (const v of byLang[lang] ?? byLang.es) {
    if ((v ?? []).some((x) => (x ?? '').trim())) return v as string[]
  }
  return []
}

/** Como `rowText` pero para columnas de lista (`body_es`, `objectives_es`…). */
export function rowList(row: unknown, field: string): string[] {
  const r = row as Record<string, unknown> | null | undefined
  if (!r) return []
  const order: Language[] = [initialContentLang(), 'es', 'en', 'pt']
  for (const l of order) {
    const v = r[`${field}_${l}`] as string[] | null | undefined
    if ((v ?? []).some((x) => (x ?? '').trim())) return v as string[]
  }
  return []
}
