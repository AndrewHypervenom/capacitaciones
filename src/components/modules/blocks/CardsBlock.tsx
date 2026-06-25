import { motion } from 'framer-motion';
import type { CardsBlock } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { cn } from '@/lib/cn';

interface Props {
  block: CardsBlock;
  language: Language;
}

export function CardsBlockRenderer({ block, language }: Props) {
  return (
    <div
      className={cn(
        'grid gap-4 grid-cols-1 sm:grid-cols-2',
        block.columns === 3 && 'md:grid-cols-3',
      )}
    >
      {block.items.map((card, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.4, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
          className="group glass rounded-2xl border border-glass-border/10 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-neon-green/25 hover:bg-glass/8"
        >
          {card.icon && <div className="text-3xl leading-none mb-3">{card.icon}</div>}
          <h3 className="text-[15px] font-semibold text-text leading-snug mb-1.5">
            {card.title[language] || card.title.es}
          </h3>
          <p className="text-[13.5px] text-text-muted leading-relaxed">
            {card.text[language] || card.text.es}
          </p>
        </motion.div>
      ))}
    </div>
  );
}
