import { useEffect, useState } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export function ReadingProgressBar() {
  const [progress, setProgress] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const onScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      setProgress(Math.min(100, (window.scrollY / scrollable) * 100));
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 right-0 h-[2px] z-50 pointer-events-none bg-transparent"
    >
      <div
        className="h-full origin-left"
        style={{
          width: `${progress}%`,
          background: 'linear-gradient(90deg, rgb(var(--neon-green)), rgb(var(--neon-violet)))',
          boxShadow: '0 0 8px rgb(var(--neon-green) / 0.6), 0 0 16px rgb(var(--neon-green) / 0.2)',
          transition: reducedMotion ? 'none' : 'width 80ms linear',
        }}
      />
    </div>
  );
}
