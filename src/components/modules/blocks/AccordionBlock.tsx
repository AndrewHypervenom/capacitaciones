import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { AccordionBlock } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { cn } from '@/lib/cn';

interface Props {
  block: AccordionBlock;
  language: Language;
}

export function AccordionBlockRenderer({ block, language }: Props) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      {block.items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div
            key={i}
            className={cn(
              'rounded-2xl border transition-colors duration-200 overflow-hidden',
              isOpen ? 'border-neon-green/20 glass-md' : 'border-glass-border/10 glass',
            )}
          >
            <button
              className="w-full flex items-center justify-between px-5 py-4 text-left gap-3"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
            >
              <span className="text-[14.5px] font-medium text-text leading-snug">
                {item.question[language] || item.question.es}
              </span>
              <motion.div
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="shrink-0 text-text-muted"
              >
                <ChevronDown className="h-4 w-4" />
              </motion.div>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 pt-1">
                    <div className="h-px w-full bg-glass-border/10 mb-4" />
                    <p className="text-[14px] text-text-muted leading-relaxed">
                      {item.answer[language] || item.answer.es}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
