import { useEffect, useLayoutEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Award, Check, Lock, PhoneCall, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { useUserStore } from '@/stores/userStore';
import {
  useProgressStore,
  selectSimulatorUnlocked,
  SIMULATOR_UNLOCK_THRESHOLD,
  CERTIFICATION_MIN_SCORE,
  BADGE_DEFS,
  getXPLevel,
  getXPProgress,
} from '@/stores/progressStore';
import { useModules } from '@/hooks/useModules';
import { LearningPath } from '@/components/modules/LearningPath';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { Reveal } from '@/components/ui/Reveal';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { GradientHeading } from '@/components/ui/GradientHeading';
import { NeonBadge } from '@/components/ui/NeonBadge';
import { cn } from '@/lib/cn';

// Tracks whether Dashboard has already mounted since the last full page load.
// On first mount (fresh load): false → render normally.
// On subsequent mounts (React Router navigation): true → force a full reload.
let _hasRenderedOnce = false;

export default function Dashboard() {
  const [needsReload] = useState(() => _hasRenderedOnce);

  useLayoutEffect(() => {
    _hasRenderedOnce = true;
    if (needsReload) { window.location.reload(); return; }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const { t } = useTranslation();
  const { name, language } = useUserStore();
  const { modules, loading: modulesLoading } = useModules();
  const progressState = useProgressStore();
  const { xp, streak, badges, attempts } = progressState;
  const recheckBadges = useProgressStore((s) => s.recheckBadges);

  useEffect(() => {
    if (!modulesLoading && modules.length > 0) {
      recheckBadges(modules);
    }
  }, [modulesLoading, modules, recheckBadges]);
  const xpLevel = getXPLevel(xp);
  const xpProgress = getXPProgress(xp);

  const total = modules.length;
  // Only count completions for modules that actually exist right now
  const completedModules = progressState.completedModules.filter((id) =>
    modules.some((m) => m.id === id),
  );
  const done = completedModules.length;
  const progressPct = total > 0 ? Math.min(1, done / total) : 0;

  const simulatorUnlocked = selectSimulatorUnlocked({ ...progressState, completedModules });
  const allModulesDone = total > 0 && done === total;
  const bestScore = attempts.length > 0 ? Math.max(...attempts.map((a) => a.score)) : 0;
  const hasSimulatorScore = attempts.some((a) => a.score >= CERTIFICATION_MIN_SCORE);
  const certificationEarned = allModulesDone && hasSimulatorScore;

  const remainingForUnlock = Math.max(0, SIMULATOR_UNLOCK_THRESHOLD - done);
  const remainingMinutes = modules
    .filter((m) => !completedModules.includes(m.id))
    .reduce((acc, m) => acc + m.duration, 0);
  const nextModule = modules.find((m) => !completedModules.includes(m.id));

  if (needsReload) return null;

  if (modulesLoading) {
    return (
      <div className="mx-auto max-w-5xl px-5 pt-12 pb-24">
        <div className="animate-pulse space-y-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 rounded-2xl glass" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-5 pt-12 pb-24 dark-mesh-bg min-h-screen">
      {/* Hero section */}
      <Reveal as="section" className="mb-16 md:mb-20 relative">
        {/* Glow decorativo */}
        <div
          className="absolute -top-20 right-0 w-[500px] h-[300px] pointer-events-none rounded-full"
          aria-hidden
          style={{ background: 'radial-gradient(ellipse at center, rgb(var(--neon-green) / 0.05) 0%, transparent 70%)' }}
        />

        <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-8">
          <div>
            <p className="text-[13px] text-text-muted mb-4">
              {t('dashboard.greeting', { name })}
            </p>
            <GradientHeading as="h1" variant="white" size="display-lg" className="mb-4 text-balance">
              {t('dashboard.headline')}
            </GradientHeading>
            <p className="text-text-muted text-[18px] max-w-xl leading-relaxed">
              {t('dashboard.subheadline', { done, total })}
            </p>
          </div>

          <GlassCard intensity="default" padding="md" rounded="2xl" className="flex items-center gap-5 shrink-0">
            <ProgressRing value={progressPct} size={88} stroke={5} showLabel />
            <div>
              <div className="text-[11px] uppercase tracking-wider text-text-subtle">
                {t('dashboard.progress_label')}
              </div>
              <div className="text-[15px] font-medium tabular-nums text-text">
                {t('dashboard.progress_full', {
                  done,
                  total,
                  pct: Math.round(progressPct * 100),
                })}
              </div>
            </div>
          </GlassCard>
        </div>
      </Reveal>

      {/* Learning path */}
      <section className="mb-16">
        <Reveal className="mb-6">
          <GradientHeading as="h2" variant="white" size="headline" className="mb-1">
            {t('dashboard.path_title')}
          </GradientHeading>
          <p className="text-text-muted text-[15px]">
            {t('dashboard.path_subtitle')}
          </p>
        </Reveal>

        <LearningPath
          modules={modules}
          language={language}
          completedIds={completedModules}
        />
      </section>

      {/* ── Sección de certificación (siempre visible) ─────────── */}
      <Reveal as="section" className="mb-16">
        <Reveal className="mb-6">
          <GradientHeading as="h2" variant="white" size="headline" className="mb-1">
            {t('dashboard.cert_section_title')}
          </GradientHeading>
          <p className="text-text-muted text-[15px]">
            {t('dashboard.cert_section_subtitle')}
          </p>
        </Reveal>

        {certificationEarned ? (
          <Link to="/certificate">
            <GlassCard intensity="default" glow="green" shimmer interactive padding="lg">
              <div className="flex items-center gap-5">
                <div className="shrink-0 h-14 w-14 rounded-2xl bg-neon-green/90 flex items-center justify-center ring-1 ring-neon-green/20">
                  <Award className="h-6 w-6 text-black" />
                </div>
                <div className="flex-1">
                  <NeonBadge color="green" className="mb-2">
                    {t('dashboard.certificate_ready_title')}
                  </NeonBadge>
                  <div className="text-title font-semibold tracking-tight text-text">
                    {t('dashboard.certificate_ready_subtitle')}
                  </div>
                </div>
                <Button variant="glass" size="sm" className="shrink-0">
                  {t('dashboard.certificate_cta')} →
                </Button>
              </div>
            </GlassCard>
          </Link>
        ) : (
          <GlassCard intensity="default" padding="lg">
            <div className="space-y-5 mb-6">
              {/* Requisito 1: módulos */}
              <div className="flex items-center gap-4">
                <div className={cn(
                  'shrink-0 h-9 w-9 rounded-full flex items-center justify-center',
                  allModulesDone
                    ? 'bg-brand-green/15 ring-1 ring-brand-green/25'
                    : 'glass ring-1 ring-glass-border/10',
                )}>
                  {allModulesDone
                    ? <Check className="h-4 w-4 text-brand-green" />
                    : <span className="text-[13px] font-bold text-text-muted">1</span>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-text mb-1">
                    {t('dashboard.cert_req_modules')}
                  </div>
                  <div className="h-1.5 w-full rounded-full glass border border-glass-border/10 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: allModulesDone
                        ? 'rgb(var(--brand-green))'
                        : 'linear-gradient(90deg, rgb(var(--neon-green)), rgb(var(--brand-green)))',
                      }}
                      initial={{ width: 0 }}
                      animate={{ width: `${total > 0 ? Math.min(100, (done / total) * 100) : 0}%` }}
                      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                  <div className="text-[11px] text-text-subtle mt-1 tabular-nums">
                    {t('dashboard.cert_req_modules_sub', { done, total })}
                  </div>
                </div>
                <NeonBadge color={allModulesDone ? 'green' : 'neutral'} className="shrink-0 tabular-nums">
                  {done}/{total}
                </NeonBadge>
              </div>

              {/* Requisito 2: simulador */}
              <div className="flex items-center gap-4">
                <div className={cn(
                  'shrink-0 h-9 w-9 rounded-full flex items-center justify-center',
                  hasSimulatorScore
                    ? 'bg-brand-green/15 ring-1 ring-brand-green/25'
                    : 'glass ring-1 ring-glass-border/10',
                )}>
                  {hasSimulatorScore
                    ? <Check className="h-4 w-4 text-brand-green" />
                    : <span className="text-[13px] font-bold text-text-muted">2</span>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-text mb-1">
                    {t('dashboard.cert_req_simulator', { score: CERTIFICATION_MIN_SCORE })}
                  </div>
                  <div className="h-1.5 w-full rounded-full glass border border-glass-border/10 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: hasSimulatorScore
                        ? 'rgb(var(--brand-green))'
                        : 'linear-gradient(90deg, rgb(var(--neon-green)), rgb(var(--brand-green)))',
                      }}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (bestScore / CERTIFICATION_MIN_SCORE) * 100)}%` }}
                      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                  <div className="text-[11px] text-text-subtle mt-1 tabular-nums">
                    {attempts.length > 0
                      ? t('dashboard.cert_req_simulator_sub', { best: bestScore })
                      : t('dashboard.cert_req_simulator_none')
                    }
                  </div>
                </div>
                <NeonBadge color={hasSimulatorScore ? 'green' : 'neutral'} className="shrink-0 tabular-nums">
                  {bestScore}/100
                </NeonBadge>
              </div>
            </div>

            <Link to="/certificate">
              <Button variant="secondary" size="sm">
                {t('dashboard.cert_preview')} →
              </Button>
            </Link>
          </GlassCard>
        )}
      </Reveal>

      {/* ── Gamificación ──────────────────────────────────────── */}
      <Reveal as="section" className="mb-12">
        <div className="grid sm:grid-cols-3 gap-4">

          {/* XP Bar */}
          <GlassCard intensity="subtle" padding="md" rounded="2xl" className="col-span-2">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-text-subtle font-semibold">
                  Experiencia
                </span>
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: `${xpLevel.color}18`, color: xpLevel.color }}
                >
                  Nv. {xpLevel.level} · {xpLevel.label}
                </span>
              </div>
              <span className="text-[13px] font-semibold tabular-nums text-text">
                {xp.toLocaleString()} XP
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full glass border border-glass-border/10 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: `linear-gradient(90deg, ${xpLevel.color}, ${xpLevel.color}88)` }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.round(xpProgress * 100)}%` }}
                transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            {xpLevel.level < 4 && (
              <p className="text-[11px] text-text-subtle mt-1.5 tabular-nums">
                {xp} / {xpLevel.maxXP} XP para {
                  ['', 'Aprendiz', 'Experto', 'Maestro'][xpLevel.level] ?? 'Maestro'
                }
              </p>
            )}
          </GlassCard>

          {/* Streak */}
          <GlassCard intensity="subtle" padding="md" rounded="2xl" className="flex items-center gap-4">
            <div className={cn(
              'shrink-0 h-12 w-12 rounded-2xl flex items-center justify-center text-2xl',
              streak > 0
                ? 'bg-orange-500/10 ring-1 ring-orange-500/20'
                : 'bg-glass/8 ring-1 ring-glass-border/10',
            )}>
              {streak > 0 ? (
                <motion.span
                  animate={{ scale: [1, 1.15, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                >
                  🔥
                </motion.span>
              ) : '💤'}
            </div>
            <div>
              <div className="text-[26px] font-bold tabular-nums leading-none text-text">
                {streak}
              </div>
              <div className="text-[11px] text-text-subtle mt-0.5">
                {streak === 1 ? 'día de racha' : streak > 1 ? 'días de racha' : 'Empieza hoy'}
              </div>
            </div>
          </GlassCard>
        </div>
      </Reveal>

      {/* ── Badges ────────────────────────────────────────────── */}
      <Reveal as="section" className="mb-12">
        <div className="mb-4 flex items-center justify-between">
          <GradientHeading as="h2" variant="white" size="headline">
            Logros
          </GradientHeading>
          <span className="text-[12px] text-text-subtle tabular-nums">
            {badges.length} / {BADGE_DEFS.length} desbloqueados
          </span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-3">
          {BADGE_DEFS.map((badge) => {
            const earned = badges.includes(badge.id);
            return (
              <div
                key={badge.id}
                title={badge.description}
                className={cn(
                  'group flex flex-col items-center gap-2 p-3 rounded-2xl border transition-all duration-200 cursor-default',
                  earned
                    ? 'glass border-neon-green/15 hover:border-neon-green/30'
                    : 'glass border-glass-border/6 opacity-40 grayscale',
                )}
              >
                <div className={cn(
                  'h-10 w-10 rounded-xl flex items-center justify-center text-2xl',
                  earned ? 'bg-glass/10' : 'bg-glass/5',
                )}>
                  {earned ? badge.emoji : '🔒'}
                </div>
                <p className="text-[10px] font-medium text-center leading-tight text-text-muted truncate w-full">
                  {badge.label}
                </p>
              </div>
            );
          })}
        </div>
      </Reveal>

      {/* Simulador */}
      <Reveal as="section" className="mb-12">
        {simulatorUnlocked ? (
          <Link to="/simulator">
            <GlassCard intensity="strong" interactive className="overflow-hidden">
              <div className="relative p-8 md:p-10 grid md:grid-cols-[1fr_auto] gap-6 items-center">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-text-subtle mb-3 font-semibold">
                    {t('dashboard.status_available')}
                  </p>
                  <GradientHeading as="h2" variant="white" size="display-md" className="mb-3 text-balance">
                    {t('dashboard.simulator_card_title_unlocked')}
                  </GradientHeading>
                  <p className="text-text-muted text-[16px] max-w-xl leading-relaxed">
                    {t('dashboard.simulator_card_subtitle_unlocked')}
                  </p>
                </div>
                <Button variant="neon" size="lg" className="shrink-0">
                  <PhoneCall className="h-4 w-4" />
                  {t('dashboard.simulator_cta')}
                </Button>
              </div>
            </GlassCard>
          </Link>
        ) : (
          <GlassCard intensity="default" padding="xl">
            <div className="flex items-start gap-5">
              <div className="shrink-0 inline-flex items-center justify-center h-12 w-12 rounded-2xl glass border-glass-border/10 text-text-muted">
                <Lock className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <GradientHeading as="h2" variant="white" size="headline" className="mb-2">
                  {t('dashboard.simulator_card_title_locked')}
                </GradientHeading>
                <p className="text-text-muted text-[15px] mb-5 max-w-xl leading-relaxed">
                  {t('dashboard.simulator_card_subtitle_locked', { remaining: remainingForUnlock })}
                </p>
                <div className="h-2 w-full max-w-md rounded-full glass border-glass-border/10 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      background: 'linear-gradient(90deg, rgb(var(--neon-green)), rgb(var(--brand-green)))',
                      boxShadow: '0 0 6px rgb(var(--neon-green) / 0.28)',
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (done / SIMULATOR_UNLOCK_THRESHOLD) * 100)}%` }}
                    transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
                <div className="text-[11px] tabular-nums text-text-subtle mt-2">
                  {Math.min(done, SIMULATOR_UNLOCK_THRESHOLD)} / {SIMULATOR_UNLOCK_THRESHOLD}
                </div>
              </div>
            </div>
          </GlassCard>
        )}
      </Reveal>

      {/* Quiz en vivo */}
      <Reveal as="section" className="mb-12">
        <Link to="/quiz">
          <GlassCard intensity="subtle" interactive className="border-amber-500/10 hover:border-amber-500/20">
            <div className="p-6 md:p-7 flex items-center gap-5">
              <div className="shrink-0 inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/15">
                <Zap className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-[11px] uppercase tracking-wider text-amber-400 mb-1 font-semibold">
                  {t('dashboard.quiz_tag')}
                </div>
                <div className="text-title font-semibold tracking-tight text-text">
                  {t('dashboard.quiz_title')}
                </div>
                <div className="text-text-muted text-[14px] mt-0.5">
                  {t('dashboard.quiz_subtitle')}
                </div>
              </div>
              <span className="text-[13px] font-medium text-text-muted shrink-0">
                {t('dashboard.quiz_join')} →
              </span>
            </div>
          </GlassCard>
        </Link>
      </Reveal>

      {/* Footer stats */}
      <Reveal>
        <div className="h-px w-full bg-gradient-to-r from-transparent via-glass-border/15 to-transparent mb-6" />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-text-muted">
          <span>{t('dashboard.footer_modules', { n: total })}</span>
          {remainingMinutes > 0 && (
            <>
              <span className="text-text-subtle">·</span>
              <span>{t('dashboard.footer_minutes', { n: remainingMinutes })}</span>
            </>
          )}
          {nextModule && (
            <>
              <span className="text-text-subtle">·</span>
              <span className="inline-flex items-center gap-1.5 text-text-muted">
                {t('dashboard.footer_next', { title: nextModule.title[language] })}
              </span>
            </>
          )}
        </div>
      </Reveal>
    </div>
  );
}
