import { AnimatePresence, motion } from 'framer-motion';
import { X, CheckCircle, AlertCircle, Info, Award } from 'lucide-react';
import { useToastStore, type Toast, type ToastKind } from '@/stores/toastStore';
import { cn } from '@/lib/cn';

const kindConfig: Record<ToastKind, {
  icon: React.ComponentType<{ className?: string }>;
  bar: string;
  iconCls: string;
}> = {
  success: {
    icon: CheckCircle,
    bar: 'bg-neon-green',
    iconCls: 'text-neon-green',
  },
  error: {
    icon: AlertCircle,
    bar: 'bg-red-500',
    iconCls: 'text-red-400',
  },
  info: {
    icon: Info,
    bar: 'bg-neon-cyan',
    iconCls: 'text-neon-cyan',
  },
  badge: {
    icon: Award,
    bar: 'bg-neon-violet',
    iconCls: 'text-neon-violet',
  },
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const cfg = kindConfig[toast.kind];
  const Icon = cfg.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 32, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'relative flex items-start gap-3 min-w-[280px] max-w-[360px]',
        'glass-strong rounded-2xl px-4 py-3.5 shadow-2xl shadow-black/30',
        'border border-glass-border/10 overflow-hidden',
      )}
    >
      {/* Accent bar */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-0.5 rounded-full', cfg.bar)} />

      <div className={cn('mt-0.5 shrink-0', cfg.iconCls)}>
        {toast.kind === 'badge' && toast.icon ? (
          <span className="text-xl leading-none">{toast.icon}</span>
        ) : (
          <Icon className="h-4.5 w-4.5" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-semibold text-text leading-snug">{toast.title}</p>
        {toast.description && (
          <p className="text-[12px] text-text-muted mt-0.5 leading-snug">{toast.description}</p>
        )}
      </div>

      <button
        onClick={() => dismiss(toast.id)}
        className="shrink-0 mt-0.5 text-text-subtle hover:text-text transition-colors"
        aria-label="Cerrar"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2.5 items-end pointer-events-none"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
