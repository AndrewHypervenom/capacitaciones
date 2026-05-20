import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Award, Check, Clock, HeartHandshake, ShieldCheck } from 'lucide-react';
import { getScenario } from '@/data/scenarios';
import { useSimStore } from '@/stores/simStore';
import {
  useProgressStore,
  selectCertificationEarned,
} from '@/stores/progressStore';
import { useModules } from '@/hooks/useModules';
import { useUserStore } from '@/stores/userStore';
import { scoreRun, formatDuration } from '@/lib/scoring';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { Button } from '@/components/ui/Button';
import { Reveal } from '@/components/ui/Reveal';
import { cn } from '@/lib/cn';

export default function SimulatorResult() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const nav = useNavigate();
  const language = useUserStore((s) => s.language);
  const lastResult = useSimStore((s) => s.lastResult);
  const addAttempt = useProgressStore((s) => s.addAttempt);
  const progressState = useProgressStore();
  const { modules } = useModules();
  const certificationEarned = selectCertificationEarned(progressState, modules);
  const recordedRef = useRef(false);

  const scenario = useMemo(() => (id ? getScenario(id) : undefined), [id]);

  const valid = !!scenario && !!lastResult && lastResult.scenarioId === scenario.id;

  const computed = useMemo(() => {
    if (!valid || !scenario || !lastResult) return null;
    return scoreRun(lastResult, scenario);
  }, [valid, scenario, lastResult]);

  useEffect(() => {
    if (!valid) {
      nav('/simulator', { replace: true });
    }
  }, [valid, nav]);

  useEffect(() => {
    if (!valid || !scenario || !lastResult || !computed || recordedRef.current) return;
    recordedRef.current = true;
    addAttempt({
      id: `${scenario.id}-${lastResult.startedAt}`,
      scenarioId: scenario.id,
      date: Date.now(),
      score: computed.score,
      durationSec: computed.durationSec,
      checklistPct: computed.checklistPct,
      empathyPct: computed.empathyPct,
      resolved: computed.resolved,
    });
  }, [valid, scenario, lastResult, computed, addAttempt]);

  if (!valid || !scenario || !computed) return null;

  const { score, durationSec, checklistPct, empathyPct, resolved } = computed;
  const tier = score >= 85 ? 'excellent' : score >= 65 ? 'good' : 'needs-work';

  const metrics = [
    {
      icon: Clock,
      label: t('simulator.metric_time'),
      raw: durationSec,
      format: (n: number) => formatDuration(Math.round(n)),
    },
    {
      icon: ShieldCheck,
      label: t('simulator.metric_checklist'),
      raw: Math.round(checklistPct * 100),
      format: (n: number) => `${Math.round(n)}%`,
    },
    {
      icon: HeartHandshake,
      label: t('simulator.metric_empathy'),
      raw: Math.round(empathyPct * 100),
      format: (n: number) => `${Math.round(n)}%`,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl px-5 pt-12 pb-24">
      <Reveal as="header" className="mb-12 text-center">
        <div className="text-[12px] uppercase tracking-wider text-text-subtle mb-3">
          {t('simulator.result_title')}
        </div>
        <h1 className="text-display-md font-semibold tracking-[-0.04em] mb-3 text-balance">
          {scenario.title[language]}
        </h1>
        <p className="text-text-muted text-[16px] max-w-xl mx-auto">{t('simulator.result_subtitle')}</p>
      </Reveal>

      <Reveal delay={120}>
        <div className="surface-card p-12 mb-6 text-center">
          <div className="text-[11px] uppercase tracking-wider text-text-subtle mb-4">
            {t('simulator.metric_score')}
          </div>
          <div
            className={cn(
              'text-[120px] md:text-[160px] font-semibold leading-none tracking-[-0.06em] tabular-nums',
              tier === 'excellent' && 'text-brand-green',
              tier === 'good' && 'text-text',
              tier === 'needs-work' && 'text-brand-magenta',
            )}
          >
            <AnimatedNumber value={score} duration={1.4} />
          </div>
          <div
            className={cn(
              'inline-flex items-center gap-2 mt-5 text-[13px] px-3 py-1 rounded-full border',
              resolved
                ? 'bg-brand-green/10 text-brand-green border-brand-green/30'
                : 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/30',
            )}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
            {resolved ? t('simulator.resolved_yes') : t('simulator.resolved_no')}
          </div>
        </div>
      </Reveal>

      <div className="grid md:grid-cols-3 gap-5 mb-10">
        {metrics.map((m, i) => (
          <Reveal key={m.label} delay={200 + i * 80}>
            <div className="surface-card p-6">
              <m.icon className="h-4 w-4 text-text-muted mb-3" />
              <div className="text-[11px] uppercase tracking-wider text-text-subtle mb-2 font-medium">
                {m.label}
              </div>
              <div className="text-[28px] font-semibold tracking-tight tabular-nums">
                <AnimatedNumber value={m.raw} duration={1.2} format={m.format} />
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      {certificationEarned && (
        <Reveal delay={320}>
          <Link
            to="/certificate"
            className="group block surface-card p-6 mb-8 hover:bg-subtle transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="shrink-0 inline-flex items-center justify-center h-11 w-11 rounded-2xl bg-brand-green text-white dark:text-black">
                <Award className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-[11px] uppercase tracking-wider text-brand-green mb-0.5 font-medium">
                  {t('dashboard.certificate_ready_title')}
                </div>
                <div className="text-[15px] font-medium">
                  {t('simulator.view_certificate')}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-text-muted group-hover:translate-x-0.5 transition-transform" />
            </div>
          </Link>
        </Reveal>
      )}

      <Reveal delay={400}>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button variant="secondary" size="lg" onClick={() => nav(`/simulator/run/${scenario.id}`)}>
            {t('simulator.retry')}
          </Button>
          <Link to="/dashboard">
            <Button size="lg">
              {t('simulator.back_dashboard')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </Reveal>
    </div>
  );
}
