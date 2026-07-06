import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, BookOpen, Check, Clock, GraduationCap, Loader2, Lock, LogOut, Play, Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import { useUserStore } from '@/stores/userStore';
import { useProgressStore } from '@/stores/progressStore';
import { useLearnerCourses, invalidateLearnerCoursesCache } from '@/hooks/useLearnerCourses';
import { selfEnroll, unenrollSelf } from '@/services/courses.service';
import { toast } from '@/stores/toastStore';
import { Reveal } from '@/components/ui/Reveal';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { cn } from '@/lib/cn';

type ModuleStatus = 'completed' | 'available' | 'locked';

function pickText(es: string | null, en: string | null, pt: string | null, lang: string): string {
  if (lang === 'en') return en || es || '';
  if (lang === 'pt') return pt || es || '';
  return es || '';
}

export default function CoursePage() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const { t } = useTranslation();

  // Si llegaste desde la vista de cursos, volver ahí; si no, a la página principal.
  const fromCourses = (location.state as { from?: string } | null)?.from === 'courses';
  const backTo = fromCourses ? '/courses' : '/dashboard';
  const backLabel = fromCourses ? t('courses.back_to_courses') : t('courses.back_to_home');
  const language = useUserStore((s) => s.language);
  const completedSlugs = useProgressStore((s) => s.completedModules);
  const { courses, loading, reload } = useLearnerCourses();
  const [enrollBusy, setEnrollBusy] = useState(false);

  const course = useMemo(() => courses.find((c) => c.slug === slug), [courses, slug]);

  const handleEnroll = async () => {
    if (!course) return;
    setEnrollBusy(true);
    try {
      await selfEnroll(course.id);
      invalidateLearnerCoursesCache();
      toast.success(t('courses.enrolled_ok'));
      reload();
    } catch {
      toast.error(t('courses.enroll_error'));
    } finally {
      setEnrollBusy(false);
    }
  };

  const handleLeave = async () => {
    if (!course) return;
    setEnrollBusy(true);
    try {
      await unenrollSelf(course.id);
      invalidateLearnerCoursesCache();
      toast.success(t('courses.left_ok'));
      reload();
    } catch {
      toast.error(t('courses.enroll_error'));
    } finally {
      setEnrollBusy(false);
    }
  };

  const items = useMemo(() => {
    if (!course) return [];
    return course.modules.map((m, idx) => {
      let status: ModuleStatus;
      if (completedSlugs.includes(m.slug)) status = 'completed';
      else if (idx === 0 || completedSlugs.includes(course.modules[idx - 1].slug)) status = 'available';
      else status = 'locked';
      return { module: m, status };
    });
  }, [course, completedSlugs]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-5 pt-12 pb-24">
        <div className="animate-pulse space-y-5">
          <div className="h-44 rounded-3xl bg-subtle" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-subtle" />
          ))}
        </div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="mx-auto max-w-4xl px-5 pt-20 pb-24 text-center">
        <GraduationCap className="h-10 w-10 text-text-subtle mx-auto mb-3" />
        <h1 className="text-xl font-semibold text-text mb-2">{t('courses.not_found_title')}</h1>
        <p className="text-[14px] text-text-muted mb-6">{t('courses.not_found_subtitle')}</p>
        <Link
          to="/courses"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13px] font-semibold text-on-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('courses.back_to_courses')}
        </Link>
      </div>
    );
  }

  const total = course.modules.length;
  const done = course.modules.filter((m) => completedSlugs.includes(m.slug)).length;
  const pct = total > 0 ? done / total : 0;
  const totalMin = course.modules.reduce((acc, m) => acc + m.duration_min, 0);
  const nextItem = items.find((i) => i.status === 'available');
  const completed = total > 0 && done === total;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-8 pt-8 sm:pt-12 pb-24">
      <Reveal>
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text transition-colors mb-5"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </Link>
      </Reveal>

      {/* Hero */}
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl border border-line bg-surface mb-10">
          <div
            className="h-32 sm:h-40 w-full"
            style={{
              background: course.cover_url
                ? undefined
                : `linear-gradient(120deg, ${course.color}4D, ${course.color}14)`,
            }}
          >
            {course.cover_url && (
              <img src={course.cover_url} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="px-6 sm:px-8 pb-6 sm:pb-8">
            <div
              className="-mt-7 mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-md"
              style={{ background: course.color }}
            >
              <GraduationCap className="h-6 w-6" />
            </div>

            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
              <div className="max-w-xl">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {course.isMandatory ? (
                    <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">
                      {t('courses.mandatory')}
                    </span>
                  ) : course.isAssigned ? (
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                      {t('courses.assigned')}
                    </span>
                  ) : (
                    <span className="rounded-full bg-subtle px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-muted">
                      {t('courses.catalog')}
                    </span>
                  )}
                  <span className="rounded-full bg-subtle px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    {t(`courses.level_${course.level}`)}
                  </span>
                  {course.category && (
                    <span className="rounded-full bg-subtle px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                      {course.category}
                    </span>
                  )}
                </div>
                <h1 className="text-[26px] sm:text-3xl font-extrabold tracking-tight text-text mb-2">
                  {pickText(course.title_es, course.title_en, course.title_pt, language)}
                </h1>
                <p className="text-[14px] sm:text-[15px] text-text-muted leading-relaxed mb-4">
                  {pickText(course.description_es, course.description_en, course.description_pt, language)}
                </p>
                <div className="flex items-center gap-4 text-[13px] text-text-subtle">
                  <span className="inline-flex items-center gap-1.5">
                    <BookOpen className="h-4 w-4" />
                    {t('courses.modules_count', { n: total })}
                  </span>
                  {totalMin > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-4 w-4" />
                      {totalMin} min
                    </span>
                  )}
                </div>
                {nextItem && (
                  <Link
                    to={`/modules/${nextItem.module.slug}`}
                    className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-[14px] font-semibold text-on-primary shadow-sm transition-all hover:opacity-90 hover:shadow-md"
                  >
                    <Play className="h-4 w-4" />
                    {done > 0 ? t('courses.cta_continue') : t('courses.cta_start')}
                  </Link>
                )}
                {completed && (
                  <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-5 py-2.5 text-[13px] font-semibold text-primary">
                    <Check className="h-4 w-4" strokeWidth={3} />
                    {t('courses.completed_banner')}
                  </div>
                )}

                {/* Auto-inscripción en cursos del catálogo */}
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {!course.isAssigned && (
                    <button
                      onClick={handleEnroll}
                      disabled={enrollBusy}
                      className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-[14px] font-semibold text-on-primary shadow-sm transition-all hover:opacity-90 hover:shadow-md disabled:opacity-60"
                    >
                      {enrollBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      {t('courses.enroll')}
                    </button>
                  )}
                  {course.selfEnrolled && (
                    <button
                      onClick={handleLeave}
                      disabled={enrollBusy}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2.5 text-[13px] font-medium text-text-muted transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-60"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      {t('courses.leave')}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-5 rounded-3xl border border-line bg-bg p-5">
                <ProgressRing value={pct} size={88} stroke={10} showLabel color={course.color} />
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-text-subtle mb-1">
                    {t('courses.progress_label')}
                  </div>
                  <div className="text-[17px] font-bold tabular-nums text-text">
                    {t('courses.progress', { done, total })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Reveal>

      {/* Módulos */}
      <Reveal className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight text-text mb-1">
          {t('courses.content_title')}
        </h2>
        <p className="text-[14px] text-text-muted">{t('courses.content_subtitle')}</p>
      </Reveal>

      <div className="space-y-3">
        {items.length === 0 && (
          <div className="rounded-3xl border border-line bg-surface p-8 text-center text-[14px] text-text-muted">
            {t('courses.no_modules')}
          </div>
        )}
        {items.map(({ module, status }, idx) => {
          const interactive = status !== 'locked';
          const Wrapper: React.ElementType = interactive ? Link : 'div';
          const wrapperProps = interactive ? { to: `/modules/${module.slug}` } : {};
          return (
            <Reveal key={module.id} delay={Math.min(idx * 50, 250)}>
              <Wrapper
                {...wrapperProps}
                className={cn(
                  'flex items-center gap-4 rounded-2xl border bg-surface p-4 sm:p-5 transition-all duration-200',
                  status === 'available' && 'border-line hover:border-primary hover:shadow-card-hover cursor-pointer',
                  status === 'completed' && 'border-primary/25 hover:border-primary hover:shadow-card-hover cursor-pointer',
                  status === 'locked' && 'border-line opacity-55',
                )}
              >
                {/* Estado */}
                <div
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                    status === 'completed' && 'bg-primary/10 text-primary',
                    status === 'available' && 'text-white',
                    status === 'locked' && 'bg-subtle text-text-subtle',
                  )}
                  style={status === 'available' ? { background: course.color } : undefined}
                >
                  {status === 'completed' ? (
                    <Check className="h-5 w-5" strokeWidth={3} />
                  ) : status === 'locked' ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <span className="text-[14px] font-bold tabular-nums">{idx + 1}</span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold tracking-tight text-text truncate">
                    {pickText(module.title_es, module.title_en, module.title_pt, language)}
                  </h3>
                  <p className="text-[13px] text-text-muted truncate">
                    {status === 'locked'
                      ? t('courses.module_locked_hint')
                      : pickText(module.subtitle_es, module.subtitle_en, module.subtitle_pt, language)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <span className="hidden sm:inline text-[12px] tabular-nums text-text-subtle">
                    {module.duration_min} min
                  </span>
                  {status === 'completed' && (
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      {t('dashboard.status_completed')}
                    </span>
                  )}
                  {status === 'available' && (
                    <span className="rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-on-primary">
                      {completedSlugs.includes(module.slug) ? t('courses.cta_review') : t('courses.cta_start')}
                    </span>
                  )}
                </div>
              </Wrapper>
            </Reveal>
          );
        })}
      </div>

      {/* Barra de progreso al pie */}
      {total > 0 && (
        <Reveal className="mt-10">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="mb-2 flex items-center justify-between text-[12px] text-text-muted">
              <span>{t('courses.progress_label')}</span>
              <span className="tabular-nums font-semibold text-text">{Math.round(pct * 100)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-subtle">
              <motion.div
                className="h-full rounded-full"
                style={{ background: course.color }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.round(pct * 100)}%` }}
                transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
        </Reveal>
      )}
    </div>
  );
}
