import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Sparkles, Flame, Zap, RotateCcw, GraduationCap, Gamepad2, Map } from 'lucide-react';
import { useXPFeedStore, type XPGain, type XPReason } from '@/stores/xpFeedStore';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';

/* ────────────────────────────────────────────────────────────────────────────
   Capa de "+XP".

   Cada vez que el store de progreso acredita XP, aquí sale una burbuja que sube
   y se desvanece. Es la única señal inmediata de que algo sumó: sin ella, el XP
   solo se ve al volver al panel y el repaso parece no pagar nada.

   Va por PORTAL a <body>: dentro del árbol hay contenedores con `transform`
   (Reveal, tarjetas con hover) y un `position: fixed` adentro se ancla al
   contenedor, no a la ventana — ver memoria reveal_transform_fixed_trap.
   ──────────────────────────────────────────────────────────────────────────── */

const REASON_ICON: Record<XPReason, typeof Sparkles> = {
  module: Sparkles,
  quiz: Zap,
  streak: Flame,
  simulator: Gamepad2,
  certification: GraduationCap,
  world: Map,
  review: RotateCcw,
  'review-course': RotateCcw,
};

/** Cuánto vive una burbuja en pantalla. */
const LIFETIME_MS = 2200;

function Bubble({ gain }: { gain: XPGain }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const dismiss = useXPFeedStore((s) => s.dismiss);
  const Icon = REASON_ICON[gain.reason] ?? Sparkles;
  const boosted = gain.multiplier > 1;

  useEffect(() => {
    const timer = setTimeout(() => dismiss(gain.id), LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [gain.id, dismiss]);

  return (
    <motion.div
      layout
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.8 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -28, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24, mass: 0.6 }}
      className={cn(
        'pointer-events-none relative flex items-center gap-2 overflow-hidden rounded-full border px-3.5 py-2 shadow-lg backdrop-blur-md',
        boosted
          ? 'border-neon-magenta/40 bg-neon-magenta/12 shadow-[0_8px_30px_-8px_rgba(179,61,158,0.55)]'
          : 'border-primary/30 bg-primary/10 shadow-[0_8px_30px_-10px_rgba(16,212,81,0.5)]',
      )}
    >
      {/* El destello del multiplicador barre la píldora una sola vez: dice
          "esto valió más" sin necesidad de leer nada. */}
      {boosted && !reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
          initial={{ opacity: 0.9 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        >
          <motion.span
            className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/35 to-transparent"
            initial={{ x: 0 }}
            animate={{ x: '340%' }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          />
        </motion.span>
      )}
      <Icon className={cn('h-3.5 w-3.5 shrink-0', boosted ? 'text-neon-magenta' : 'text-primary')} />
      <span
        className={cn(
          'text-[13px] font-bold tabular-nums',
          boosted ? 'text-neon-magenta' : 'text-primary',
        )}
      >
        +{gain.amount} XP
      </span>
      {boosted && (
        <motion.span
          initial={reduce ? undefined : { scale: 0.6, rotate: -12 }}
          animate={reduce ? undefined : { scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 14, delay: 0.08 }}
          className="rounded-full bg-neon-magenta px-1.5 py-0.5 text-[10px] font-black leading-none text-white"
        >
          ×{gain.multiplier}
        </motion.span>
      )}
      {(gain.reason === 'review' || gain.reason === 'review-course') && (
        <span className="text-[11px] font-medium text-text-muted">
          {gain.reason === 'review-course'
            ? t('xp.gain_review_course', 'repaso del curso')
            : t('xp.gain_review', 'repaso')}
        </span>
      )}
    </motion.div>
  );
}

export function XPGainLayer() {
  const gains = useXPFeedStore((s) => s.gains);
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-[85] flex flex-col items-center gap-2 px-4 sm:bottom-8 sm:left-auto sm:right-6 sm:items-end"
    >
      <AnimatePresence mode="popLayout">
        {gains.map((g) => (
          <Bubble key={g.id} gain={g} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
