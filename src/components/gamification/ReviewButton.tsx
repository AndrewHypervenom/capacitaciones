import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { RotateCcw, Check } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';

/* ────────────────────────────────────────────────────────────────────────────
   Botón "Repasar y ganar XP".

   Aparece donde el módulo YA está completado, en lugar de "Marcar completado".
   Muestra de antemano cuánto paga (con el multiplicador del día ya aplicado):
   una recompensa que no se ve antes de actuar no motiva a nadie.

   Cuando ya se cobró hoy no desaparece — se queda apagado explicando por qué —
   porque un botón que se esfuma parece un error de la aplicación.
   ──────────────────────────────────────────────────────────────────────────── */

export function ReviewButton({
  done,
  xp,
  multiplier = 1,
  onClick,
  className,
}: {
  /** Ya se cobró el repaso de hoy. */
  done: boolean;
  /** XP que pagaría ahora mismo (multiplicador incluido). */
  xp: number;
  multiplier?: number;
  onClick: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const [burst, setBurst] = useState(0);
  const boosted = multiplier > 1;

  if (done) {
    return (
      <div
        className={cn(
          'inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-subtle px-4 py-2.5 text-[13px] font-medium text-text-muted',
          className,
        )}
      >
        <Check className="h-4 w-4 text-primary" strokeWidth={3} />
        {t('module.review_done_today', 'Repaso de hoy hecho')}
      </div>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={() => {
        setBurst((n) => n + 1);
        onClick();
      }}
      whileHover={reduce ? undefined : { y: -2 }}
      whileTap={reduce ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 380, damping: 22 }}
      className={cn(
        'relative inline-flex min-h-[44px] items-center gap-2 overflow-hidden rounded-xl border px-4 py-2.5 text-[13px] font-semibold transition-colors',
        boosted
          ? 'border-neon-magenta/45 bg-neon-magenta/10 text-neon-magenta hover:bg-neon-magenta/15'
          : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15',
        className,
      )}
    >
      {/* Halo que respira: distingue la acción opcional (repasar) de la
          obligatoria sin gritar tanto como un botón sólido. */}
      {!reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl"
          animate={{
            boxShadow: [
              `inset 0 0 0 0 ${boosted ? 'rgba(179,61,158,0.35)' : 'rgba(16,212,81,0.3)'}`,
              `inset 0 0 22px 0 ${boosted ? 'rgba(179,61,158,0.18)' : 'rgba(16,212,81,0.16)'}`,
              `inset 0 0 0 0 ${boosted ? 'rgba(179,61,158,0.35)' : 'rgba(16,212,81,0.3)'}`,
            ],
          }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Chispas al pulsar: confirma el toque incluso antes de que el store
          responda. `key` con el contador para poder repetirlo. */}
      <AnimatePresence>
        {!reduce && burst > 0 && (
          <motion.span
            key={burst}
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-xl"
            initial={{ opacity: 0.5, scale: 0.9 }}
            animate={{ opacity: 0, scale: 1.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            style={{ background: boosted ? 'rgba(179,61,158,0.28)' : 'rgba(16,212,81,0.25)' }}
          />
        )}
      </AnimatePresence>

      <motion.span
        className="relative inline-flex"
        animate={reduce ? undefined : { rotate: [0, -18, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 2, ease: 'easeInOut' }}
      >
        <RotateCcw className="h-4 w-4" />
      </motion.span>
      <span className="relative">{t('module.review_cta', 'Repasar')}</span>
      <span
        className={cn(
          'relative rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums',
          boosted ? 'bg-neon-magenta text-white' : 'bg-primary/20',
        )}
      >
        +{xp} XP{boosted ? ` ×${multiplier}` : ''}
      </span>
    </motion.button>
  );
}
