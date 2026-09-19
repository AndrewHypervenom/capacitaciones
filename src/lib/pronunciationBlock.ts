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
    // Solo si es uno de los tres válidos; si no, el bloque usa su diseño por defecto.
    ...(s.layout === 'list' || s.layout === 'grid' || s.layout === 'steps' ? { layout: s.layout } : {}),
    phrases: (s.phrases ?? [])
      .filter((p) => p.text?.trim())
      .map((p) => ({
        text: p.text.trim(),
        ipa: p.ipa?.trim() || undefined,
        sounds: p.sounds?.trim() ? ml(p.sounds.trim()) : undefined,
        translation: ml(p.translation),
        tip: ml(p.tip),
      })),
  }
}
