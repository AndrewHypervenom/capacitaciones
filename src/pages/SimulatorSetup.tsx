import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PhoneCall, Flame, Lock, ArrowLeft, MessageSquare } from 'lucide-react';
import type { ChoiceScenario } from '@/data/choiceScenarios';
import { useScenarios, useChoiceScenarios } from '@/hooks/useScenarios';
import { motion } from 'framer-motion';
import { useUserStore } from '@/stores/userStore';
import {
  useProgressStore,
  selectSimulatorUnlocked,
  SIMULATOR_UNLOCK_THRESHOLD,
} from '@/stores/progressStore';
import { Badge } from '@/components/ui/Badge';
import { Reveal } from '@/components/ui/Reveal';
import { Button } from '@/components/ui/Button';
import { CountryFlag } from '@/components/layout/CountryFlag';
import { cn } from '@/lib/cn';

export default function SimulatorSetup() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const language = useUserStore((s) => s.language);
  const completedCount = useProgressStore((s) => s.completedModules.length);
  const unlocked = useProgressStore(selectSimulatorUnlocked);
  const remaining = Math.max(0, SIMULATOR_UNLOCK_THRESHOLD - completedCount);
  const { scenarios: SCENARIOS } = useScenarios();
  const { choiceScenarios: CHOICE_SCENARIOS } = useChoiceScenarios();

  if (!unlocked) {
    return (
      <div className="mx-auto max-w-3xl px-5 pt-16 pb-24">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-[13px] text-text-muted hover:text-text mb-8"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {t('simulator.back_dashboard')}
        </Link>
        <Reveal className="surface-card p-10 text-center">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-subtle border border-line text-text-muted mx-auto mb-6">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-display-md font-semibold tracking-tight mb-3">
            {t('simulator.locked_title')}
          </h1>
          <p className="text-text-muted text-[16px] mb-8">
            {t('simulator.locked_hint', { remaining })}
          </p>
          <Button onClick={() => nav('/dashboard')} size="md">
            {t('simulator.back_dashboard')}
          </Button>
        </Reveal>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-5 pt-12 pb-24">
      <Reveal as="header" className="mb-12 max-w-2xl">
        <Badge tone="brand" className="mb-4">
          <PhoneCall className="h-3 w-3" /> {t('nav.simulator')}
        </Badge>
        <h1 className="text-display-lg font-semibold tracking-[-0.04em] leading-[1.05] mb-4 text-balance">
          {t('simulator.setup_title')}
        </h1>
        <p className="text-text-muted text-[18px] leading-relaxed">
          {t('simulator.setup_subtitle')}
        </p>
      </Reveal>

      <div className="grid md:grid-cols-2 gap-5">
        {SCENARIOS.map((scn, i) => (
          <Reveal key={scn.id} delay={i * 50}>
            <button
              onClick={() => nav(`/simulator/run/${scn.id}`)}
              className="group w-full text-left surface-card p-7 hover:bg-subtle transition-colors"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <CountryFlag code={scn.country} size={20} />
                  <span className="text-[12px] text-text-muted">
                    {t(`simulator.countries.${scn.country}`)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3].map((d) => (
                    <Flame
                      key={d}
                      className={cn(
                        'h-3.5 w-3.5 transition-colors',
                        d <= scn.difficulty
                          ? scn.difficulty === 3
                            ? 'text-brand-magenta'
                            : 'text-brand-green'
                          : 'text-line',
                      )}
                      fill={d <= scn.difficulty ? 'currentColor' : 'none'}
                    />
                  ))}
                </div>
              </div>
              <h3 className="text-title font-semibold tracking-tight mb-2.5">
                {scn.title[language]}
              </h3>
              <p className="text-[14px] text-text-muted leading-relaxed mb-6 line-clamp-3">
                {scn.summary[language]}
              </p>
              <div className="flex items-center justify-between pt-4 border-t border-line">
                <div className="text-[12px] text-text-subtle">
                  <span className="text-text-muted">{scn.customer.name}</span>
                  <span className="mx-2">·</span>
                  <span className="font-mono">{scn.customer.phone}</span>
                </div>
                <span className="text-brand-green text-[13px] font-medium group-hover:translate-x-0.5 transition-transform">
                  {t('simulator.take_call')} →
                </span>
              </div>
            </button>
          </Reveal>
        ))}
      </div>

      <ChoiceScenariosSection nav={nav} choiceScenarios={CHOICE_SCENARIOS} />
    </div>
  );
}

