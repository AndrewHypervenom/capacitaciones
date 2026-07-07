import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Loader2, AlertTriangle, X } from 'lucide-react';
import { useBgTaskStore } from '@/stores/bgTaskStore';
import { cn } from '@/lib/cn';

/**
 * Indicador global de procesos en segundo plano (p. ej. generación de mundos
 * con IA). Muestra en qué paso va cada proceso y su resultado (éxito/error),
 * visible en todo el sitio mientras dure.
 */
export function BgTaskIndicator() {
  const tasks = useBgTaskStore((s) => s.tasks);
  const dismiss = useBgTaskStore((s) => s.dismiss);

  return (
    <div className="fixed bottom-6 left-6 z-[9998] flex flex-col gap-2.5 items-start w-[calc(100%-3rem)] max-w-sm pointer-events-none">
      <AnimatePresence>
        {tasks.map((task) => (
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
              <div
                className={cn(
                  'absolute left-0 top-0 bottom-0 w-0.5 rounded-full',
                  task.status === 'running' && 'bg-neon-cyan',
                  task.status === 'success' && 'bg-neon-green',
                  task.status === 'error' && 'bg-red-500',
                )}
              />

              <div className="shrink-0 mt-0.5">
                {task.status === 'running' && <Loader2 className="h-5 w-5 text-neon-cyan animate-spin" />}
                {task.status === 'success' && <CheckCircle2 className="h-5 w-5 text-neon-green" />}
                {task.status === 'error' && <AlertTriangle className="h-5 w-5 text-red-500" />}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-semibold text-text leading-snug">{task.title}</p>
                {task.detail && (
                  <p className="text-[12px] text-text-muted mt-0.5 leading-snug">{task.detail}</p>
                )}
              </div>

              <button
                onClick={() => dismiss(task.id)}
                className="shrink-0 text-text-subtle hover:text-text transition-colors"
                aria-label="Cerrar"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
