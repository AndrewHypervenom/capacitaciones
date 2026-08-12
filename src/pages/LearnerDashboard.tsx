import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  BookOpen,
  Compass,
  Home,
  Lock,
  LogOut,
  Medal,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  X,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { FadeIn, Stagger, StaggerItem, ease } from '@/components/ui/motion';
import { useUserStore } from '@/stores/userStore';
import {
  useProgressStore,
  useModuleDone,
  keyOfModule,
} from '@/stores/progressStore';
import {
  useGamificationStore,
  getXPLevel,
  getXPProgress,
  badgeLabel,
  badgeDescription,
  xpLevelLabel,
  type Lang,
} from '@/stores/gamificationStore';
import { XPBoostCard, XPBoostPill } from '@/components/gamification/XPBoostBanner';
import { useModules } from '@/hooks/useModules';
import { useLearnerCourses } from '@/hooks/useLearnerCourses';
import { useHasWorld } from '@/hooks/useHasWorld';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { signOut } from '@/services/auth.service';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { ViewSwitcher } from '@/components/layout/ViewSwitcher';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { Avatar } from '@/components/ui/Avatar';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { CourseGrid, courseProgress, pickCourseText } from '@/components/course/CourseCard';
import { cn } from '@/lib/cn';

const SECTION_IDS = ['inicio', 'cursos', 'recursos', 'logros'];

// Cuántos cursos pendientes se nombran en el encabezado. Con 50 asignados la
// lista completa tapa la pantalla; estos son los que conviene retomar YA y el
// resto vive en la rejilla de "Cursos", a un clic.
const CHIP_LIMIT = 4;