const LEVEL_META = {
  basico: { label: 'Básico', color: '#34c759' },
  medio: { label: 'Medio', color: '#0071e3' },
  avanzado: { label: 'Avanzado', color: '#ff453a' },
} as const;

function ChoiceScenariosSection({
  nav,
  choiceScenarios,
}: {
  nav: ReturnType<typeof useNavigate>
  choiceScenarios: ChoiceScenario[]
}) {
  const language = useUserStore((s) => s.language);
  const levels = (['basico', 'medio', 'avanzado'] as const).filter((lvl) =>
    choiceScenarios.some((s) => s.level === lvl),
  );

  return (
    <div className="mt-16">
      <div className="flex items-center gap-4 mb-8">
        <div className="h-px flex-1 bg-line" />
        <div className="flex items-center gap-2 shrink-0">
          <MessageSquare className="h-4 w-4 text-text-muted" />
          <span className="text-[13px] font-medium text-text-muted uppercase tracking-widest">
            Simulaciones de opción múltiple
          </span>
        </div>
        <div className="h-px flex-1 bg-line" />
      </div>

      <div className="space-y-10">
        {levels.map((level) => {
          const meta = LEVEL_META[level];
          const scenarios = choiceScenarios.filter((s) => s.level === level);
          return (
            <div key={level}>
              <div className="flex items-center gap-2.5 mb-4">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: meta.color }}
                />
                <span className="text-[15px] font-semibold text-text tracking-tight">
                  {meta.label}
                </span>
                <span className="text-[12px] text-text-subtle border border-line rounded-full px-2 py-0.5">
                  {scenarios.length}
                </span>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {scenarios.map((scn, i) => (
                  <ChoiceScenarioCard
                    key={scn.id}
                    scn={scn}
                    index={i}
                    color={meta.color}
                    onClick={() => nav(`/simulator/choice/${scn.id}`)}
                    language={language}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChoiceScenarioCard({
  scn,
  index,
  color,
  onClick,
  language,
}: {
  scn: ChoiceScenario;
  index: number;
  color: string;
  onClick: () => void;
  language: 'es' | 'en' | 'pt';
}) {
  return (
    <Reveal delay={index * 60}>
      <motion.button
        onClick={onClick}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className="group w-full text-left surface-card rounded-3xl p-5 hover:bg-subtle transition-colors"
      >
        <div className="flex items-start justify-between mb-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `${color}18`, border: `1px solid ${color}35` }}
          >
            <MessageSquare className="h-4 w-4" style={{ color }} />
          </div>
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
            style={{ color: 'var(--color-text-muted)', borderColor: 'var(--color-line)' }}
          >
            {scn.id}
          </span>
        </div>

        <h3 className="text-[15px] font-semibold tracking-tight mb-1.5 text-text">
          {scn.title[language]}
        </h3>
        <p className="text-[13px] text-text-muted leading-relaxed line-clamp-3 mb-4">
          {scn.description[language]}
        </p>

        <div className="flex items-center justify-between pt-3 border-t border-line">
          <span className="text-[12px] text-text-subtle">{scn.clientName}</span>
          <span
            className="text-[13px] font-medium group-hover:translate-x-0.5 transition-transform"
            style={{ color }}
          >
            Iniciar simulación →
          </span>
        </div>
      </motion.button>
    </Reveal>
  );
}
