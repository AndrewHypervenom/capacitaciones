import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVersionCheck } from '@/hooks/useVersionCheck';

/**
 * Aviso flotante que aparece cuando hay una versión más reciente del sitio
 * desplegada. Ofrece recargar para actualizar. Se apoya en useVersionCheck.
 */
export function UpdatePrompt() {
  const updateAvailable = useVersionCheck();
  const [dismissed, setDismissed] = useState(false);
  const { t } = useTranslation();

  const show = updateAvailable && !dismissed;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          role="alert"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] w-[calc(100%-2rem)] max-w-md"
        >
          <div className="glass-strong relative flex items-center gap-3 rounded-2xl border border-glass-border/10 px-4 py-3.5 shadow-2xl shadow-black/30 overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-full bg-neon-cyan" />

            <div className="shrink-0 text-neon-cyan">
              <Sparkles className="h-5 w-5" />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold text-text leading-snug">
                {t('update.title')}
              </p>
              <p className="text-[12px] text-text-muted mt-0.5 leading-snug">
                {t('update.description')}
              </p>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-neon-cyan/15 hover:bg-neon-cyan/25 text-neon-cyan text-[12.5px] font-semibold px-3 py-2 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('update.action')}
            </button>

            <button
              onClick={() => setDismissed(true)}
              className="shrink-0 text-text-subtle hover:text-text transition-colors"
              aria-label={t('common.close', 'Cerrar')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
