import { useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  PhoneCall,
  Clock,
  ChevronRight,
  BookOpen,
  X,
} from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import { useModules } from '@/hooks/useModules';
import {
  useProgressStore,
  SIMULATOR_UNLOCK_THRESHOLD,
  BADGE_DEFS,
} from '@/stores/progressStore';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Reveal } from '@/components/ui/Reveal';
import { GlassCard } from '@/components/ui/GlassCard';
import { GradientHeading } from '@/components/ui/GradientHeading';
import { NeonBadge } from '@/components/ui/NeonBadge';
import { KnowledgeCheck } from '@/components/modules/KnowledgeCheck';
import { Callout } from '@/components/modules/Callout';
import { ReadingProgressBar } from '@/components/modules/ReadingProgressBar';
import { ModuleTOC } from '@/components/modules/ModuleTOC';
import { SectionLayout } from '@/components/modules/SectionLayout';
import { InteractiveVideoModule } from '@/components/modules/InteractiveVideoModule';
import { cn } from '@/lib/cn';
import type { SectionMedia } from '@/data/modules';
import { ModulePageSkeleton } from '@/components/ui/Skeleton';
import { BlockRenderer } from '@/components/modules/blocks/BlockRenderer';
import { toast } from '@/stores/toastStore';

// ─── Media size/align helpers ──────────────────────────────────

function getMediaClasses(media: SectionMedia) {
  const sizeMap: Record<string, string> = {
    sm: 'max-w-xs',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    full: 'w-full',
    bleed: 'w-full',
  };
  const alignMap: Record<string, string> = {
    left: 'mr-auto',
    center: 'mx-auto',
    right: 'ml-auto',
  };
  const size = media.size ?? 'full';
  const align = media.align ?? 'center';
  const isBleed = size === 'bleed';
  return cn(
    sizeMap[size] ?? 'w-full',
    size !== 'full' && !isBleed ? alignMap[align] ?? 'mx-auto' : '',
  );
}

// ─── Media block ───────────────────────────────────────────────

function MediaBlock({ media, language }: { media: SectionMedia; language: string }) {
  const wrapperCls = cn(
    'rounded-2xl overflow-hidden border border-line',
    getMediaClasses(media),
    media.shadow && 'shadow-2xl shadow-black/12 ring-1 ring-black/5',
  );
  return (
    <figure className={wrapperCls}>
      {media.type === 'image' && (
        <img
          src={media.url}
          alt={media.caption?.[language as 'es' | 'en' | 'pt'] ?? ''}
          loading="lazy"
          className="w-full object-cover block"
        />
      )}
      {media.type === 'youtube' && (
        <div className="relative w-full bg-black" style={{ paddingTop: '56.25%' }}>
          <iframe
            src={`https://www.youtube.com/embed/${media.url}?rel=0&modestbranding=1`}
            title={media.caption?.[language as 'es' | 'en' | 'pt'] ?? 'Video'}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 w-full h-full border-0"
          />
        </div>
      )}
      {media.type === 'video' && (
        <video
          src={media.url}
          controls
          preload="metadata"
          className="w-full block bg-black"
        />
      )}
      {media.caption?.[language as 'es' | 'en' | 'pt'] && (
        <figcaption className="px-5 py-3 text-[12.5px] text-text-subtle border-t border-line bg-subtle">
          {media.caption[language as 'es' | 'en' | 'pt']}
        </figcaption>
      )}
    </figure>
  );
}

// ─── Hero section (style='hero') ──────────────────────────────

