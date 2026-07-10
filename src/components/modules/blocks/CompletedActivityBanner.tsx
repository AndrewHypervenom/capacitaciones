import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, RefreshCcw } from 'lucide-react';

interface Props {
  /** Puntaje del último intento guardado (0–100). */
  scorePct?: number;
  /** Rehacer la actividad desde cero. */
  onRedo: () => void;
  /** Texto opcional adicional (p. ej. detalle del intento). */
  detail?: string | null;
}

/**
 * Aviso de "actividad ya completada". Se muestra cuando el aprendiz ya resolvió
 * una actividad interactiva (juego/quiz) en una visita anterior: su progreso
 * quedó en la base, así que no tiene que rehacerla salvo que quiera.
 */
export function CompletedActivityBanner({ scorePct, onRedo, detail }: Props) {
  const { t } = useTranslation();
  const pct = typeof scorePct === 'number' ? Math.round(scorePct) : null;
  const passed = pct === null || pct >= 70;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="glass rounded-2xl p-5 space-y-4 border border-neon-green/20"
    >
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-xl bg-neon-green/10 flex items-center justify-center ring-1 ring-neon-green/20 shrink-0">
          <CheckCircle2 className="h-5 w-5 text-neon-green" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-text">
            {t('module.blocks.completed_title')}
          </p>
          <p className="text-[12px] text-text-subtle mt-0.5">
            {t('module.blocks.completed_hint')}
          </p>
          {detail && (
            <p className="text-[11px] text-text-subtle/70 mt-1.5">{detail}</p>
          )}
        </div>
        {pct !== null && (
          <span
            className={
              'shrink-0 text-[12px] font-bold px-2.5 py-1 rounded-full ' +
              (passed
                ? 'bg-neon-green/10 text-neon-green'
                : 'bg-amber-500/10 text-amber-500')
            }
          >
            {pct}%
          </span>
        )}
      </div>
      <button
        onClick={onRedo}
        className="flex items-center gap-2 px-4 py-2 rounded-xl glass border border-glass-border/15 text-text-subtle text-[13px] hover:text-text transition-colors"
      >
        <RefreshCcw className="h-3.5 w-3.5" />
        {t('module.blocks.completed_redo')}
      </button>
    </motion.div>
  );
}
