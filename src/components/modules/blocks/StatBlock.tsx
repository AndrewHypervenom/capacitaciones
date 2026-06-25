import { useEffect, useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import type { StatBlock } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { cn } from '@/lib/cn';

/** Separa un valor "82%" en prefijo, número y sufijo para animar el conteo. */
function parseValue(value: string): { prefix: string; num: number | null; suffix: string; decimals: number } {
  const m = value.match(/^(\D*)(-?[\d.,]+)(.*)$/);
  if (!m) return { prefix: '', num: null, suffix: value, decimals: 0 };
  const numRaw = m[2].replace(/,/g, '');
  const num = Number(numRaw);
  if (Number.isNaN(num)) return { prefix: '', num: null, suffix: value, decimals: 0 };
  const decimals = numRaw.includes('.') ? numRaw.split('.')[1].length : 0;
  return { prefix: m[1], num, suffix: m[3], decimals };
}

function CountUp({ value }: { value: string }) {
  const { prefix, num, suffix, decimals } = parseValue(value);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const [display, setDisplay] = useState(num === null ? value : `${prefix}0${suffix}`);

  useEffect(() => {
    if (num === null || !inView) return;
    let raf = 0;
    const start = performance.now();
    const dur = 900;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(`${prefix}${(num * eased).toFixed(decimals)}${suffix}`);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, num, prefix, suffix, decimals]);

  return <span ref={ref}>{display}</span>;
}

interface Props {
  block: StatBlock;
  language: Language;
}

export function StatBlockRenderer({ block, language }: Props) {
  return (
    <div
      className={cn(
        'grid gap-4 grid-cols-1 sm:grid-cols-2',
        block.items.length >= 3 && 'sm:grid-cols-3',
      )}
    >
      {block.items.map((s, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.4, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
          className="glass rounded-2xl border border-glass-border/10 p-6 text-center"
        >
          {s.icon && <div className="text-2xl leading-none mb-2">{s.icon}</div>}
          <div className="text-[clamp(2rem,4vw+0.5rem,3rem)] font-bold leading-none tabular-nums bg-gradient-to-r from-neon-green to-neon-violet bg-clip-text text-transparent">
            <CountUp value={s.value} />
          </div>
          <div className="text-[13px] text-text-muted mt-2.5 leading-snug">
            {s.label[language] || s.label.es}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
