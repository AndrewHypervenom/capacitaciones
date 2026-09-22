import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BLOCK_REGISTRY, type BlockType, type BlockMeta } from '@/types/blocks';
import { cn } from '@/lib/cn';
import { fold } from '@/lib/normalize';
import i18n from '@/i18n';

interface Props {
  onSelect: (type: BlockType) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement>;
}

const GROUPS: BlockMeta['group'][] = ['text', 'media', 'interactive', 'layout'];

/* El registro guarda los nombres en español; aquí se traducen al idioma del
 * sitio (el español del registro queda como respaldo). Antes el menú salía en
 * español en las tres interfaces y el buscador solo encontraba en español. */
const localizedBlocks = (): BlockMeta[] =>
  BLOCK_REGISTRY.map((b) => ({
    ...b,
    label: i18n.t(`admin.modules.be.insert.items.${b.type}.label`, b.label),
    description: i18n.t(`admin.modules.be.insert.items.${b.type}.desc`, b.description),
  }));

export function BlockInsertMenu({ onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const blocks = localizedBlocks();
  // Sin tildes: en portugués el bloque es "Vídeo" y se busca escribiendo "video".
  const q = fold(query);
  const filtered = q
    ? blocks.filter((b) => fold(b.label).includes(q) || fold(b.description).includes(q))
    : blocks;

  const grouped = GROUPS.map((key) => ({
    key,
    label: i18n.t(`admin.modules.be.insert.groups.${key}`),
    items: filtered.filter((b) => b.group === key),
  })).filter((g) => g.items.length > 0);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -6 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="w-72 glass-strong rounded-2xl border border-glass-border/10 shadow-2xl shadow-black/30 overflow-hidden"
      >
        {/* Search */}
        <div className="px-3 pt-3 pb-2 border-b border-glass-border/8">
          <div className="flex items-center gap-2 glass rounded-xl px-3 py-2">
            <span className="text-text-subtle text-[12px] font-mono">/</span>
            <input
              ref={inputRef}
              type="text"
              placeholder={i18n.t('admin.modules.be.search_block')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent text-[13px] text-text placeholder:text-text-subtle outline-none"
            />
          </div>
        </div>

        {/* Block list */}
        <div className="max-h-80 overflow-y-auto py-2">
          {grouped.length === 0 && (
            <p className="text-[12px] text-text-subtle text-center py-6">{i18n.t('admin.modules.be.no_results')}</p>
          )}
          {grouped.map((group) => (
            <div key={group.key}>
              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-subtle">
                {group.label}
              </p>
              {group.items.map((block) => (
                <button
                  key={block.type}
                  onClick={() => { onSelect(block.type); onClose(); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-glass-border/8 transition-colors text-left"
                >
                  <span className="h-8 w-8 rounded-xl glass flex items-center justify-center text-[14px] shrink-0">
                    {block.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-text leading-none mb-0.5">{block.label}</p>
                    <p className="text-[11px] text-text-subtle leading-none truncate">{block.description}</p>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