const MotionLink = motion(Link);

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
  const reduce = useReducedMotion();
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
  // Los obligatorios primero; el resto conserva el orden que trae el servicio.
  const sortedDashboardCourses = useMemo(
    () =>
      [...dashboardCourses].sort((a, b) =>
        a.isMandatory === b.isMandatory ? 0 : a.isMandatory ? -1 : 1,
      ),
    [dashboardCourses],
  );
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
  const reconcileModuleKeys = useProgressStore((s) => s.reconcileModuleKeys);
  const isModuleDone = useModuleDone();
  const recordWorldProgress = useProgressStore((s) => s.recordWorldProgress);

  // Definiciones vivas (editables por el superadmin); caen a los defaults de
  // fábrica si la BD aún no cargó. Solo las habilitadas cuentan y se muestran.
  const allBadgeDefs = useGamificationStore((s) => s.badgeDefs);
  const xpLevels = useGamificationStore((s) => s.xpLevels);
  const badgeDefs = useMemo(
    () => allBadgeDefs.filter((b) => b.enabled !== false),
    [allBadgeDefs],
  );
  // Insignias ligadas a una función opcional (mundo/simulador): se derivan de
  // `requires`. Las de mundo se muestran si el aprendiz tiene mundo; las de
  // simulador solo si ya se ganaron (no hay señal de disponibilidad).
  const conditionalIds = useMemo(
    () => new Set(badgeDefs.filter((b) => b.requires).map((b) => b.id)),
    [badgeDefs],
  );

  useEffect(() => {
    if (!modulesLoading && modules.length > 0) {
      // Antes de reevaluar logros, completar la clave que falte (slug ↔ UUID):
      // si no, un aprendiz a medio migrar contaría menos módulos de los que hizo.
      reconcileModuleKeys(modules.map(keyOfModule));
      recheckBadges(modules.map((m) => ({ ...keyOfModule(m), courseId: m.courseId })));
    }
  }, [modulesLoading, modules, recheckBadges, reconcileModuleKeys]);

  // Avance de mundo (también retroactivo): cuenta los niveles completados en
  // cualquier mundo y deja que el motor otorgue "Explorador" y afines.
  useEffect(() => {
    if (!hasWorld || !user?.id || badges.includes('world-explorer')) return;
    let active = true;
    supabase
      .from('world_progress')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('completed', true)
      .then(({ count }) => {
        if (active && (count ?? 0) > 0) recordWorldProgress(count ?? 0);
      });
    return () => {
      active = false;
    };
  }, [hasWorld, user?.id, badges, recordWorldProgress]);
  const xpLevel = getXPLevel(xp, xpLevels);
  const xpProgress = getXPProgress(xp, xpLevels);
  const nextLevel = useMemo(
    () => xpLevels.find((l) => l.level === xpLevel.level + 1),
    [xpLevels, xpLevel.level],
  );

  const badgeAvailable = useMemo<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        badgeDefs.filter((b) => b.requires === 'world').map((b) => [b.id, hasWorld]),
      ),
    [badgeDefs, hasWorld],
  );
  const visibleBadges = useMemo(
    () =>
      badgeDefs.filter(
        (b) =>
          !conditionalIds.has(b.id) ||
          badges.includes(b.id) ||
          badgeAvailable[b.id],
      ),
    [badgeDefs, conditionalIds, badges, badgeAvailable],
  );
  // Contar solo lo ganado ENTRE lo visible (un id viejo ya retirado —p. ej.
  // 'simulator-unlocked'— no debe inflar el contador).
  const earnedVisibleCount = useMemo(
    () => visibleBadges.filter((b) => badges.includes(b.id)).length,
    [visibleBadges, badges],
  );

  // Titular en CURSOS, no en módulos: el aprendiz razona por curso ("¿cuáles me
  // faltan?"), y 44 módulos sueltos no dicen nada. Solo entran los cursos en los
  // que YA está inscrito (`dashboardCourses` = isAssigned): el catálogo abierto
  // no es tarea pendiente suya.
  //
  // Cada curso se lista como una ficha (nombre + cuánto le falta), no dentro de
  // una frase: una enumeración con comas y un "y 3 más" escondía justo lo que se
  // quiere saber. Pendientes primero y, dentro de ellos, los ya empezados antes
  // que los que no ha tocado: ese es el orden en que conviene retomarlos.
  const courseStatus = useMemo(() => {
    const withPct = sortedDashboardCourses.map((c) => {
      const p = courseProgress(c, isModuleDone);
      return {
        id: c.id,
        slug: c.slug,
        title: pickCourseText(c.title_es, c.title_en, c.title_pt, language),
        // Un curso sin módulos no está completo: no hay nada que dar por hecho.
        complete: p.total > 0 && p.done === p.total,
        pct: Math.round(p.pct * 100),
        done: p.done,
        total: p.total,
      };
    });
    return {
      finished: withPct.filter((c) => c.complete),
      unfinished: withPct
        .filter((c) => !c.complete)
        .sort((a, b) => b.pct - a.pct),
    };
  }, [sortedDashboardCourses, isModuleDone, language]);

  const coursesTotal = sortedDashboardCourses.length;
  const coursesDone = courseStatus.finished.length;
  const coursePct = coursesTotal > 0 ? coursesDone / coursesTotal : 0;

  const pending = modules.filter((m) => !isModuleDone(keyOfModule(m)));
  const remainingMinutes = pending.reduce((acc, m) => acc + m.duration, 0);
  const nextModule = pending[0];

  const sidebarItems = [
    { icon: Home, label: t('dashboard.sidebar_home'), id: 'inicio' },
    { icon: BookOpen, label: t('dashboard.sidebar_courses'), id: 'cursos' },
    { icon: Compass, label: t('dashboard.sidebar_resources'), id: 'recursos' },
    { icon: Medal, label: t('dashboard.sidebar_achievements'), id: 'logros' },
  ];

  // Menú móvil: en pantallas chicas la barra superior colapsa en un solo botón
  // que abre este panel (navegación + ajustes), evitando el header sobrecargado.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMenu = () => setMobileMenuOpen(false);

  // Cierra el menú al pasar a desktop y bloquea el scroll de fondo mientras está abierto.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onResize = () => { if (window.innerWidth >= 1024) setMobileMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileMenuOpen(false); };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileMenuOpen]);

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
      <div className="mx-auto max-w-5xl px-5 pb-24 pt-12">
        <div className="space-y-8">
          <div className="space-y-3">
            <div className="h-4 w-40 rounded-lg bg-subtle skeleton-shine" />
            <div className="h-10 w-80 max-w-full rounded-xl bg-subtle skeleton-shine" />
            <div className="h-4 w-96 max-w-full rounded-lg bg-subtle skeleton-shine" />
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-64 rounded-3xl bg-subtle skeleton-shine"
                style={{ animationDelay: `${i * 90}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Barra superior móvil/tablet — mismo patrón que el panel de gestión
          (AdminNav): botón de menú a la izquierda, logo, y a la derecha el
          cambio de vista. El tema vive dentro del drawer, no en la barra, para
          que aprendiz y gestión se vean idénticos al alternar de rol. */}
      <header className="lg:hidden sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-surface px-3">
        <button
          onClick={() => setMobileMenuOpen(true)}
          aria-label={t('nav.menu', 'Menú')}
          aria-expanded={mobileMenuOpen}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-subtle hover:text-text"
        >
          <Menu className="h-5 w-5" />
        </button>
        <a href="#inicio" onClick={closeMenu} className="flex items-center gap-2">
          <img src="/logo.jpg" alt={t('brand')} className="h-7 w-7 rounded-md" width={28} height={28} />
          <span className="text-[14px] font-semibold tracking-tight text-text">{t('brand')}</span>
        </a>
        <div className="ml-auto flex items-center gap-1">
          <NotificationBell />
          {/* Solo staff: alternar gestión ⇄ aprendiz sin abrir el drawer */}
          <ViewSwitcher variant="inline" onSwitch={closeMenu} />
        </div>
      </header>

      {/* Overlay del drawer móvil (mismo patrón que el panel de gestión) */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/50"
          onClick={closeMenu}
          aria-hidden="true"
        />
      )}

      {/* Sidebar de navegación (estilo panel). En móvil es un drawer que se
          desliza desde la izquierda, igual que el panel de capacitador/superadmin. */}
      <aside
        className={cn(
          'fixed left-0 top-0 bottom-0 z-[60] flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface transition-transform duration-300 ease-in-out lg:z-30 lg:w-64 lg:translate-x-0',
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Marca + cerrar (el cierre solo se ve en móvil) */}
        <div className="flex items-center justify-between px-6 pt-6 pb-5 lg:pb-5">
          <a href="#inicio" onClick={closeMenu} className="flex items-center gap-2.5">
            <img src="/logo.jpg" alt={t('brand')} className="h-8 w-8 rounded-lg" width={32} height={32} />
            <span className="text-[16px] font-bold tracking-tight text-text">{t('brand')}</span>
          </a>
          <div className="flex items-center gap-1">
            {/* En desktop la campana vive en el sidebar; en móvil ya está en el header */}
            <NotificationBell className="hidden lg:inline-flex" />
            <button
              onClick={closeMenu}
              aria-label={t('nav.close_menu', 'Cerrar menú')}
              className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-subtle hover:text-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Cambio de vista (solo staff): arriba, para volver a gestión al instante */}
        <ViewSwitcher variant="block" className="px-4 pb-4" onSwitch={closeMenu} />

        {/* Navegación por secciones */}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
          {sidebarItems.map(({ icon: Icon, label, id }) => {
            const active = activeSection === id;
            return (
              <a
                key={id}
                href={`#${id}`}
                onClick={closeMenu}
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
            onClick={closeMenu}
            className="flex items-center gap-3 rounded-full px-4 py-2.5 text-[13px] font-medium text-text-muted transition-colors hover:bg-subtle hover:text-text"
          >
            <MessageSquare className="h-4 w-4 shrink-0 text-text-subtle" />
            {t('nav.feedback', 'Retroalimentación')}
          </Link>

          {/* Buzón de mejoras del sitio: siempre disponible, no solo durante el
              piloto del botón flotante. */}
          <Link
            to="/suggestions"
            onClick={closeMenu}
            className="flex items-center gap-3 rounded-full px-4 py-2.5 text-[13px] font-medium text-text-muted transition-colors hover:bg-subtle hover:text-text"
          >
            <MessageSquarePlus className="h-4 w-4 shrink-0 text-text-subtle" />
            {t('nav.suggestions', 'Sugerencias')}
          </Link>
        </nav>

        {/* Pie del sidebar: usuario, idioma, tema y salida */}
        <div className="border-t border-line px-4 py-4">
          <Link
            to="/profile"
            onClick={closeMenu}
            className="mb-3 flex items-center gap-3 rounded-2xl px-1 py-1 transition-colors hover:bg-subtle"
            title={t('profile.title', 'Mi perfil')}
          >
            <Avatar src={avatarUrl} name={name} size={36} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-text">{name}</p>
              <p className="text-[11px] text-text-subtle">Nv. {xpLevel.level} · {xpLevelLabel(xpLevel, language)}</p>
            </div>
          </Link>
          <div className="mb-3 flex items-center justify-between px-1 py-1">
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

          {/* Hero + estado del aprendizaje. El anillo ya no vive en un panel
              encajonado al lado del titulo: va pequeno junto al dato, y el
              avance lo cuenta un hilo de 3px como en el resto del sitio. */}
          <FadeIn as="section" className="mb-14 scroll-mt-16 md:mb-16" id="inicio">
            <p className="mb-2 text-[13px] text-text-subtle">
              {t('dashboard.greeting', { name })}
            </p>
            <h1 className="max-w-3xl text-balance text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-text sm:text-[44px]">
              {t('dashboard.panel_headline')}
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-text-muted">
              {coursesTotal === 0
                ? t('dashboard.panel_subheadline_none')
                : courseStatus.unfinished.length === 0
                  ? t('dashboard.panel_subheadline_all', { total: coursesTotal })
                  : t('dashboard.panel_subheadline_courses', {
                      done: coursesDone,
                      total: coursesTotal,
                    })}
            </p>

            {/* Solo lo PENDIENTE y solo las primeras fichas: con 50 cursos
                asignados, listarlos todos aquí es ruido —para eso está la
                rejilla de abajo, a un clic de "+N más". Lo ya terminado se
                cuenta en el hilo de progreso, no ocupa una ficha cada uno. */}
            {courseStatus.unfinished.length > 0 && (
              <div className="mt-5 flex max-w-2xl flex-wrap gap-2">
                {courseStatus.unfinished.slice(0, CHIP_LIMIT).map((c) => (
                  <Link
                    key={c.id}
                    to={`/courses/${c.slug}`}
                    className="inline-flex max-w-full items-center gap-2 rounded-full border border-line py-1.5 pl-2 pr-3.5 text-[13px] text-text transition-colors duration-300 hover:border-primary/40 hover:bg-primary/[0.04]"
                  >
                    <ProgressRing
                      value={c.total > 0 ? c.done / c.total : 0}
                      size={16}
                      stroke={2}
                      color="rgb(var(--primary))"
                    />
                    <span className="truncate">{c.title}</span>
                    <span className="shrink-0 tabular-nums text-[12px] text-text-subtle">
                      {c.done}/{c.total}
                    </span>
                  </Link>
                ))}
                {courseStatus.unfinished.length > CHIP_LIMIT && (
                  <a
                    href="#cursos"
                    className="inline-flex items-center rounded-full border border-dashed border-line px-3.5 py-1.5 text-[13px] text-text-muted transition-colors duration-300 hover:border-text-subtle/50 hover:text-text"
                  >
                    {t('dashboard.courses_more', {
                      n: courseStatus.unfinished.length - CHIP_LIMIT,
                    })}
                  </a>
                )}
              </div>
            )}

            {/* Un solo hilo de avance, en CURSOS —la misma unidad del titular.
                Antes había un anillo con "11%", un rótulo y "5 de 44 módulos ·
                11%": tres veces el mismo dato y dos unidades distintas. El
                porcentaje se dice una vez, al final de la línea. */}
            {coursesTotal > 0 && (
              <div className="mt-8 max-w-md">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-subtle">
                    {t('dashboard.panel_progress_label')}
                  </span>
                  <span className="text-[13px] tabular-nums font-medium text-text">
                    {t('dashboard.progress_courses', {
                      done: coursesDone,
                      total: coursesTotal,
                      pct: Math.round(coursePct * 100),
                    })}
                  </span>
                </div>
                <div className="h-[3px] w-full overflow-hidden rounded-full bg-subtle">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={{ width: reduce ? `${coursePct * 100}%` : 0 }}
                    animate={{ width: `${coursePct * 100}%` }}
                    transition={{ duration: reduce ? 0 : 1.2, ease, delay: 0.3 }}
                  />
                </div>
              </div>
            )}

            {nextModule && (
              <motion.div whileTap={reduce ? undefined : { scale: 0.97 }} className="mt-7 inline-flex max-w-full">
                <Link
                  to={`/modules/${nextModule.id}`}
                  className="group inline-flex max-w-full items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity duration-300 hover:opacity-90"
                >
                  <span className="truncate">
                    {t('dashboard.module_continue')}: {nextModule.title[language]}
                  </span>
                  <span className="transition-transform duration-500 ease-apple group-hover:translate-x-1">&rarr;</span>
                </Link>
              </motion.div>
            )}
          </FadeIn>

          {/* Día de XP multiplicado: va arriba del todo porque cambia QUÉ
              conviene hacer hoy. Si no hay evento vigente ni próximo, no pinta
              nada (el componente devuelve null). */}
          <XPBoostCard lang={language as Lang} className="mb-12 md:mb-16" />

          {/* Cursos — navegación principal: Campaña → Curso → Módulo.
              Tarjeta y rejilla COMPARTIDAS con /courses (components/course/CourseCard):
              el mismo curso ya no se ve de dos maneras según por dónde llegues. */}
          <section id="cursos" className="mb-16 md:mb-20 scroll-mt-16">
            <FadeIn className="mb-6">
              <Link
                to="/courses"
                className="group inline-flex items-baseline gap-2"
              >
                <h2 className="text-[19px] font-semibold tracking-tight text-text transition-colors group-hover:text-primary">
                  {t('dashboard.courses_title')}
                </h2>
                <span className="text-[13px] tabular-nums text-text-subtle">{dashboardCourses.length}</span>
                <ArrowRight className="h-3.5 w-3.5 self-center text-text-subtle transition-transform duration-500 ease-apple group-hover:translate-x-1" />
              </Link>
              <p className="mt-0.5 text-[13px] text-text-muted">
                {t('dashboard.courses_subtitle')}
              </p>
            </FadeIn>

            {dashboardCourses.length === 0 && (
              <div className="mb-5 rounded-3xl border border-line bg-surface p-10 text-center text-[13.5px] text-text-muted">
                {t('dashboard.courses_empty')}
              </div>
            )}
            <CourseGrid
              courses={sortedDashboardCourses}
              reduce={reduce}
              trailing={
                <MotionLink
                  to="/courses"
                  whileHover={reduce ? undefined : { y: -5 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                  className="group flex h-full min-h-[13rem] flex-col justify-center gap-2.5 rounded-3xl border border-dashed border-line p-6 text-center transition-colors duration-500 hover:border-text-subtle/50"
                >
                  <Compass className="mx-auto h-5 w-5 text-text-subtle transition-colors duration-500 group-hover:text-primary" />
                  <div>
                    <p className="text-[15px] font-medium tracking-tight text-text">
                      {t('dashboard.explore_cta_title')}
                    </p>
                    <p className="mt-0.5 text-[13px] text-text-muted">
                      {t('dashboard.explore_cta_subtitle')}
                    </p>
                  </div>
                  <span className="inline-flex items-center justify-center gap-1 text-[13px] text-text-muted transition-colors group-hover:text-primary">
                    {t('dashboard.courses_title')}
                    <ArrowRight className="h-3.5 w-3.5 transition-transform duration-500 ease-apple group-hover:translate-x-1" />
                  </span>
                </MotionLink>
              }
            />
          </section>

          {/* Recursos Complementarios */}
          <section id="recursos" className="mb-16 md:mb-20 scroll-mt-16">
            <FadeIn className="mb-6">
              <h2 className="text-[19px] font-semibold tracking-tight text-text">
                {t('dashboard.resources_title')}
              </h2>
              <p className="mt-0.5 text-[13px] text-text-muted">
                {t('dashboard.resources_subtitle')}
              </p>
            </FadeIn>

            <FadeIn delay={0.05} className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Link
                to="/quiz"
                className="group flex items-center gap-4 rounded-2xl border border-line p-4 transition-all duration-500 ease-apple hover:-translate-y-1 hover:shadow-card-hover"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-subtle text-text-muted transition-colors duration-500 group-hover:text-primary">
                  <Zap className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-subtle">
                    {t('dashboard.quiz_tag')}
                  </p>
                  <h3 className="truncate text-[14.5px] font-medium text-text">
                    {t('dashboard.quiz_title')}
                  </h3>
                  <p className="truncate text-[12.5px] text-text-muted">
                    {t('dashboard.quiz_subtitle')}
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-text-muted">
                  {t('dashboard.quiz_join')}
                  <span className="transition-transform duration-500 ease-apple group-hover:translate-x-1">&rarr;</span>
                </span>
              </Link>
            </FadeIn>
          </section>

          {/* Insignias y logros. Experiencia y racha dejan de ser dos cajas:
              son una sola linea de datos sobre un hilo de 3px. */}
          <FadeIn as="section" className="mb-14 scroll-mt-16 md:mb-16" id="logros">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-[19px] font-semibold tracking-tight text-text">
                  {t('dashboard.badges_title')}
                </h2>
                <p className="mt-0.5 text-[13px] text-text-muted">
                  {t('dashboard.badges_unlocked', { n: earnedVisibleCount, total: visibleBadges.length })}
                </p>
              </div>
              {/* La racha vive aqui, en texto: una caja propia para un numero de
                  un digito era la definicion de saturado. */}
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-text-muted">
                {streak > 0 ? (
                  <motion.span
                    animate={reduce ? undefined : { scale: [1, 1.18, 1] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    className="text-[15px] leading-none"
                  >
                    🔥
                  </motion.span>
                ) : (
                  <span className="text-[15px] leading-none opacity-50">💤</span>
                )}
                <span className="tabular-nums font-medium text-text">{streak}</span>
                {streak === 1
                  ? t('dashboard.streak_one')
                  : streak > 1
                    ? t('dashboard.streak_other')
                    : t('dashboard.streak_start')}
              </span>
            </div>

            {/* Experiencia */}
            <div className="mb-8">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="inline-flex items-baseline gap-2 text-[13px] text-text-muted">
                  {t('dashboard.xp_label')}
                  <span className="font-medium" style={{ color: xpLevel.color }}>
                    Nv. {xpLevel.level} · {xpLevelLabel(xpLevel, language)}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-[13px] font-medium tabular-nums text-text">
                  {/* Si hoy hay evento, se dice justo al lado del contador: es
                      donde el aprendiz mira para saber cuanto lleva. */}
                  <XPBoostPill lang={language as Lang} />
                  {xp.toLocaleString()} XP
                </span>
              </div>
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-subtle">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: xpLevel.color }}
                  initial={{ width: reduce ? `${Math.round(xpProgress * 100)}%` : 0 }}
                  animate={{ width: `${Math.round(xpProgress * 100)}%` }}
                  transition={{ duration: reduce ? 0 : 1.2, ease, delay: 0.25 }}
                />
              </div>
              {nextLevel && (
                <p className="mt-2 text-[11.5px] tabular-nums text-text-subtle">
                  {t('dashboard.xp_to_next', {
                    xp,
                    max: xpLevel.maxXP,
                    rank: xpLevelLabel(nextLevel, language),
                  })}
                </p>
              )}
            </div>

            {/* Grilla de insignias */}
            <Stagger gap={0.03} className="grid grid-cols-4 gap-3 md:grid-cols-8">
              {visibleBadges.map((badge) => {
                const earned = badges.includes(badge.id);
                return (
                  <StaggerItem
                    key={badge.id}
                    title={badgeDescription(badge, language)}
                    whileHover={reduce || !earned ? undefined : { y: -3 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 20 }}
                    className={cn(
                      'flex cursor-default flex-col items-center gap-2',
                      !earned && 'opacity-35',
                    )}
                  >
                    <div
                      className={cn(
                        'relative flex aspect-square w-full items-center justify-center rounded-2xl border text-[22px] transition-colors duration-500',
                        earned
                          ? badge.rare
                            ? 'border-amber-400/40 bg-amber-400/[0.07]'
                            : 'border-line bg-subtle/60'
                          : 'border-dashed border-line text-text-subtle',
                      )}
                    >
                      {earned ? badge.emoji : <Lock className="h-4 w-4" />}
                      {/* Marca de logro poco comun */}
                      {badge.rare && (
                        <span
                          className={cn('absolute -right-0.5 -top-0.5 text-[9px]', !earned && 'opacity-50')}
                          title="Logro poco común"
                        >
                          ⭐
                        </span>
                      )}
                    </div>
                    <p className="w-full truncate text-center text-[10px] text-text-subtle">
                      {badgeLabel(badge, language)}
                    </p>
                  </StaggerItem>
                );
              })}
            </Stagger>
          </FadeIn>

          {/* Estadísticas de pie de página */}
          <FadeIn>
            <div className="mb-5 h-px w-full bg-line" />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[12.5px] text-text-subtle">
              {remainingMinutes > 0 && (
                <span>{t('dashboard.footer_minutes', { n: remainingMinutes })}</span>
              )}
              {nextModule && (
                <>
                  {remainingMinutes > 0 && <span className="text-text-subtle/50">·</span>}
                  <span className="truncate">
                    {t('dashboard.footer_next', { title: nextModule.title[language] })}
                  </span>
                </>
              )}
            </div>
          </FadeIn>
        </main>
      </div>
    </div>
  );
}
