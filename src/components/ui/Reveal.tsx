import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tag = 'div' | 'section' | 'header' | 'article' | 'aside' | 'li' | 'ol' | 'ul';

export interface RevealProps {
  as?: Tag;
  delay?: number;
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function Reveal({
  as = 'div',
  delay = 0,
  threshold = 0.15,
  rootMargin = '0px 0px -10% 0px',
  once = true,
  className,
  style,
  children,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    // Check using document-relative position so this works correctly even
    // during a smooth-scroll animation (rect.top is viewport-relative, but
    // rect.top + scrollY gives the true document Y regardless of scroll state).
    const rect = node.getBoundingClientRect();
    const docTop = rect.top + window.scrollY;
    if (docTop < window.innerHeight) {
      setVisible(true);
      return;
    }

    // Element is below the fold — use IO to reveal on scroll.
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            if (once) obs.unobserve(entry.target);
          } else if (!once) {
            setVisible(false);
          }
        });
      },
      { threshold, rootMargin },
    );
    obs.observe(node);

    // Last-resort fallback: reveal after the page-transition duration even if
    // IO never fires (e.g. elements just outside the rootMargin boundary).
    const fallback = setTimeout(() => setVisible(true), 600);

    return () => {
      clearTimeout(fallback);
      obs.disconnect();
    };
  }, [threshold, rootMargin, once]);

  const sharedClass = cn('reveal-init', visible && 'reveal-in', className);
  const sharedStyle: CSSProperties = {
    transitionDelay: visible && delay ? `${delay}ms` : undefined,
    ...style,
  };
  const setRef = (el: HTMLElement | null) => {
    ref.current = el;
  };

  switch (as) {
    case 'section':
      return (
        <section ref={setRef} className={sharedClass} style={sharedStyle}>
          {children}
        </section>
      );
    case 'header':
      return (
        <header ref={setRef} className={sharedClass} style={sharedStyle}>
          {children}
        </header>
      );
    case 'article':
      return (
        <article ref={setRef} className={sharedClass} style={sharedStyle}>
          {children}
        </article>
      );
    case 'aside':
      return (
        <aside ref={setRef} className={sharedClass} style={sharedStyle}>
          {children}
        </aside>
      );
    case 'li':
      return (
        <li ref={setRef as (el: HTMLLIElement | null) => void} className={sharedClass} style={sharedStyle}>
          {children}
        </li>
      );
    case 'ol':
      return (
        <ol ref={setRef as (el: HTMLOListElement | null) => void} className={sharedClass} style={sharedStyle}>
          {children}
        </ol>
      );
    case 'ul':
      return (
        <ul ref={setRef as (el: HTMLUListElement | null) => void} className={sharedClass} style={sharedStyle}>
          {children}
        </ul>
      );
    default:
      return (
        <div ref={setRef as (el: HTMLDivElement | null) => void} className={sharedClass} style={sharedStyle}>
          {children}
        </div>
      );
  }
}
