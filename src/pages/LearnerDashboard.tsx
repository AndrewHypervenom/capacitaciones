import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  BookOpen,
  Compass,
  Globe,
  GraduationCap,
  Home,
  Lock,
  LogOut,
  Medal,
  MessageSquare,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useUserStore } from '@/stores/userStore';
import {
  useProgressStore,
  BADGE_DEFS,
  getXPLevel,
  getXPProgress,
} from '@/stores/progressStore';
import { useModules } from '@/hooks/useModules';
import { useLearnerCourses } from '@/hooks/useLearnerCourses';
import { useHasWorld } from '@/hooks/useHasWorld';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { signOut } from '@/services/auth.service';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { ViewSwitcher } from '@/components/layout/ViewSwitcher';
import { Avatar } from '@/components/ui/Avatar';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { Reveal } from '@/components/ui/Reveal';
import { cn } from '@/lib/cn';

const SECTION_IDS = ['inicio', 'cursos', 'recursos', 'logros'];

// Insignias ligadas a una función opcional (no universal): se ocultan como meta
// para quien no tiene esa función. `simulator-unlocked` solo aparece si ya se
// ganó; `world-explorer` aparece si el aprendiz tiene mundo (aunque siga bloqueada).
const CONDITIONAL_BADGE_IDS = new Set(['simulator-unlocked', 'world-explorer']);

