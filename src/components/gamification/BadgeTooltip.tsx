import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';
import { badgeLabel, badgeDescription, type BadgeDef, type Lang } from '@/stores/gamificationStore';
import { cn } from '@/lib/cn';

/* ────────────────────────────────────────────────────────────────────────
   Globo de una insignia. Vive aparte porque la misma cuadrícula aparece en
   dos sitios —el inicio del aprendiz y el panel de logros del perfil— y el
   `title` nativo que había en ambos salía tarde, feo y sin decir si la
   insignia ya estaba obtenida, que es justo lo que se quiere saber al
   pasar por encima.
   ──────────────────────────────────────────────────────────────────────── */

export function BadgeTooltip({
  badge, earned, lang, className, children,
}: {
  badge: BadgeDef;
  earned: boolean;
  lang: Lang;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  const label = (
    <span className="block w-[210px]">
      <span className="flex items-center gap-2">
        <span className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[16px]',
          earned ? (badge.rare ? 'bg-amber-400/15' : 'bg-primary/10') : 'bg-subtle',
        )}>
          {earned ? badge.emoji : <Lock className="h-3.5 w-3.5 text-text-subtle" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-bold text-text">
            {badgeLabel(badge, lang)}
          </span>
          {badge.rare && (
            <span className="block text-[10px] font-semibold text-amber-500">
              ⭐ {t('profile.badge_rare', 'Insignia rara')}
            </span>
          )}
        </span>
      </span>
      <span className="mt-2 block text-[11.5px] leading-snug text-text-muted">
        {badgeDescription(badge, lang)}
      </span>
      <span className={cn(
        'mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold',
        earned ? 'bg-[rgba(16,212,81,0.15)] text-[#0ca23e]' : 'bg-subtle text-text-subtle',
      )}>
        {earned
          ? t('profile.badge_unlocked', 'Obtenida')
          : t('profile.badge_pending', 'Aún por conseguir')}
      </span>
    </span>
  );

  return (
    <Tooltip label={label} variant="panel" anchor="element" delay={220} className={className}>
      {children}
    </Tooltip>
  );
}
