import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Sparkles, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SectionQuiz } from '@/data/modules';
import type { Language } from '@/stores/userStore';
import { useProgressStore } from '@/stores/progressStore';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';

interface Props {
  moduleId: string;
  sectionIdx: number;
  quiz: SectionQuiz;
  language: Language;
  quizIndex?: number;
  totalQuizzes?: number;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E'];

const CONFETTI_COLORS = [
  'bg-neon-green',
  'bg-neon-magenta',
  'bg-amber-400',
  'bg-neon-green',
  'bg-neon-magenta',
  'bg-orange-400',
  'bg-neon-green',
  'bg-neon-magenta',
];

function ConfettiPiece({ color, angle, delay, isBar }: { color: string; angle: number; delay: number; isBar?: boolean }) {
  const rad = (angle * Math.PI) / 180;
  const dist = 56 + Math.random() * 24;
  const x = Math.cos(rad) * dist;
  const y = Math.sin(rad) * dist;
  return (
    <motion.span
      className={cn(
        'absolute',
        color,
        isBar ? 'h-0.5 w-2 rounded-sm' : 'h-2.5 w-2.5 rounded-full',
      )}
      style={{ top: '50%', left: '50%' }}
      initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
      animate={{ x, y: y - 28, opacity: 0, scale: 0.3, rotate: angle }}
      transition={{ duration: 0.75, delay, ease: [0.16, 1, 0.3, 1] }}
    />
  );
}

export function KnowledgeCheck({
  moduleId,
  sectionIdx,
  quiz,
  language,
  quizIndex,
  totalQuizzes,
}: Props) {
  const { t } = useTranslation();
  const recordCheck = useProgressStore((s) => s.recordCheck);
  const stored = useProgressStore((s) => s.checkAnswers[moduleId]?.[sectionIdx]);
  const [selected, setSelected] = useState<number | null>(stored ?? null);
  const [showConfetti, setShowConfetti] = useState(false);
  const reducedMotion = useReducedMotion();

  const choose = (i: number) => {
    if (selected !== null) return;
    setSelected(i);
    recordCheck(moduleId, sectionIdx, i);
    if (i === quiz.correct && !reducedMotion) {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 800);
    }
  };

  const answered = selected !== null;
  const correct = answered && selected === quiz.correct;

  return (
    <motion.div
      className="mt-10 rounded-3xl overflow-hidden glass-md"
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border/8">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-xl bg-neon-green/8 flex items-center justify-center ring-1 ring-neon-green/14">
            <Sparkles className="h-3.5 w-3.5 text-neon-green" />
          </div>
          <span className="text-[11px] uppercase tracking-wider text-text-subtle font-semibold">
            {t('module.knowledge_check')}
          </span>
        </div>
        {totalQuizzes !== undefined && totalQuizzes > 1 && quizIndex !== undefined && (
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalQuizzes }).map((_, i) => (
              <motion.span
                key={i}
                className={cn(
                  'inline-block rounded-full transition-all duration-300',
                  i < quizIndex
                    ? 'h-2 w-2 bg-neon-green'
                    : i === quizIndex
                      ? answered
                        ? correct ? 'h-2 w-2 bg-neon-green' : 'h-2 w-2 bg-neon-magenta'
                        : 'h-2.5 w-2.5 bg-text-muted'
                      : 'h-1.5 w-1.5 bg-glass-border/20',
                )}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-6 py-6">
        {/* Question */}
        <p className="text-[16.5px] font-semibold leading-snug mb-6 tracking-tight">
          {quiz.question[language]}
        </p>

        {/* Options */}
        <div className="space-y-2.5 mb-2">
          {quiz.options[language].map((opt, i) => {
            const isSelected = selected === i;
            const isCorrect = i === quiz.correct;
            const showState = answered;

            return (
              <motion.button
                key={i}
                onClick={() => choose(i)}
                disabled={answered}
                initial={reducedMotion ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: reducedMotion ? 0 : i * 0.07, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                whileHover={!answered && !reducedMotion ? { scale: 1.006, y: -1 } : undefined}
                whileTap={!answered && !reducedMotion ? { scale: 0.98 } : undefined}
                className={cn(
                  'w-full text-left flex items-center gap-3.5 px-4 py-3.5 rounded-2xl border transition-all duration-200 group',
                  !showState && 'glass border-glass-border/10 hover:border-neon-green/25 hover:bg-glass/6 cursor-pointer',
                  showState && isSelected && isCorrect && 'glass border-neon-green/25 bg-neon-green/6',
                  showState && isSelected && !isCorrect && 'glass border-neon-magenta/25 bg-neon-magenta/6',
                  showState && !isSelected && isCorrect && 'glass border-neon-green/20 opacity-70',
                  showState && !isSelected && !isCorrect && 'glass border-glass-border/5 opacity-35',
                  answered && 'cursor-default',
                )}
              >
                {/* Letter badge — becomes check/X after answer */}
                <span className={cn(
                  'shrink-0 relative inline-flex items-center justify-center h-8 w-8 rounded-xl text-[12px] font-bold transition-all',
                  !showState && 'bg-glass/8 text-text-muted group-hover:bg-neon-green/10 group-hover:text-neon-green border border-glass-border/10',
                  showState && isSelected && isCorrect && 'bg-neon-green/80 text-black',
                  showState && isSelected && !isCorrect && 'bg-neon-magenta/80 text-white',
                  showState && !isSelected && isCorrect && 'bg-neon-green/10 text-neon-green',
                  showState && !isSelected && !isCorrect && 'bg-glass/8 text-text-subtle',
                )}>
                  {showState && isSelected ? (
                    <>
                      {isCorrect ? (
                        <Check className="h-4 w-4" strokeWidth={3} />
                      ) : (
                        <X className="h-4 w-4" strokeWidth={3} />
                      )}
                      {/* Confetti burst */}
                      {isCorrect && showConfetti && !reducedMotion &&
                        CONFETTI_COLORS.map((color, ci) => (
                          <ConfettiPiece
                            key={ci}
                            color={color}
                            angle={(ci / CONFETTI_COLORS.length) * 360 + 30}
                            delay={ci * 0.05}
                            isBar={ci % 2 === 0}
                          />
                        ))
                      }
                    </>
                  ) : (
                    OPTION_LABELS[i] ?? String(i + 1)
                  )}
                </span>
                <span className="text-[14.5px] leading-snug flex-1">{opt}</span>
              </motion.button>
            );
          })}
        </div>

        {/* Explanation */}
        <AnimatePresence>
          {answered && (
            <motion.div
              key="explanation"
              initial={reducedMotion ? false : { opacity: 0, height: 0, y: 6 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className={cn(
                'mt-5 rounded-2xl px-5 py-4 glass',
                correct ? 'border-neon-green/20' : 'border-neon-magenta/20',
              )}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn(
                    'h-1.5 w-1.5 rounded-full animate-glow-pulse',
                    correct ? 'bg-neon-green' : 'bg-neon-magenta',
                  )} />
                  <span className={cn(
                    'text-[11px] uppercase tracking-wider font-semibold',
                    correct ? 'text-neon-green' : 'text-neon-magenta',
                  )}>
                    {correct ? t('module.check_correct') : t('module.check_incorrect')}
                  </span>
                </div>
                <p className="text-[14px] leading-relaxed text-text/90">
                  {quiz.explanation[language]}
                </p>
                {!correct && (
                  <button
                    onClick={() => setSelected(null)}
                    className="mt-4 flex items-center gap-1.5 text-[12.5px] font-medium text-neon-magenta/70 hover:text-neon-magenta transition-colors"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Intentar de nuevo
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
