import { useState } from 'react'
import { CheckCircle2, Eye, EyeOff, Mic, RotateCcw, Undo2, Volume2, X } from 'lucide-react'
import type { ContentBlock, PronunciationBlock } from '@/types/blocks'
import { buildPronunciationBlock } from '@/lib/pronunciationBlock'
import type { PronunciationPlan } from '@/services/ai.service'
import { PRONUNCIATION_LANGS, normalizePronLang, speak } from '@/lib/speech'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { PronunciationBlockRenderer } from '@/components/modules/blocks/PronunciationBlock'
import { cn } from '@/lib/cn'
import i18n from '@/i18n'
import { blockPlainText } from '@/lib/blockPlainText'

type Lang = 'es' | 'en' | 'pt'
type Suggestion = PronunciationPlan['suggestions'][number]

export interface PronunciationInsert {
  /** Índice del bloque tras el que va la práctica; -1 = al principio. */
  afterIndex: number
  block: PronunciationBlock
}

export function PronunciationPlanCard({
  plan, blocks, lang, onInsert, onDiscard, onRegenerate,
}: {
  plan: PronunciationPlan
  blocks: ContentBlock[]
  lang: Lang
  onInsert: (items: PronunciationInsert[]) => void
  onDiscard: () => void
  onRegenerate: () => void
}) {
  const suggestions = plan.is_language_content ? plan.suggestions ?? [] : []
  const target = normalizePronLang(plan.target_lang || 'en-US')
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(suggestions.map((_, i) => i)))
  const [previewing, setPreviewing] = useState<Set<number>>(() => new Set())
  // Frases quitadas ("índice:frase"): se ven tachadas y no se insertan.
  const [dropped, setDropped] = useState<Set<string>>(() => new Set())
  const langLabel = PRONUNCIATION_LANGS.find((l) => l.value === target)?.label ?? target

  const flip = <T,>(set: React.Dispatch<React.SetStateAction<Set<T>>>, i: T) => set((prev) => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  })

  /** La práctica con solo las frases que siguen puestas. */
  const kept = (s: Suggestion, i: number): Suggestion => ({
    ...s,
    phrases: (s.phrases ?? []).filter((_, k) => !dropped.has(`${i}:${k}`)),
  })
  const willInsert = (s: Suggestion, i: number) => chosen.has(i) && kept(s, i).phrases.length > 0
  const insertCount = suggestions.filter((s, i) => willInsert(s, i)).length

  const afterIndex = (s: Suggestion) => Math.max(-1, Math.min(blocks.length - 1, Math.round(Number(s.after_index))))

  const where = (idx: number) => {
    if (idx < 0 || !blocks[idx]) return i18n.t('admin.modules.ai_panel.pron_at_start')
    const type = blocks[idx].type
    const label = i18n.t(`admin.modules.be.block_labels.${type}`, type)
    const text = blockPlainText(blocks[idx], lang)
    const snippet = text.length > 48 ? `${text.slice(0, 48).trimEnd()}…` : text
    return i18n.t('admin.modules.ai_panel.pron_after_block', { n: idx + 1, label, snippet })
  }

  const insert = () => onInsert(
    suggestions
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => willInsert(s, i))
      .map(({ s, i }) => ({ afterIndex: afterIndex(s), block: buildPronunciationBlock(kept(s, i), target, lang) }))
      .filter((x) => x.block.phrases.length > 0),
  )

  return (
    <div className="rounded-xl border border-neon-magenta/20 bg-neon-magenta/4 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Mic className="h-3.5 w-3.5 shrink-0 text-neon-magenta" />
          <span className="text-xs font-medium text-text truncate">
            {plan.is_language_content
              ? i18n.t('admin.modules.ai_panel.pron_found', { lang: langLabel })
              : i18n.t('admin.modules.ai_panel.pron_not_language')}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onRegenerate} className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text transition-colors">
            <RotateCcw className="h-3 w-3" /> {i18n.t('admin.modules.ai_panel.regenerate')}
          </button>
          <Tooltip label={i18n.t('common.close')}>
            <button onClick={onDiscard} aria-label={i18n.t('common.close')} className="text-text-muted hover:text-danger transition-colors p-0.5">
              <X className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {plan.reason && <p className="text-[11px] text-text-muted leading-snug">{plan.reason}</p>}

      {suggestions.map((s, i) => {
        const keptPhrases = kept(s, i).phrases.length
        const on = chosen.has(i) && keptPhrases > 0
        const open = previewing.has(i)
        return (
          <div
            key={i}
            className={cn(
              'rounded-lg border p-2.5 space-y-2 transition-colors',
              on ? 'border-neon-magenta/30 bg-surface' : 'border-glass-border/15',
            )}
          >
            <div className="flex items-start gap-2">
              <input
                id={`pron-sug-${i}`}
                type="checkbox"
                checked={on}
                disabled={keptPhrases === 0}
                onChange={() => flip(setChosen, i)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-neon-green cursor-pointer"
              />
              <label htmlFor={`pron-sug-${i}`} className={cn('min-w-0 flex-1 cursor-pointer', !on && 'opacity-60')}>
                <p className="text-[12px] font-semibold text-text">{s.title}</p>
                <p className="text-[10.5px] text-text-subtle">{where(afterIndex(s))}</p>
                {s.why && <p className="text-[10.5px] text-text-muted mt-0.5">{s.why}</p>}
                {keptPhrases === 0 && (
                  <p className="text-[10.5px] text-amber-600 dark:text-amber-400 mt-0.5">{i18n.t('admin.modules.pron_module.all_removed')}</p>
                )}
              </label>
              <button
                type="button"
                onClick={() => flip(setPreviewing, i)}
                aria-expanded={open}
                className={cn(
                  'shrink-0 inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10.5px] font-semibold transition-colors',
                  open
                    ? 'border-neon-green/30 bg-neon-green/10 text-neon-green'
                    : 'border-glass-border/20 text-text-muted hover:text-text hover:border-glass-border/40',
                )}
              >
                {open ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {open ? i18n.t('admin.modules.ai_panel.pron_hide_preview') : i18n.t('admin.modules.ai_panel.pron_preview')}
              </button>
            </div>

            {open ? (
              // El mismo componente que ve quien aprende: lo que se ve aquí es lo que se inserta.
              <div className={cn('rounded-xl border border-dashed border-glass-border/25 bg-bg/40 p-3 sm:p-4', !on && 'opacity-60')}>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                  {i18n.t('admin.modules.ai_panel.pron_preview_label')}
                </p>
                <PronunciationBlockRenderer block={buildPronunciationBlock(kept(s, i), target, lang)} language={lang} />
              </div>
            ) : (
              <ul className={cn('pl-5 space-y-0.5', !on && 'opacity-60')}>
                {(s.phrases ?? []).map((p, k) => {
                  const key = `${i}:${k}`
                  const gone = dropped.has(key)
                  const hint = gone ? i18n.t('admin.modules.pron_module.phrase_restore') : i18n.t('admin.modules.pron_module.phrase_remove')
                  return (
                  <li key={k} className={cn('flex items-center gap-1.5 text-[11px] text-text-muted min-w-0', gone && 'opacity-50')}>
                    <button
                      type="button"
                      onClick={() => void speak(p.text, target)}
                      aria-label={i18n.t('admin.modules.be.pron_preview')}
                      className="shrink-0 text-text-subtle hover:text-neon-green"
                    >
                      <Volume2 className="h-3 w-3" />
                    </button>
                    <span className={cn('font-medium text-text', gone && 'line-through')} lang={target}>{p.text}</span>
                    {p.translation && <span className={cn('min-w-0 flex-1 truncate', gone && 'line-through')}>— {p.translation}</span>}
                    <Tooltip label={hint} anchor="element">
                      <button
                        type="button"
                        onClick={() => flip(setDropped, key)}
                        aria-label={hint}
                        className={cn(
                          'ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors',
                          gone ? 'text-neon-green hover:bg-neon-green/10' : 'text-text-subtle hover:bg-danger/10 hover:text-danger',
                        )}
                      >
                        {gone ? <Undo2 className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      </button>
                    </Tooltip>
                  </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}

      {suggestions.length > 0 && (
        <Button
          size="sm"
          disabled={insertCount === 0}
          onClick={insert}
          className="w-full justify-center"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {i18n.t('admin.modules.ai_panel.pron_insert', { count: insertCount })}
        </Button>
      )}
    </div>
  )
}
