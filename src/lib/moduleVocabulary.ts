import i18n from '@/i18n'
import { moduleAiAssist, type VocabularyPlan } from '@/services/ai.service'
import type { DbSectionRow } from '@/services/modules.service'
import type { VocabTerm } from '@/types/blocks'
import { blockPlainText } from '@/lib/blockPlainText'
import { rowText } from '@/lib/contentLang'
import { normalizePronLang } from '@/lib/speech'

type Lang = 'es' | 'en' | 'pt'

/** Todo el texto de una sección, en el idioma de trabajo: cuerpo, bloques y quiz. */
export function sectionText(s: DbSectionRow, lang: Lang): string {
  const r = s as unknown as Record<string, unknown>
  const body = (r[`body_${lang}`] as string[] | null)?.length ? (r[`body_${lang}`] as string[]) : (s.body_es ?? [])
  const blocks = Array.isArray(s.blocks_data) ? s.blocks_data : []
  const quizzes = (s.section_quizzes ?? []) as unknown as Array<Record<string, unknown>>
  return [
    ...body,
    ...blocks.map((b) => blockPlainText(b, lang) || blockPlainText(b, 'es')),
    ...quizzes.flatMap((q) => [
      (q[`question_${lang}`] as string) || (q.question_es as string) || '',
      ...((((q[`options_${lang}`] as string[] | null)?.length ? q[`options_${lang}`] : q.options_es) as string[]) ?? []),
    ]),
  ].filter((x) => x?.trim()).join('\n')
}

/**
 * Claude lee los textos del módulo y elige las palabras del idioma que se
 * estudia que vale la pena subrayar (con AFI, y significado solo si es
 * difícil). Devuelve la lista limpia y ordenada; NO la guarda ni cobra cupo:
 * eso lo decide quien llama (un módulo con revisión, o el curso entero).
 */
export async function generateModuleVocabulary(opts: {
  moduleTitle: string
  sections: DbSectionRow[]
  targetLang: string
  lang: Lang
}): Promise<VocabTerm[]> {
  const { moduleTitle, sections, lang } = opts
  const targetLang = normalizePronLang(opts.targetLang)
  const res = await moduleAiAssist({
    action: 'vocabulary_module',
    contentType: 'section',
    sourceLang: lang,
    fields: {},
    moduleTitle,
    language: lang,
    vocabulary: {
      targetLang,
      sections: sections.map((s, index) => ({
        index,
        heading: rowText(s, 'heading') || undefined,
        text: sectionText(s, lang),
      })),
    },
  })
  const d = res.data as unknown as VocabularyPlan
  // Una función sin desplegar no conoce la acción: sin la lista, falta el redeploy.
  if (!Array.isArray(d?.terms)) throw new Error(i18n.t('admin.modules.ai_panel.pron_outdated_function'))

  const empty = { es: '', en: '', pt: '' }
  const seen = new Set<string>()
  const out: VocabTerm[] = []
  for (const x of d.terms) {
    const text = x?.text?.trim().replace(/^[\s"'«»“”.,;:!?¿¡()]+|[\s"'«»“”.,;:!?¿¡()]+$/g, '')
    if (!text || seen.has(text.toLowerCase())) continue
    seen.add(text.toLowerCase())
    out.push({
      text,
      ipa: x.ipa?.trim().replace(/^[/[]|[/\]]$/g, '') || undefined,
      sounds: x.sounds?.trim() ? { ...empty, [lang]: x.sounds.trim() } : undefined,
      meaning: x.meaning?.trim() ? { ...empty, [lang]: x.meaning.trim() } : undefined,
      kind: x.kind?.trim() ? { ...empty, [lang]: x.kind.trim().toLowerCase() } : undefined,
    })
  }
  return out.sort((a, b) => a.text.localeCompare(b.text, targetLang, { sensitivity: 'base' }))
}
