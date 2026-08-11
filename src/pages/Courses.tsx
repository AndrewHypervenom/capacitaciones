import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowDownAZ,
  Building2,
  Check,
  ChevronDown,
  GraduationCap,
  Layers,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useSpring } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useUserStore } from '@/stores/userStore';
import { useModuleDone } from '@/stores/progressStore';
import { useLearnerCourses } from '@/hooks/useLearnerCourses';
import { type LearnerCourse } from '@/services/courses.service';
import { Select } from '@/components/ui/Select';
// La tarjeta y la rejilla son las MISMAS que usa el panel del aprendiz: un curso
// no puede verse de dos formas según por dónde llegues.
import { CourseGrid, courseProgress, ease, pickCourseText as pickText } from '@/components/course/CourseCard';
import { cn } from '@/lib/cn';

export { courseProgress };

type Filter = 'all' | 'mandatory' | 'optional' | 'in_progress' | 'completed';

// 'smart' es el orden de siempre (estado → obligatorio → alfabético). Las otras
// dos son alfabéticas puras: quien busca un curso por nombre no quiere que el
// progreso le mueva las tarjetas de sitio.
type Sort = 'smart' | 'az' | 'za';

/** Valor centinela de los filtros de una sola opción ("todas / todos"). */
const ANY = '__any__';

/* ── Número que sube solo ────────────────────────────────────────────────────
   Se usa UNA sola vez (el % de avance). Un tablero entero de números contando
   es ruido; uno solo, en el dato que resume la página, se lee como un pulso. */
function CountUp({ value, suffix }: { value: number; suffix?: string }) {
  const reduce = useReducedMotion();
  const spring = useSpring(0, { stiffness: 70, damping: 18, mass: 0.6 });
  const [shown, setShown] = useState(0);

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  useEffect(() => spring.on('change', (v) => setShown(Math.round(v))), [spring]);

  return (
    <span className="tabular-nums">
      {reduce ? value : shown}
      {suffix}
    </span>
  );
}

/* ── Encabezado de sección ──────────────────────────────────────────────── */
function SectionHead({ title, subtitle, count }: { title: string; subtitle: string; count: number }) {
  return (
    <div className="mb-6">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[19px] font-semibold tracking-tight text-text">{title}</h2>
        <span className="text-[13px] tabular-nums text-text-subtle">{count}</span>
      </div>
      <p className="mt-0.5 text-[13px] text-text-muted">{subtitle}</p>
    </div>
  );
}

