import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';

/**
 * Flecha minimalista para volver al inicio de la página. Aparece al bajar y
 * corona la columna de flotantes de la derecha: chat de ayuda (bottom-5, h-14),
 * botón de opinión (bottom-[5.5rem], h-14) y por encima esta flecha, con un
 * z-index apenas menor que el de ambos.
 */
export function ScrollToTopButton() {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = () =>
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label={t('common.scroll_top')}
      title={t('common.scroll_top')}
      className={cn(
        'fixed bottom-[9.75rem] right-5 z-[9989] flex h-11 w-11 items-center justify-center rounded-full',
        'border border-line bg-surface/90 text-text-muted shadow-lg backdrop-blur',
        'transition-all duration-200 hover:text-text hover:border-primary/40 hover:-translate-y-0.5',
        visible ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-2',
      )}
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}
