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
      {/* Contenedor sin recorte: el globo del marcador puede salirse de la imagen
          sin quedar oculto. El overflow/borde redondeado van solo sobre la imagen. */}
      <div className="relative select-none">
        <div className="rounded-2xl overflow-hidden border border-line">
          <img
            src={block.url}
            alt={block.caption?.[language] || block.caption?.es || ''}
            loading="lazy"
            className="w-full block"
          />
        </div>
        {block.points.map((pt, i) => {
          // Apertura inteligente: si el marcador está en la mitad inferior el globo
          // sube; si está pegado a un borde lateral, se alinea hacia adentro. Así el
          // texto nunca queda cortado ni oculto dentro de la imagen.
          const openUp = pt.y > 55
          const nearLeft = pt.x < 22
          const nearRight = pt.x > 78
          const horizClass = nearLeft
            ? 'left-0 translate-x-0'
            : nearRight
              ? 'right-0 translate-x-0'
              : 'left-1/2 -translate-x-1/2'
          return (
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
                  initial={{ opacity: 0, y: openUp ? -6 : 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: openUp ? -6 : 6, scale: 0.96 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className={cn(
                    'absolute w-56 max-w-[70vw] rounded-xl border border-line bg-surface p-3 shadow-xl text-left',
                    openUp ? 'bottom-9' : 'top-9',
                    horizClass,
                  )}
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
          )
        })}
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
