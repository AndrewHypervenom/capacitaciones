import { useTranslation } from 'react-i18next';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/cn';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  const options: { value: 'light' | 'dark' | 'system'; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: t('theme.light') },
    { value: 'dark', icon: Moon, label: t('theme.dark') },
    { value: 'system', icon: Monitor, label: t('theme.system') },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t('theme.toggle_label')}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full border border-line bg-surface p-0.5',
        className,
      )}
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            onClick={() => setTheme(opt.value)}
            className={cn(
              'h-6 w-6 sm:h-7 sm:w-7 inline-flex items-center justify-center rounded-full transition-colors',
              active
                ? 'bg-text text-bg'
                : 'text-text-muted hover:text-text',
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        );
      })}
    </div>
  );
}
