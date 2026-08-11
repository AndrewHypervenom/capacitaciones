import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';
import { revealAll } from '@/components/ui/Reveal';
import type { Language } from '@/stores/userStore';
import type { ModuleSection } from '@/data/modules';

interface Props {
  sections: ModuleSection[];
  language: Language;
  sectionPrefix?: string;
}

/** Posición real (de layout) del elemento dentro del documento.
 *  Se suma la cadena de offsetParent en lugar de usar getBoundingClientRect
 *  porque las secciones llevan `transform: translateY(24px)` mientras se
 *  revelan: el rect mentiría durante la animación, offsetTop no. */
function docTop(el: HTMLElement): number {
  let y = 0;
  let node: HTMLElement | null = el;
  while (node) {
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return y;
}

export function ModuleTOC({ sections, language, sectionPrefix = 'section' }: Props) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [activeIdx, setActiveIdx] = useState(0);
  const observersRef = useRef<IntersectionObserver[]>([]);
  const activeRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);
  /** Mientras dura un salto pedido por el usuario, el observador no puede
   *  cambiar la sección activa ni el índice puede desplazarse solo. */
  const jumpingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  const cancelJump = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    jumpingRef.current = false;
  }, []);

  useEffect(() => cancelJump, [cancelJump]);

  // Si la persona toma el control (rueda, dedo o teclado) se abandona la
  // corrección automática: manda su scroll, no el nuestro.
  useEffect(() => {
    const onUser = () => { if (jumpingRef.current) cancelJump(); };
    window.addEventListener('wheel', onUser, { passive: true });
    window.addEventListener('touchstart', onUser, { passive: true });
    window.addEventListener('keydown', onUser);
    return () => {
      window.removeEventListener('wheel', onUser);
      window.removeEventListener('touchstart', onUser);
      window.removeEventListener('keydown', onUser);
    };
  }, [cancelJump]);

  useEffect(() => {
    observersRef.current.forEach((obs) => obs.disconnect());
    observersRef.current = [];

    const ratios = new Map<number, number>();

    sections.forEach((_, i) => {
      const el = document.getElementById(`${sectionPrefix}-${i}`);
      if (!el) return;

      const obs = new IntersectionObserver(
        ([entry]) => {
          ratios.set(i, entry.intersectionRatio);
          if (jumpingRef.current) return;
          let best = 0;
          let bestRatio = -1;
          ratios.forEach((ratio, idx) => {
            if (ratio > bestRatio) { bestRatio = ratio; best = idx; }
          });
          if (bestRatio > 0) setActiveIdx(best);
        },
        { threshold: [0, 0.1, 0.3, 0.5, 0.8, 1.0], rootMargin: '-20% 0px -40% 0px' },
      );
      obs.observe(el);
      observersRef.current.push(obs);
    });

    return () => observersRef.current.forEach((obs) => obs.disconnect());
  }, [sections, sectionPrefix]);

  // El botón activo se mantiene a la vista moviendo SOLO la lista del índice.
  // (scrollIntoView movería también la página y cortaría el salto en curso.)
  useEffect(() => {
    const nav = navRef.current;
    const btn = activeRef.current;
    if (!nav || !btn) return;
    const top = btn.offsetTop;
    const bottom = top + btn.offsetHeight;
    if (top < nav.scrollTop) {
      nav.scrollTo({ top, behavior: 'smooth' });
    } else if (bottom > nav.scrollTop + nav.clientHeight) {
      nav.scrollTo({ top: bottom - nav.clientHeight, behavior: 'smooth' });
    }
  }, [activeIdx]);

  const scrollTo = (i: number) => {
    const el = document.getElementById(`${sectionPrefix}-${i}`);
    if (!el) return;

    cancelJump();
    setActiveIdx(i);
    jumpingRef.current = true;

    // Se revelan todas las secciones por estado de React (no tocando clases a
    // mano, que el siguiente render deshacía) para que ninguna cambie de sitio
    // mientras la página viaja hacia el destino.
    revealAll();

    const maxTop = () =>
      Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const wanted = () => {
      const offset = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      return Math.min(Math.max(0, docTop(el) - offset), maxTop());
    };

    // Dos cuadros para que el layout de lo recién revelado quede asentado
    // antes de medir el destino.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!jumpingRef.current) return;
      window.scrollTo({ top: wanted(), behavior: 'smooth' });

      // El contenido puede crecer en camino (imágenes, videos, incrustados):
      // se espera a que el scroll se detenga y se corrige si quedó corto.
      let last = NaN;
      let stable = 0;
      let fixes = 0;
      const tick = () => {
        if (!jumpingRef.current) return;
        const y = window.scrollY;
        stable = Math.abs(y - last) < 1 ? stable + 1 : 0;
        last = y;
        if (stable < 3) {
          timerRef.current = window.setTimeout(tick, 100);
          return;
        }
        const target = wanted();
        if (Math.abs(y - target) > 4 && fixes < 3) {
          fixes += 1;
          stable = 0;
          window.scrollTo({ top: target, behavior: 'smooth' });
          timerRef.current = window.setTimeout(tick, 100);
          return;
        }
        cancelJump();
        setActiveIdx(i);
      };
      timerRef.current = window.setTimeout(tick, 100);
    }));
  };

  return (
    // Sin tarjeta de cristal: el índice es un riel. La sección activa la marca
    // una línea que se desliza (layoutId), no un recuadro verde por elemento.
    <aside className="self-start md:sticky md:top-24">
      <div className="flex max-h-[calc(100vh-8rem)] flex-col overflow-hidden">
        <div className="mb-3 shrink-0 pl-4 text-[11px] font-medium uppercase tracking-[0.14em] text-text-subtle">
          {t('module.section_index')}
        </div>
        <nav ref={navRef} className="relative overflow-y-auto border-l border-line">
          <ul>
            {sections.map((s, i) => {
              const active = activeIdx === i;
              return (
                <li key={i} className="relative">
                  {active && (
                    <motion.span
                      layoutId="module-toc-rail"
                      aria-hidden
                      className="absolute -left-px top-1 bottom-1 w-[2px] rounded-full bg-primary"
                      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <button
                    ref={active ? activeRef : undefined}
                    onClick={() => scrollTo(i)}
                    className={cn(
                      'w-full py-2 pl-4 pr-2 text-left text-[12.5px] leading-snug transition-colors duration-300',
                      active ? 'font-medium text-text' : 'text-text-subtle hover:text-text-muted',
                    )}
                  >
                    <span
                      className={cn(
                        'mr-2 text-[10.5px] tabular-nums',
                        active ? 'text-primary' : 'text-text-subtle/60',
                      )}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {s.heading[language]}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </aside>
  );
}
