import { motion } from 'framer-motion';
import type { TimelineBlock } from '@/types/blocks';
import type { Language } from '@/stores/userStore';

interface Props {
  block: TimelineBlock;
  language: Language;
}

export function TimelineBlockRenderer({ block, language }: Props) {
  return (
    <div className="relative space-y-0 pl-6">
      {/* Vertical line */}
      <div className="absolute left-[9px] top-2 bottom-2 w-px bg-gradient-to-b from-neon-green/50 via-neon-green/20 to-transparent" />

      {block.items.map((item, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.35, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
          className="relative pb-8 last:pb-0"
        >
          {/* Dot */}
          <div className="absolute -left-6 top-1 h-4 w-4 rounded-full border-2 border-neon-green bg-surface flex items-center justify-center">
            {item.icon ? (
              <span className="text-[8px] leading-none">{item.icon}</span>
            ) : (
              <div className="h-1.5 w-1.5 rounded-full bg-neon-green" />
            )}
          </div>

          <div className="ml-3">
            <p className="text-[14px] font-semibold text-text leading-snug mb-1">
              {item.label[language] || item.label.es}
            </p>
            <p className="text-[13.5px] text-text-muted leading-relaxed">
              {item.description[language] || item.description.es}
            </p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
