import { useState, useRef, type ReactNode } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import type { TabMedia, TabsBlock } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { cn } from '@/lib/cn';
import { RichText } from '@/components/ui/RichText';

interface Props {
  block: TabsBlock;
  language: Language;
  /**
   * Pinta la imagen o el video de la pestaña. Lo inyecta BlockRenderer en vez de
   * resolverlo aquí: así el video de una pestaña pasa por EXACTAMENTE el mismo
   * reproductor que el bloque de video (con su candado de no adelantar y su
   * registro de visto), sin duplicar ese motor ni crear un import circular.
   */
  renderMedia?: (media: TabMedia) => ReactNode;
}

export function TabsBlockRenderer({ block, language, renderMedia }: Props) {
  const [active, setActive] = useState(0);
  const groupId = useRef(`tabs-${Math.random().toString(36).slice(2)}`).current;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setActive((a) => Math.min(a + 1, block.tabs.length - 1)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
  };

  const content = block.tabs[active]?.content[language] || block.tabs[active]?.content.es || '';
  const media = block.tabs[active]?.media;

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
        {/* El medio va ARRIBA del texto: es lo que identifica la iniciativa de
            un vistazo, y el texto explica lo que se está viendo. */}
        {media?.url && renderMedia && (
          <div className={cn('overflow-hidden', content && 'mb-4')}>{renderMedia(media)}</div>
        )}
        {content && <RichText text={content} className="text-[15px] text-text-muted" />}
      </motion.div>
    </div>
  );
}
