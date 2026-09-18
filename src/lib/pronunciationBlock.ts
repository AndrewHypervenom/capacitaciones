import type { PronunciationBlock } from '@/types/blocks'
import type { PronunciationPlan } from '@/services/ai.service'
import { normalizePronLang } from '@/lib/speech'

type Lang = 'es' | 'en' | 'pt'
type Suggestion = PronunciationPlan['suggestions'][number]

/** El bloque tal cual se insertaría. La vista previa y la inserción usan el mismo. */
export function buildPronunciationBlock(s: Suggestion, targetLang: string, lang: Lang): PronunciationBlock {
  const ml = (text?: string) => ({ es: '', en: '', pt: '', [lang]: text ?? '' }) as Record<Lang, string>
  return {
    type: 'pronunciation',
    lang: normalizePronLang(targetLang),
    title: ml(s.title),
    phrases: (s.phrases ?? [])
      .filter((p) => p.text?.trim())
      .map((p) => ({ text: p.text.trim(), ipa: p.ipa?.trim() || undefined, translation: ml(p.translation), tip: ml(p.tip) })),
  }
}
