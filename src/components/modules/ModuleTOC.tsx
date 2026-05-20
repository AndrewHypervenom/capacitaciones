import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { Language } from '@/stores/userStore';
import type { ModuleSection } from '@/data/modules';

interface Props {
  sections: ModuleSection[];
  language: Language;
  sectionPrefix?: string;
}

export function ModuleTOC({ sections, language, sectionPrefix = 'section' }: Props) {
  const { t } = useTranslation();
  const [activeIdx, setActiveIdx] = useState(0);
  const observersRef = useRef<IntersectionObserver[]>([]);
  const activeRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIdx]);

  const scrollTo = (i: number) => {
    // Force-reveal any section that hasn't animated yet to avoid invisible gaps
    sections.forEach((_, idx) => {
      const target = document.getElementById(`${sectionPrefix}-${idx}`);
      const sectionEl = target?.parentElement;
      if (sectionEl?.classList.contains('reveal-init')) {
        sectionEl.classList.remove('reveal-init');
        sectionEl.classList.add('reveal-in');
      }
    });
    document.getElementById(`${sectionPrefix}-${i}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  return (
    <aside className="md:sticky md:top-24 self-start">
      <div className="glass-md rounded-2xl p-4 flex flex-col max-h-[calc(100vh-8rem)] overflow-hidden">
        <div className="text-[10px] uppercase tracking-wider text-text-subtle mb-3 px-1 font-semibold shrink-0">
          {t('module.section_index')}
        </div>
        <nav className="overflow-y-auto">
          <ul className="space-y-0.5">
            {sections.map((s, i) => {
              if (s.style === 'video-interactive') return null;
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
