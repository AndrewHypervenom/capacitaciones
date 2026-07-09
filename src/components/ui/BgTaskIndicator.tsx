import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Loader2, AlertTriangle, X, Ban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBgTaskStore } from '@/stores/bgTaskStore';
import { cn } from '@/lib/cn';

/**
 * Indicador global de procesos en segundo plano (generación con IA de cursos,
 * módulos, mundos y simulaciones). Muestra el paso actual, permite CANCELAR
 * mientras corren y ofrece una acción destacada al terminar (p. ej. "Editar
 * módulo"). Visible en todo el sitio mientras el usuario navega.
 */
export function BgTaskIndicator() {
  const { t } = useTranslation();
  const tasks = useBgTaskStore((s) => s.tasks);
  const dismiss = useBgTaskStore((s) => s.dismiss);
  const requestCancel = useBgTaskStore((s) => s.requestCancel);

  return (
    <div className="fixed bottom-6 left-6 z-[9998] flex flex-col gap-2.5 items-start w-[calc(100%-3rem)] max-w-sm pointer-events-none">
      <AnimatePresence>
        {tasks.map((task) => {
          const running = task.status === 'running';
          const incompleteSuccess = task.status === 'success' && task.incomplete;
          const accent =
            running
              ? 'bg-neon-cyan'
              : task.status === 'success'
                ? (task.incomplete ? 'bg-amber-500' : 'bg-neon-green')
                : task.status === 'canceled'
                  ? 'bg-text-subtle'
                  : 'bg-red-500';

          return (
            <motion.div
              key={task.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              role="status"
              aria-live="polite"
              className="pointer-events-auto w-full"
            >
              <div className="glass-strong relative flex items-start gap-3 rounded-2xl border border-glass-border/10 px-4 py-3.5 shadow-2xl shadow-black/30 overflow-hidden">
                <div className={cn('absolute left-0 top-0 bottom-0 w-0.5 rounded-full', accent)} />

                <div className="shrink-0 mt-0.5">
                  {running && <Loader2 className="h-5 w-5 text-neon-cyan animate-spin" />}
                  {task.status === 'success' && (
                    <CheckCircle2 className={cn('h-5 w-5', task.incomplete ? 'text-amber-500' : 'text-neon-green')} />
                  )}
                  {task.status === 'canceled' && <Ban className="h-5 w-5 text-text-subtle" />}
                  {task.status === 'error' && <AlertTriangle className="h-5 w-5 text-red-500" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13.5px] font-semibold text-text leading-snug truncate">{task.title}</p>
                    {incompleteSuccess && (
                      <span className="shrink-0 rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-500">
                        {t('bgtask.incomplete_badge')}
                      </span>
                    )}
                  </div>
                  {task.detail && (
                    <p className="text-[12px] text-text-muted mt-0.5 leading-snug">
                      {task.canceling ? t('bgtask.canceling') : task.detail}
                    </p>
                  )}

                  {/* Acciones al terminar: acción destacada (abrir el resultado) */}
                  {!running && task.action && (
                    <button
                      onClick={() => { task.action?.run(); dismiss(task.id); }}
                      className={cn(
                        'mt-2.5 inline-flex items-center rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors',
                        task.incomplete
                          ? 'bg-amber-500/12 text-amber-500 hover:bg-amber-500/20'
                          : 'bg-neon-green/12 text-neon-green hover:bg-neon-green/20',
                      )}
                    >
                      {task.action.label}
                    </button>
                  )}
                </div>

                {/* Cancelar (corriendo) o cerrar (terminado) */}
                {running && task.cancelable ? (
                  <button
                    onClick={() => requestCancel(task.id)}
                    disabled={task.canceling}
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-glass-border/15 px-2 py-1 text-[11px] font-medium text-text-muted hover:text-text hover:border-glass-border/30 transition-colors disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                    {t('bgtask.cancel')}
                  </button>
                ) : !running ? (
                  <button
                    onClick={() => dismiss(task.id)}
                    className="shrink-0 text-text-subtle hover:text-text transition-colors"
                    aria-label={t('bgtask.dismiss')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
