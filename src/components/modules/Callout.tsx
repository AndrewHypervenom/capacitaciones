import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Lightbulb,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Quote,
  Info,
} from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';
import { RichTextInline } from '@/components/ui/RichText';
import type { CalloutKind } from '@/data/modules';

interface CalloutConfig {
  Icon: React.ComponentType<{ className?: string }>;
  wrapperClass: string;
  iconClass: string;
  accentClass: string;
  labelClass: string;
  labelKey: string;
}

const CALLOUT_CONFIG: Record<CalloutKind, CalloutConfig> = {
  tip: {
    Icon: Lightbulb,
    wrapperClass: 'glass border-neon-green/15',
    iconClass: 'bg-neon-green/12 text-neon-green ring-1 ring-neon-green/20',
    accentClass: 'bg-gradient-to-r from-neon-green to-neon-green/20',
    labelClass: 'text-neon-green',
    labelKey: 'module.tip',
  },
  important: {
    Icon: AlertTriangle,
    wrapperClass: 'glass border-neon-magenta/15',
    iconClass: 'bg-neon-magenta/12 text-neon-magenta ring-1 ring-neon-magenta/20',
    accentClass: 'bg-gradient-to-r from-neon-magenta to-neon-magenta/20',
    labelClass: 'text-neon-magenta',
    labelKey: 'module.important',
  },
  warning: {
    Icon: AlertOctagon,
    wrapperClass: 'glass border-amber-500/15',
    iconClass: 'bg-amber-500/12 text-amber-400 ring-1 ring-amber-500/20',
    accentClass: 'bg-gradient-to-r from-amber-500 to-amber-500/20',
    labelClass: 'text-amber-400',
    labelKey: 'module.warning',
  },
  success: {
    Icon: CheckCircle2,
    wrapperClass: 'glass border-neon-green/15',
    iconClass: 'bg-neon-green/12 text-neon-green ring-1 ring-neon-green/20',
    accentClass: 'bg-gradient-to-r from-neon-green to-neon-green/25',
    labelClass: 'text-neon-green',
    labelKey: 'module.success',
  },
  quote: {
    Icon: Quote,
    wrapperClass: 'glass',
    iconClass: 'bg-glass/8 text-text-muted ring-1 ring-glass-border/10',
    accentClass: 'bg-gradient-to-r from-glass-border/20 to-transparent',
    labelClass: 'text-text-muted',
    labelKey: 'module.quote',
  },
  note: {
    Icon: Info,
    wrapperClass: 'glass',
    iconClass: 'bg-glass/8 text-text-subtle ring-1 ring-glass-border/8',
    accentClass: 'bg-gradient-to-r from-glass-border/15 to-transparent',
    labelClass: 'text-text-subtle',
    labelKey: 'module.note',
  },
};

interface Props {
  kind: CalloutKind;
  text: string;
  animate?: boolean;
  className?: string;
}

export function Callout({ kind, text, animate = true, className }: Props) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const config = CALLOUT_CONFIG[kind] ?? CALLOUT_CONFIG.tip;
  const { Icon } = config;

  const inner = (
    <div className={cn('mt-8 rounded-2xl border overflow-hidden', config.wrapperClass, className)}>
      {/* Accent top bar */}
      <div className={cn('h-0.5 w-full', config.accentClass)} />
      <div className="flex gap-4 p-5">
        <div className={cn(
          'shrink-0 h-10 w-10 rounded-xl inline-flex items-center justify-center shadow-sm',
          config.iconClass,
        )}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="pt-0.5 flex-1 min-w-0">
          <div className={cn('text-[11px] uppercase tracking-wider font-bold mb-2', config.labelClass)}>
            {t(config.labelKey)}
          </div>
          <p className="text-[15px] leading-[1.65] text-text whitespace-pre-line"><RichTextInline text={text} /></p>
        </div>
      </div>
    </div>
  );

  if (!animate || reducedMotion) return inner;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      {inner}
    </motion.div>
  );
}
