import { AnimatePresence, motion } from 'framer-motion';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVersionCheck } from '@/hooks/useVersionCheck';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useUnsavedWorkSummary } from '@/hooks/useUnsavedWork';

/**
 * Aviso flotante que aparece cuando hay una versión más reciente del sitio
 * desplegada. Ofrece recargar para actualizar. Se apoya en useVersionCheck.
 */
export function UpdatePrompt() {
  const updateAvailable = useVersionCheck();
  const [dismissed, setDismissed] = useState(false);
  const { t } = useTranslation();
  const confirm = useConfirm();
  const unsaved = useUnsavedWorkSummary();

  const show = updateAvailable && !dismissed;

  /**
   * Actualizar recarga la página, y recargar se lleva lo que no esté guardado.
   *
   * Antes se preguntaba SIEMPRE, con un texto que suponía lo peor ("podrías
   * perder progreso"). Un aviso que sale siempre se acepta sin leer — y así el
   * día que sí había un módulo a medio escribir tampoco frenaba a nadie.
   *
   * Ahora se consulta el registro de trabajo sin guardar (lib/unsavedWork.ts):
   * si no hay nada abierto a medias se recarga y ya; si lo hay, el aviso NOMBRA
   * qué se perdería, que es la única forma de que se lea.
   */
  const handleUpdate = async () => {
    if (!unsaved.any) {
      window.location.reload();
      return;
    }
    const ok = await confirm({
      title: t('update.confirm_title'),
      description: t('update.confirm_unsaved', { items: unsaved.labels.join(', ') }),
      confirmLabel: t('update.confirm_discard'),
      cancelLabel: t('update.confirm_cancel'),
    });
    if (ok) window.location.reload();
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          role="alert"
          // La posición la pone el contenedor (BottomBannerStack).
          className="pointer-events-auto w-full"
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
                {/* Si hay algo a medias, el aviso lo dice desde el banner: así
                    se guarda primero en vez de descubrirlo tras pulsar. */}
                {unsaved.any ? t('update.description_unsaved') : t('update.description')}
              </p>
            </div>

            <button
              onClick={handleUpdate}
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
