import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Award,
  BookOpen,
  Check,
  Compass,
  FlaskConical,
  Globe,
  GraduationCap,
  Home,
  Lock,
  LogOut,
  Medal,
  PhoneCall,
  Zap,
} from 'lucide-react';
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
import { useLearnerCourses } from '@/hooks/useLearnerCourses';
import { signOut } from '@/services/auth.service';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { Reveal } from '@/components/ui/Reveal';
import { cn } from '@/lib/cn';

const SECTION_IDS = ['inicio', 'cursos', 'recursos', 'certificacion', 'logros', 'simulador'];

// `hideSidebar`: superadmin y capacitador reutilizan este diseño de panel pero
// sin el menú lateral de secciones; conservan su Navbar superior de staff.
export default function LearnerDashboard({ hideSidebar = false }: { hideSidebar?: boolean } = {}) {
  // Asegurar que la página comience desde arriba al montar el componente
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const navigate = useNavigate();
  const { t } = useTranslation();
  const { name, language, reset } = useUserStore();
  const { modules: allModules, loading: modulesLoading } = useModules();
  const { courses } = useLearnerCourses();

  // Universo de módulos que cuenta para certificación, simulador e insignias:
  // los módulos de los cursos asignados (a la persona o a su campaña), no los
  // del catálogo abierto. Todo módulo vive dentro de un curso tras la migración.
  const assignedCourseIds = useMemo(
    () => new Set(courses.filter((c) => c.isAssigned).map((c) => c.id)),
    [courses],
  );
  const modules = useMemo(
    () => allModules.filter((m) => m.courseId && assignedCourseIds.has(m.courseId)),
    [allModules, assignedCourseIds],
  );
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

  const sidebarItems = [
    { icon: Home, label: t('dashboard.sidebar_home'), id: 'inicio' },
    { icon: BookOpen, label: t('dashboard.sidebar_courses'), id: 'cursos' },
    { icon: Compass, label: t('dashboard.sidebar_resources'), id: 'recursos' },
    { icon: GraduationCap, label: t('dashboard.sidebar_cert'), id: 'certificacion' },
    { icon: Medal, label: t('dashboard.sidebar_achievements'), id: 'logros' },
    { icon: FlaskConical, label: t('dashboard.sidebar_lab'), id: 'simulador' },
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
      {!hideSidebar && (
      <header className="lg:hidden sticky top-0 z-40 flex h-12 items-center justify-between border-b border-line bg-surface px-4">
        <a href="#inicio" className="flex items-center gap-2">
          <img src="/logo.jpg" alt={t('brand')} className="h-6 w-6 rounded-md" width={24} height={24} />
          <span className="text-[14px] font-semibold tracking-tight text-text">{t('brand')}</span>
        </a>
        <div className="flex items-center gap-2">
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
      )}

      {/* Sidebar de navegación (estilo panel) */}
      {!hideSidebar && (
      <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 z-30 w-64 flex-col border-r border-line bg-surface">
        {/* Marca */}
        <a href="#inicio" className="flex items-center gap-2.5 px-6 pt-6 pb-5">
          <img src="/logo.jpg" alt={t('brand')} className="h-8 w-8 rounded-lg" width={32} height={32} />
          <span className="text-[16px] font-bold tracking-tight text-text">{t('brand')}</span>
        </a>

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
        </nav>

        {/* Pie del sidebar: usuario, idioma, tema y salida */}
        <div className="border-t border-line px-4 py-4">
          <div className="mb-3 flex items-center gap-3 px-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[14px] font-bold uppercase text-primary">
              {(name || '?').charAt(0)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-text">{name}</p>
              <p className="text-[11px] text-text-subtle">Nv. {xpLevel.level} · {xpLevel.label}</p>
            </div>
          </div>
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
      )}

      <div className={hideSidebar ? '' : 'lg:pl-64'}>
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

            {courses.length === 0 ? (
              <div className="rounded-3xl border border-line bg-surface p-8 text-center text-[14px] text-text-muted">
                {t('dashboard.courses_empty')}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {[...courses]
                  .sort((a, b) => {
                    if (a.isAssigned !== b.isAssigned) return a.isAssigned ? -1 : 1;
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
              </div>
            )}
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
            </div>
          </section>

          {/* Certificación */}
          <Reveal as="section" className="mb-16 md:mb-20 scroll-mt-16" id="certificacion">
            <div className="mb-8">
              <h2 className="text-2xl font-semibold tracking-tight text-text mb-1">
                {t('dashboard.cert_section_title')}
              </h2>
              <p className="text-[15px] text-text-muted">
                {t('dashboard.cert_section_subtitle')}
              </p>
            </div>

            {certificationEarned ? (
              <Link
                to="/certificate"
                className="flex items-center gap-5 rounded-3xl border border-primary/30 bg-surface p-6 md:p-8 transition-all hover:border-primary hover:shadow-card-hover"
              >
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-on-primary">
                  <Award className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-primary mb-1">
                    {t('dashboard.certificate_ready_title')}
                  </p>
                  <div className="text-[19px] font-semibold tracking-tight text-text">
                    {t('dashboard.certificate_ready_subtitle')}
                  </div>
                </div>
                <span className="shrink-0 text-[13px] font-medium text-text-muted">
                  {t('dashboard.certificate_cta')} →
                </span>
              </Link>
            ) : (
              <div className="rounded-3xl border border-line bg-surface p-6 md:p-8">
                <div className="space-y-6 mb-6">
                  {/* Requisito 1: módulos */}
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                      allModulesDone ? 'bg-primary/10 text-primary' : 'bg-subtle text-text-muted',
                    )}>
                      {allModulesDone
                        ? <Check className="h-4 w-4" strokeWidth={3} />
                        : <span className="text-[13px] font-bold">1</span>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-text mb-1.5">
                        {t('dashboard.cert_req_modules')}
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-subtle">
                        <motion.div
                          className="h-full rounded-full bg-primary"
                          initial={{ width: 0 }}
                          animate={{ width: `${total > 0 ? Math.min(100, (done / total) * 100) : 0}%` }}
                          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                        />
                      </div>
                      <div className="mt-1 text-[11px] tabular-nums text-text-subtle">
                        {t('dashboard.cert_req_modules_sub', { done, total })}
                      </div>
                    </div>
                    <span className={cn(
                      'shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums',
                      allModulesDone ? 'bg-primary/10 text-primary' : 'bg-subtle text-text-muted',
                    )}>
                      {done}/{total}
                    </span>
                  </div>

                  {/* Requisito 2: simulador */}
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                      hasSimulatorScore ? 'bg-primary/10 text-primary' : 'bg-subtle text-text-muted',
                    )}>
                      {hasSimulatorScore
                        ? <Check className="h-4 w-4" strokeWidth={3} />
                        : <span className="text-[13px] font-bold">2</span>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-text mb-1.5">
                        {t('dashboard.cert_req_simulator', { score: CERTIFICATION_MIN_SCORE })}
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-subtle">
                        <motion.div
                          className="h-full rounded-full bg-primary"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, (bestScore / CERTIFICATION_MIN_SCORE) * 100)}%` }}
                          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                        />
                      </div>
                      <div className="mt-1 text-[11px] tabular-nums text-text-subtle">
                        {attempts.length > 0
                          ? t('dashboard.cert_req_simulator_sub', { best: bestScore })
                          : t('dashboard.cert_req_simulator_none')
                        }
                      </div>
                    </div>
                    <span className={cn(
                      'shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums',
                      hasSimulatorScore ? 'bg-primary/10 text-primary' : 'bg-subtle text-text-muted',
                    )}>
                      {bestScore}/100
                    </span>
                  </div>
                </div>

                <Link
                  to="/certificate"
                  className="inline-block rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-text transition-colors hover:border-primary hover:text-primary"
                >
                  {t('dashboard.cert_preview')} →
                </Link>
              </div>
            )}
          </Reveal>

          {/* Insignias y logros */}
          <Reveal as="section" className="mb-16 md:mb-20 scroll-mt-16" id="logros">
            <div className="mb-8 flex items-end justify-between">
              <h2 className="text-2xl font-semibold tracking-tight text-text">
                {t('dashboard.badges_title')}
              </h2>
              <span className="text-[12px] tabular-nums text-text-subtle">
                {t('dashboard.badges_unlocked', { n: badges.length, total: BADGE_DEFS.length })}
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
              {BADGE_DEFS.map((badge) => {
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

          {/* Simulador / laboratorio de práctica */}
          <Reveal as="section" className="mb-16 scroll-mt-16" id="simulador">
            {simulatorUnlocked ? (
              <Link
                to="/simulator"
                className="flex flex-col md:flex-row items-start md:items-center gap-6 rounded-3xl border border-primary/25 bg-surface p-6 md:p-8 transition-all hover:border-primary hover:shadow-card-hover"
              >
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <PhoneCall className="h-7 w-7" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-primary mb-1">
                    {t('dashboard.status_available')}
                  </p>
                  <h3 className="text-2xl font-semibold tracking-tight text-text mb-1">
                    {t('dashboard.simulator_card_title_unlocked')}
                  </h3>
                  <p className="max-w-xl text-[15px] leading-relaxed text-text-muted">
                    {t('dashboard.simulator_card_subtitle_unlocked')}
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-primary px-5 py-2.5 text-[13px] font-semibold text-on-primary">
                  {t('dashboard.simulator_cta')}
                </span>
              </Link>
            ) : (
              <div className="flex flex-col md:flex-row items-start md:items-center gap-6 rounded-3xl border border-line bg-surface p-6 md:p-8">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-subtle text-text-muted">
                  <Lock className="h-7 w-7" />
                </div>
                <div className="flex-1 w-full">
                  <h3 className="text-2xl font-semibold tracking-tight text-text mb-1">
                    {t('dashboard.panel_sim_locked_title')}
                  </h3>
                  <p className="mb-4 max-w-xl text-[15px] leading-relaxed text-text-muted">
                    {t('dashboard.simulator_card_subtitle_locked', { remaining: remainingForUnlock })}
                  </p>
                  <div className="max-w-md">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-subtle">
                      <motion.div
                        className="h-full rounded-full bg-primary"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, (done / SIMULATOR_UNLOCK_THRESHOLD) * 100)}%` }}
                        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                    <div className="mt-1.5 text-[11px] tabular-nums text-text-subtle">
                      {Math.min(done, SIMULATOR_UNLOCK_THRESHOLD)} / {SIMULATOR_UNLOCK_THRESHOLD}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Reveal>

          {/* Estadísticas de pie de página */}
          <Reveal>
            <div className="mb-6 h-px w-full bg-line" />
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
