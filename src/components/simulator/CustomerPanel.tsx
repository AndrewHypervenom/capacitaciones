import { useTranslation } from 'react-i18next';
import type { Scenario } from '@/data/scenarios';
import type { Language } from '@/stores/userStore';
import { CountryFlag } from '@/components/layout/CountryFlag';

function Avatar({ seed }: { seed: number }) {
  const initials =
    String.fromCharCode(65 + (seed % 26)) +
    String.fromCharCode(65 + ((seed * 7) % 26));
  return (
    <div className="relative w-16 h-16 shrink-0">
      <div className="w-16 h-16 rounded-full flex items-center justify-center font-semibold text-text text-lg bg-subtle border border-line">
        {initials}
      </div>
    </div>
  );
}

interface CustomerPanelProps {
  scenario: Scenario;
  language: Language;
  live: boolean;
}

export function CustomerPanel({ scenario, language, live }: CustomerPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="surface-card p-6 h-full flex flex-col">
      <div className="flex items-start gap-4 mb-6">
        <Avatar seed={scenario.customer.avatarSeed} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <CountryFlag code={scenario.country} size={16} />
            <span className="text-[11px] text-text-subtle uppercase tracking-wider">
              {t(`simulator.countries.${scenario.country}`)}
            </span>
          </div>
          <div className="text-[16px] font-semibold tracking-tight">{scenario.customer.name}</div>
          <div className="text-[12px] font-mono text-text-muted">{scenario.customer.phone}</div>
        </div>
      </div>

      <div className="hairline mb-5" />

      <div className="space-y-4 text-[13px]">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-text-subtle mb-1.5 font-medium">
            {t('simulator.case')}
          </div>
          <p className="text-text leading-relaxed">{scenario.customer.reason[language]}</p>
        </div>
      </div>

      <div className="mt-auto pt-6">
        <div className="flex items-center gap-2">
          <span
            className={
              live
                ? 'h-2 w-2 rounded-full bg-brand-green shadow-[0_0_8px_rgba(0,213,98,0.5)]'
                : 'h-2 w-2 rounded-full bg-text-subtle'
            }
          />
          <span
            className={`text-[11px] uppercase tracking-wider ${
              live ? 'text-text' : 'text-text-subtle'
            }`}
          >
            {live ? t('simulator.status_on_call') : t('simulator.status_ended')}
          </span>
        </div>
      </div>
    </div>
  );
}