// Todos ven este panel con su menú lateral. El staff que mira "como aprendiz"
// lo ve idéntico al aprendiz; para volver a gestión usa el ViewSwitcher que se
// inserta en el sidebar y en la barra móvil (invisible para los aprendices).
export default function LearnerDashboard() {
  // Asegurar que la página comience desde arriba al montar el componente
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const navigate = useNavigate();
  const { t } = useTranslation();
  const { name, language, reset } = useUserStore();
  const { modules: allModules, loading: modulesLoading } = useModules();
  const { courses } = useLearnerCourses();
  const { user, avatarUrl } = useAuth();

  // Universo de módulos que cuenta para certificación, simulador e insignias:
  // los módulos de los cursos asignados (a la persona o a su campaña), no los
  // del catálogo abierto. Todo módulo vive dentro de un curso tras la migración.
  // El panel principal solo muestra cursos asignados (a la campaña o al aprendiz).
  // Los cursos abiertos "para todo el mundo" no se mezclan aquí: se exploran en
  // /courses, para que el aprendiz no crea que debe hacer cursos que no son suyos.
  const dashboardCourses = useMemo(() => courses.filter((c) => c.isAssigned), [courses]);
  const assignedCourseIds = useMemo(
    () => new Set(dashboardCourses.map((c) => c.id)),
    [dashboardCourses],
  );
  // Mundos van ligados a cursos: solo hay "Mi Mundo" si alguno de sus cursos
  // asignados tiene un mundo publicado (no todos los cursos tienen mundo).
  const assignedCourseIdList = useMemo(() => [...assignedCourseIds], [assignedCourseIds]);
  const { hasWorld } = useHasWorld(assignedCourseIdList);
  const modules = useMemo(
    () => allModules.filter((m) => m.courseId && assignedCourseIds.has(m.courseId)),
    [allModules, assignedCourseIds],
  );
  const progressState = useProgressStore();
  const { xp, streak, badges } = progressState;
  const recheckBadges = useProgressStore((s) => s.recheckBadges);
  const awardBadge = useProgressStore((s) => s.awardBadge);

  useEffect(() => {
    if (!modulesLoading && modules.length > 0) {
      recheckBadges(modules);
    }
  }, [modulesLoading, modules, recheckBadges]);

  // Logro de mundo: se otorga (también retroactivamente) si el aprendiz ya
  // completó al menos un nivel en cualquier mundo. Solo consultamos si tiene
  // mundo y aún no lo ha ganado.
  useEffect(() => {
    if (!hasWorld || !user?.id || badges.includes('world-explorer')) return;
    let active = true;
    supabase
      .from('world_progress')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('completed', true)
      .then(({ count }) => {
        if (active && (count ?? 0) > 0) awardBadge('world-explorer');
      });
    return () => {
      active = false;
    };
  }, [hasWorld, user?.id, badges, awardBadge]);
  const xpLevel = getXPLevel(xp);
  const xpProgress = getXPProgress(xp);

  // Insignias condicionales: dependen de una función que no todos los aprendices
  // tienen. Se muestran si ya se ganaron o si su función está disponible para el
  // aprendiz (p. ej. el logro de mundo solo si tiene mundo).
  const badgeAvailable = useMemo<Record<string, boolean>>(
    () => ({ 'world-explorer': hasWorld }),
    [hasWorld],
  );
  const visibleBadges = useMemo(
    () =>
      BADGE_DEFS.filter(
        (b) =>
          !CONDITIONAL_BADGE_IDS.has(b.id) ||
          badges.includes(b.id) ||
          badgeAvailable[b.id],
      ),
    [badges, badgeAvailable],
  );

  const total = modules.length;
  // Only count completions for modules that actually exist right now
  const completedModules = progressState.completedModules.filter((id) =>
    modules.some((m) => m.id === id),
  );
  const done = completedModules.length;
  const progressPct = total > 0 ? Math.min(1, done / total) : 0;

  const remainingMinutes = modules
    .filter((m) => !completedModules.includes(m.id))
    .reduce((acc, m) => acc + m.duration, 0);
  const nextModule = modules.find((m) => !completedModules.includes(m.id));

  const sidebarItems = [
    { icon: Home, label: t('dashboard.sidebar_home'), id: 'inicio' },
    { icon: BookOpen, label: t('dashboard.sidebar_courses'), id: 'cursos' },
    { icon: Compass, label: t('dashboard.sidebar_resources'), id: 'recursos' },
    { icon: Medal, label: t('dashboard.sidebar_achievements'), id: 'logros' },
  ];

  // Scroll-spy: resalta en el sidebar la sección visible
  const [activeSection, setActiveSection] = useState('inicio');
  useEffect(() => {
    if (modulesLoading) return;
    const sections = SECTION_IDS
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          const topmost = visible.reduce((a, b) =>
            a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
          );
          setActiveSection(topmost.target.id);
        }
      },
      { rootMargin: '-15% 0px -65% 0px' },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [modulesLoading]);

  const handleLogout = async () => {
    reset();
    try { await signOut(); } catch { /* ignore */ }
    navigate('/login', { replace: true });
  };

  if (modulesLoading) {
    return (
      <div className="mx-auto max-w-5xl px-5 pt-12 pb-24">
        <div className="animate-pulse space-y-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-subtle" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Barra superior — solo en móvil/tablet, donde el sidebar no cabe */}
      <header className="lg:hidden sticky top-0 z-40 flex h-12 items-center justify-between border-b border-line bg-surface px-4">
        <a href="#inicio" className="flex items-center gap-2">
          <img src="/logo.jpg" alt={t('brand')} className="h-6 w-6 rounded-md" width={24} height={24} />
          <span className="text-[14px] font-semibold tracking-tight text-text">{t('brand')}</span>
        </a>
        <div className="flex items-center gap-2">
          {/* Solo staff: volver a gestión sin salir de la vista de aprendiz */}
          <ViewSwitcher variant="inline" />
          <Link to="/profile" aria-label={t('profile.title', 'Mi perfil')}>
            <Avatar src={avatarUrl} name={name} size={28} />
          </Link>
          <LanguageSwitcher />
          <ThemeToggle />
          <button
            onClick={handleLogout}
            aria-label={t('nav.logout')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-subtle hover:text-text"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Sidebar de navegación (estilo panel) */}
      <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 z-30 w-64 flex-col border-r border-line bg-surface">
        {/* Marca */}
        <a href="#inicio" className="flex items-center gap-2.5 px-6 pt-6 pb-5">
          <img src="/logo.jpg" alt={t('brand')} className="h-8 w-8 rounded-lg" width={32} height={32} />
          <span className="text-[16px] font-bold tracking-tight text-text">{t('brand')}</span>
        </a>

        {/* Cambio de vista (solo staff): arriba, para volver a gestión al instante */}
        <ViewSwitcher variant="block" className="px-4 pb-4" />

        {/* Navegación por secciones */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
          {sidebarItems.map(({ icon: Icon, label, id }) => {
            const active = activeSection === id;
            return (
              <a
                key={id}
                href={`#${id}`}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-full px-4 py-2.5 text-[13px] font-medium transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-text-muted hover:bg-subtle hover:text-text',
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-text-subtle')} />
                {label}
              </a>
            );
          })}

          {/* Retroalimentación del capacitador: página propia (no una sección) */}
          <Link
            to="/feedback"
            className="flex items-center gap-3 rounded-full px-4 py-2.5 text-[13px] font-medium text-text-muted transition-colors hover:bg-subtle hover:text-text"
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-text-subtle" />
            {t('nav.feedback', 'Retroalimentación')}
          </Link>
        </nav>

        {/* Pie del sidebar: usuario, idioma, tema y salida */}
        <div className="border-t border-line px-4 py-4">
          <Link
            to="/profile"
            className="mb-3 flex items-center gap-3 rounded-2xl px-1 py-1 transition-colors hover:bg-subtle"
            title={t('profile.title', 'Mi perfil')}
          >
            <Avatar src={avatarUrl} name={name} size={36} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-text">{name}</p>
              <p className="text-[11px] text-text-subtle">Nv. {xpLevel.level} · {xpLevel.label}</p>
            </div>
          </Link>
          <div className="mb-3 flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-[13px] font-medium text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {t('nav.logout')}
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <main className="mx-auto max-w-6xl px-4 sm:px-8 pt-10 sm:pt-14 pb-24 overflow-x-hidden">

          {/* Hero + estado del aprendizaje */}
          <Reveal as="section" className="mb-16 md:mb-20 scroll-mt-16" id="inicio">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
              <div className="max-w-2xl">
                <p className="text-[14px] text-text-muted mb-2">
                  {t('dashboard.greeting', { name })}
                </p>
                <h1 className="text-[34px] leading-[1.08] sm:text-5xl font-extrabold tracking-tight text-text mb-5 text-balance">
                  {t('dashboard.panel_headline')}
                </h1>
                <p className="text-[16px] sm:text-[17px] text-text-muted leading-relaxed">
                  {t('dashboard.panel_subheadline', { done, total })}
                </p>
                {nextModule && (
                  <Link
                    to={`/modules/${nextModule.id}`}
                    className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-[14px] font-semibold text-on-primary shadow-sm transition-all hover:opacity-90 hover:shadow-md"
                  >
                    {t('dashboard.module_continue')}: {nextModule.title[language]} →
                  </Link>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-6 rounded-3xl border border-line bg-surface p-6 sm:p-8 shadow-sm">
                <ProgressRing value={progressPct} size={104} stroke={11} showLabel color="rgb(var(--primary))" />
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-text-subtle mb-1">
                    {t('dashboard.panel_progress_label')}
                  </div>
                  <div className="text-[19px] font-bold tabular-nums text-text">
                    {t('dashboard.progress_full', {
                      done,
                      total,
                      pct: Math.round(progressPct * 100),
                    })}
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

          {/* Cursos — navegación principal: Campaña → Curso → Módulo */}
          <section id="cursos" className="mb-16 md:mb-20 scroll-mt-16">
            <Reveal className="mb-8">
              <h2 className="text-2xl font-semibold tracking-tight text-text mb-1">
                <Link
                  to="/courses"
                  className="inline-flex items-center gap-1.5 hover:text-primary transition-colors"
                >
                  {t('dashboard.courses_title')}
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </h2>
              <p className="text-[15px] text-text-muted">
                {t('dashboard.courses_subtitle')}
              </p>
            </Reveal>

            {dashboardCourses.length === 0 && (
              <div className="mb-5 rounded-3xl border border-line bg-surface p-8 text-center text-[14px] text-text-muted">
                {t('dashboard.courses_empty')}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {dashboardCourses.length > 0 &&
                [...dashboardCourses]
                  .sort((a, b) => {
                    if (a.isMandatory !== b.isMandatory) return a.isMandatory ? -1 : 1;
                    return 0;
                  })
                  .map((course, idx) => {
                    const courseTotal = course.modules.length;
                    const courseDone = course.modules.filter((m) =>
                      progressState.completedModules.includes(m.slug),
                    ).length;
                    const coursePct = courseTotal > 0 ? courseDone / courseTotal : 0;
                    const courseTitle =
                      language === 'en'
                        ? course.title_en || course.title_es
                        : language === 'pt'
                          ? course.title_pt || course.title_es
                          : course.title_es;
                    return (
                      <Reveal key={course.id} delay={idx * 60}>
                        <Link
                          to={`/courses/${course.slug}`}
                          className="flex h-full flex-col justify-between rounded-3xl border border-line bg-surface p-6 transition-all duration-300 hover:border-primary hover:shadow-card-hover"
                        >
                          <div className="mb-5">
                            <div className="mb-4 flex items-center justify-between">
                              <div
                                className="flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm"
                                style={{ background: course.color }}
                              >
                                <GraduationCap className="h-5 w-5" />
                              </div>
                              {course.isMandatory && (
                                <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">
                                  {t('courses.mandatory')}
                                </span>
                              )}
                            </div>
                            <h3 className="text-[17px] font-semibold tracking-tight text-text mb-1">
                              {courseTitle}
                            </h3>
                            <p className="text-[13px] text-text-muted">
                              {t('courses.modules_count', { n: courseTotal })}
                            </p>
                          </div>
                          <div>
                            <div className="mb-1.5 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
                              <div
                                className="h-full rounded-full transition-[width] duration-700"
                                style={{ background: course.color, width: `${Math.round(coursePct * 100)}%` }}
                              />
                            </div>
                            <span className="text-[11px] tabular-nums text-text-subtle">
                              {t('courses.progress', { done: courseDone, total: courseTotal })}
                            </span>
                          </div>
                        </Link>
                      </Reveal>
                    );
                  })}
              <Reveal delay={dashboardCourses.length * 60}>
                <Link
                  to="/courses"
                  className="group flex h-full flex-col justify-center gap-3 rounded-3xl border border-dashed border-line bg-surface/60 p-6 text-center transition-all duration-300 hover:border-primary hover:bg-surface"
                >
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Compass className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold tracking-tight text-text">
                      {t('dashboard.explore_cta_title')}
                    </p>
                    <p className="mt-0.5 text-[13px] text-text-muted">
                      {t('dashboard.explore_cta_subtitle')}
                    </p>
                  </div>
                  <span className="inline-flex items-center justify-center gap-1 text-[13px] font-semibold text-primary">
                    {t('dashboard.courses_title')}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </Reveal>
            </div>
          </section>

          {/* Recursos Complementarios */}
          <section id="recursos" className="mb-16 md:mb-20 scroll-mt-16">
            <Reveal className="mb-8">
              <h2 className="text-2xl font-semibold tracking-tight text-text mb-1">
                {t('dashboard.resources_title')}
              </h2>
              <p className="text-[15px] text-text-muted">
                {t('dashboard.resources_subtitle')}
              </p>
            </Reveal>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Reveal>
                <Link
                  to="/quiz"
                  className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 transition-all hover:border-primary hover:shadow-card-hover"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-subtle text-text-muted">
                    <Zap className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                      {t('dashboard.quiz_tag')}
                    </p>
                    <h4 className="text-[15px] font-semibold text-text truncate">
                      {t('dashboard.quiz_title')}
                    </h4>
                    <p className="text-[13px] text-text-muted truncate">
                      {t('dashboard.quiz_subtitle')}
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] font-medium text-text-muted">
                    {t('dashboard.quiz_join')} →
                  </span>
                </Link>
              </Reveal>

              {hasWorld && (
                <Reveal delay={60}>
                  <button
                    type="button"
                    onClick={() => navigate('/world')}
                    className="flex w-full items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left transition-all hover:border-primary hover:shadow-card-hover"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-subtle text-text-muted">
                      <Globe className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                        Mapa
                      </p>
                      <h4 className="text-[15px] font-semibold text-text truncate">
                        Mi Mundo
                      </h4>
                      <p className="text-[13px] text-text-muted truncate">
                        Explora tu mapa de capacitación y completa niveles
                      </p>
                    </div>
                    <span className="shrink-0 text-[13px] font-medium text-text-muted">
                      Explorar →
                    </span>
                  </button>
                </Reveal>
              )}
            </div>
          </section>

          {/* Insignias y logros */}
          <Reveal as="section" className="mb-16 md:mb-20 scroll-mt-16" id="logros">
            <div className="mb-8 flex items-end justify-between">
              <h2 className="text-2xl font-semibold tracking-tight text-text">
                {t('dashboard.badges_title')}
              </h2>
              <span className="text-[12px] tabular-nums text-text-subtle">
                {t('dashboard.badges_unlocked', { n: badges.length, total: visibleBadges.length })}
              </span>
            </div>

            {/* Experiencia y racha */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
              <div className="md:col-span-2 rounded-3xl border border-line bg-surface p-6">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                    Experiencia
                    <span
                      className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold normal-case tracking-normal"
                      style={{ background: `${xpLevel.color}18`, color: xpLevel.color }}
                    >
                      Nv. {xpLevel.level} · {xpLevel.label}
                    </span>
                  </span>
                  <span className="text-[13px] font-bold tabular-nums text-text">
                    {xp.toLocaleString()} XP
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-subtle mb-2">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: `linear-gradient(90deg, ${xpLevel.color}, ${xpLevel.color}88)` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.round(xpProgress * 100)}%` }}
                    transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
                {xpLevel.level < 4 && (
                  <p className="text-[11px] tabular-nums text-text-subtle">
                    {xp} / {xpLevel.maxXP} XP para {
                      ['', 'Aprendiz', 'Experto', 'Maestro'][xpLevel.level] ?? 'Maestro'
                    }
                  </p>
                )}
              </div>

              <div className="flex items-center gap-4 rounded-3xl border border-line bg-surface p-6">
                <div className={cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl',
                  streak > 0 ? 'bg-orange-500/10' : 'bg-subtle',
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
                  <div className="text-[26px] font-bold leading-none tabular-nums text-text">
                    {streak}
                  </div>
                  <div className="mt-0.5 text-[11px] text-text-subtle">
                    {streak === 1 ? t('dashboard.streak_one') : streak > 1 ? t('dashboard.streak_other') : t('dashboard.streak_start')}
                  </div>
                </div>
              </div>
            </div>

            {/* Grilla de insignias */}
            <div className="grid grid-cols-4 md:grid-cols-7 gap-3">
              {visibleBadges.map((badge) => {
                const earned = badges.includes(badge.id);
                return (
                  <div
                    key={badge.id}
                    title={badge.description}
                    className={cn(
                      'flex flex-col items-center gap-2 cursor-default',
                      !earned && 'opacity-40',
                    )}
                  >
                    <div className={cn(
                      'flex aspect-square w-full items-center justify-center rounded-2xl border text-2xl',
                      earned
                        ? 'border-primary/25 bg-primary/10'
                        : 'border-line bg-subtle text-text-subtle',
                    )}>
                      {earned ? badge.emoji : <Lock className="h-5 w-5" />}
                    </div>
                    <p className="w-full truncate text-center text-[10px] font-medium text-text-muted">
                      {badge.label}
                    </p>
                  </div>
                );
              })}
            </div>
          </Reveal>

          {/* Estadísticas de pie de página */}
          <Reveal>
            <div className="mb-6 h-px w-full bg-line" />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-text-muted">
              {remainingMinutes > 0 && (
                <span>{t('dashboard.footer_minutes', { n: remainingMinutes })}</span>
              )}
              {nextModule && (
                <>
                  {remainingMinutes > 0 && <span className="text-text-subtle">·</span>}
                  <span>{t('dashboard.footer_next', { title: nextModule.title[language] })}</span>
                </>
              )}
            </div>
          </Reveal>
        </main>
      </div>
    </div>
  );
}