export default function Courses() {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const language = useUserStore((s) => s.language);
  const isModuleDone = useModuleDone();
  const { courses, loading, reload } = useLearnerCourses();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('smart');
  const [campaign, setCampaign] = useState<string>(ANY);
  const [level, setLevel] = useState<string>(ANY);
  const [category, setCategory] = useState<string>(ANY);
  const [grouped, setGrouped] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" enfoca la búsqueda, como en cualquier catálogo que se respete. Se ignora
  // si ya estás escribiendo en otro campo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ── Opciones de los filtros, sacadas de los cursos que hay de verdad ──── */
  const campaigns = useMemo(() => {
    const set = new Set<string>();
    courses.forEach((c) => c.campaign_name && set.add(c.campaign_name));
    return [...set].sort((a, b) => a.localeCompare(b, language, { sensitivity: 'base' }));
  }, [courses, language]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    courses.forEach((c) => c.category && set.add(c.category));
    return [...set].sort((a, b) => a.localeCompare(b, language, { sensitivity: 'base' }));
  }, [courses, language]);

  const levels = useMemo(() => {
    const set = new Set<string>();
    courses.forEach((c) => c.level && set.add(c.level));
    return [...set];
  }, [courses]);

  // Si el filtro elegido deja de existir (cambió la campaña activa, se despublicó
  // un curso), vale "todas" en vez de dejar la pantalla vacía sin motivo. Se
  // resuelve al derivar, NO con un useEffect que llame a setState: el efecto
  // provoca un render extra y deja un parpadeo con la lista vacía.
  const campaignSel = campaign !== ANY && !campaigns.includes(campaign) ? ANY : campaign;
  const categorySel = category !== ANY && !categories.includes(category) ? ANY : category;
  const levelSel = level !== ANY && !levels.includes(level) ? ANY : level;

  /* ── Filtrado en capas ──────────────────────────────────────────────────
     Búsqueda → campaña/nivel/categoría → estado. Separamos el último paso para
     poder contar cuántos cursos caen en cada cápsula de estado con el resto de
     filtros ya aplicados: un contador que no respeta los otros filtros miente. */
  const base = useMemo(() => {
    const q = query.trim().toLowerCase();
    return courses.filter((c) => {
      if (q) {
        const text = `${c.title_es} ${c.title_en ?? ''} ${c.title_pt ?? ''} ${c.description_es ?? ''} ${c.category ?? ''} ${c.campaign_name ?? ''}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      if (campaignSel !== ANY && c.campaign_name !== campaignSel) return false;
      if (levelSel !== ANY && c.level !== levelSel) return false;
      if (categorySel !== ANY && c.category !== categorySel) return false;
      return true;
    });
  }, [courses, query, campaignSel, levelSel, categorySel]);

  const matchesFilter = useCallback(
    (c: LearnerCourse, f: Filter) => {
      const { total, done } = courseProgress(c, isModuleDone);
      switch (f) {
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
    },
    [isModuleDone],
  );

  const filtered = useMemo(
    () => base.filter((c) => matchesFilter(c, filter)),
    [base, filter, matchesFilter],
  );

  const titleOf = (c: LearnerCourse) =>
    pickText(c.title_es, c.title_en, c.title_pt, language);

  // localeCompare con el idioma activo: en español la "ñ" va después de la "n",
  // no al final del alfabeto, y los acentos no rompen el orden.
  const byTitle = (a: LearnerCourse, b: LearnerCourse) =>
    titleOf(a).localeCompare(titleOf(b), language, { sensitivity: 'base', numeric: true });

  const sortCourses = (list: LearnerCourse[]) =>
    [...list].sort((a, b) => {
      if (a.isMandatory !== b.isMandatory) return a.isMandatory ? -1 : 1;
      return byTitle(a, b);
    });

  // El estado pesa más que el orden alfabético: primero lo que el aprendiz ya
  // empezó, luego lo que no ha tocado y de último lo ya completado. El sort es
  // estable, así que dentro de cada grupo se mantiene obligatorio + alfabético.
  const statusRank = (c: LearnerCourse) => {
    const { total, done } = courseProgress(c, isModuleDone);
    if (total > 0 && done === total) return 2;
    if (done > 0) return 0;
    return 1;
  };

  const sortByStatus = (list: LearnerCourse[]) =>
    sortCourses(list).sort((a, b) => statusRank(a) - statusRank(b));

  // A-Z / Z-A mandan sobre todo lo demás: si el aprendiz pide alfabético, no le
  // colamos primero los obligatorios ni los que ya empezó.
  const arrange = (list: LearnerCourse[]) => {
    if (sort === 'az') return [...list].sort(byTitle);
    if (sort === 'za') return [...list].sort((a, b) => byTitle(b, a));
    return sortByStatus(list);
  };

  const myCourses = arrange(filtered.filter((c) => c.isAssigned));
  const exploreCourses = arrange(filtered.filter((c) => !c.isAssigned));

  // Catálogo agrupado por campaña dueña: es la pregunta real de quien ve cursos
  // de varias campañas ("¿esto de quién es?"). Sin useMemo a propósito: agrupar
  // una lista ya calculada es barato.
  const exploreGroups = (() => {
    const map = new Map<string, LearnerCourse[]>();
    exploreCourses.forEach((c) => {
      const key = c.campaign_name ?? '';
      const list = map.get(key);
      if (list) list.push(c);
      else map.set(key, [c]);
    });
    return [...map.entries()].sort((a, b) => {
      // Los sin campaña, al final.
      if (!a[0]) return 1;
      if (!b[0]) return -1;
      return a[0].localeCompare(b[0], language, { sensitivity: 'base' });
    });
  })();

  const showGroups = grouped && exploreGroups.length > 1;

  /* ── Resumen del avance: una sola línea, sin tablero de KPIs ─────────── */
  const stats = useMemo(() => {
    const assigned = courses.filter((c) => c.isAssigned);
    let completed = 0;
    let mandatoryPending = 0;
    assigned.forEach((c) => {
      const { total, done } = courseProgress(c, isModuleDone);
      if (total > 0 && done === total) completed += 1;
      if (c.isMandatory && (total === 0 || done < total)) mandatoryPending += 1;
    });
    return {
      assigned: assigned.length,
      completed,
      mandatoryPending,
      pct: assigned.length > 0 ? completed / assigned.length : 0,
    };
  }, [courses, isModuleDone]);

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: t('courses.filter_all') },
    { id: 'mandatory', label: t('courses.filter_mandatory') },
    { id: 'optional', label: t('courses.filter_optional') },
    { id: 'in_progress', label: t('courses.filter_in_progress') },
    { id: 'completed', label: t('courses.filter_completed') },
  ];

  const counts = filters.reduce<Record<Filter, number>>(
    (acc, f) => {
      acc[f.id] = base.filter((c) => matchesFilter(c, f.id)).length;
      return acc;
    },
    { all: 0, mandatory: 0, optional: 0, in_progress: 0, completed: 0 },
  );

  // Cuántos filtros "de segundo nivel" están puestos: lo único que necesita
  // saber el botón que abre el panel.
  const advancedCount =
    (campaignSel !== ANY ? 1 : 0) + (levelSel !== ANY ? 1 : 0) + (categorySel !== ANY ? 1 : 0);
  const hasAny = advancedCount > 0 || filter !== 'all' || query.trim().length > 0;

  const clearAll = () => {
    setFilter('all');
    setCampaign(ANY);
    setLevel(ANY);
    setCategory(ANY);
    setQuery('');
  };

  const hasAdvanced = campaigns.length > 1 || levels.length > 1 || categories.length > 1;

  /* ── Cargando ───────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 pt-12 pb-24 sm:px-8 sm:pt-16">
        <div className="space-y-10">
          <div className="space-y-3">
            <div className="h-8 w-52 rounded-xl bg-subtle skeleton-shine" />
            <div className="h-4 w-80 max-w-full rounded-lg bg-subtle skeleton-shine" />
          </div>
          <div className="h-10 w-full max-w-sm rounded-full bg-subtle skeleton-shine" />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="h-72 rounded-3xl bg-subtle skeleton-shine"
                style={{ animationDelay: `${i * 90}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-8">
      {/* ── Encabezado: título, una línea de contexto y el avance ─────────── */}
      <motion.header
        initial={reduce ? false : { opacity: 0, y: 14, filter: 'blur(5px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.6, ease }}
        className="pt-12 pb-9 sm:pt-16"
      >
        <Link
          to="/dashboard"
          className="group mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-subtle transition-colors hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-500 ease-apple group-hover:-translate-x-1" />
          {t('courses.back_to_home')}
        </Link>

        <h1 className="text-[32px] font-semibold tracking-[-0.03em] text-text sm:text-[40px]">
          {t('courses.title')}
        </h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-text-muted">
          {t('courses.subtitle')}
        </p>

        {stats.assigned > 0 && (
          <div className="mt-8 max-w-sm">
            <div className="mb-2 flex items-baseline justify-between gap-4 text-[13px]">
              <span className="text-text-muted">
                {t('courses.progress_summary', { done: stats.completed, total: stats.assigned })}
              </span>
              <span className="font-semibold text-text">
                <CountUp value={Math.round(stats.pct * 100)} suffix="%" />
              </span>
            </div>
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-subtle">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: reduce ? `${stats.pct * 100}%` : 0 }}
                animate={{ width: `${stats.pct * 100}%` }}
                transition={{ duration: reduce ? 0 : 1.2, ease, delay: 0.3 }}
              />
            </div>
            {stats.mandatoryPending > 0 && (
              <button
                type="button"
                onClick={() => setFilter('mandatory')}
                className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-text-muted transition-colors hover:text-text"
              >
                <span className="relative flex h-1.5 w-1.5">
                  {!reduce && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" />
                  )}
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-danger" />
                </span>
                {t('courses.mandatory_pending', { n: stats.mandatoryPending })}
              </button>
            )}
          </div>
        )}
      </motion.header>

      {/* ── Barra de mando: búsqueda + cápsulas. Lo demás vive en el panel ─ */}
      {courses.length > 0 && (
        <div className="sticky top-12 z-30 -mx-4 mb-10 border-b border-line/60 bg-bg/85 px-4 pt-3 pb-2.5 backdrop-blur-xl sm:-mx-8 sm:px-8">
          <div className="flex items-center gap-2">
            <div className="group relative w-full max-w-[19rem]">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle transition-colors group-focus-within:text-text" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('courses.search_ph')}
                className="w-full rounded-full border border-line bg-transparent py-2 pl-10 pr-9 text-[13.5px] text-text outline-none transition-colors duration-300 placeholder:text-text-subtle focus:border-text-subtle"
              />
              <AnimatePresence initial={false}>
                {query ? (
                  <motion.button
                    key="clear"
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    onClick={() => setQuery('')}
                    aria-label={t('courses.search_clear')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-subtle transition-colors hover:text-text"
                  >
                    <X className="h-3.5 w-3.5" />
                  </motion.button>
                ) : (
                  <motion.kbd
                    key="hint"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    aria-hidden
                    className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 text-[11px] font-medium text-text-subtle/70 sm:block"
                  >
                    /
                  </motion.kbd>
                )}
              </AnimatePresence>
            </div>

            {/* Cápsulas de estado: la pastilla se desliza entre ellas. */}
            <div className="-mx-1 flex flex-1 items-center gap-0.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {filters.map((f) => {
                const active = filter === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    aria-pressed={active}
                    className={cn(
                      'relative shrink-0 rounded-full px-3 py-1.5 text-[13px] transition-colors duration-300',
                      active ? 'font-medium text-text' : 'text-text-subtle hover:text-text-muted',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="courses-filter-pill"
                        aria-hidden
                        className="absolute inset-0 rounded-full bg-subtle"
                        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative z-10">
                      {f.label}
                      <span className="ml-1.5 text-[11px] tabular-nums text-text-subtle">{counts[f.id]}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {(hasAdvanced || exploreGroups.length > 1) && (
              <button
                onClick={() => setPanelOpen((o) => !o)}
                aria-expanded={panelOpen}
                className={cn(
                  'relative shrink-0 rounded-full border px-3 py-2 text-[13px] transition-colors duration-300',
                  panelOpen || advancedCount > 0
                    ? 'border-text-subtle text-text'
                    : 'border-line text-text-subtle hover:text-text',
                )}
              >
                <span className="flex items-center gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('courses.filters')}</span>
                  {advancedCount > 0 && (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                  )}
                </span>
              </button>
            )}
          </div>

          {/* Panel plegado: campaña, nivel, categoría, orden y agrupación. */}
          <AnimatePresence initial={false}>
            {panelOpen && (
              <motion.div
                initial={reduce ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.32, ease }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 gap-2 pt-3 pb-1 sm:grid-cols-2 lg:grid-cols-4">
                  {campaigns.length > 1 && (
                    <Select
                      value={campaignSel}
                      onChange={setCampaign}
                      options={[
                        { value: ANY, label: t('courses.filter_campaign_all') },
                        ...campaigns.map((c) => ({ value: c, label: c })),
                      ]}
                      leadingIcon={<Building2 className="h-4 w-4 text-text-subtle" />}
                      aria-label={t('courses.filter_campaign_label')}
                      compact
                    />
                  )}
                  {levels.length > 1 && (
                    <Select
                      value={levelSel}
                      onChange={setLevel}
                      options={[
                        { value: ANY, label: t('courses.filter_level_all') },
                        ...levels.map((l) => ({ value: l, label: t(`courses.level_${l}`) })),
                      ]}
                      leadingIcon={<SlidersHorizontal className="h-4 w-4 text-text-subtle" />}
                      aria-label={t('courses.filter_level_label')}
                      compact
                    />
                  )}
                  {categories.length > 1 && (
                    <Select
                      value={categorySel}
                      onChange={setCategory}
                      options={[
                        { value: ANY, label: t('courses.filter_category_all') },
                        ...categories.map((c) => ({ value: c, label: c })),
                      ]}
                      leadingIcon={<Layers className="h-4 w-4 text-text-subtle" />}
                      aria-label={t('courses.filter_category_label')}
                      compact
                    />
                  )}
                  {/* Orden. Separado del filtro porque son cosas distintas: uno
                      decide QUÉ cursos se ven y el otro EN QUÉ ORDEN. */}
                  <Select
                    value={sort}
                    onChange={(v) => setSort(v as Sort)}
                    options={[
                      { value: 'smart', label: t('courses.sort_smart') },
                      { value: 'az', label: t('courses.sort_az') },
                      { value: 'za', label: t('courses.sort_za') },
                    ]}
                    leadingIcon={<ArrowDownAZ className="h-4 w-4 text-text-subtle" />}
                    aria-label={t('courses.sort_label')}
                    compact
                  />
                </div>

                <div className="flex flex-wrap items-center gap-4 pb-3 pt-1">
                  {exploreGroups.length > 1 && (
                    <button
                      onClick={() => setGrouped((g) => !g)}
                      role="switch"
                      aria-checked={grouped}
                      className="inline-flex items-center gap-2 text-[13px] text-text-muted transition-colors hover:text-text"
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded-[5px] border transition-colors duration-300',
                          grouped ? 'border-primary bg-primary text-on-primary' : 'border-line',
                        )}
                      >
                        {grouped && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                      {t('courses.group_by_campaign')}
                    </button>
                  )}
                  <AnimatePresence initial={false}>
                    {hasAny && (
                      <motion.button
                        initial={reduce ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={clearAll}
                        className="ml-auto text-[13px] text-text-subtle transition-colors hover:text-text"
                      >
                        {t('courses.filter_clear_all')}
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {courses.length === 0 ? (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="rounded-3xl border border-line bg-surface p-12 text-center"
        >
          <GraduationCap className="mx-auto mb-4 h-8 w-8 text-text-subtle" />
          <h3 className="mb-1 text-[16px] font-medium text-text">{t('courses.empty_title')}</h3>
          <p className="text-[13.5px] text-text-muted">{t('courses.empty_subtitle')}</p>
        </motion.div>
      ) : (
        <>
          {/* ── Mis cursos ─────────────────────────────────────────────────── */}
          <AnimatePresence initial={false}>
            {myCourses.length > 0 && (
              <motion.section
                key="mine"
                layout={reduce ? undefined : 'position'}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mb-16"
              >
                <SectionHead
                  title={t('courses.my_courses')}
                  subtitle={t('courses.my_courses_subtitle')}
                  count={myCourses.length}
                />
                <CourseGrid courses={myCourses} reduce={reduce} />
              </motion.section>
            )}
          </AnimatePresence>

          {/* ── Explorar catálogo ──────────────────────────────────────────── */}
          <AnimatePresence initial={false}>
            {exploreCourses.length > 0 && (
              <motion.section
                key="explore"
                layout={reduce ? undefined : 'position'}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <SectionHead
                  title={t('courses.explore')}
                  subtitle={t('courses.explore_subtitle')}
                  count={exploreCourses.length}
                />

                {showGroups ? (
                  <div className="space-y-10">
                    {exploreGroups.map(([name, list]) => {
                      const isOpen = !collapsed[name];
                      return (
                        <div key={name || '__none__'}>
                          <button
                            onClick={() => setCollapsed((s) => ({ ...s, [name]: !!isOpen }))}
                            aria-expanded={isOpen}
                            className="group mb-4 flex w-full items-center gap-2 border-b border-line/70 pb-2 text-left transition-colors hover:border-text-subtle/40"
                          >
                            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-subtle transition-colors group-hover:text-text-muted">
                              {name || t('courses.campaign_none')}
                            </span>
                            <span className="text-[11px] tabular-nums text-text-subtle/70">{list.length}</span>
                            <motion.span
                              animate={{ rotate: isOpen ? 180 : 0 }}
                              transition={{ duration: reduce ? 0 : 0.35, ease }}
                              className="ml-auto text-text-subtle"
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </motion.span>
                          </button>
                          <AnimatePresence initial={false}>
                            {isOpen && (
                              <motion.div
                                initial={reduce ? false : { opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.38, ease }}
                                className="overflow-hidden"
                              >
                                <div className="pt-1">
                                  <CourseGrid courses={list} onEnrolled={reload} reduce={reduce} />
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <CourseGrid courses={exploreCourses} onEnrolled={reload} reduce={reduce} />
                )}
              </motion.section>
            )}
          </AnimatePresence>

          {myCourses.length === 0 && exploreCourses.length === 0 && (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease }}
              className="py-20 text-center"
            >
              <Search className="mx-auto mb-4 h-7 w-7 text-text-subtle" />
              <p className="mb-1 text-[15px] font-medium text-text">{t('courses.no_results')}</p>
              <p className="mb-6 text-[13.5px] text-text-muted">{t('courses.no_results_hint')}</p>
              <button
                onClick={clearAll}
                className="rounded-full border border-line px-4 py-2 text-[13px] text-text-muted transition-colors duration-300 hover:border-text-subtle hover:text-text"
              >
                {t('courses.filter_clear_all')}
              </button>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}
