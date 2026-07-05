import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { HotspotImageBlock } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { cn } from '@/lib/cn';

interface Props {
  block: HotspotImageBlock;
  language: Language;
}

export function HotspotImageBlockRenderer({ block, language }: Props) {
  const { t } = useTranslation();
  const [active, setActive] = useState<number | null>(null);
  if (!block.url) return null;

  return (
    <figure className="space-y-3">
      <div className="relative rounded-2xl overflow-hidden border border-line select-none">
        <img
          src={block.url}
          alt={block.caption?.[language] || block.caption?.es || ''}
          loading="lazy"
          className="w-full block"
        />
        {block.points.map((pt, i) => (
          <div
            key={i}
            className={cn('absolute -translate-x-1/2 -translate-y-1/2', active === i ? 'z-20' : 'z-10')}
            style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
          >
            <button
              onClick={() => setActive(active === i ? null : i)}
              aria-label={pt.title[language] || pt.title.es}
              className={cn(
                'relative h-7 w-7 rounded-full flex items-center justify-center text-[12px] font-bold transition-transform',
                'bg-neon-green text-black ring-2 ring-white/70 shadow-lg hover:scale-110',
                active === i && 'scale-110',
              )}
            >
              {active !== i && (
                <span className="absolute inset-0 rounded-full bg-neon-green/60 animate-[glow-pulse_2s_ease-in-out_infinite]" />
              )}
              <span className="relative">{i + 1}</span>
            </button>

            <AnimatePresence>
              {active === i && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.96 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute left-1/2 top-9 -translate-x-1/2 w-56 max-w-[70vw] glass-strong rounded-xl border border-glass-border/15 p-3 shadow-xl text-left"
                >
                  <p className="text-[13px] font-semibold text-text mb-1">
                    {pt.title[language] || pt.title.es}
                  </p>
                  <p className="text-[12.5px] text-text-muted leading-relaxed">
                    {pt.text[language] || pt.text.es}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
      {block.caption?.[language] && (
        <figcaption className="text-[12.5px] text-text-subtle text-center">
          {block.caption[language]}
        </figcaption>
      )}
      {block.points.length > 0 && (
        <p className="text-[11px] text-text-subtle text-center">{t('module.blocks.hotspot_hint')}</p>
      )}
    </figure>
  );
}
