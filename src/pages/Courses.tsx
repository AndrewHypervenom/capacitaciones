import { useMemo, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, BookOpen, Clock, Compass, GraduationCap, Loader2, Plus, Search, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useUserStore } from '@/stores/userStore';
import { useProgressStore } from '@/stores/progressStore';
import { useLearnerCourses, invalidateLearnerCoursesCache } from '@/hooks/useLearnerCourses';
import { selfEnroll, type LearnerCourse } from '@/services/courses.service';
import { toast } from '@/stores/toastStore';
import { Reveal } from '@/components/ui/Reveal';
import { cn } from '@/lib/cn';

type Filter = 'all' | 'mandatory' | 'optional' | 'in_progress' | 'completed';

const MotionLink = motion(Link);

function pickText(es: string | null, en: string | null, pt: string | null, lang: string): string {
  if (lang === 'en') return en || es || '';
  if (lang === 'pt') return pt || es || '';
  return es || '';
}

export function courseProgress(course: LearnerCourse, completedSlugs: string[]) {
  const total = course.modules.length;
  const done = course.modules.filter((m) => completedSlugs.includes(m.slug)).length;
  return { total, done, pct: total > 0 ? done / total : 0 };
}

function CourseCard({
  course,
  index,
  onEnrolled,
}: {
  course: LearnerCourse;
  index: number;
  onEnrolled?: () => void;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const language = useUserStore((s) => s.language);
  const completedSlugs = useProgressStore((s) => s.completedModules);
  const { total, done, pct } = courseProgress(course, completedSlugs);
  const totalMin = course.modules.reduce((acc, m) => acc + m.duration_min, 0);
  const completed = total > 0 && done === total;
  const [enrolling, setEnrolling] = useState(false);

  const handleEnroll = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEnrolling(true);
    try {
      await selfEnroll(course.id);
      invalidateLearnerCoursesCache();
      toast.success(t('courses.enrolled_ok'));
      onEnrolled?.();
    } catch {
      toast.error(t('courses.enroll_error'));
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <Reveal delay={Math.min(index * 60, 240)}>
      <MotionLink
        to={`/courses/${course.slug}`}
        state={{ from: 'courses' }}
        whileHover={reduce ? undefined : { y: -4 }}
        transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        className="group flex h-full flex-col overflow-hidden rounded-3xl border border-line bg-surface transition-[border-color,box-shadow] duration-300 hover:border-primary hover:shadow-card-hover"
      >
        {/* Portada */}
        <div
          className="relative h-28 w-full shrink-0 overflow-hidden"
          style={{
            background: course.cover_url
              ? course.cover_fit === 'contain'
                ? `linear-gradient(120deg, ${course.color}26, ${course.color}0A)`
                : undefined
              : `linear-gradient(120deg, ${course.color}40, ${course.color}0D)`,
          }}
        >
          {course.cover_url && (
            <img src={course.cover_url} alt={pickText(course.title_es, course.title_en, course.title_pt, language)} className={`h-full w-full transition-transform duration-500 ease-apple group-hover:scale-105 ${course.cover_fit === 'contain' ? 'object-contain' : 'object-cover'}`} loading="lazy" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" aria-hidden />
          <div
            className="absolute -bottom-5 left-5 flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-md"
            style={{ background: course.color }}
          >
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="absolute top-3 right-3 flex gap-1.5">
            {course.isMandatory && (
              <span className="rounded-full bg-danger/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                {t('courses.mandatory')}
              </span>
            )}
            {!course.isAssigned && (
              <span className="rounded-full bg-black/40 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
                {t('courses.catalog')}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col px-5 pt-8 pb-5">
          <h3 className="text-[17px] font-semibold tracking-tight text-text mb-1">
            {pickText(course.title_es, course.title_en, course.title_pt, language)}
          </h3>
          <p className="text-[13px] text-text-muted leading-relaxed line-clamp-2 mb-4">
            {pickText(course.description_es, course.description_en, course.description_pt, language)}
          </p>

          <div className="mt-auto">
            <div className="flex items-center gap-3 text-[12px] text-text-subtle mb-3">
              <span className="inline-flex items-center gap-1">
                <BookOpen className="h-3.5 w-3.5" />
                {t('courses.modules_count', { n: total })}
              </span>
              {totalMin > 0 && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {totalMin} min
                </span>
              )}
              <span className="ml-auto rounded-full bg-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                {t(`courses.level_${course.level}`)}
              </span>
            </div>

            {/* Progreso */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-subtle mb-2">
              <motion.div
                className="h-full rounded-full"
                style={{ background: course.color }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.round(pct * 100)}%` }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] tabular-nums text-text-subtle">
                {t('courses.progress', { done, total })}
              </span>
              {course.isAssigned ? (
                <span className={cn('text-[13px] font-semibold', completed ? 'text-primary' : 'text-text')}>
                  {completed
                    ? t('courses.cta_review')
                    : done > 0
                      ? t('courses.cta_continue')
                      : t('courses.cta_start')}{' '}
                  →
                </span>
              ) : (
                <button
                  onClick={handleEnroll}
                  disabled={enrolling}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-60"
                >
                  {enrolling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  {t('courses.enroll')}
                </button>
              )}
            </div>
          </div>
        </div>
      </MotionLink>
    </Reveal>
  );
}

export default function Courses() {
  const { t } = useTranslation();
  const language = useUserStore((s) => s.language);
  const completedSlugs = useProgressStore((s) => s.completedModules);
  const { courses, loading, reload } = useLearnerCourses();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return courses.filter((c) => {
      if (q) {
        const text = `${c.title_es} ${c.title_en ?? ''} ${c.title_pt ?? ''} ${c.description_es ?? ''} ${c.category ?? ''}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      const { total, done } = courseProgress(c, completedSlugs);
      switch (filter) {
        case 'mandatory':
          return c.isMandatory;
        case 'optional':
          return !c.isMandatory;
        case 'in_progress':
          return done > 0 && done < total;
        case 'completed':
          return total > 0 && done === total;
        default:
          return true;
      }
    });
  }, [courses, query, filter, completedSlugs]);

  const sortCourses = (list: LearnerCourse[]) =>
    [...list].sort((a, b) => {
      if (a.isMandatory !== b.isMandatory) return a.isMandatory ? -1 : 1;
      return pickText(a.title_es, a.title_en, a.title_pt, language).localeCompare(
        pickText(b.title_es, b.title_en, b.title_pt, language),
      );
    });

  const myCourses = sortCourses(filtered.filter((c) => c.isAssigned));
  const exploreCourses = sortCourses(filtered.filter((c) => !c.isAssigned));

  const mandatoryPending = courses.filter((c) => {
    if (!c.isMandatory) return false;
    const { total, done } = courseProgress(c, completedSlugs);
    return total === 0 || done < total;
  }).length;

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: t('courses.filter_all') },
    { id: 'mandatory', label: t('courses.filter_mandatory') },
    { id: 'optional', label: t('courses.filter_optional') },
    { id: 'in_progress', label: t('courses.filter_in_progress') },
    { id: 'completed', label: t('courses.filter_completed') },
  ];

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-5 pt-12 pb-24">
        <div className="animate-pulse space-y-6">
          <div className="h-10 w-64 rounded-2xl bg-subtle" />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-72 rounded-3xl bg-subtle" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-8 pt-10 sm:pt-14 pb-24">
      {/* Encabezado */}
      <Reveal className="mb-8">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text transition-colors mb-5"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('courses.back_to_home')}
        </Link>
        <h1 className="text-[30px] sm:text-4xl font-extrabold tracking-tight text-text mb-2">
          {t('courses.title')}
        </h1>
        <p className="text-[15px] sm:text-[16px] text-text-muted leading-relaxed max-w-2xl">
          {t('courses.subtitle')}
        </p>
        {mandatoryPending > 0 && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-danger/25 bg-danger/5 px-4 py-1.5 text-[13px] font-medium text-danger">
            <Sparkles className="h-3.5 w-3.5" />
            {t('courses.mandatory_pending', { n: mandatoryPending })}
          </div>
        )}
      </Reveal>

      {/* Búsqueda y filtros */}
      <Reveal className="mb-10 flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('courses.search_ph')}
            className="w-full rounded-full border border-line bg-surface pl-11 pr-4 py-2.5 text-[14px] text-text outline-none transition-colors focus:border-primary"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'shrink-0 rounded-full px-4 py-2 text-[13px] font-medium transition-colors',
                filter === f.id
                  ? 'bg-primary text-on-primary'
                  : 'border border-line text-text-muted hover:border-primary hover:text-text',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Reveal>

      {courses.length === 0 ? (
        <Reveal>
          <div className="rounded-3xl border border-line bg-surface p-10 text-center">
            <GraduationCap className="h-10 w-10 text-text-subtle mx-auto mb-3" />
            <h3 className="text-[17px] font-semibold text-text mb-1">{t('courses.empty_title')}</h3>
            <p className="text-[14px] text-text-muted">{t('courses.empty_subtitle')}</p>
          </div>
        </Reveal>
      ) : (
        <>
          {/* Mis cursos */}
          {myCourses.length > 0 && (
            <section className="mb-14">
              <Reveal className="mb-6">
                <h2 className="text-2xl font-semibold tracking-tight text-text mb-1">
                  {t('courses.my_courses')}
                </h2>
                <p className="text-[14px] text-text-muted">{t('courses.my_courses_subtitle')}</p>
              </Reveal>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {myCourses.map((c, i) => (
                  <CourseCard key={c.id} course={c} index={i} />
                ))}
              </div>
            </section>
          )}

          {/* Explorar catálogo */}
          {exploreCourses.length > 0 && (
            <section>
              <Reveal className="mb-6">
                <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-text mb-1">
                  <Compass className="h-5 w-5 text-primary" />
                  {t('courses.explore')}
                </h2>
                <p className="text-[14px] text-text-muted">{t('courses.explore_subtitle')}</p>
              </Reveal>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {exploreCourses.map((c, i) => (
                  <CourseCard key={c.id} course={c} index={i} onEnrolled={reload} />
                ))}
              </div>
            </section>
          )}

          {myCourses.length === 0 && exploreCourses.length === 0 && (
            <Reveal>
              <div className="rounded-3xl border border-line bg-surface p-10 text-center">
                <Search className="h-8 w-8 text-text-subtle mx-auto mb-3" />
                <p className="text-[14px] text-text-muted">{t('courses.no_results')}</p>
              </div>
            </Reveal>
          )}
        </>
      )}
    </div>
  );
}
