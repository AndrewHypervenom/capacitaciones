import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Maximize2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AccordionBlock } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { cn } from '@/lib/cn';
import { RichText } from '@/components/ui/RichText';
import { ACC_LAYOUT_CLASS, accFrameClass, accImageClass, resolveAccImageStyle } from '@/lib/accordionImage';

interface Props {
  block: AccordionBlock;
  language: Language;
}

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Imagen ampliada de un ítem. Va por portal a <body>: el acordeón vive dentro
 * de animaciones de Motion (con `transform`) y ahí un `fixed` se anclaría al
 * bloque en vez de a la pantalla.
 */
function ImageZoom({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-8 cursor-zoom-out"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <motion.img
        src={url}
        alt={alt}
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.28, ease: EASE }}
        className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl shadow-black/50 ring-1 ring-white/10"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition-colors hover:bg-white/20"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>,
    document.body,
  );
}

export function AccordionBlockRenderer({ block, language }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);
  const [zoom, setZoom] = useState<{ url: string; alt: string } | null>(null);
  const closeZoom = useCallback(() => setZoom(null), []);

  return (
    <div className="space-y-2">
      {block.items.map((item, i) => {
        const isOpen = open === i;
        const question = item.question[language] || item.question.es;
        const look = resolveAccImageStyle(item.imageStyle);
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
              <span className="flex items-center gap-3 min-w-0">
                {/* Miniatura en la cabecera: avisa que el ítem trae imagen sin
                    tener que abrirlo. Se desvanece al abrir, porque abajo ya
                    aparece la imagen de verdad. */}
                {item.image && (
                  <motion.img
                    src={item.image}
                    alt=""
                    loading="lazy"
                    animate={{ opacity: isOpen ? 0 : 1, scale: isOpen ? 0.85 : 1 }}
                    transition={{ duration: 0.22, ease: EASE }}
                    className="h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-glass-border/15 bg-subtle"
                  />
                )}
                <span className="text-[14.5px] font-medium text-text leading-snug">{question}</span>
              </span>
              <motion.div
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.22, ease: EASE }}
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
                  transition={{ duration: 0.26, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 pt-1">
                    <div className="h-px w-full bg-glass-border/10 mb-4" />
                    <div className={cn(item.image && ACC_LAYOUT_CLASS[look.position])}>
                      {/* Tamaño, ubicación y forma los elige el capacitador
                          (lib/accordionImage); siempre contenida: acompaña, no
                          protagoniza. Quien quiera el detalle la toca y se amplía. */}
                      {item.image && (
                        <motion.button
                          type="button"
                          onClick={() => setZoom({ url: item.image!, alt: question })}
                          aria-label={t('module.blocks.image_enlarge')}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: 0.06, ease: EASE }}
                          className={cn(
                            'group relative shrink-0 self-start overflow-hidden rounded-xl border border-glass-border/15 bg-subtle p-1 shadow-sm shadow-black/10 transition-[border-color,box-shadow] duration-200 hover:border-neon-green/30 hover:shadow-md cursor-zoom-in',
                            accFrameClass(look),
                          )}
                        >
                          <img
                            src={item.image}
                            alt={question}
                            loading="lazy"
                            className={cn('block rounded-lg transition-transform duration-300 group-hover:scale-[1.03]', accImageClass(look))}
                          />
                          <span className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
                            <Maximize2 className="h-3 w-3" />
                          </span>
                        </motion.button>
                      )}
                      <RichText
                        text={item.answer[language] || item.answer.es}
                        className={cn('text-[14px] text-text-muted', item.image && 'min-w-0 sm:flex-1')}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      <AnimatePresence>
        {zoom && <ImageZoom url={zoom.url} alt={zoom.alt} onClose={closeZoom} />}
      </AnimatePresence>
    </div>
  );
}