function HeroSectionContent({
  children,
  imageSrc,
}: {
  children: React.ReactNode;
  imageSrc?: string;
}) {
  return (
    <>
      {imageSrc && (
        <>
          <div
            className="absolute inset-0 z-0"
            style={{ backgroundImage: `url(${imageSrc})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          />
          <div
            className="absolute inset-0 z-0"
            style={{
              background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(5,5,15,0.5) 40%, rgba(0,194,40,0.04) 100%)',
            }}
          />
        </>
      )}
      <div className={cn('relative z-10 w-full p-8 md:p-12', imageSrc && 'text-white')}>
        {children}
      </div>
    </>
  );
}

// ─── Page ──────────────────────────────────────────────────────

export default function ModulePage() {
  const { id } = useParams<{ id: string }>();
  useLayoutEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [id]);

  const { t } = useTranslation();
  const nav = useNavigate();
  const language = useUserStore((s) => s.language);
  const { completedModules, markModule, earnXP, updateStreak } = useProgressStore();
  const { modules, loading } = useModules();

  const module = useMemo(() => modules.find((m) => m.id === id), [id, modules]);
  const moduleIndex = useMemo(() => modules.findIndex((m) => m.id === id), [id, modules]);
  const nextModule = moduleIndex >= 0 ? modules[moduleIndex + 1] : undefined;
  const completed = module ? completedModules.includes(module.id) : false;
  const [justUnlockedSimulator, setJustUnlockedSimulator] = useState(false);
  const [readingMode, setReadingMode] = useState(false);

  const totalQuizzes = useMemo(
    () => (module?.sections ?? []).filter((s) => !!s.quiz).length,
    [module],
  );
  const quizIndexMap = useMemo(() => {
    let count = 0;
    return (module?.sections ?? []).map((s) => (s.quiz ? count++ : -1));
  }, [module]);

  if (loading) return <ModulePageSkeleton />;

  if (!module) {
    return (
      <div className="mx-auto max-w-3xl px-5 pt-20 text-center">
        <p className="text-text-muted">Módulo no encontrado.</p>
        <Link to="/dashboard" className="text-brand-green mt-4 inline-block">
          ← Volver al panel
        </Link>
      </div>
    );
  }

  const handleComplete = () => {
    const wasUnlocked = completedModules.length >= SIMULATOR_UNLOCK_THRESHOLD;

    // XP + streak
    earnXP(100);
    updateStreak();

    // Award badges and get newly unlocked ones
    const newBadges = markModule(module.id, modules.length);

    toast.success(`¡${module.title[language]} completado! +100 XP`);

    // Fire badge toasts with stagger
    newBadges.forEach((badgeId, i) => {
      const def = BADGE_DEFS.find((b) => b.id === badgeId);
      if (def) {
        setTimeout(() => toast.badge(`${def.emoji} ${def.label} desbloqueado`), 900 + i * 700);
      }
    });

    const newCount = completedModules.length + 1;
    const nowUnlocked = newCount >= SIMULATOR_UNLOCK_THRESHOLD;
    if (!wasUnlocked && nowUnlocked) {
      setJustUnlockedSimulator(true);
      return;
    }
    if (nextModule) {
      setTimeout(() => nav(`/modules/${nextModule.id}`), 600);
    }
  };

  return (
    <>
      <ReadingProgressBar />

      {/* ── Hero Header ─────────────────────────────────────── */}
      <div className="relative overflow-hidden">
        {/* Mesh gradient — 3 blobs */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute top-0 right-0 h-96 w-96 rounded-full bg-neon-green/6 blur-[80px]" />
          <div className="absolute bottom-0 left-1/3 h-64 w-80 rounded-full bg-neon-violet/5 blur-[60px]" />
          <div className="absolute top-1/2 left-0 h-48 w-64 rounded-full bg-neon-violet/3 blur-[80px]" />
        </div>

        <div className="relative mx-auto max-w-5xl px-5 pt-10 pb-14">
          <div className="flex items-center justify-between mb-10">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> {t('module.back')}
            </Link>
            <button
              onClick={() => setReadingMode((v) => !v)}
              title={readingMode ? 'Salir de modo lectura' : 'Modo lectura sin distracciones'}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium transition-all duration-200',
                readingMode
                  ? 'bg-neon-green/10 border border-neon-green/20 text-neon-green'
                  : 'glass border border-glass-border/10 text-text-muted hover:text-text',
              )}
            >
              {readingMode ? <X className="h-3.5 w-3.5" /> : <BookOpen className="h-3.5 w-3.5" />}
              {readingMode ? 'Salir' : 'Lectura'}
            </button>
          </div>

          {/* Module index + meta */}
          <Reveal>
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <NeonBadge color="neutral">
                {t('module.of_modules', { idx: moduleIndex + 1, total: modules.length })}
              </NeonBadge>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-text-muted">
                <Clock className="h-3.5 w-3.5" />
                {t('module.duration', { min: module.duration })}
              </span>
              {completed && (
                <NeonBadge color="green">
                  <Check className="h-3 w-3" strokeWidth={3} />
                  {t('module.marked_complete')}
                </NeonBadge>
              )}
            </div>

            {/* Title */}
            <GradientHeading as="h1" variant="white" size="display-lg" className="mb-5 text-balance">
              {module.title[language]}
            </GradientHeading>

            <p className="text-[17px] text-text-muted leading-relaxed max-w-2xl mb-10">
              {module.subtitle[language]}
            </p>
          </Reveal>

          {/* Objectives grid */}
          {module.objectives[language].length > 0 && (
            <Reveal delay={80}>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                {module.objectives[language].map((o, i) => (
                  <GlassCard
                    key={i}
                    intensity="subtle"
                    interactive
                    padding="sm"
                    rounded="2xl"
                    className="flex items-start gap-3"
                  >
                    <span className="mt-0.5 h-5 w-5 rounded-full bg-glass-border/10 text-text-muted flex items-center justify-center text-[10px] font-bold shrink-0 ring-1 ring-glass-border/8">
                      {i + 1}
                    </span>
                    <span className="text-[13px] text-text leading-snug">{o}</span>
                  </GlassCard>
                ))}
              </div>
            </Reveal>
          )}
        </div>
      </div>

      {/* Section count hint */}
      <div className="mx-auto max-w-5xl px-5">
        <div className="flex items-center gap-4 mb-10">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent to-glass-border/15" />
          <span className="text-[11px] text-text-subtle uppercase tracking-wider font-medium">
            {module.sections.length} {module.sections.length === 1 ? 'sección' : 'secciones'}
            {totalQuizzes > 0 && ` · ${totalQuizzes} verificación${totalQuizzes > 1 ? 'es' : ''}`}
          </span>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent to-glass-border/15" />
        </div>
      </div>

      {/* ── Video Interactive sections (full-width, before normal content) ── */}
      {module.sections.some((s) => s.style === 'video-interactive') && (
        <div className="mx-auto max-w-6xl px-5 pb-8 space-y-8">
          {module.sections.map((s, i) => {
            if (s.style !== 'video-interactive') return null;
            return (
              <div key={i} id={`section-${i}`}>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-text-subtle mb-3">
                  {s.heading[language]}
                </p>
                <InteractiveVideoModule section={s} language={language} />
              </div>
            );
          })}
        </div>
      )}

      {/* ── Content ─────────────────────────────────────────── */}
      {module.sections.some((s) => s.style !== 'video-interactive') && (
      <div className={cn(
        'mx-auto px-5 pb-28 transition-all duration-500',
        readingMode ? 'max-w-2xl' : 'max-w-5xl',
      )}>
        <div className={cn(
          readingMode ? 'block' : 'grid md:grid-cols-[200px_1fr] gap-12',
        )}>
          {!readingMode && (
            <ModuleTOC
              sections={module.sections}
              language={language}
              sectionPrefix="section"
            />
          )}

          <article className={cn(
            'space-y-20 min-w-0',
            readingMode && 'text-[18px] leading-[1.9]',
          )}>
            {module.sections.map((s, i) => {
              if (s.style === 'video-interactive') return null;
              const isSideBySide = s.style === 'side-by-side' && !!s.media;
              const isHero = s.style === 'hero';
              const isFeature = s.style === 'feature';
              const quizIdx = quizIndexMap[i];

              const sectionLabel = (
                <div className={cn(
                  'text-[10.5px] uppercase tracking-widest font-semibold mb-4 tabular-nums',
                  isHero ? 'text-white/60' : 'text-text-subtle',
                )}>
                  {String(i + 1).padStart(2, '0')} — {String(module.sections.length).padStart(2, '0')}
                </div>
              );

              const heading = (
                <h2 className={cn(
                  'font-bold tracking-[-0.03em] leading-tight mb-5',
                  isHero ? 'text-white text-[clamp(1.8rem,3vw+0.5rem,2.8rem)]' : 'text-[clamp(1.6rem,2.5vw+0.5rem,2.2rem)]',
                  isFeature && 'text-center',
                )}>
                  {s.heading[language]}
                </h2>
              );

              const body = s.blocks && s.blocks.length > 0 ? (
                <div>
                  {s.blocks.map((block, j) => (
                    <BlockRenderer
                      key={j}
                      block={block}
                      language={language}
                      moduleId={module.id}
                      blockIndex={j}
                    />
                  ))}
                </div>
              ) : (
                <div className={cn(
                  'stagger-p space-y-5 text-[16px] leading-[1.8] max-w-[68ch]',
                  isHero ? 'text-white/85' : 'text-text/92',
                  isFeature && 'mx-auto text-center text-text-muted',
                )}>
                  {s.body[language].map((p, j) => (
                    <p key={j}>{p}</p>
                  ))}
                </div>
              );

              const callout = s.callout ? (
                <Callout
                  kind={s.callout.kind}
                  text={s.callout.text[language]}
                />
              ) : null;

              const quiz = s.quiz ? (
                <KnowledgeCheck
                  moduleId={module.id}
                  sectionIdx={i}
                  quiz={s.quiz}
                  language={language}
                  quizIndex={quizIdx >= 0 ? quizIdx : undefined}
                  totalQuizzes={totalQuizzes}
                />
              ) : null;

              // Hero style: image as background
              if (isHero) {
                return (
                  <Reveal
                    as="section"
                    key={i}
                    delay={Math.min(i * 60, 200)}
                  >
                    <div id={`section-${i}`} className="scroll-mt-28">
                      <SectionLayout style="hero" hasMedia={!!s.media}>
                        <HeroSectionContent imageSrc={s.media?.type === 'image' ? s.media.url : undefined}>
                          {sectionLabel}
                          {heading}
                          {body}
                          {s.media?.type !== 'image' && s.media && (
                            <div className="mt-8">
                              <MediaBlock media={s.media} language={language} />
                            </div>
                          )}
                        </HeroSectionContent>
                      </SectionLayout>
                      {callout}
                      {quiz}
                    </div>
                  </Reveal>
                );
              }

              // Side-by-side
              if (isSideBySide) {
                return (
                  <Reveal
                    as="section"
                    key={i}
                    delay={Math.min(i * 60, 200)}
                  >
                    <div id={`section-${i}`} className="scroll-mt-28">
                      {sectionLabel}
                      <SectionLayout style="side-by-side" hasMedia>
                        <div>
                          {heading}
                          {body}
                        </div>
                        <MediaBlock media={s.media!} language={language} />
                      </SectionLayout>
                      {callout}
                      {quiz}
                    </div>
                  </Reveal>
                );
              }

              // All other styles (default, immersive, spotlight, feature)
              return (
                <Reveal
                  as="section"
                  key={i}
                  delay={Math.min(i * 60, 200)}
                >
                  <div id={`section-${i}`} className="scroll-mt-28">
                    <SectionLayout style={s.style ?? 'default'} hasMedia={!!s.media}>
                      {sectionLabel}
                      {heading}
                      {body}
                      {s.media && (
                        <div className="mt-8">
                          <MediaBlock media={s.media} language={language} />
                        </div>
                      )}
                      {callout}
                      {quiz}
                    </SectionLayout>
                  </div>
                </Reveal>
              );
            })}

            {/* Key takeaways */}
            <Reveal>
              <GlassCard intensity="default" glow="green" rounded="3xl" className="overflow-hidden">
                {/* Gradiente top */}
                <div className="h-px w-full bg-gradient-to-r from-neon-green via-neon-green/30 to-transparent" />
                <div className="p-7 md:p-8">
                  <div className="flex items-center gap-2.5 mb-6">
                    <div className="h-8 w-8 rounded-xl bg-neon-green/8 flex items-center justify-center ring-1 ring-neon-green/14">
                      <Check className="h-4 w-4 text-neon-green" strokeWidth={2.5} />
                    </div>
                    <span className="text-[11px] uppercase tracking-wider text-text-subtle font-semibold">
                      {t('module.key_takeaways')}
                    </span>
                  </div>
                  <ul className="space-y-4">
                    {module.keyTakeaways[language].map((k, i) => (
                      <li key={i} className="flex items-start gap-3.5 text-[15.5px] leading-relaxed">
                        <span className="mt-1.5 inline-block h-2 w-2 rounded-full bg-neon-green shrink-0" />
                        <span>{k}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </GlassCard>
            </Reveal>

            {/* Simulator unlock or navigation */}
            {justUnlockedSimulator ? (
              <Reveal>
                <GlassCard intensity="strong" glow="green" shimmer rounded="3xl">
                  <div className="p-7 md:p-8 flex flex-col md:flex-row md:items-center gap-5">
                    <div className="shrink-0 inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-neon-green/90 text-black ring-1 ring-neon-green/20">
                      <PhoneCall className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <NeonBadge color="green" dot className="mb-2">
                        {t('module.unlock_banner_title')}
                      </NeonBadge>
                      <p className="text-[15.5px] text-text leading-relaxed">
                        {t('dashboard.simulator_card_subtitle_unlocked')}
                      </p>
                    </div>
                    <Button variant="neon" onClick={() => nav('/simulator')} size="md" className="shrink-0">
                      {t('module.unlock_banner_cta')}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </GlassCard>
              </Reveal>
            ) : (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-2">
                <div className="text-text-subtle text-[13px]">
                  {completed ? (
                    <span className="flex items-center gap-1.5 text-neon-green">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      {t('module.marked_complete')}
                    </span>
                  ) : '—'}
                </div>
                <div className="flex gap-3">
                  {!completed && (
                    <Button variant="neon" size="md" onClick={handleComplete}>
                      <Check className="h-4 w-4" strokeWidth={3} />
                      {t('module.mark_complete')}
                    </Button>
                  )}
                  {nextModule && (
                    <Button
                      variant={completed ? 'neon' : 'glass'}
                      size="md"
                      onClick={() => nav(`/modules/${nextModule.id}`)}
                    >
                      {t('module.next')}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </article>
        </div>
      </div>
      )}
    </>
  );
}
