import i18n from '@/i18n'

/**
 * Idioma en el que la IA REDACTA el contenido nuevo: el que el capacitador tiene puesto
 * en el sitio. Manda sobre el idioma del material fuente — si el sitio está en portugués
 * y el PDF en español, el módulo sale en portugués.
 *
 * Antes todo se generaba en español fijo y los otros dos idiomas se copiaban/traducían
 * después; ahora la "base" es variable y hay que llevarla a la traducción diferida.
 */
export type AiLang = 'es' | 'en' | 'pt'

export const AI_LANGS: AiLang[] = ['es', 'en', 'pt']

/** Acepta 'pt-BR', 'es-CO'… y cae al español si el idioma no es uno de los tres. */
export function normalizeAiLang(raw: unknown, fallback: AiLang = 'es'): AiLang {
  const s = String(raw ?? '').trim().toLowerCase()
  if (s.startsWith('pt')) return 'pt'
  if (s.startsWith('en')) return 'en'
  if (s.startsWith('es')) return 'es'
  return fallback
}

/** Idioma actual de la interfaz, listo para mandárselo a las Edge Functions. */
export function currentAiLang(): AiLang {
  return normalizeAiLang(i18n.resolvedLanguage ?? i18n.language)
}

/** Los otros dos idiomas (los que quedan pendientes de traducir). */
export function otherLangs(base: AiLang): AiLang[] {
  return AI_LANGS.filter((l) => l !== base)
}

/** Nombre del idioma para mostrar en la interfaz. */
export const AI_LANG_LABEL: Record<AiLang, string> = {
  es: 'Español',
  en: 'English',
  pt: 'Português (BR)',
}
