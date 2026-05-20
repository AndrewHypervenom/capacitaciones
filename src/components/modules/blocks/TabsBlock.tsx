import { useState, useRef } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import type { TabsBlock } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { cn } from '@/lib/cn';

interface Props {
  block: TabsBlock;
  language: Language;
}

export function TabsBlockRenderer({ block, language }: Props) {
  const [active, setActive] = useState(0);
  const groupId = useRef(`tabs-${Math.random().toString(36).slice(2)}`).current;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setActive((a) => Math.min(a + 1, block.tabs.length - 1)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
  };

  const content = block.tabs[active]?.content[language] || block.tabs[active]?.content.es || '';

  return (
    <div>
      {/* Tab bar */}
      <LayoutGroup id={groupId}>
        <div
          role="tablist"
          className="flex gap-1 p-1 glass rounded-2xl mb-5 overflow-x-auto"
          onKeyDown={handleKeyDown}
        >
          {block.tabs.map((tab, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={active === i}
              onClick={() => setActive(i)}
              className={cn(
                'relative flex-1 min-w-max px-4 py-2 text-[13px] font-medium rounded-xl transition-colors duration-200 focus:outline-none',
                active === i ? 'text-text' : 'text-text-muted hover:text-text',
              )}
            >
              {active === i && (
                <motion.div
                  layoutId="tab-bg"
                  className="absolute inset-0 glass-md rounded-xl"
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                />
              )}
              <span className="relative z-10">{tab.label[language] || tab.label.es}</span>
            </button>
          ))}
        </div>
      </LayoutGroup>

      {/* Content */}
      <motion.div
        key={active}
        role="tabpanel"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="px-1"
      >
        {content.split('\n').map((line, i) =>
          line.trim() === '' ? (
            <div key={i} className="h-3" />
          ) : (
            <p key={i} className="text-[15px] text-text-muted leading-relaxed">
              {line}
            </p>
          ),
        )}
      </motion.div>
    </div>
  );
}
