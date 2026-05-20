import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useUserStore } from '@/stores/userStore';
import type { Message } from '@/lib/simulator';
import type { Scenario } from '@/data/scenarios';
import { cn } from '@/lib/cn';

interface ChatTranscriptProps {
  messages: Message[];
  scenario: Scenario;
  isTyping?: boolean;
}

export function ChatTranscript({ messages, scenario, isTyping }: ChatTranscriptProps) {
  const { t } = useTranslation();
  const name = useUserStore((s) => s.name);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length, isTyping]);

  return (
    <div
      ref={scrollRef}
      className="surface-card p-6 md:p-8 h-[460px] md:h-[520px] overflow-y-auto"
    >
      <AnimatePresence initial={false}>
        <div className="space-y-4">
          {messages.map((m) => (
            <motion.div
              key={m.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                'flex gap-3 max-w-[85%]',
                m.from === 'agent' ? 'ml-auto flex-row-reverse' : '',
              )}
            >
              <div
                className={cn(
                  'shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold',
                  m.from === 'agent'
                    ? 'bg-brand-green text-white dark:text-black'
                    : 'bg-subtle border border-line text-text',
                )}
              >
                {m.from === 'agent'
                  ? (name[0] ?? 'A').toUpperCase()
                  : (scenario.customer.name[0] ?? 'C').toUpperCase()}
              </div>
              <div
                className={cn(
                  'rounded-2xl px-4 py-3 text-[14.5px] leading-relaxed',
                  m.from === 'agent'
                    ? 'bg-brand-green/12 border border-brand-green/30 text-text'
                    : 'bg-subtle border border-line text-text',
                )}
              >
                <div className="text-[10px] uppercase tracking-wider text-text-subtle mb-1">
                  {m.from === 'agent' ? `${t('simulator.agent')} · ${name}` : scenario.customer.name}
                </div>
                {m.text}
              </div>
            </motion.div>
          ))}
        </div>

        {isTyping && (
          <motion.div
            key="typing-indicator"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="flex gap-3 max-w-[85%] mt-4"
          >
            <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold bg-subtle border border-line text-text">
              {(scenario.customer.name[0] ?? 'C').toUpperCase()}
            </div>
            <div className="rounded-2xl px-4 py-3 bg-subtle border border-line flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-text-subtle"
                  style={{ animation: `typing-bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
              <span className="sr-only">{t('simulator.customer_typing')}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
