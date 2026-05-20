import { useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { Scenario } from '@/data/scenarios';
import type { Language } from '@/stores/userStore';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';

interface ChecklistProps {
  scenario: Scenario;
  language: Language;
  completed: Set<string>;
}

export function Checklist({ scenario, language, completed }: ChecklistProps) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const done = completed.size;
  const total = scenario.checklist.length;

  const prevCompletedRef = useRef<Set<string>>(new Set());

  const newlyCompleted = useMemo(() => {
    const result = new Set<string>();
    for (const id of completed) {
      if (!prevCompletedRef.current.has(id)) result.add(id);
    }
    return result;
  }, [completed]);

  useEffect(() => {
    prevCompletedRef.current = new Set(completed);
  }, [completed]);

  const popVariants = {
    rest: { scale: 1 },
    pop: reducedMotion ? { scale: 1 } : { scale: [1, 1.25, 0.92, 1] },
  };

  return (
    <div className="surface-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <div className="text-[11px] uppercase tracking-wider text-text-subtle font-medium">
          {t('simulator.checklist_title')}
        </div>
        <div className="text-[12px] font-mono text-text-muted tabular-nums">
          {done}/{total}
        </div>
      </div>
      <div className="h-1 rounded-full bg-subtle overflow-hidden mb-6 border border-line">
        <div
          className="h-full bg-brand-green transition-[width] duration-500 ease-apple"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>
      <ul className="space-y-3 flex-1">
        {scenario.checklist.map((item) => {
          const isDone = completed.has(item.id);
          const justCompleted = newlyCompleted.has(item.id);
          return (
            <li key={item.id} className="flex items-start gap-3">
              <motion.div
                animate={justCompleted ? 'pop' : 'rest'}
                variants={popVariants}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  'shrink-0 mt-0.5 w-5 h-5 rounded-full inline-flex items-center justify-center transition-colors',
                  isDone
                    ? 'bg-brand-green text-white dark:text-black'
                    : 'border border-line bg-surface',
                )}
              >
                <AnimatePresence initial={false}>
                  {isDone && (
                    <motion.span
                      key="check"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="inline-flex"
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
              <span
                className={cn(
                  'text-[13.5px] transition-colors leading-snug',
                  isDone ? 'text-text' : 'text-text-muted',
                )}
              >
                {item.label[language]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
