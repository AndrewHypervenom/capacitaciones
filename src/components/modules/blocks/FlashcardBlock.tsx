import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import type { FlashcardBlock } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { cn } from '@/lib/cn';

interface Props {
  block: FlashcardBlock;
  language: Language;
}

export function FlashcardBlockRenderer({ block, language }: Props) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [dir, setDir] = useState(1);
  const card = block.cards[index];
  const total = block.cards.length;

  const goTo = (next: number) => {
    setDir(next > index ? 1 : -1);
    setFlipped(false);
    setTimeout(() => setIndex(next), 160);
  };

  const handleFlip = () => {
    setFlipped((f) => !f);
    setSeen((s) => new Set(s).add(index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' && index < total - 1) { e.preventDefault(); goTo(index + 1); }
    if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); goTo(index - 1); }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleFlip(); }
  };

  return (
    <div
      className="space-y-4 focus:outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Progress */}
      <div className="flex items-center justify-between text-[11px] text-text-subtle">
        <span>{t('module.blocks.flashcard_reviewed', { seen: seen.size, total })}</span>
        <span className="tabular-nums">{index + 1} / {total}</span>
      </div>
      <div className="flex gap-1 mb-1">
        {block.cards.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              seen.has(i) ? 'bg-neon-green' : 'bg-glass-border/20',
              i === index && !seen.has(i) && 'bg-neon-green/40',
            )}
          />
        ))}
      </div>

      {/* Card */}
      <div
        className="relative h-60 cursor-pointer select-none"
        style={{ perspective: '1200px' }}
        onClick={handleFlip}
      >
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={index}
            custom={dir}
            initial={{ opacity: 0, x: dir * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -24 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full h-full"
          >
            <motion.div
              className="w-full h-full"
              style={{ transformStyle: 'preserve-3d' }}
              animate={{ rotateY: flipped ? 180 : 0 }}
              transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Front */}
              <div
                className="absolute inset-0 glass-md rounded-3xl p-7 flex flex-col items-center justify-center text-center border border-glass-border/10"
                style={{ backfaceVisibility: 'hidden' }}
              >
                <p className="text-[10px] uppercase tracking-widest text-text-subtle mb-3 font-medium">{t('module.blocks.flashcard_question')}</p>
                <div className="overflow-y-auto max-h-[130px] w-full flex items-center justify-center">
                  <p className="text-[17px] font-semibold text-text leading-snug">
                    {card.front[language] || card.front.es}
                  </p>
                </div>
                <p className="text-[11px] text-text-subtle mt-4 shrink-0">{t('module.blocks.flashcard_reveal')}</p>
              </div>

              {/* Back */}
              <div
                className="absolute inset-0 glass-md rounded-3xl p-7 flex flex-col items-center justify-center text-center border border-neon-green/12 bg-neon-green/3"
                style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
              >
                <p className="text-[10px] uppercase tracking-widest text-neon-green mb-3 font-medium">{t('module.blocks.flashcard_answer')}</p>
                <div className="overflow-y-auto max-h-[150px] w-full flex items-center justify-center">
                  <p className="text-[17px] font-semibold text-text leading-snug">
                    {card.back[language] || card.back.es}
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Hint */}
      <p className="text-center text-[11px] text-text-subtle">
        {t('module.blocks.flashcard_nav_hint')}
      </p>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-3">
        <button
          disabled={index === 0}
          onClick={() => goTo(index - 1)}
          className="h-9 w-9 rounded-full glass flex items-center justify-center text-text-muted hover:text-text disabled:opacity-30 transition-colors"
          aria-label={t('common.previous')}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <button
          onClick={handleFlip}
          className="flex items-center gap-1.5 text-[12px] text-text-subtle hover:text-text transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          {flipped ? t('module.blocks.flashcard_see_question') : t('module.blocks.flashcard_see_answer')}
        </button>

        <button
          disabled={index === total - 1}
          onClick={() => goTo(index + 1)}
          className="h-9 w-9 rounded-full glass flex items-center justify-center text-text-muted hover:text-text disabled:opacity-30 transition-colors"
          aria-label={t('common.next')}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
