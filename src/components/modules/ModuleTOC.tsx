import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
    <aside className="md:sticky md:top-24 self-start">
      <div className="glass-md rounded-2xl p-4 flex flex-col max-h-[calc(100vh-8rem)] overflow-hidden">
        <div className="text-[10px] uppercase tracking-wider text-text-subtle mb-3 px-1 font-semibold shrink-0">
          {t('module.section_index')}
        </div>
        <nav ref={navRef} className="overflow-y-auto relative">
          <ul className="space-y-0.5">
            {sections.map((s, i) => {
              return (
                <li key={i}>
                  <button
                    ref={activeIdx === i ? activeRef : undefined}
                    onClick={() => scrollTo(i)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-xl text-[12px] transition-all duration-200',
                      activeIdx === i
                        ? 'bg-neon-green/8 border border-neon-green/15 text-text font-medium'
                        : 'text-text-muted hover:text-text hover:bg-glass/5 border border-transparent',
                    )}
                  >
                    <span className={cn(
                      'tabular-nums text-[10px] mr-2',
                      activeIdx === i ? 'text-neon-green/60' : 'text-text-subtle/50',
                    )}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="leading-snug">{s.heading[language]}</span>
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
