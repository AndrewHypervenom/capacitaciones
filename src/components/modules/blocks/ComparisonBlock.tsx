import { Check, X } from 'lucide-react';
import type { ComparisonBlock } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { cn } from '@/lib/cn';

interface Props {
  block: ComparisonBlock;
  language: Language;
}

export function ComparisonBlockRenderer({ block, language }: Props) {
  return (
    <div className="max-w-3xl mx-auto overflow-x-auto rounded-2xl border border-neon-green/12">
      <table className="w-full text-[14.5px]">
        <thead>
          <tr>
            {block.headers.map((h, i) => (
              <th
                key={i}
                className={cn(
                  'px-5 py-4 text-left font-semibold text-[11px] uppercase tracking-widest whitespace-nowrap',
                  i === 0
                    ? 'text-neon-green bg-neon-green/5 border-b border-neon-green/12 min-w-[120px]'
                    : 'text-text border-b border-neon-green/8 min-w-[100px]',
                )}
              >
                {h[language] || h.es}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, ri) => (
            <tr
              key={ri}
              className={cn(
                'border-t border-neon-green/6 transition-colors duration-150',
                ri % 2 === 0 ? 'hover:bg-glass/10' : 'bg-glass/20 hover:bg-glass/30',
              )}
            >
              {row.map((cell, ci) => {
                const text = cell[language] || cell.es;
                const isCheck = text === '✓' || text === 'true' || text === 'sí' || text === 'si';
                const isCross = text === '✗' || text === 'false' || text === 'no';
                return (
                  <td
                    key={ci}
                    className={cn(
                      'px-5 py-4 align-middle leading-snug',
                      ci === 0
                        ? 'text-text font-medium border-r border-neon-green/10'
                        : 'text-text-muted border-r border-neon-green/6 last:border-r-0',
                    )}
                  >
                    {isCheck ? (
                      <Check className="h-4 w-4 text-neon-green" strokeWidth={2.5} />
                    ) : isCross ? (
                      <X className="h-4 w-4 text-red-400" strokeWidth={2.5} />
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
