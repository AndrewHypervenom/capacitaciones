// src/admin/pages/progress/ProgressOverview.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users, UserCheck, Award, Gauge, HeartHandshake, ClipboardCheck, Download,
  Search, RefreshCw, Sparkles, TrendingUp, Clock, Layers, GraduationCap,
  ChevronRight, Inbox, FileSpreadsheet, CalendarRange, Filter, BarChart3,
  MessageSquareQuote, AlertTriangle, Hourglass, CircleSlash,
  CalendarClock, Copy, ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUserStore } from '@/stores/userStore';
import { toast } from '@/stores/toastStore';
import { cn } from '@/lib/cn';
import { fold } from '@/lib/normalize';
import { Select } from '@/components/ui/Select';
import { Tooltip } from '@/components/ui/Tooltip';
import { countryLabel, countryLabelWithFlag } from '@/lib/countries';
import { UserProgressDrawer } from '@/admin/components/UserProgressDrawer';
import type { Profile, OrgUnit } from '@/types/database';
import { downloadWorkbook, xlsDate, xlsHours, type Sheet, type SheetRow } from '@/lib/exportXlsx';
import { formatElapsed } from '@/hooks/useModuleTimer';
import {
  useProgramData, npsFromHistogram, mergeNps, isCourseCompleted,
  type ProgramPerson, type ProgramCourse, type ActivityRow,
} from './useProgramData';
import {
  KpiCard, SectionCard, StackedBar, Donut, NpsGauge, RankBar, PersonAvatar,
  SortableTh, EmptyState, SkeletonRows, StatusPill, FilterChip, Menu, MenuItem, Rise,
  GREEN, MAGENTA, BLUE, AMBER, VIOLET, CYAN,
} from './OverviewChrome';
import { scoreHex, useSearchHotkey, Highlight } from './ModulesChrome';
import { StatStrip } from './ProgressChrome';
import { CourseProgressDrawer } from './CourseProgressDrawer';
import { pickLang } from '@/lib/contentLang';
import { getOrganizations, getOrgUnits } from '@/services/org.service';

/** Miles separados. Un "2015" a secas se lee mal al lado de un porcentaje. */
const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n.toLocaleString('es');

/* ────────────────────────────────────────────────────────────────────────────
   Panorama de Progreso.

   La pregunta que responde esta pantalla no es "¿qué me falta calificar?" —esa
   es la Bandeja— sino "¿cómo va el programa?": a cuánta gente llegó, quiénes
   participaron, cómo les fue, cuántos se certificaron y qué opinan. De ahí que
   todo esté ordenado de lo general a lo particular, con UN control por
   pregunta y con cada cifra exportable a Excel para cruzarla con lo que el
   negocio ya tiene.
   ──────────────────────────────────────────────────────────────────────────── */

type Tab = 'summary' | 'people' | 'courses' | 'certificates' | 'exam' | 'survey';
type Focus = 'none' | 'started' | 'idle' | 'certified' | 'pending' | 'risk' | 'mandatory' | 'overdue';
type RangeKey = '7' | '30' | '90' | 'all';
type PeopleSort =
  | 'name' | 'campaign' | 'assigned' | 'mandatory' | 'syllabus' | 'started' | 'completed'
  | 'certified' | 'score' | 'time' | 'last' | 'pending' | 'overdue';
type CourseSort = 'title' | 'assigned' | 'started' | 'completed' | 'certified' | 'overdue' | 'score' | 'nps' | 'last';
type CertSort = 'person' | 'course' | 'campaign' | 'score' | 'date';

const RANGE_DAYS: Record<RangeKey, number | null> = { '7': 7, '30': 30, '90': 90, all: null };

/** Clave para agrupar a quien no tiene cargo o país en su perfil. */
const NO_VALUE = '__none__';

/**
 * Valores distintos de un eje de segmentación, con cuántas personas hay en cada
 * uno y ordenados por tamaño. Se derivan de la gente real: un catálogo fijo de
 * cargos envejecería mal y escondería justo lo que interesa ver (quién no tiene
 * el dato puesto).
 */
function segmentOptions(
  people: ProgramPerson[],
  pick: (p: ProgramPerson) => string | null,
): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const p of people) {
    if (p.role !== 'learner' && p.role !== 'capacitador' && p.role !== 'superadmin') continue;
    const key = pick(p) ?? NO_VALUE;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => (a.value === NO_VALUE ? 1 : b.value === NO_VALUE ? -1 : b.count - a.count));
}

/** Nota media a color, con "sin datos" explícito (nunca un 0 que no ocurrió). */
function ScoreCell({ score }: { score: number | null }) {
  if (score === null) return <span className="text-text-subtle">—</span>;
  return (
    <span className="font-bold tabular-nums" style={{ color: scoreHex(score) }}>
      {score}
    </span>
  );
}

/**
 * Cursos vencidos. Cero NO se pinta como "0": un cero de verdad y un curso sin
 * plazo configurado se leen igual en una tabla, y el guion no promete nada.
 */
function OverdueCell({ n }: { n: number }) {
  if (n <= 0) return <span className="text-text-subtle">—</span>;
  return (
    <span className="inline-flex items-center gap-1 font-bold tabular-nums text-red-600 dark:text-red-400">
      <CalendarClock className="h-3.5 w-3.5" />
      {n}
    </span>
  );
}

function relative(ms: number | null, lang: string, never: string): string {
  if (!ms) return never;
  const diff = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(ms).toLocaleDateString(lang);
}

export default function ProgressOverview({ onOpenInbox }: { onOpenInbox?: () => void }) {
  const { t, i18n } = useTranslation();
  const { isSuperAdmin } = useAuth();
  const lang = (useUserStore((s) => s.language) ?? 'es') as 'es' | 'en' | 'pt';

  const [campaign, setCampaign] = useState<string>('all');
  const [course, setCourse] = useState<string>('all');
  /* CR y área: los ejes con los que ahora se reparte la formación, y los que
     acotan lo que este tablero tiene que leer. */
  const [operation, setOperation] = useState<string>('all');
  const [area, setArea] = useState<string>('all');
  const [units, setUnits] = useState<OrgUnit[]>([]);

  /**
   * Hasta que no se elige un CR, un área o un curso, NO se consulta nada.
   *
   * El tablero lee dieciocho tablas de un tirón. Hacerlo al abrir la pantalla es
   * trabajo que casi siempre se tira: nadie entra aquí a mirar "todo", se entra
   * a mirar UN CR, UN área o UN curso. El programa no cuenta como alcance a
   * propósito — es el eje que se está jubilando, y dejar que sirviera de
   * atajo mantendría viva justo la costumbre que se quiere quitar.
   */
  const scopeChosen = operation !== 'all' || area !== 'all' || course !== 'all';

  /* El catálogo SÍ se pide de entrada: son noventa y cinco filas de dos
     columnas, y es precisamente lo que hay que poder elegir para que se cargue
     todo lo demás. Pedirlo bajo demanda dejaría los selectores vacíos. */
  useEffect(() => {
    let alive = true;
    void getOrganizations()
      .then((orgs) => (orgs[0] ? getOrgUnits(orgs[0].id) : []))
      .then((list) => { if (alive) setUnits(list); })
      .catch(() => { if (alive) setUnits([]); });
    return () => { alive = false; };
  }, []);

  const data = useProgramData(lang, !isSuperAdmin, scopeChosen);
  const {
    loading, error, people, courses, cells, campaigns, activity, certificates, certificatesKnown,
    assignmentsKnown, journeyKnown, modulesByCourse, doneModules, study, loadStudyTime, surveys, loadSurveys,
    exams, loadExams, reload,
  } = data;

  const [tab, setTab] = useState<Tab>('summary');
  const [range, setRange] = useState<RangeKey>('all');
  const [onlyLearners, setOnlyLearners] = useState(true);
  const [job, setJob] = useState<string>('all');
  const [country, setCountry] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<Focus>('none');
  const [peopleSort, setPeopleSort] = useState<{ key: PeopleSort; dir: 'asc' | 'desc' }>({ key: 'last', dir: 'desc' });
  const [courseSort, setCourseSort] = useState<{ key: CourseSort; dir: 'asc' | 'desc' }>({ key: 'assigned', dir: 'desc' });
  const [certSort, setCertSort] = useState<{ key: CertSort; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [drawerPerson, setDrawerPerson] = useState<ProgramPerson | null>(null);
  const [drawerCourse, setDrawerCourse] = useState<ProgramCourse | null>(null);
  const [exporting, setExporting] = useState(false);
  const searchRef = useSearchHotkey();

  const never = t('admin.progress_overview.never', 'Sin actividad');
  // Corte de la ventana de tiempo. Se calcula en cada render a propósito: es un
  // "hace N días" contado desde ahora, no un valor que se pueda congelar en un
  // memo (al día siguiente estaría mintiendo).
  const rangeDays = RANGE_DAYS[range];
  const since = rangeDays === null ? null : Date.now() - rangeDays * 86_400_000;

  /* ── Alcance: campaña + rol + ventana de tiempo ───────────────────────── */

  /**
   * Los cursos DE la campaña: los suyos y los que se le asignaron entera.
   * Se calcula antes que la gente porque es lo que define quién cuenta.
   */
  const campaignOwnCourseIds = useMemo(() => {
    if (campaign === 'all') return null;
    const ids = new Set<string>();
    for (const c of courses) {
      if (c.campaignId === campaign || c.campaignsAssigned.includes(campaign)) ids.add(c.id);
    }
    return ids;
  }, [campaign, courses]);

  /**
   * La gente de la campaña.
   *
   * NO es solo "quien tiene esta campaña en su perfil". Filtrar por
   * `profiles.campaign_id` dejaba fuera a todo el que está INSCRITO en un curso
   * de la campaña viniendo de otra (que es lo normal con el catálogo
   * compartido), y por eso la campaña salía vacía aunque tuviera gente
   * avanzando en sus cursos. Cuentan las dos cosas: los de casa y los inscritos.
   */
  const campaignPeopleIds = useMemo(() => {
    if (campaignOwnCourseIds === null) return null;
    const ids = new Set(people.filter((p) => p.campaignId === campaign).map((p) => p.id));
    for (const cell of cells) {
      if (cell.assigned && campaignOwnCourseIds.has(cell.courseId)) ids.add(cell.userId);
    }
    return ids;
  }, [campaign, people, cells, campaignOwnCourseIds]);

  /**
   * Cursos del alcance: los de la campaña, más los que su gente de casa tenga
   * asignados de OTRAS campañas — ese progreso también es de esta campaña, y
   * mirar solo `campaign_id` lo dejaba fuera del tablero.
   */
  const campaignCourseIds = useMemo(() => {
    if (campaignOwnCourseIds === null) return null;
    // La gente de casa, sin los cortes de cargo/país: filtrar por un cargo no
    // debe cambiar cuáles son los cursos de la campaña.
    const members = new Set(people.filter((p) => p.campaignId === campaign).map((p) => p.id));
    const ids = new Set(campaignOwnCourseIds);
    for (const cell of cells) if (cell.assigned && members.has(cell.userId)) ids.add(cell.courseId);
    return ids;
  }, [campaign, people, cells, campaignOwnCourseIds]);

  /**
   * Los cursos que se pueden elegir en el filtro: los del alcance de la
   * campaña, SIN aplicar el filtro de curso (si no, elegir uno vaciaría la
   * lista y no habría cómo volver a cambiarlo).
   */
  const courseOptions = useMemo(
    () => (campaignCourseIds === null ? courses : courses.filter((c) => campaignCourseIds.has(c.id)))
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title)),
    [courses, campaignCourseIds],
  );

  /**
   * Curso elegido, ya validado contra el alcance actual: cambiar de campaña no
   * puede dejar seleccionado un curso que esa campaña no tiene (se leería como
   * "no hay nadie" en vez de "ese curso no es de aquí").
   */
  const activeCourse = useMemo(
    () => (course !== 'all' && !courseOptions.some((c) => c.id === course) ? 'all' : course),
    [course, courseOptions],
  );

  const scopedCourses = useMemo(
    () => (activeCourse === 'all' ? courseOptions : courseOptions.filter((c) => c.id === activeCourse)),
    [courseOptions, activeCourse],
  );
  const courseIds = useMemo(() => new Set(scopedCourses.map((c) => c.id)), [scopedCourses]);

  /**
   * Quién cuenta cuando se filtra por UN curso: las personas que lo tienen
   * asignado o que ya hicieron algo en él. Sin esto, el tablero seguía
   * contando a gente que no tiene nada que ver con el curso elegido.
   */
  const coursePeopleIds = useMemo(() => {
    if (activeCourse === 'all') return null;
    const ids = new Set<string>();
    for (const cell of cells) {
      if (cell.courseId === activeCourse && (cell.assigned || cell.started)) ids.add(cell.userId);
    }
    return ids;
  }, [cells, activeCourse]);

  const scopedPeople = useMemo(() => {
    return people.filter((p) => {
      if (onlyLearners && p.role !== 'learner') return false;
      if (campaignPeopleIds !== null && !campaignPeopleIds.has(p.id)) return false;
      if (coursePeopleIds !== null && !coursePeopleIds.has(p.id)) return false;
      // Cargo y país salen del perfil; "sin dato" es un valor más y se puede
      // filtrar por él (suele ser el primer hallazgo: gente sin cargo).
      if (job !== 'all' && (p.jobTitle ?? NO_VALUE) !== job) return false;
      if (country !== 'all' && (p.country ?? NO_VALUE) !== country) return false;
      // CR y área: los ejes nuevos. Se comparan por id, no por nombre, porque
      // el nombre del CR puede corregirse en la próxima carga de la nómina.
      if (operation !== 'all' && p.operationId !== operation) return false;
      if (area !== 'all' && p.areaId !== area) return false;
      return true;
    });
  }, [people, onlyLearners, campaignPeopleIds, coursePeopleIds, job, country, operation, area]);

  /** Opciones de los cortes, sacadas de la gente que hay (no de un catálogo). */
  const jobOptions = useMemo(() => segmentOptions(people, (p) => p.jobTitle), [people]);
  const countryOptions = useMemo(() => segmentOptions(people, (p) => p.country), [people]);

  const peopleIds = useMemo(() => new Set(scopedPeople.map((p) => p.id)), [scopedPeople]);

  /** Cuántos de los que se ven vienen de otra campaña (inscritos, no de casa). */
  const guestCount = useMemo(
    () => (campaign === 'all' ? 0 : scopedPeople.filter((p) => p.campaignId !== campaign).length),
    [scopedPeople, campaign],
  );


  const scopedActivity = useMemo(
    () => activity.filter((a) =>
      peopleIds.has(a.userId) &&
      (!a.courseId || courseIds.has(a.courseId)) &&
      (since === null || a.at >= since)),
    [activity, peopleIds, courseIds, since],
  );

  const scopedCells = useMemo(
    () => cells.filter((c) => peopleIds.has(c.userId) && courseIds.has(c.courseId)),
    [cells, peopleIds, courseIds],
  );

  const scopedCerts = useMemo(
    () => certificates.filter((c) =>
      peopleIds.has(c.userId) && courseIds.has(c.courseId) &&
      (since === null || new Date(c.issuedAt).getTime() >= since)),
    [certificates, peopleIds, courseIds, since],
  );

  /* ── Personas recalculadas dentro del alcance ─────────────────────────── */

  const rows = useMemo(() => {
    // Los totales de cada persona se rehacen sobre las celdas del alcance: si se
    // filtra por campaña, "5 cursos asignados" tiene que ser 5 EN ESA campaña.
    type Agg = {
      assigned: number; mandatory: number; mandatoryDone: number; started: number;
      completed: number; certified: number; pending: number; overdue: number;
      modulesDone: number; modulesTotal: number; last: number | null;
    };
    const byUser = new Map<string, Agg>();
    for (const cell of scopedCells) {
      const agg: Agg = byUser.get(cell.userId) ?? {
        assigned: 0, mandatory: 0, mandatoryDone: 0, started: 0, completed: 0,
        certified: 0, pending: 0, overdue: 0, modulesDone: 0, modulesTotal: 0, last: null,
      };
      if (cell.assigned) agg.assigned++;
      if (cell.started) agg.started++;
      if (cell.certifiedAt) agg.certified++;
      if (isCourseCompleted(cell)) {
        agg.completed++;
        if (cell.mandatory) agg.mandatoryDone++;
      }
      if (cell.mandatory) agg.mandatory++;
      if (cell.overdue) agg.overdue++;
      agg.modulesDone += cell.modulesDone;
      if (cell.assigned) agg.modulesTotal += cell.modulesTotal;
      agg.pending += cell.pending;
      if (cell.lastAt && (!agg.last || cell.lastAt > agg.last)) agg.last = cell.lastAt;
      byUser.set(cell.userId, agg);
    }
    const score = new Map<string, { sum: number; n: number }>();
    for (const a of scopedActivity) {
      const s = score.get(a.userId) ?? { sum: 0, n: 0 };
      s.sum += a.score; s.n++;
      score.set(a.userId, s);
    }
    return scopedPeople.map((p) => {
      const agg = byUser.get(p.id);
      const s = score.get(p.id);
      return {
        ...p,
        assigned: agg?.assigned ?? 0,
        mandatory: agg?.mandatory ?? 0,
        mandatoryDone: agg?.mandatoryDone ?? 0,
        started: agg?.started ?? 0,
        completed: agg?.completed ?? 0,
        certified: agg?.certified ?? 0,
        modulesDone: agg?.modulesDone ?? 0,
        modulesTotal: agg?.modulesTotal ?? 0,
        pendingReviews: agg?.pending ?? 0,
        overdue: agg?.overdue ?? 0,
        lastActivity: agg?.last ?? p.lastActivity,
        avgScore: s && s.n > 0 ? Math.round(s.sum / s.n) : null,
      } as ProgramPerson;
    });
  }, [scopedPeople, scopedCells, scopedActivity]);

  /* ── KPIs ─────────────────────────────────────────────────────────────── */

  const kpi = useMemo(() => {
    // "Alcanzadas" = a quienes el programa les llegó de verdad: tienen algún
    // curso asignado o ya hicieron algo. Sin datos de asignación visibles (un
    // capacitador al que la RLS no le deja leer las tablas de asignación) se
    // cae al universo de personas del alcance, que es lo único que se sabe.
    const reached = assignmentsKnown
      ? rows.filter((p) => p.assigned > 0 || p.started > 0)
      : rows;
    const total = reached.length;
    const started = reached.filter((p) => p.started > 0).length;
    const idle = total - started;
    // Todo lo demás se cuenta sobre ese mismo conjunto: mezclar universos era
    // justo lo que hacía que dos cifras de la misma pantalla no cuadraran.
    const certified = reached.filter((p) => p.certified > 0).length;
    const completedCourses = reached.reduce((s, p) => s + p.completed, 0);
    const pending = reached.reduce((s, p) => s + p.pendingReviews, 0);
    // "En riesgo": participó, pero su promedio no alcanza el mínimo de aprobación.
    const risk = reached.filter((p) => p.started > 0 && p.avgScore !== null && p.avgScore < 70).length;
    const scored = reached.filter((p) => p.avgScore !== null);
    const avgScore = scored.length
      ? Math.round(scored.reduce((s, p) => s + (p.avgScore ?? 0), 0) / scored.length)
      : null;
    const studyMs = study.loaded ? reached.reduce((s, p) => s + p.studyMs, 0) : 0;

    // Cumplimiento de la formación OBLIGATORIA: es la tasa que se reporta hacia
    // afuera (auditoría, cliente, matriz de capacitación) y no es la misma que
    // la finalización general — mezclarlas era esconder el dato que importa.
    const mandatoryTotal = reached.reduce((s, p) => s + p.mandatory, 0);
    const mandatoryDone = reached.reduce((s, p) => s + p.mandatoryDone, 0);
    /* Avance de temario: POR PERSONA, no por asignación.
     *
     * Sumar los módulos de todo el mundo daba "354 de 64.502" — un denominador
     * que sale de multiplicar los cursos por la gente, y que crece cada vez que
     * alguien asigna un curso a todos. Ese 1% no medía el avance: medía cuánto
     * se había repartido.
     *
     * Ahora cada persona aporta SU porcentaje y se promedia. El número deja de
     * depender del reparto. Va con la MEDIANA al lado a propósito: con mucha
     * gente sin empezar, la media la levantan unos pocos muy avanzados, y la
     * mediana es la que dice cómo va la persona del medio.
     */
    const modulesDone = reached.reduce((s, p) => s + p.modulesDone, 0);
    const modulesTotal = reached.reduce((s, p) => s + p.modulesTotal, 0);
    const conTemario = reached.filter((p) => p.modulesTotal > 0);
    const pcts = conTemario
      .map((p) => (p.modulesDone / p.modulesTotal) * 100)
      .sort((a, b) => a - b);
    const syllabusAvg = pcts.length
      ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
      : null;
    const syllabusMedian = pcts.length
      ? Math.round(
          pcts.length % 2
            ? pcts[(pcts.length - 1) / 2]
            : (pcts[pcts.length / 2 - 1] + pcts[pcts.length / 2]) / 2,
        )
      : null;

    // Fuera de plazo. Se reportan las dos cifras porque responden preguntas
    // distintas: a cuánta GENTE hay que perseguir, y cuántas ASIGNACIONES se
    // pasaron (una sola persona puede arrastrar cinco cursos vencidos).
    const overduePeople = reached.filter((p) => p.overdue > 0).length;
    const overdueAssignments = reached.reduce((s, p) => s + p.overdue, 0);

    return {
      total, started, idle, certified, completedCourses, pending, risk, avgScore, studyMs,
      overduePeople, overdueAssignments,
      mandatoryTotal, mandatoryDone,
      compliance: mandatoryTotal > 0 ? Math.round((mandatoryDone / mandatoryTotal) * 100) : null,
      modulesDone, modulesTotal,
      /** Avance medio POR PERSONA. Ver el comentario de arriba. */
      syllabus: syllabusAvg,
      syllabusMedian,
      syllabusPeople: pcts.length,
      participation: total > 0 ? Math.round((started / total) * 100) : 0,
      deliveries: scopedActivity.length,
      certificates: scopedCerts.length,
    };
  }, [rows, study.loaded, scopedActivity.length, scopedCerts.length, assignmentsKnown]);

  /* ── Tendencia: el mismo periodo, inmediatamente antes ─────────────────
     Un número sin comparación no se reporta, se mira. Solo tiene sentido con
     una ventana de tiempo elegida: contra "todo el histórico" no hay un
     "antes" con el que comparar, y ahí no se pinta ningún delta. */
  const trend = useMemo(() => {
    if (since === null) return null;
    const span = Date.now() - since;
    const prevFrom = since - span;
    const inPrev = (t: number) => t >= prevFrom && t < since;

    const prevActivity = activity.filter(
      (a) => peopleIds.has(a.userId) && (!a.courseId || courseIds.has(a.courseId)) && inPrev(a.at),
    );
    const prevCerts = certificates.filter(
      (c) => peopleIds.has(c.userId) && courseIds.has(c.courseId) && inPrev(new Date(c.issuedAt).getTime()),
    );
    const activeNow = new Set(scopedActivity.map((a) => a.userId)).size;
    const activePrev = new Set(prevActivity.map((a) => a.userId)).size;

    return {
      activePeople: activeNow - activePrev,
      certificates: scopedCerts.length - prevCerts.length,
      deliveries: scopedActivity.length - prevActivity.length,
    };
  }, [since, activity, certificates, peopleIds, courseIds, scopedActivity, scopedCerts]);

  const trendLabel = t('admin.progress_overview.vs_previous', 'Frente al periodo anterior de la misma duración');

  const nps = useMemo(() => {
    const list = scopedCourses
      .map((c) => surveys.byCourse[c.id])
      .filter(Boolean);
    return mergeNps(list);
  }, [scopedCourses, surveys.byCourse]);

  /* ── Cursos recalculados ──────────────────────────────────────────────── */

  const courseRows = useMemo(() => {
    const agg = new Map<string, { assigned: number; direct: number; started: number; completed: number; certified: number; pending: number; overdue: number; last: number | null; sum: number; n: number }>();
    for (const cell of scopedCells) {
      const a = agg.get(cell.courseId) ?? { assigned: 0, direct: 0, started: 0, completed: 0, certified: 0, pending: 0, overdue: 0, last: null, sum: 0, n: 0 };
      if (cell.assigned) { a.assigned++; if (!cell.viaCampaign) a.direct++; }
      if (cell.overdue) a.overdue++;
      if (cell.started) a.started++;
      if (cell.certifiedAt) a.certified++;
      if (isCourseCompleted(cell)) a.completed++;
      a.pending += cell.pending;
      if (cell.lastAt && (!a.last || cell.lastAt > a.last)) a.last = cell.lastAt;
      agg.set(cell.courseId, a);
    }
    for (const act of scopedActivity) {
      if (!act.courseId) continue;
      const a = agg.get(act.courseId);
      if (!a) continue;
      a.sum += act.score; a.n++;
    }
    return scopedCourses.map((c) => {
      const a = agg.get(c.id);
      return {
        ...c,
        assigned: a?.assigned ?? 0,
        directAssigned: a?.direct ?? 0,
        started: a?.started ?? 0,
        completed: a?.completed ?? 0,
        certified: a?.certified ?? 0,
        pendingReviews: a?.pending ?? 0,
        overdue: a?.overdue ?? 0,
        lastActivity: a?.last ?? null,
        avgScore: a && a.n > 0 ? Math.round(a.sum / a.n) : null,
      } as ProgramCourse;
    });
  }, [scopedCourses, scopedCells, scopedActivity]);

  /* ── Tabla de personas: foco, búsqueda y orden ────────────────────────── */

  const visiblePeople = useMemo(() => {
    const q = fold(query);
    let list = rows.filter((p) => {
      if (focus === 'started' && p.started === 0) return false;
      if (focus === 'idle' && p.started > 0) return false;
      if (focus === 'certified' && p.certified === 0) return false;
      if (focus === 'pending' && p.pendingReviews === 0) return false;
      if (focus === 'risk' && !(p.started > 0 && p.avgScore !== null && p.avgScore < 70)) return false;
      if (focus === 'mandatory' && !(p.mandatory > p.mandatoryDone)) return false;
      if (focus === 'overdue' && p.overdue === 0) return false;
      if (!q) return true;
      return fold(p.name).includes(q) || fold(p.email ?? '').includes(q);
    });
    const dir = peopleSort.dir === 'asc' ? 1 : -1;
    const val = (p: ProgramPerson): string | number => {
      switch (peopleSort.key) {
        case 'name': return p.name.toLowerCase();
        case 'campaign': return (p.campaignName ?? '').toLowerCase();
        case 'assigned': return p.assigned;
        case 'mandatory': return p.mandatory > 0 ? p.mandatoryDone / p.mandatory : -1;
        case 'syllabus': return p.modulesTotal > 0 ? p.modulesDone / p.modulesTotal : -1;
        case 'started': return p.started;
        case 'completed': return p.completed;
        case 'certified': return p.certified;
        case 'pending': return p.pendingReviews;
        case 'overdue': return p.overdue;
        case 'score': return p.avgScore ?? -1;
        case 'time': return p.studyMs;
        case 'last':
        default: return p.lastActivity ?? 0;
      }
    };
    list = [...list].sort((a, b) => {
      const va = val(a); const vb = val(b);
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
    return list;
  }, [rows, focus, query, peopleSort]);

  const visibleCourses = useMemo(() => {
    const q = fold(query);
    const list = courseRows.filter((c) => !q || fold(c.title).includes(q));
    const dir = courseSort.dir === 'asc' ? 1 : -1;
    const val = (c: ProgramCourse): string | number => {
      switch (courseSort.key) {
        case 'title': return c.title.toLowerCase();
        case 'started': return c.started;
        case 'completed': return c.completed;
        case 'certified': return c.certified;
        case 'overdue': return c.overdue;
        case 'score': return c.avgScore ?? -1;
        case 'nps': return npsFromHistogram(surveys.byCourse[c.id]?.q2_hist).score ?? -101;
        case 'last': return c.lastActivity ?? 0;
        case 'assigned':
        default: return c.assigned;
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a); const vb = val(b);
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
  }, [courseRows, query, courseSort, surveys.byCourse]);

  /* ── Certificados emitidos, uno por fila ──────────────────────────────
     La lista de diplomas es la prueba que se pide fuera del equipo ("¿quién se
     certificó?"), y hasta ahora solo existía como un número en un KPI. Sale del
     mismo alcance que el resto del tablero (`scopedCerts`: programa, curso,
     cargo, país y rango ya aplicados), así que lo que se ve aquí cuadra con lo
     que dice la tarjeta de arriba. */
  const certRows = useMemo(() => {
    const personById = new Map(rows.map((p) => [p.id, p]));
    const courseById = new Map(courses.map((c) => [c.id, c]));
    const q = fold(query);
    const list = scopedCerts
      .map((c) => {
        const person = personById.get(c.userId);
        const courseRow = courseById.get(c.courseId);
        /* "Certificado" no es "al día": el diploma se emitió contra el temario
           que había ese día. Si el curso creció después, se dice —el certificado
           sigue valiendo, lo que cambió fue el curso. Misma regla que
           `courseState('certified_outdated')`. */
        const syllabus = modulesByCourse[c.courseId]?.length ?? courseRow?.modules ?? 0;
        const done = doneModules[`${c.userId}|${c.courseId}`]?.length ?? 0;
        const missing = syllabus > 0 && done < syllabus ? syllabus - done : 0;
        return {
          key: `${c.userId}|${c.courseId}|${c.certId}`,
          userId: c.userId,
          courseId: c.courseId,
          certId: c.certId,
          score: c.score,
          issuedAt: new Date(c.issuedAt).getTime(),
          person,
          personName: person?.name ?? c.userId,
          email: person?.email ?? null,
          avatarUrl: person?.avatarUrl ?? null,
          jobTitle: person?.jobTitle ?? null,
          country: person?.country ?? null,
          courseTitle: courseRow?.title ?? c.courseId,
          courseIcon: courseRow?.icon ?? null,
          /* El programa DUEÑO del curso, que es por el que se clasifica un
             certificado; el de la persona va debajo solo cuando no coinciden
             (curso compartido), porque si no se lee como un error. */
          programName: courseRow?.campaignName ?? null,
          personProgram: person?.campaignName ?? null,
          missing,
        };
      })
      .filter((r) => !q
        || fold(r.personName).includes(q)
        || fold(r.email ?? '').includes(q)
        || fold(r.courseTitle).includes(q)
        || fold(r.certId).includes(q));

    const dir = certSort.dir === 'asc' ? 1 : -1;
    const val = (r: typeof list[number]): string | number => {
      switch (certSort.key) {
        case 'person': return r.personName.toLowerCase();
        case 'course': return r.courseTitle.toLowerCase();
        case 'campaign': return (r.programName ?? '').toLowerCase();
        case 'score': return r.score ?? -1;
        case 'date':
        default: return r.issuedAt;
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a); const vb = val(b);
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir;
    });
  }, [scopedCerts, rows, courses, modulesByCourse, doneModules, query, certSort]);

  /** Certificados que ya no cubren el temario completo del curso. */
  const outdatedCerts = useMemo(() => certRows.filter((r) => r.missing > 0).length, [certRows]);

  /* ── Pulso de actividad de los últimos 14 días ────────────────────────── */

  const pulse = useMemo(() => {
    const days = 14;
    const bucket = new Array(days).fill(0) as number[];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const startMs = start.getTime() - (days - 1) * 86_400_000;
    for (const a of scopedActivity) {
      if (a.at < startMs) continue;
      const idx = Math.floor((a.at - startMs) / 86_400_000);
      if (idx >= 0 && idx < days) bucket[idx]++;
    }
    return { bucket, max: Math.max(1, ...bucket), startMs };
  }, [scopedActivity]);

  /* ── Cargas diferidas según la pestaña ────────────────────────────────── */

  useEffect(() => {
    if (tab === 'people' || tab === 'summary') loadStudyTime();
  }, [tab, loadStudyTime]);

  useEffect(() => {
    if (tab === 'survey' && courses.length > 0) void loadSurveys(courses.map((c) => c.id));
  }, [tab, courses, loadSurveys]);

  useEffect(() => {
    if (tab === 'exam' && courses.length > 0) void loadExams(courses.map((c) => c.id));
  }, [tab, courses, loadExams]);

  /* ── Examen final: agregados del alcance ──────────────────────────────── */

  /* Recibe el mapa en vez de leerlo del estado: la exportación lo calcula con
     lo que acaba de traer, sin tener que esperar a que React vuelva a pintar. */
  const computeExamSummary = useCallback((byCourse: typeof exams.byCourse) => {
    const perCourse: Array<{
      course: ProgramCourse;
      taken: number; passed: number; passRate: number;
      avgBest: number | null; attemptsAvg: number; inReinforcement: number;
    }> = [];
    // Dominios flojos, sumados de todo el alcance: es la pregunta cara —
    // "¿qué NO se está aprendiendo?"— y solo se puede responder agregando.
    const weak = new Map<string, { name: string; hits: number; sum: number }>();
    let taken = 0, passed = 0, attempts = 0, scoreSum = 0, scored = 0, reinforcement = 0;

    for (const c of scopedCourses) {
      const rows = byCourse[c.id];
      if (!rows || rows.length === 0) continue;
      // Solo cuenta quien de verdad presentó: tener el examen abierto no es dato.
      const presented = rows.filter((r) => r.attempts > 0);
      if (presented.length === 0) continue;
      const p = presented.filter((r) => r.passed).length;
      const best = presented.map((r) => r.best_score).filter((s): s is number => s !== null);
      const att = presented.reduce((s, r) => s + r.attempts, 0);
      const reinf = presented.filter((r) => r.reinforcement === 'pending').length;

      taken += presented.length;
      passed += p;
      attempts += att;
      scoreSum += best.reduce((s, v) => s + v, 0);
      scored += best.length;
      reinforcement += reinf;

      for (const r of presented) {
        for (const d of r.weak_domains ?? []) {
          const key = d.domain_id;
          const name = pickLang(d.name_es, d.name_en, d.name_pt, lang);
          const cur = weak.get(key) ?? { name, hits: 0, sum: 0 };
          cur.hits++;
          cur.sum += d.pct ?? 0;
          weak.set(key, cur);
        }
      }

      perCourse.push({
        course: c,
        taken: presented.length,
        passed: p,
        passRate: Math.round((p / presented.length) * 100),
        avgBest: best.length ? Math.round(best.reduce((s, v) => s + v, 0) / best.length) : null,
        attemptsAvg: Math.round((att / presented.length) * 10) / 10,
        inReinforcement: reinf,
      });
    }

    return {
      perCourse: perCourse.sort((a, b) => b.taken - a.taken),
      taken,
      passed,
      passRate: taken > 0 ? Math.round((passed / taken) * 100) : null,
      avgScore: scored > 0 ? Math.round(scoreSum / scored) : null,
      attemptsAvg: taken > 0 ? Math.round((attempts / taken) * 10) / 10 : 0,
      reinforcement,
      weakDomains: [...weak.entries()]
        .map(([id, w]) => ({ id, name: w.name, hits: w.hits, avg: Math.round(w.sum / w.hits) }))
        .sort((a, b) => b.hits - a.hits || a.avg - b.avg)
        .slice(0, 8),
    };
  }, [scopedCourses, lang]);

  const examSummary = useMemo(
    () => computeExamSummary(exams.byCourse),
    [computeExamSummary, exams.byCourse],
  );

  type ExamSummary = ReturnType<typeof computeExamSummary>;

  /* ── Exportaciones ────────────────────────────────────────────────────── */

  const L = {
    person: t('admin.progress_overview.col_person', 'Persona'),
    email: t('admin.progress_overview.col_email', 'Correo'),
    campaignCol: t('admin.progress_overview.col_campaign', 'Programa'),
    role: t('admin.progress_overview.col_role', 'Rol'),
    assigned: t('admin.progress_overview.col_assigned', 'Asignados'),
    started: t('admin.progress_overview.col_started', 'Iniciados'),
    completed: t('admin.progress_overview.col_completed', 'Completados'),
    certified: t('admin.progress_overview.col_certified', 'Certificados'),
    score: t('admin.progress_overview.col_score', 'Nota promedio'),
    hours: t('admin.progress_overview.col_hours', 'Horas de estudio'),
    last: t('admin.progress_overview.col_last', 'Última actividad'),
    pending: t('admin.progress_overview.col_pending', 'Pendientes por evaluar'),
    course: t('admin.progress_overview.col_course', 'Curso'),
    published: t('admin.progress_overview.col_published', 'Publicado'),
    nps: t('admin.progress_overview.col_nps', 'NPS'),
    responses: t('admin.progress_overview.col_responses', 'Respuestas'),
    date: t('admin.progress_overview.col_date', 'Fecha'),
    certId: t('admin.progress_overview.col_cert_id', 'Código'),
    activity: t('admin.progress_overview.col_activity', 'Actividad'),
    module: t('admin.progress_overview.col_module', 'Módulo'),
    section: t('admin.progress_overview.col_section', 'Sección'),
    type: t('admin.progress_overview.col_type', 'Tipo'),
    state: t('admin.progress_overview.col_state', 'Estado'),
    comment: t('admin.progress_overview.col_comment', 'Comentario'),
    jobCol: t('admin.progress_overview.col_job', 'Cargo'),
    countryCol: t('admin.progress_overview.col_country', 'País'),
    mandatory: t('admin.progress_overview.col_mandatory_total', 'Obligatorios asignados'),
    mandatoryDone: t('admin.progress_overview.col_mandatory_done', 'Obligatorios terminados'),
    syllabus: t('admin.progress_overview.col_syllabus_pct', 'Avance del temario (%)'),
    mandatoryCol: t('admin.progress_overview.mandatory', 'Obligatorio'),
    modulesCol: t('admin.progress_overview.col_modules', 'Módulos'),
    overdue: t('admin.progress_overview.col_overdue', 'Vencidos'),
    verifyUrl: t('admin.progress_overview.col_verify_url', 'Enlace de verificación'),
    yes: t('admin.progress_overview.yes', 'Sí'),
    no: t('admin.progress_overview.no', 'No'),
  };

  const peopleSheet = (): Sheet => ({
    name: t('admin.progress_overview.sheet_people', 'Personas'),
    rows: visiblePeople.map<SheetRow>((p) => ({
      [L.person]: p.name,
      [L.email]: p.email ?? '',
      [L.campaignCol]: p.campaignName ?? '',
      [L.jobCol]: p.jobTitle ?? '',
      [L.countryCol]: countryLabel(p.country) ?? '',
      [L.role]: t(`roles.${p.role}`, p.role),
      [L.assigned]: p.assigned,
      [L.mandatory]: p.mandatory,
      [L.mandatoryDone]: p.mandatoryDone,
      [L.syllabus]: p.modulesTotal > 0 ? Math.round((p.modulesDone / p.modulesTotal) * 100) : '',
      [L.started]: p.started,
      [L.completed]: p.completed,
      [L.certified]: p.certified,
      [L.score]: p.avgScore ?? '',
      [L.hours]: study.loaded ? xlsHours(p.studyMs) : '',
      [L.overdue]: p.overdue,
      [L.pending]: p.pendingReviews,
      [L.last]: p.lastActivity ? new Date(p.lastActivity).toLocaleString(i18n.language) : '',
    })),
  });

  const coursesSheet = (byCourse: typeof surveys.byCourse): Sheet => ({
    name: t('admin.progress_overview.sheet_courses', 'Cursos'),
    rows: visibleCourses.map<SheetRow>((c) => {
      const n = npsFromHistogram(byCourse[c.id]?.q2_hist);
      return {
        [L.course]: c.title,
        [L.campaignCol]: c.campaignName ?? '',
        [L.published]: c.published ? L.yes : L.no,
        [L.mandatoryCol]: c.mandatory ? L.yes : L.no,
        [L.modulesCol]: c.modules,
        [L.assigned]: c.assigned,
        [L.started]: c.started,
        [L.completed]: c.completed,
        [L.certified]: c.certified,
        [L.score]: c.avgScore ?? '',
        [L.nps]: n.score ?? '',
        [L.responses]: n.total,
        [L.overdue]: c.overdue,
        [L.pending]: c.pendingReviews,
        [L.last]: c.lastActivity ? new Date(c.lastActivity).toLocaleString(i18n.language) : '',
      };
    }),
  });

  const matrixSheet = (): Sheet => {
    // Matriz persona × curso: una columna por curso con el estado de la celda.
    // Es la hoja que el negocio cruza con su propia nómina.
    const headers = [L.person, L.email, L.campaignCol, ...visibleCourses.map((c) => c.title)];
    const cellByKey = new Map(scopedCells.map((c) => [`${c.userId}|${c.courseId}`, c]));
    const stateOf = (userId: string, courseId: string): string => {
      const cell = cellByKey.get(`${userId}|${courseId}`);
      if (!cell || (!cell.assigned && !cell.started)) return '';
      if (cell.certifiedAt) return t('admin.progress_overview.cell_certified', 'Certificado');
      if (cell.started) return `${cell.score ?? ''}`;
      return t('admin.progress_overview.cell_assigned', 'Asignado');
    };
    return {
      name: t('admin.progress_overview.sheet_matrix', 'Matriz'),
      headers,
      rows: visiblePeople.map<SheetRow>((p) => {
        const row: SheetRow = {
          [L.person]: p.name,
          [L.email]: p.email ?? '',
          [L.campaignCol]: p.campaignName ?? '',
        };
        for (const c of visibleCourses) row[c.title] = stateOf(p.id, c.id);
        return row;
      }),
    };
  };

  /**
   * La hoja sale de `certRows`, o sea de lo que se está viendo en la pestaña
   * Certificados: mismo orden, misma búsqueda y mismos filtros. Un Excel que no
   * coincide con la pantalla que lo pidió es un Excel que hay que volver a
   * explicar.
   */
  const certificatesSheet = (): Sheet => ({
    name: t('admin.progress_overview.sheet_certificates', 'Certificados'),
    rows: certRows.map<SheetRow>((r) => ({
      [L.person]: r.personName,
      [L.email]: r.email ?? '',
      [L.jobCol]: r.jobTitle ?? '',
      [L.countryCol]: countryLabel(r.country) ?? '',
      [L.campaignCol]: r.programName ?? '',
      [L.course]: r.courseTitle,
      [L.score]: r.score,
      [L.date]: xlsDate(new Date(r.issuedAt).toISOString(), i18n.language),
      [L.certId]: r.certId,
      // El verificador público: es lo que se pega en un correo o en LinkedIn.
      [L.verifyUrl]: `${window.location.origin}/verify/${r.certId}`,
      [L.state]: r.missing > 0
        ? t('admin.progress_overview.cert_state_outdated', { count: r.missing, defaultValue: 'Faltan {{count}} módulos del temario actual' })
        : t('admin.progress_overview.cert_state_ok', 'Al día'),
    })),
  });

  const deliveriesSheet = (): Sheet => ({
    name: t('admin.progress_overview.sheet_deliveries', 'Entregas'),
    rows: scopedActivity.map<SheetRow>((a) => ({
      [L.person]: a.userName,
      [L.course]: a.courseTitle ?? '',
      [L.module]: a.moduleTitle ?? '',
      [L.section]: a.sectionTitle ?? '',
      [L.type]: a.gameType,
      [L.score]: a.score,
      [L.state]: a.evaluated
        ? t('admin.progress_overview.state_evaluated', 'Evaluada')
        : t('admin.progress_overview.state_pending', 'Pendiente'),
      [L.date]: new Date(a.at).toLocaleString(i18n.language),
    })),
  });

  const examSheet = (summary: ExamSummary): Sheet => ({
    name: t('admin.progress_overview.sheet_exam', 'Examen final'),
    rows: summary.perCourse.map<SheetRow>((r) => ({
      [L.course]: r.course.title,
      [L.campaignCol]: r.course.campaignName ?? '',
      [t('admin.progress_overview.exam_col_taken', 'Presentaron')]: r.taken,
      [t('admin.progress_overview.exam_col_passed', 'Aprobaron')]: r.passed,
      [t('admin.progress_overview.exam_col_pass', 'Aprobación')]: `${r.passRate}%`,
      [L.score]: r.avgBest ?? '',
      [t('admin.progress_overview.exam_col_attempts', 'Intentos')]: r.attemptsAvg,
      [t('admin.progress_overview.exam_col_reinforcement', 'Refuerzo')]: r.inReinforcement,
    })),
  });

  const weakSheet = (summary: ExamSummary): Sheet => ({
    name: t('admin.progress_overview.sheet_weak', 'Temas flojos'),
    rows: summary.weakDomains.map<SheetRow>((d) => ({
      [t('admin.progress_overview.exam_weak_domain', 'Tema')]: d.name,
      [t('admin.progress_overview.exam_weak_people', 'Personas por debajo del mínimo')]: d.hits,
      [t('admin.progress_overview.exam_weak_avg', 'Acierto promedio')]: d.avg,
    })),
  });

  const surveySheet = (byCourse: typeof surveys.byCourse): Sheet => {
    const rowsOut: SheetRow[] = [];
    for (const c of visibleCourses) {
      const res = byCourse[c.id];
      if (!res) continue;
      const n = npsFromHistogram(res.q2_hist);
      rowsOut.push({
        [L.course]: c.title,
        [L.nps]: n.score ?? '',
        [L.responses]: res.total,
        [t('admin.progress_overview.col_q1', 'Promedio pregunta 1')]: res.q1_avg ?? '',
        [t('admin.progress_overview.col_q2', 'Promedio pregunta 2')]: res.q2_avg ?? '',
        [t('admin.progress_overview.col_promoters', 'Promotores')]: n.promoters,
        [t('admin.progress_overview.col_passives', 'Pasivos')]: n.passives,
        [t('admin.progress_overview.col_detractors', 'Detractores')]: n.detractors,
      });
    }
    return { name: t('admin.progress_overview.sheet_survey', 'Satisfacción'), rows: rowsOut };
  };

  const commentsSheet = (byCourse: typeof surveys.byCourse): Sheet => {
    const rowsOut: SheetRow[] = [];
    for (const c of visibleCourses) {
      for (const cm of byCourse[c.id]?.comments ?? []) {
        rowsOut.push({
          [L.course]: c.title,
          [L.date]: xlsDate(cm.at, i18n.language),
          [t('admin.progress_overview.col_q1', 'Promedio pregunta 1')]: cm.q1,
          [t('admin.progress_overview.col_q2', 'Promedio pregunta 2')]: cm.q2,
          [L.comment]: cm.text,
        });
      }
    }
    return { name: t('admin.progress_overview.sheet_comments', 'Comentarios'), rows: rowsOut };
  };

  const runExport = async (kind: 'all' | 'people' | 'courses' | 'matrix' | 'certificates' | 'deliveries' | 'exam' | 'survey') => {
    setExporting(true);
    try {
      // Examen y satisfacción se cargan al abrir su pestaña. Quien exporta sin
      // haber pasado por ahí las trae ahora: un informe con hojas vacías se lee
      // como "no hubo datos", que sería mentira. Si ya están, esto no cuesta
      // nada — el cargador devuelve la misma promesa ya resuelta.
      const courseIds = courses.map((c) => c.id);
      const needsExam = kind === 'exam' || kind === 'all';
      // La hoja de Cursos también trae NPS y respuestas, así que necesita la
      // encuesta aunque no sea la hoja de satisfacción.
      const needsSurvey = kind === 'survey' || kind === 'courses' || kind === 'all';
      const [examData, surveyData] = await Promise.all([
        needsExam ? loadExams(courseIds) : Promise.resolve(exams.byCourse),
        needsSurvey ? loadSurveys(courseIds) : Promise.resolve(surveys.byCourse),
      ]);
      const summary = computeExamSummary(examData);

      const sheets: Sheet[] =
        kind === 'people' ? [peopleSheet()]
          : kind === 'courses' ? [coursesSheet(surveyData)]
            : kind === 'matrix' ? [matrixSheet()]
              : kind === 'certificates' ? [certificatesSheet()]
                : kind === 'deliveries' ? [deliveriesSheet()]
                  : kind === 'exam' ? [examSheet(summary), weakSheet(summary)]
                    : kind === 'survey' ? [surveySheet(surveyData), commentsSheet(surveyData)]
                      : [peopleSheet(), coursesSheet(surveyData), matrixSheet(), certificatesSheet(), deliveriesSheet(), examSheet(summary), weakSheet(summary), surveySheet(surveyData), commentsSheet(surveyData)];
      // El nombre del archivo se lee fuera de la app —en el correo, en la
      // carpeta de Descargas—, así que va en el idioma del usuario y no con la
      // clave interna en inglés: "progreso-entregas-2026-08-15.xlsx".
      const kindName: Record<typeof kind, string> = {
        all: t('admin.progress_overview.file_all', 'informe-completo'),
        people: t('admin.progress_overview.file_people', 'personas'),
        courses: t('admin.progress_overview.file_courses', 'cursos'),
        matrix: t('admin.progress_overview.file_matrix', 'matriz'),
        certificates: t('admin.progress_overview.file_certificates', 'certificados'),
        deliveries: t('admin.progress_overview.file_deliveries', 'entregas'),
        exam: t('admin.progress_overview.file_exam', 'examen-final'),
        survey: t('admin.progress_overview.file_survey', 'satisfaccion'),
      };
      const base = t('admin.progress_overview.file_base', 'progreso');
      const total = await downloadWorkbook(`${base}-${kindName[kind]}`, sheets);
      toast.success(
        t('admin.progress_overview.export_ok', 'Excel descargado'),
        t('admin.progress_overview.export_ok_desc', { count: total, defaultValue: '{{count}} filas exportadas.' }),
      );
    } catch (e) {
      console.error('export:', e);
      toast.error(t('admin.progress_overview.export_err', 'No se pudo generar el Excel'));
    } finally {
      setExporting(false);
    }
  };

  /* ── Render ───────────────────────────────────────────────────────────── */

  const tabs: Array<{ key: Tab; label: string; icon: React.ReactNode; count?: number }> = [
    { key: 'summary', label: t('admin.progress_overview.tab_summary', 'Resumen'), icon: <BarChart3 className="h-4 w-4" /> },
    { key: 'people', label: t('admin.progress_overview.tab_people', 'Personas'), icon: <Users className="h-4 w-4" />, count: rows.length },
    { key: 'courses', label: t('admin.progress_overview.tab_courses', 'Cursos'), icon: <Layers className="h-4 w-4" />, count: scopedCourses.length },
    { key: 'certificates', label: t('admin.progress_overview.tab_certificates', 'Certificados'), icon: <Award className="h-4 w-4" />, count: certificatesKnown ? certRows.length : undefined },
    { key: 'exam', label: t('admin.progress_overview.tab_exam', 'Examen final'), icon: <GraduationCap className="h-4 w-4" /> },
    { key: 'survey', label: t('admin.progress_overview.tab_survey', 'Satisfacción'), icon: <HeartHandshake className="h-4 w-4" /> },
  ];

  const focusLabel: Record<Exclude<Focus, 'none'>, string> = {
    started: t('admin.progress_overview.focus_started', 'Solo quienes participaron'),
    idle: t('admin.progress_overview.focus_idle', 'Solo sin iniciar'),
    certified: t('admin.progress_overview.focus_certified', 'Solo certificados'),
    pending: t('admin.progress_overview.focus_pending', 'Solo con entregas por evaluar'),
    risk: t('admin.progress_overview.focus_risk', 'Solo en riesgo'),
    mandatory: t('admin.progress_overview.focus_mandatory', 'Solo con formación obligatoria pendiente'),
    overdue: t('admin.progress_overview.focus_overdue', 'Solo con cursos vencidos'),
  };

  const toggleFocus = (next: Exclude<Focus, 'none'>) => {
    setFocus((cur) => (cur === next ? 'none' : next));
    setTab('people');
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-16 pt-5 sm:px-6">
      {/* ── Encabezado + controles ───────────────────────────────────────── */}
      <Rise>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-text-muted">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: GREEN }} />
              {t('admin.progress_overview.badge', 'Progreso · Panorama')}
            </div>
            <h1 className="text-[26px] font-bold tracking-tight text-text sm:text-[30px]">
              {t('admin.progress_overview.title', 'Cómo va el programa')}
            </h1>
            <p className="mt-1 max-w-2xl text-[13px] text-text-muted">
              {t('admin.progress_overview.subtitle', 'Alcance, participación, desempeño, certificación y satisfacción de los aprendices. Todo lo que ves aquí se puede descargar en Excel.')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={reload}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-line px-3 text-[12.5px] font-medium text-text-muted transition-colors hover:border-[rgb(var(--brand-green))]/40 hover:text-text"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              {t('admin.progress_overview.refresh', 'Actualizar')}
            </button>

            <Menu
              align="right"
              button={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  disabled={exporting || loading}
                  className="inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-[12.5px] font-bold text-white shadow-lg transition-transform duration-300 hover:scale-[1.03] disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${GREEN}, color-mix(in srgb, ${GREEN} 62%, #000))` }}
                >
                  <Download className="h-3.5 w-3.5" />
                  {exporting
                    ? t('admin.progress_overview.exporting', 'Generando…')
                    : t('admin.progress_overview.export', 'Exportar')}
                </button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem
                    icon={<FileSpreadsheet className="h-4 w-4" />}
                    label={t('admin.progress_overview.export_all', 'Informe completo')}
                    description={t('admin.progress_overview.export_all_desc', 'Todas las hojas en un libro')}
                    onClick={() => { close(); void runExport('all'); }}
                  />
                  <MenuItem
                    icon={<Users className="h-4 w-4" />}
                    label={t('admin.progress_overview.export_people', 'Personas')}
                    description={t('admin.progress_overview.export_people_desc', { count: visiblePeople.length, defaultValue: '{{count}} filas con lo que estás viendo' })}
                    onClick={() => { close(); void runExport('people'); }}
                  />
                  <MenuItem
                    icon={<Layers className="h-4 w-4" />}
                    label={t('admin.progress_overview.export_courses', 'Cursos')}
                    onClick={() => { close(); void runExport('courses'); }}
                  />
                  <MenuItem
                    icon={<BarChart3 className="h-4 w-4" />}
                    label={t('admin.progress_overview.export_matrix', 'Matriz personas × cursos')}
                    description={t('admin.progress_overview.export_matrix_desc', 'Una columna por curso, para cruzar')}
                    onClick={() => { close(); void runExport('matrix'); }}
                  />
                  <MenuItem
                    icon={<Award className="h-4 w-4" />}
                    label={t('admin.progress_overview.export_certificates', 'Certificados emitidos')}
                    description={t('admin.progress_overview.export_certificates_desc', { count: scopedCerts.length, defaultValue: '{{count}} certificados con código y fecha' })}
                    onClick={() => { close(); void runExport('certificates'); }}
                  />
                  <MenuItem
                    icon={<ClipboardCheck className="h-4 w-4" />}
                    label={t('admin.progress_overview.export_deliveries', 'Entregas de actividades')}
                    onClick={() => { close(); void runExport('deliveries'); }}
                  />
                  <MenuItem
                    icon={<GraduationCap className="h-4 w-4" />}
                    label={t('admin.progress_overview.export_exam', 'Examen final y temas flojos')}
                    description={exams.loaded
                      ? undefined
                      : t('admin.progress_overview.export_exam_hint', 'Se consultan al exportar')}
                    onClick={() => { close(); void runExport('exam'); }}
                  />
                  <MenuItem
                    icon={<HeartHandshake className="h-4 w-4" />}
                    label={t('admin.progress_overview.export_survey', 'Satisfacción y comentarios')}
                    description={surveys.loaded
                      ? undefined
                      : t('admin.progress_overview.export_survey_hint', 'Se consultan al exportar')}
                    onClick={() => { close(); void runExport('survey'); }}
                  />
                </>
              )}
            </Menu>
          </div>
        </div>
      </Rise>

      {/* ── Barra de alcance ─────────────────────────────────────────────── */}
      <Rise delay={0.05}>
        <div className="mb-6 flex flex-wrap items-center gap-2.5 rounded-2xl border border-line bg-surface/70 p-2.5 backdrop-blur">
          <div className="relative min-w-[210px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('admin.progress_overview.search', 'Buscar persona, correo o curso…  (⌘K)')}
              className="h-9 w-full rounded-xl border border-line bg-bg pl-9 pr-3 text-[12.5px] text-text outline-none transition-colors placeholder:text-text-subtle focus:border-[rgb(var(--brand-green))]/50"
            />
          </div>

          <div className="w-[190px]">
            <Select
              value={campaign}
              onChange={setCampaign}
              options={[
                { value: 'all', label: t('admin.progress_overview.all_campaigns', 'Todos los programas') },
                ...campaigns.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>

          {/* CR y ÁREA. Van delante del curso porque son el orden en el que se
              piensa —dónde, qué tipo de gente, qué curso— y el mismo con el que
              se define la audiencia de un curso. Cualquiera de los tres
              enciende el tablero. */}
          <div className="w-[190px]">
            <Select
              value={operation}
              onChange={setOperation}
              options={[
                { value: 'all', label: t('admin.progress_overview.all_operations', 'Todos los CR') },
                ...units.filter((u) => u.kind === 'operation').map((u) => ({ value: u.id, label: u.name })),
              ]}
            />
          </div>
          <div className="w-[175px]">
            <Select
              value={area}
              onChange={setArea}
              options={[
                { value: 'all', label: t('admin.progress_overview.all_areas', 'Todas las áreas') },
                ...units.filter((u) => u.kind === 'area').map((u) => ({ value: u.id, label: u.name })),
              ]}
            />
          </div>

          {/* Filtro por CURSO. El resto de columnas —temario, completados,
              certificados— son sumas de todos los cursos asignados, así que
              "certificado" y "30% de temario" conviven en la misma fila sin que
              ninguno de los dos esté mal: son cursos distintos. Elegir uno es
              lo que vuelve la fila legible. */}
          {courseOptions.length > 1 && (
            <div className="w-[210px]">
              <Select
                value={activeCourse}
                onChange={setCourse}
                options={[
                  { value: 'all', label: t('admin.progress_overview.all_courses', 'Todos los cursos') },
                  ...courseOptions.map((c) => ({ value: c.id, label: c.title })),
                ]}
              />
            </div>
          )}

          <div className="w-[165px]">
            <Select
              value={range}
              onChange={(v) => setRange(v as RangeKey)}
              options={[
                { value: 'all', label: t('admin.progress_overview.range_all', 'Todo el histórico') },
                { value: '90', label: t('admin.progress_overview.range_90', 'Últimos 90 días') },
                { value: '30', label: t('admin.progress_overview.range_30', 'Últimos 30 días') },
                { value: '7', label: t('admin.progress_overview.range_7', 'Últimos 7 días') },
              ]}
            />
          </div>

          {/* Cortes por cargo y país: el perfil ya los guarda y son la
              segmentación que pide cualquier informe de formación. */}
          {jobOptions.length > 1 && (
            <div className="w-[180px]">
              <Select
                value={job}
                onChange={setJob}
                options={[
                  { value: 'all', label: t('admin.progress_overview.all_jobs', 'Todos los cargos') },
                  ...jobOptions.map((o) => ({
                    value: o.value,
                    label: `${o.value === NO_VALUE ? t('admin.progress_overview.no_job', 'Sin cargo') : o.value} (${o.count})`,
                  })),
                ]}
              />
            </div>
          )}

          {countryOptions.length > 1 && (
            <div className="w-[170px]">
              <Select
                value={country}
                onChange={setCountry}
                options={[
                  { value: 'all', label: t('admin.progress_overview.all_countries', 'Todos los países') },
                  ...countryOptions.map((o) => ({
                    value: o.value,
                    label: `${o.value === NO_VALUE ? t('admin.progress_overview.no_country', 'Sin país') : (countryLabelWithFlag(o.value) ?? o.value)} (${o.count})`,
                  })),
                ]}
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => setOnlyLearners((v) => !v)}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[12.5px] font-medium transition-colors',
              onlyLearners
                ? 'border-[rgb(var(--brand-green))]/40 bg-[rgb(var(--brand-green))]/8 text-text'
                : 'border-line text-text-muted hover:text-text',
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            {t('admin.progress_overview.only_learners', 'Solo aprendices')}
          </button>

          {focus !== 'none' && (
            <FilterChip label={focusLabel[focus]} onClear={() => setFocus('none')} />
          )}
          {job !== 'all' && (
            <FilterChip
              label={job === NO_VALUE ? t('admin.progress_overview.no_job', 'Sin cargo') : job}
              onClear={() => setJob('all')}
            />
          )}
          {country !== 'all' && (
            <FilterChip
              label={country === NO_VALUE
                ? t('admin.progress_overview.no_country', 'Sin país')
                : (countryLabelWithFlag(country) ?? country)}
              onClear={() => setCountry('all')}
            />
          )}
          {range !== 'all' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-subtle/60 px-2.5 py-1 text-[11.5px] text-text-muted">
              <CalendarRange className="h-3 w-3" />
              {t('admin.progress_overview.range_note', 'La actividad y los certificados se cuentan dentro del rango')}
            </span>
          )}
          {/* Gente de otras campañas inscrita en cursos de esta. Se dice, para
              que nadie lea la tabla como "la plantilla del programa". */}
          {guestCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-subtle/60 px-2.5 py-1 text-[11.5px] text-text-muted">
              <Users className="h-3 w-3" />
              {t('admin.progress_overview.guests_note', {
                count: guestCount,
                defaultValue: 'Incluye {{count}} personas de otros programas inscritas en sus cursos',
              })}
            </span>
          )}
        </div>
      </Rise>

      {/* ── Sin alcance: no se ha consultado nada todavía ────────────────
          No es un estado vacío de "no hay datos" — es un "todavía no te he
          preguntado qué quieres ver". La diferencia importa: un vacío hace
          pensar que algo falló, y aquí lo único que falta es elegir. */}
      {!scopeChosen ? (
        <Rise delay={0.06}>
          <div className="rounded-2xl border border-line bg-subtle/40 px-6 py-14 text-center">
            <Filter className="mx-auto mb-3 h-8 w-8 text-text-subtle" />
            <p className="text-[15px] font-medium text-text">
              {t('admin.progress_overview.pick_scope_title', 'Elige qué quieres mirar')}
            </p>
            <p className="mx-auto mt-1.5 max-w-[46ch] text-[13px] leading-relaxed text-text-muted">
              {t('admin.progress_overview.pick_scope_body', 'Un CR, un área o un curso. El tablero se calcula sobre lo que elijas — así no se consulta el programa entero para mirar un equipo de doce personas.')}
            </p>
          </div>
        </Rise>
      ) : (
      <>
      {/* ── Las cifras, en una tira ──────────────────────────────────────
          Antes eran nueve tarjetas que ocupaban la pantalla entera y dejaban la
          tabla fuera de vista: se pulsaba una para filtrar y "no pasaba nada"
          — pasaba novecientos píxeles más abajo. Siguen siendo las mismas
          nueve y siguen filtrando igual; lo que cambia es que ahora la tabla
          está justo debajo. Las tres de segundo plano se despliegan. */}
      <Rise delay={0.06}>
        <StatStrip
          loading={loading}
          moreLabel={t('admin.progress_overview.more_stats', 'Más cifras')}
          lessLabel={t('admin.progress_overview.less_stats', 'Menos cifras')}
          items={[
            {
              key: 'reach',
              label: t('admin.progress_overview.kpi_reach', 'Personas alcanzadas'),
              value: fmt(kpi.total),
              accent: BLUE,
              hint: assignmentsKnown
                ? t('admin.progress_overview.kpi_reach_hint', { count: kpi.total - kpi.idle, defaultValue: '{{count}} con actividad registrada' })
                : t('admin.progress_overview.kpi_reach_noassign', 'Sin datos de asignación visibles'),
            },
            {
              key: 'participation',
              label: t('admin.progress_overview.kpi_participation', 'Participación'),
              value: loading ? '·' : `${kpi.participation}%`,
              accent: GREEN,
              active: focus === 'started',
              onClick: () => toggleFocus('started'),
              hint: t('admin.progress_overview.kpi_participation_hint', { started: kpi.started, total: kpi.total, defaultValue: '{{started}} de {{total}} han hecho al menos una actividad' }),
            },
            {
              key: 'pending',
              label: t('admin.progress_overview.kpi_pending', 'Por evaluar'),
              value: fmt(kpi.pending),
              accent: CYAN,
              active: focus === 'pending',
              onClick: () => toggleFocus('pending'),
              hint: t('admin.progress_overview.kpi_pending_hint', 'Entregas esperando retroalimentación'),
            },
            {
              key: 'overdue',
              label: t('admin.progress_overview.kpi_overdue', 'Fuera de plazo'),
              value: fmt(kpi.overduePeople),
              accent: '#ef4444',
              active: focus === 'overdue',
              onClick: kpi.overdueAssignments > 0 ? () => toggleFocus('overdue') : undefined,
              hint: kpi.overdueAssignments > 0
                ? t('admin.progress_overview.kpi_overdue_hint', { count: kpi.overdueAssignments, defaultValue: '{{count}} cursos asignados con el plazo vencido' })
                : t('admin.progress_overview.kpi_overdue_none', 'Nadie con el plazo vencido (solo cuentan los cursos con límite de tiempo)'),
            },
            {
              key: 'certificates',
              label: t('admin.progress_overview.kpi_certificates', 'Certificados'),
              value: fmt(kpi.certificates),
              accent: VIOLET,
              active: tab === 'certificates',
              onClick: () => setTab('certificates'),
              hint: certificatesKnown
                ? t('admin.progress_overview.kpi_certificates_hint', { count: kpi.certified, defaultValue: '{{count}} personas con al menos uno' })
                : t('admin.progress_overview.kpi_certificates_unknown', 'No se pudieron leer los certificados'),
            },
            {
              key: 'score',
              label: t('admin.progress_overview.kpi_score', 'Nota promedio'),
              value: kpi.avgScore === null ? '—' : String(kpi.avgScore),
              accent: AMBER,
              hint: t('admin.progress_overview.kpi_score_hint', { count: kpi.deliveries, defaultValue: 'Sobre {{count}} entregas evaluadas o resueltas' }),
            },
          ]}
          secondary={[
            {
              key: 'syllabus',
              label: t('admin.progress_overview.kpi_syllabus', 'Avance del temario'),
              value: kpi.syllabus === null ? '—' : `${kpi.syllabus}%`,
              accent: '#14b8a6',
              /* Media Y mediana. Con mucha gente sin empezar, la media la
                 levantan unos pocos muy avanzados; la mediana dice cómo va la
                 persona del medio, que es la pregunta de verdad. */
              hint: kpi.syllabus === null
                ? t('admin.progress_overview.kpi_syllabus_none', 'Todavía no hay temario asignado')
                : t('admin.progress_overview.kpi_syllabus_person', {
                    median: kpi.syllabusMedian, count: kpi.syllabusPeople,
                    defaultValue: 'Media por persona · mediana {{median}}% sobre {{count}} personas',
                  }),
            },
            {
              key: 'compliance',
              label: t('admin.progress_overview.kpi_compliance', 'Cumplimiento obligatorio'),
              value: kpi.compliance === null ? '—' : `${kpi.compliance}%`,
              accent: '#f97316',
              active: focus === 'mandatory',
              onClick: kpi.mandatoryTotal > 0 ? () => toggleFocus('mandatory') : undefined,
              hint: !journeyKnown
                ? t('admin.progress_overview.kpi_journey_unknown', 'Solo se pudo medir el temario: sin simuladores, mundo ni examen, esta cifra puede salir alta')
                : kpi.mandatoryTotal > 0
                  ? t('admin.progress_overview.kpi_compliance_hint', { done: kpi.mandatoryDone, total: kpi.mandatoryTotal, defaultValue: '{{done}} de {{total}} asignaciones obligatorias terminadas' })
                  : t('admin.progress_overview.kpi_compliance_none', 'Ningún curso está marcado como obligatorio todavía'),
            },
            {
              key: 'nps',
              label: t('admin.progress_overview.kpi_nps', 'NPS'),
              value: nps.score === null ? '—' : String(nps.score),
              accent: MAGENTA,
              onClick: () => setTab('survey'),
              hint: nps.total > 0
                ? t('admin.progress_overview.kpi_nps_hint', { count: nps.total, defaultValue: 'De {{count}} encuestas de cierre' })
                : t('admin.progress_overview.kpi_nps_empty', 'Abre Satisfacción para calcularlo'),
            },
          ]}
        />
      </Rise>

      {/* ── Pestañas ─────────────────────────────────────────────────────── */}
      <Rise delay={0.1}>
        <div className="mb-5 flex items-center gap-1 overflow-x-auto rounded-2xl border border-line bg-subtle/40 p-1">
          {tabs.map((tb) => {
            const active = tb.key === tab;
            return (
              <button
                key={tb.key}
                type="button"
                onClick={() => setTab(tb.key)}
                className={cn(
                  'relative inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-[12.5px] font-bold transition-all duration-300',
                  active ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
                )}
              >
                {tb.icon}
                {tb.label}
                {typeof tb.count === 'number' && (
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
                    active ? 'bg-[rgb(var(--brand-green))]/12 text-[rgb(var(--brand-green))]' : 'bg-line/60 text-text-subtle',
                  )}>
                    {tb.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Rise>

      {/* Buscar un CURSO desde cualquier pestaña. El buscador dice "persona,
          correo o curso", pero fuera de la pestaña Cursos el resultado no se
          veía por ningún lado: aquí se ofrece el salto. */}
      {query.trim() !== '' && tab !== 'courses' && visibleCourses.length > 0 && (
        <button
          type="button"
          onClick={() => setTab('courses')}
          className="mb-5 flex w-full items-center gap-3 rounded-2xl border border-line bg-surface/70 p-3 text-left transition-colors hover:border-[rgb(var(--brand-green))]/40"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${MAGENTA} 12%, transparent)`, color: MAGENTA }}>
            <GraduationCap className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold text-text">
              {t('admin.progress_overview.course_hits', {
                count: visibleCourses.length,
                defaultValue: '{{count}} cursos coinciden con la búsqueda',
              })}
            </span>
            <span className="block truncate text-[11.5px] text-text-muted">
              {visibleCourses.slice(0, 3).map((c) => c.title).join(' · ')}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle" />
        </button>
      )}

      {error && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <div>
            <p className="text-[13px] font-semibold text-text">{t('admin.progress_overview.error', 'No se pudieron cargar todos los datos')}</p>
            <p className="mt-0.5 text-[12px] text-text-muted">{error}</p>
          </div>
        </div>
      )}

      {/* ── Contenido ────────────────────────────────────────────────────── */}
      {tab === 'summary' && (
        <SummaryTab
          loading={loading}
          kpi={kpi}
          pulse={pulse}
          courseRows={visibleCourses}
          activity={scopedActivity}
          people={rows}
          study={study}
          onFocus={toggleFocus}
          onSegment={(axis, value) => {
            // "Sin campaña" no es un valor que el selector de arriba sepa
            // representar: se salta el filtro y solo se pasa a la lista.
            if (axis === 'campaign') { if (value !== NO_VALUE) setCampaign(value); }
            else if (axis === 'job') setJob(value);
            else setCountry(value);
            setTab('people');
          }}
          onOpenInbox={onOpenInbox}
          onPerson={(id) => {
            const p = rows.find((x) => x.id === id);
            if (p) setDrawerPerson(p);
          }}
          lang={i18n.language}
          never={never}
        />
      )}

      {tab === 'people' && (
        <PeopleTab
          loading={loading}
          people={visiblePeople}
          total={rows.length}
          query={query}
          sort={peopleSort}
          onSort={setPeopleSort}
          study={study}
          onLoadStudy={loadStudyTime}
          onPerson={setDrawerPerson}
          lang={i18n.language}
          never={never}
        />
      )}

      {tab === 'courses' && (
        <div className="space-y-4">
          <CoursesTab
            loading={loading}
            courses={visibleCourses}
            sort={courseSort}
            onSort={setCourseSort}
            surveys={surveys.byCourse}
            onCourse={setDrawerCourse}
            lang={i18n.language}
            never={never}
          />
          <MatrixSection
            people={visiblePeople}
            courses={visibleCourses}
            cells={scopedCells}
            onPerson={setDrawerPerson}
            onExport={() => void runExport('matrix')}
          />
        </div>
      )}

      {tab === 'certificates' && (
        <CertificatesTab
          loading={loading}
          known={certificatesKnown}
          rows={certRows}
          total={scopedCerts.length}
          outdated={outdatedCerts}
          query={query}
          sort={certSort}
          onSort={setCertSort}
          onPerson={setDrawerPerson}
          onExport={() => void runExport('certificates')}
          exporting={exporting}
          lang={i18n.language}
        />
      )}

      {tab === 'exam' && (
        <ExamTab
          loading={exams.loading}
          loaded={exams.loaded}
          summary={examSummary}
        />
      )}

      {tab === 'survey' && (
        <SurveyTab
          loading={surveys.loading}
          loaded={surveys.loaded}
          nps={nps}
          courses={visibleCourses}
          byCourse={surveys.byCourse}
          lang={i18n.language}
        />
      )}
      </>
      )}

      {/* Los cajones van FUERA del alcance: se abren desde dentro, pero cerrar
          el alcance con uno abierto no debe hacerlo desaparecer a mitad de
          lectura. */}
      {/* Detalle de un curso: sus módulos y quién va por dónde. */}
      {drawerCourse && (
        <CourseProgressDrawer
          course={drawerCourse}
          modules={modulesByCourse[drawerCourse.id] ?? []}
          people={rows}
          cells={scopedCells}
          doneModules={doneModules}
          onPerson={(p) => { setDrawerCourse(null); setDrawerPerson(p); }}
          onClose={() => setDrawerCourse(null)}
        />
      )}

      {/* Ficha completa de la persona, sin salir del tablero. */}
      {drawerPerson && (
        <UserProgressDrawer
          user={{
            id: drawerPerson.id,
            display_name: drawerPerson.name,
            role: drawerPerson.role,
            campaign_id: drawerPerson.campaignId,
            avatar_url: drawerPerson.avatarUrl,
            email: drawerPerson.email ?? undefined,
          } as unknown as Profile & { email?: string }}
          campaignName={drawerPerson.campaignName}
          onClose={() => setDrawerPerson(null)}
        />
      )}
    </div>
  );
}

/* ══ Resumen ═══════════════════════════════════════════════════════════════ */

function SummaryTab({
  loading, kpi, pulse, courseRows, activity, people, study, onFocus, onSegment, onOpenInbox, onPerson, lang, never,
}: {
  loading: boolean;
  kpi: { total: number; started: number; idle: number; certified: number; completedCourses: number; pending: number; risk: number; avgScore: number | null; studyMs: number; participation: number; deliveries: number; certificates: number };
  pulse: { bucket: number[]; max: number; startMs: number };
  courseRows: ProgramCourse[];
  activity: ActivityRow[];
  people: ProgramPerson[];
  study: { loading: boolean; loaded: boolean; partial: boolean; totalMs: number };
  onFocus: (f: 'started' | 'idle' | 'certified' | 'pending' | 'risk') => void;
  onSegment: (axis: SegmentAxis, value: string) => void;
  onOpenInbox?: () => void;
  onPerson: (id: string) => void;
  lang: string;
  never: string;
}) {
  const { t } = useTranslation();

  const topCourses = useMemo(
    () => [...courseRows].sort((a, b) => b.started - a.started || b.assigned - a.assigned).slice(0, 6),
    [courseRows],
  );
  const maxStarted = Math.max(1, ...topCourses.map((c) => c.started));

  const recent = useMemo(() => activity.slice(0, 8), [activity]);

  const topLearners = useMemo(
    () => [...people]
      .filter((p) => p.started > 0)
      .sort((a, b) => b.completed - a.completed || (b.avgScore ?? 0) - (a.avgScore ?? 0) || b.studyMs - a.studyMs)
      .slice(0, 5),
    [people],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Participación */}
      <Rise delay={0.02} className="lg:col-span-1">
        <SectionCard
          title={t('admin.progress_overview.participation_title', 'Quiénes participaron')}
          subtitle={t('admin.progress_overview.participation_sub', 'Del total alcanzado en este alcance')}
          icon={<UserCheck className="h-4 w-4" />}
          accent={GREEN}
          className="h-full"
        >
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
            <Donut
              value={kpi.started}
              total={kpi.total}
              accent={GREEN}
              label={t('admin.progress_overview.participation_label', 'participación')}
              sublabel={`${kpi.started}/${kpi.total}`}
            />
            <div className="min-w-0 flex-1 space-y-2.5">
              <SummaryLine
                color={GREEN}
                label={t('admin.progress_overview.seg_started', 'Participaron')}
                value={kpi.started}
                onClick={() => onFocus('started')}
              />
              <SummaryLine
                color="#a1a1aa"
                label={t('admin.progress_overview.seg_idle', 'Sin iniciar')}
                value={kpi.idle}
                onClick={() => onFocus('idle')}
              />
              <SummaryLine
                color={VIOLET}
                label={t('admin.progress_overview.seg_certified', 'Con certificado')}
                value={kpi.certified}
                onClick={() => onFocus('certified')}
              />
              <SummaryLine
                color="#ef4444"
                label={t('admin.progress_overview.seg_risk', 'En riesgo (<70)')}
                value={kpi.risk}
                onClick={() => onFocus('risk')}
              />
            </div>
          </div>
        </SectionCard>
      </Rise>

      {/* Pulso de actividad */}
      <Rise delay={0.06} className="lg:col-span-2">
        <SectionCard
          title={t('admin.progress_overview.pulse_title', 'Pulso de los últimos 14 días')}
          subtitle={t('admin.progress_overview.pulse_sub', 'Entregas de actividades por día')}
          icon={<TrendingUp className="h-4 w-4" />}
          accent={BLUE}
          className="h-full"
          action={
            <span className="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-text-muted">
              {t('admin.progress_overview.pulse_total', { count: pulse.bucket.reduce((s, n) => s + n, 0), defaultValue: '{{count}} entregas' })}
            </span>
          }
        >
          {/* Las barras miden su alto en %, así que TODA la cadena de padres
              tiene que tener alto propio: el contenedor fija h-36 y cada
              columna se estira (`items-stretch`). Envolver solo la barra en un
              tooltip rompía esa cadena y el gráfico salía vacío. */}
          <div className="flex h-40 gap-1.5">
            {pulse.bucket.map((n, i) => {
              const day = new Date(pulse.startMs + i * 86_400_000);
              return (
                <Tooltip
                  key={i}
                  anchor="element"
                  delay={80}
                  className="min-w-0 flex-1"
                  label={
                    <span className="block text-center">
                      <span className="block font-semibold">{day.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'short' })}</span>
                      <span className="block opacity-80">
                        {t('admin.progress_overview.pulse_total', { count: n, defaultValue: '{{count}} entregas' })}
                      </span>
                    </span>
                  }
                >
                  <span className="group flex h-full w-full min-w-0 flex-col items-center gap-1.5">
                    <span className="flex w-full flex-1 items-end">
                      <span
                        className="block w-full rounded-t-lg transition-all duration-500 ease-apple group-hover:opacity-100"
                        style={{
                          height: `${Math.max(3, (n / pulse.max) * 100)}%`,
                          background: n === 0
                            ? 'rgb(var(--line))'
                            : `linear-gradient(180deg, ${BLUE}, color-mix(in srgb, ${BLUE} 45%, transparent))`,
                          opacity: n === 0 ? 0.5 : 0.9,
                        }}
                      />
                    </span>
                    <span className="text-[9.5px] tabular-nums text-text-subtle">
                      {day.getDate()}
                    </span>
                  </span>
                </Tooltip>
              );
            })}
          </div>
        </SectionCard>
      </Rise>

      {/* Cursos con más movimiento */}
      <Rise delay={0.1} className="lg:col-span-2">
        <SectionCard
          title={t('admin.progress_overview.top_courses_title', 'Cursos con más movimiento')}
          subtitle={t('admin.progress_overview.top_courses_sub', 'Personas que ya empezaron cada curso')}
          icon={<Layers className="h-4 w-4" />}
          accent={MAGENTA}
          className="h-full"
        >
          {loading ? (
            <SkeletonRows rows={5} cols={3} />
          ) : topCourses.length === 0 ? (
            <EmptyState
              icon={<CircleSlash className="h-6 w-6" />}
              title={t('admin.progress_overview.no_courses', 'Todavía no hay cursos con actividad')}
              description={t('admin.progress_overview.no_courses_desc', 'Cuando alguien resuelva una actividad, el curso aparecerá aquí.')}
            />
          ) : (
            <ul className="space-y-3.5">
              {topCourses.map((c, i) => (
                <li key={c.id} className="group">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <Tooltip anchor="element" maxWidth={320} delay={120} label={c.title} className="min-w-0">
                      <span className="truncate text-[13px] font-medium text-text">{c.title}</span>
                    </Tooltip>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-text-muted">
                      {t('admin.progress_overview.course_line', {
                        started: c.started, assigned: c.assigned, certified: c.certified,
                        defaultValue: '{{started}} activos · {{assigned}} asignados · {{certified}} certificados',
                      })}
                    </span>
                  </div>
                  <RankBar value={c.started} max={maxStarted} accent={MAGENTA} delay={0.04 * i} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </Rise>

      {/* Dedicación + destacados */}
      <Rise delay={0.14}>
        <SectionCard
          title={t('admin.progress_overview.study_title', 'Dedicación real')}
          subtitle={t('admin.progress_overview.study_sub', 'Tiempo activo dentro de los módulos')}
          icon={<Clock className="h-4 w-4" />}
          accent={CYAN}
          className="h-full"
        >
          {study.loading ? (
            <SkeletonRows rows={3} cols={2} />
          ) : (
            <>
              <p className="text-[32px] font-bold leading-none tracking-tight text-text">
                {formatElapsed(kpi.studyMs)}
              </p>
              <p className="mt-1.5 text-[12px] text-text-muted">
                {study.partial
                  ? t('admin.progress_overview.study_partial', 'Muestra parcial: hay más registros de los que caben en una consulta.')
                  : t('admin.progress_overview.study_hint', 'Suma del tiempo activo medido en el sitio, sin contar pestañas abiertas de fondo.')}
              </p>
              <ul className="mt-4 space-y-2.5">
                {topLearners.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onPerson(p.id)}
                      className="flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left transition-colors hover:bg-subtle"
                    >
                      <PersonAvatar name={p.name} url={p.avatarUrl} size={30} />
                      <Tooltip anchor="element" maxWidth={300} delay={120} label={p.name} className="min-w-0 flex-1">
                        <span className="block min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium text-text">{p.name}</span>
                          <span className="block truncate text-[11px] text-text-subtle">
                            {t('admin.progress_overview.person_line', {
                              completed: p.completed, certified: p.certified,
                              defaultValue: '{{completed}} completados · {{certified}} certificados',
                            })}
                          </span>
                        </span>
                      </Tooltip>
                      {study.loaded && p.studyMs > 0 && (
                        <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{formatElapsed(p.studyMs)}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>
      </Rise>

      {/* Desglose por cargo / país */}
      <Rise delay={0.16}>
        <SegmentBreakdown people={people} onPick={onSegment} />
      </Rise>

      {/* Actividad reciente */}
      <Rise delay={0.18} className="lg:col-span-2">
        <SectionCard
          title={t('admin.progress_overview.recent_title', 'Lo último que pasó')}
          subtitle={t('admin.progress_overview.recent_sub', 'Entregas más recientes de los aprendices')}
          icon={<Sparkles className="h-4 w-4" />}
          accent={AMBER}
          className="h-full"
          action={onOpenInbox && (
            <button
              type="button"
              onClick={onOpenInbox}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[12px] font-semibold text-text-muted transition-colors hover:border-[rgb(var(--brand-green))]/40 hover:text-text"
            >
              <Inbox className="h-3.5 w-3.5" />
              {t('admin.progress_overview.open_inbox', 'Ir a evaluar')}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        >
          {loading ? (
            <SkeletonRows rows={5} cols={4} />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<Hourglass className="h-6 w-6" />}
              title={t('admin.progress_overview.no_activity', 'Sin actividad en este rango')}
              description={t('admin.progress_overview.no_activity_desc', 'Amplía el rango de fechas o cambia de programa.')}
            />
          ) : (
            <ul className="divide-y divide-line/70">
              {recent.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onPerson(a.userId)}
                    className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-subtle/50"
                  >
                    <PersonAvatar name={a.userName} size={32} accent={AMBER} />
                    <Tooltip
                      anchor="element"
                      maxWidth={320}
                      delay={120}
                      className="min-w-0 flex-1"
                      label={
                        <span className="block">
                          <span className="block font-semibold">{a.userName}</span>
                          <span className="block opacity-80">
                            {[a.courseTitle, a.moduleTitle, a.sectionTitle].filter(Boolean).join(' · ') || t('admin.progress_overview.no_course', 'Sin curso')}
                          </span>
                        </span>
                      }
                    >
                      <span className="block min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-text">{a.userName}</span>
                        <span className="block truncate text-[11px] text-text-subtle">
                          {[a.courseTitle, a.moduleTitle].filter(Boolean).join(' · ') || t('admin.progress_overview.no_course', 'Sin curso')}
                        </span>
                      </span>
                    </Tooltip>
                    <span className="shrink-0 text-[13px] font-bold tabular-nums" style={{ color: scoreHex(a.score) }}>
                      {a.score}
                    </span>
                    {!a.evaluated && (
                      <StatusPill tone="amber">{t('admin.progress_overview.state_pending', 'Pendiente')}</StatusPill>
                    )}
                    <span className="hidden shrink-0 text-[11px] text-text-subtle sm:block">
                      {relative(a.at, lang, never)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </Rise>
    </div>
  );
}

/* ── Desglose por segmento ────────────────────────────────────────────────
   El mismo tablero, partido por cargo o por país. Es donde se ve lo que un
   promedio esconde: "68% de participación" puede ser 95% en un cargo y 30% en
   otro, y son dos problemas distintos. */

type SegmentAxis = 'campaign' | 'job' | 'country';

function SegmentBreakdown({
  people, onPick,
}: {
  people: ProgramPerson[];
  onPick: (axis: SegmentAxis, value: string) => void;
}) {
  const { t } = useTranslation();
  // ¿Hay más de una campaña en el alcance? Con una sola, partir por campaña no
  // compara nada: el eje se esconde y se arranca por cargo, como antes.
  const multiCampaign = useMemo(
    () => new Set(people.map((p) => p.campaignId ?? NO_VALUE)).size > 1,
    [people],
  );
  const [axis, setAxis] = useState<SegmentAxis>('campaign');
  const effAxis: SegmentAxis = axis === 'campaign' && !multiCampaign ? 'job' : axis;

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; total: number; started: number; completed: number; certified: number; scoreSum: number; scored: number; modulesDone: number; modulesTotal: number; assigned: number }>();
    for (const p of people) {
      const key = (effAxis === 'campaign' ? p.campaignId : effAxis === 'job' ? p.jobTitle : p.country) ?? NO_VALUE;
      const g = map.get(key) ?? {
        label: effAxis === 'campaign' ? (p.campaignName ?? '') : '',
        total: 0, started: 0, completed: 0, certified: 0, scoreSum: 0, scored: 0,
        modulesDone: 0, modulesTotal: 0, assigned: 0,
      };
      g.total++;
      if (p.started > 0) g.started++;
      if (p.completed > 0) g.completed++;
      if (p.certified > 0) g.certified++;
      if (p.avgScore !== null) { g.scoreSum += p.avgScore; g.scored++; }
      // Avance REAL del grupo: módulos hechos sobre los módulos que se le
      // asignaron a su gente. Es la cifra que se pide de una campaña, y no la
      // puede dar el conteo de personas.
      g.modulesDone += p.modulesDone;
      g.modulesTotal += p.modulesTotal;
      g.assigned += p.assigned;
      map.set(key, g);
    }
    return [...map.entries()]
      .map(([key, g]) => ({
        key,
        ...g,
        // Va DESPUÉS del spread a propósito: `g` trae su propio `label` (el
        // nombre crudo de la campaña) y antes lo pisaba.
        label: key === NO_VALUE
          ? (effAxis === 'campaign'
              ? t('admin.progress_overview.no_campaign', 'Sin programa')
              : effAxis === 'job'
                ? t('admin.progress_overview.no_job', 'Sin cargo')
                : t('admin.progress_overview.no_country', 'Sin país'))
          : effAxis === 'country'
            ? (countryLabel(key) ?? key)
            : effAxis === 'campaign'
              ? (g.label || key)
              : key,
        participation: g.total > 0 ? Math.round((g.started / g.total) * 100) : 0,
        progress: g.modulesTotal > 0 ? Math.round((g.modulesDone / g.modulesTotal) * 100) : null,
        avg: g.scored > 0 ? Math.round(g.scoreSum / g.scored) : null,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [people, effAxis, t]);

  const maxTotal = Math.max(1, ...groups.map((g) => g.total));

  return (
    <SectionCard
      title={t('admin.progress_overview.segments_title', 'Cómo va cada grupo')}
      subtitle={t('admin.progress_overview.segments_sub', 'El mismo alcance, partido por programa, cargo o país')}
      icon={<Users className="h-4 w-4" />}
      accent={VIOLET}
      className="h-full"
      action={
        <div className="flex items-center gap-1 rounded-xl border border-line bg-subtle/50 p-1">
          {([
            ...(multiCampaign
              ? [{ key: 'campaign' as const, label: t('admin.progress_overview.axis_campaign', 'Programa') }]
              : []),
            { key: 'job' as const, label: t('admin.progress_overview.axis_job', 'Cargo') },
            { key: 'country' as const, label: t('admin.progress_overview.axis_country', 'País') },
          ]).map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setAxis(o.key)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
                effAxis === o.key ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      }
    >
      {groups.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={t('admin.progress_overview.segments_empty', 'No hay con qué comparar')}
        />
      ) : (
        <ul className="space-y-3.5">
          {groups.map((g, i) => (
            <li key={g.key}>
              <button
                type="button"
                onClick={() => onPick(effAxis, g.key)}
                className="w-full rounded-xl p-1.5 text-left transition-colors hover:bg-subtle"
              >
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <Tooltip anchor="element" maxWidth={300} delay={120} label={g.label} className="min-w-0">
                    <span className="truncate text-[12.5px] font-medium text-text">{g.label}</span>
                  </Tooltip>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-text-muted">
                    {effAxis === 'campaign'
                      ? t('admin.progress_overview.campaign_line', {
                          count: g.total,
                          progress: g.progress ?? 0,
                          certified: g.certified,
                          defaultValue: '{{count}} personas · {{progress}}% del temario · {{certified}} certificados',
                        })
                      : t('admin.progress_overview.segment_line', {
                          count: g.total, participation: g.participation, certified: g.certified,
                          defaultValue: '{{count}} personas · {{participation}}% participación · {{certified}} certificados',
                        })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Por campaña la barra mide el AVANCE del temario (0–100), no
                      cuánta gente hay: la pregunta es cómo va, no cuántos son. */}
                  <span className="flex-1">
                    {effAxis === 'campaign'
                      ? <RankBar value={g.progress ?? 0} max={100} accent={VIOLET} delay={0.04 * i} />
                      : <RankBar value={g.total} max={maxTotal} accent={VIOLET} delay={0.04 * i} />}
                  </span>
                  {effAxis === 'campaign' ? (
                    <span className="w-9 shrink-0 text-right text-[11px] font-bold tabular-nums text-text">
                      {g.progress === null ? '—' : `${g.progress}%`}
                    </span>
                  ) : g.avg !== null && (
                    <span className="w-8 shrink-0 text-right text-[11px] font-bold tabular-nums" style={{ color: scoreHex(g.avg) }}>
                      {g.avg}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function SummaryLine({
  color, label, value, onClick,
}: {
  color: string; label: string; value: number; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-subtle"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-muted">{label}</span>
      <span className="shrink-0 text-[14px] font-bold tabular-nums text-text">{value}</span>
    </button>
  );
}

/* ══ Personas ══════════════════════════════════════════════════════════════ */

function PeopleTab({
  loading, people, total, query, sort, onSort, study, onLoadStudy, onPerson, lang, never,
}: {
  loading: boolean;
  people: ProgramPerson[];
  total: number;
  query: string;
  sort: { key: PeopleSort; dir: 'asc' | 'desc' };
  onSort: (s: { key: PeopleSort; dir: 'asc' | 'desc' }) => void;
  study: { loading: boolean; loaded: boolean; partial: boolean; totalMs: number };
  onLoadStudy: () => void;
  onPerson: (p: ProgramPerson) => void;
  lang: string;
  never: string;
}) {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(50);

  // Al cambiar la búsqueda o el orden se vuelve a la primera tanda. Se ajusta en
  // el propio render (patrón de React para "estado derivado de props") en vez de
  // en un efecto: así no hay un pintado intermedio con la lista larga anterior.
  const listKey = `${query}|${sort.key}|${sort.dir}`;
  const [lastKey, setLastKey] = useState(listKey);
  if (listKey !== lastKey) {
    setLastKey(listKey);
    setLimit(50);
  }

  const th = (key: PeopleSort, label: string, align: 'left' | 'right' = 'right', title?: string, className?: string) => (
    <SortableTh
      label={label}
      align={align}
      title={title}
      className={className}
      active={sort.key === key}
      dir={sort.key === key ? sort.dir : 'desc'}
      onClick={() => onSort({ key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' })}
    />
  );

  return (
    <SectionCard
      title={t('admin.progress_overview.people_title', 'Personas')}
      subtitle={t('admin.progress_overview.people_sub', { shown: Math.min(limit, people.length), count: people.length, total, defaultValue: 'Mostrando {{shown}} de {{count}} (de {{total}} en el alcance). Clic en alguien para ver su ficha completa.' })}
      icon={<Users className="h-4 w-4" />}
      accent={BLUE}
      action={!study.loaded && (
        <button
          type="button"
          onClick={onLoadStudy}
          disabled={study.loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[12px] font-semibold text-text-muted transition-colors hover:border-[rgb(var(--brand-green))]/40 hover:text-text disabled:opacity-50"
        >
          <Clock className={cn('h-3.5 w-3.5', study.loading && 'animate-spin')} />
          {t('admin.progress_overview.load_study', 'Cargar tiempo de estudio')}
        </button>
      )}
    >
      {loading ? (
        <SkeletonRows rows={8} cols={6} />
      ) : people.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={t('admin.progress_overview.no_people', 'Nadie coincide con este filtro')}
          description={t('admin.progress_overview.no_people_desc', 'Prueba con otro programa, amplía el rango o limpia la búsqueda.')}
        />
      ) : (
        <>
          <div className="group/table -mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[1210px] table-fixed border-separate border-spacing-0 text-[12.5px]">
              <thead>
                <tr>
                  {th('name', t('admin.progress_overview.col_person', 'Persona'), 'left', undefined, 'w-[215px]')}
                  {th('campaign', t('admin.progress_overview.col_campaign', 'Programa'), 'left', undefined, 'w-[150px]')}
                  {th('assigned', t('admin.progress_overview.col_assigned', 'Asignados'), 'right', t('admin.progress_overview.help_assigned', 'Cursos que le tocan, por asignación directa o por su programa.'))}
                  {th('mandatory', t('admin.progress_overview.col_mandatory', 'Obligatorios'), 'right', t('admin.progress_overview.help_mandatory', 'Cursos obligatorios terminados sobre los que le tocan. Es la cifra de cumplimiento que se audita.'))}
                  {th('syllabus', t('admin.progress_overview.col_syllabus', 'Temario'), 'right', t('admin.progress_overview.help_syllabus', 'Módulos completados sobre los de TODOS sus cursos asignados. Por eso alguien puede estar certificado en un curso y tener el temario al 30%: filtra por curso para verlo aislado.'))}
                  {th('completed', t('admin.progress_overview.col_completed', 'Completados'), 'right', t('admin.progress_overview.help_completed', 'Cursos con certificado, o con TODO el recorrido hecho: módulos, simuladores, mundo y examen final.'))}
                  {th('certified', t('admin.progress_overview.col_certified', 'Certificados'), 'right', t('admin.progress_overview.help_certified', 'Certificados emitidos a esta persona.'))}
                  {th('score', t('admin.progress_overview.col_score_short', 'Nota'), 'right', t('admin.progress_overview.help_score', 'Promedio de todas sus entregas dentro del alcance elegido.'))}
                  {th('time', t('admin.progress_overview.col_time', 'Tiempo'), 'right', t('admin.progress_overview.help_time', 'Tiempo activo dentro de los módulos: no cuenta la pestaña abierta de fondo.'))}
                  {th('overdue', t('admin.progress_overview.col_overdue', 'Vencidos'), 'right', t('admin.progress_overview.help_overdue', 'Cursos que se le pasaron de plazo sin terminarlos. Solo cuentan los cursos con límite de tiempo configurado.'))}
                  {th('pending', t('admin.progress_overview.col_pending_short', 'Por evaluar'), 'right', t('admin.progress_overview.help_pending', 'Entregas suyas que todavía esperan retroalimentación.'))}
                  {th('last', t('admin.progress_overview.col_last', 'Última actividad'), 'right', t('admin.progress_overview.help_last', 'Cuándo fue su última entrega dentro del alcance.'), 'w-[118px]')}
                </tr>
              </thead>
              <tbody>
                {people.slice(0, limit).map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => onPerson(p)}
                    className="cursor-pointer transition-colors hover:bg-subtle/60"
                  >
                    <td className="border-b border-line/60 px-2.5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <PersonAvatar name={p.name} url={p.avatarUrl} size={30} />
                        {/* El nombre y el correo se recortan por ancho de tabla,
                            así que el dato completo vive en el tooltip. */}
                        <Tooltip
                          anchor="element"
                          maxWidth={320}
                          delay={120}
                          className="min-w-0 flex-1"
                          label={<span className="block">{p.name}{p.email ? <span className="block opacity-80">{p.email}</span> : null}</span>}
                        >
                          {/* spans (no divs): el Tooltip envuelve en un <span>
                              y un <div> dentro es HTML inválido. */}
                          <span className="block min-w-0">
                            <span className="block truncate font-medium text-text">
                              <Highlight text={p.name} term={query} />
                            </span>
                            {p.email && (
                              <span className="block truncate text-[11px] text-text-subtle">
                                <Highlight text={p.email} term={query} />
                              </span>
                            )}
                          </span>
                        </Tooltip>
                      </div>
                    </td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-text-muted">
                      <Tooltip
                        anchor="element"
                        maxWidth={280}
                        delay={120}
                        className="min-w-0 w-full"
                        label={[p.campaignName, p.jobTitle, countryLabel(p.country)].filter(Boolean).join(' · ') || '—'}
                      >
                        <span className="block min-w-0">
                          <span className="block truncate">{p.campaignName ?? '—'}</span>
                          {(p.jobTitle || p.country) && (
                            <span className="block truncate text-[11px] text-text-subtle">
                              {[p.jobTitle, countryLabel(p.country)].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                      </Tooltip>
                    </td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums text-text-muted">{p.assigned}</td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right">
                      {p.mandatory === 0 ? (
                        <span className="text-text-subtle">—</span>
                      ) : (
                        <span className={cn(
                          'font-bold tabular-nums',
                          p.mandatoryDone >= p.mandatory ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400',
                        )}>
                          {p.mandatoryDone}/{p.mandatory}
                        </span>
                      )}
                    </td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right">
                      {p.modulesTotal === 0 ? (
                        <span className="text-text-subtle">—</span>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-2">
                          <span className="hidden w-10 sm:block">
                            <RankBar value={p.modulesDone} max={p.modulesTotal} accent="#14b8a6" />
                          </span>
                          <span className="tabular-nums text-text-muted">
                            {Math.round((p.modulesDone / p.modulesTotal) * 100)}%
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums text-text">{p.completed}</td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right">
                      {p.certified > 0 ? (
                        <span className="inline-flex items-center gap-1 font-bold tabular-nums" style={{ color: VIOLET }}>
                          <Award className="h-3.5 w-3.5" />{p.certified}
                        </span>
                      ) : <span className="text-text-subtle">—</span>}
                    </td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right"><ScoreCell score={p.avgScore} /></td>
                    <td className="whitespace-nowrap border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums text-text-muted">
                      {study.loaded ? (p.studyMs > 0 ? formatElapsed(p.studyMs) : '—') : '·'}
                    </td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right"><OverdueCell n={p.overdue} /></td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right">
                      {p.pendingReviews > 0
                        ? <StatusPill tone="amber">{p.pendingReviews}</StatusPill>
                        : <span className="text-text-subtle">—</span>}
                    </td>
                    <td className="whitespace-nowrap border-b border-line/60 px-2.5 py-2.5 text-right text-[11.5px] text-text-muted">
                      {relative(p.lastActivity, lang, never)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {people.length > limit && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setLimit((l) => l + 100)}
                className="rounded-xl border border-line px-4 py-2 text-[12.5px] font-semibold text-text-muted transition-colors hover:border-[rgb(var(--brand-green))]/40 hover:text-text"
              >
                {t('admin.progress_overview.load_more', { count: people.length - limit, defaultValue: 'Ver {{count}} más' })}
              </button>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

/* ══ Cursos ════════════════════════════════════════════════════════════════ */

function CoursesTab({
  loading, courses, sort, onSort, surveys, onCourse, lang, never,
}: {
  loading: boolean;
  courses: ProgramCourse[];
  sort: { key: CourseSort; dir: 'asc' | 'desc' };
  onSort: (s: { key: CourseSort; dir: 'asc' | 'desc' }) => void;
  surveys: Record<string, { q2_hist: Record<string, number> } | undefined>;
  onCourse: (c: ProgramCourse) => void;
  lang: string;
  never: string;
}) {
  const { t } = useTranslation();
  const th = (key: CourseSort, label: string, align: 'left' | 'right' = 'right', title?: string) => (
    <SortableTh
      label={label}
      align={align}
      title={title}
      active={sort.key === key}
      dir={sort.key === key ? sort.dir : 'desc'}
      onClick={() => onSort({ key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' })}
    />
  );

  return (
    <SectionCard
      title={t('admin.progress_overview.courses_title', 'Cursos')}
      subtitle={t('admin.progress_overview.courses_sub', 'Alcance, avance y certificación de cada curso. Clic en uno para ver sus módulos y su gente.')}
      icon={<GraduationCap className="h-4 w-4" />}
      accent={MAGENTA}
    >
      {loading ? (
        <SkeletonRows rows={6} cols={6} />
      ) : courses.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-6 w-6" />}
          title={t('admin.progress_overview.no_courses', 'Todavía no hay cursos con actividad')}
        />
      ) : (
        <div className="group/table -mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[940px] border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr>
                {th('title', t('admin.progress_overview.col_course', 'Curso'), 'left')}
                {th('assigned', t('admin.progress_overview.col_assigned', 'Asignados'), 'right', t('admin.progress_overview.help_course_assigned', 'Personas a las que les toca este curso.'))}
                {th('started', t('admin.progress_overview.col_started', 'Iniciados'), 'right', t('admin.progress_overview.help_course_started', 'Personas que ya resolvieron algo en este curso.'))}
                {th('completed', t('admin.progress_overview.col_completed', 'Completados'), 'right', t('admin.progress_overview.help_completed', 'Cursos con certificado, o con TODO el recorrido hecho: módulos, simuladores, mundo y examen final.'))}
                {th('certified', t('admin.progress_overview.col_certified', 'Certificados'), 'right', t('admin.progress_overview.help_course_certified', 'Certificados emitidos de este curso.'))}
                {th('overdue', t('admin.progress_overview.col_overdue', 'Vencidos'), 'right', t('admin.progress_overview.help_course_overdue', 'Personas a las que se les pasó el plazo de este curso sin terminarlo. Solo cuenta si el curso tiene límite de tiempo.'))}
                {th('score', t('admin.progress_overview.col_score_short', 'Nota'), 'right', t('admin.progress_overview.help_course_score', 'Promedio de las entregas de este curso.'))}
                {th('nps', t('admin.progress_overview.col_nps', 'NPS'), 'right', t('admin.progress_overview.help_nps', 'Promotores (9-10) menos detractores (0-6) de la encuesta de cierre, de −100 a +100.'))}
                {th('last', t('admin.progress_overview.col_last', 'Última actividad'), 'right', t('admin.progress_overview.help_last', 'Cuándo fue su última entrega dentro del alcance.'))}
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => {
                const n = npsFromHistogram(surveys[c.id]?.q2_hist);
                const progress = c.assigned > 0 ? Math.round((c.completed / c.assigned) * 100) : 0;
                return (
                  <tr
                    key={c.id}
                    onClick={() => onCourse(c)}
                    className="cursor-pointer transition-colors hover:bg-subtle/60"
                  >
                    <td className="border-b border-line/60 px-2.5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${MAGENTA} 12%, transparent)`, color: MAGENTA }}>
                          <GraduationCap className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Tooltip anchor="element" maxWidth={320} delay={120} label={c.title} className="min-w-0">
                              <span className="truncate font-medium text-text">{c.title}</span>
                            </Tooltip>
                            {!c.published && (
                              <StatusPill tone="neutral">{t('admin.progress_overview.draft', 'Borrador')}</StatusPill>
                            )}
                          </div>
                          <div className="mt-1 flex flex-nowrap items-center gap-2 overflow-hidden">
                            <div className="w-24 shrink-0"><RankBar value={c.completed} max={Math.max(1, c.assigned)} accent={GREEN} /></div>
                            <span className="text-[10.5px] tabular-nums text-text-subtle">{progress}%</span>
                            <span className="whitespace-nowrap text-[10.5px] text-text-subtle">
                              · {t('admin.progress_overview.course_modules', { count: c.modules, defaultValue: '{{count}} módulos' })}
                            </span>
                            {c.mandatory && (
                              <StatusPill tone="amber">{t('admin.progress_overview.mandatory', 'Obligatorio')}</StatusPill>
                            )}
                            {/* Cómo le llegó a la gente. "20 asignados" no dice
                                lo mismo si es un curso que le toca a toda la
                                campaña o uno que se le dio a tres personas, y
                                hasta ahora las dos cosas se veían igual. */}
                            {c.campaignsAssigned.length > 0 ? (
                              <StatusPill tone="green">
                                {t('admin.progress_overview.reach_campaign', 'Todo el programa')}
                              </StatusPill>
                            ) : c.directAssigned > 0 ? (
                              <StatusPill tone="neutral">
                                {t('admin.progress_overview.reach_people', { count: c.directAssigned, defaultValue: '{{count}} personas' })}
                              </StatusPill>
                            ) : (
                              <StatusPill tone="neutral">
                                {t('admin.progress_overview.reach_none', 'Sin asignar')}
                              </StatusPill>
                            )}
                            {c.campaignName && <span className="min-w-0 truncate text-[10.5px] text-text-subtle">· {c.campaignName}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums text-text-muted">
                      <Tooltip
                        anchor="element"
                        delay={120}
                        maxWidth={280}
                        label={t('admin.progress_overview.assigned_breakdown', {
                          campaign: c.assigned - c.directAssigned,
                          direct: c.directAssigned,
                          defaultValue: '{{campaign}} por su programa · {{direct}} una por una',
                        })}
                      >
                        <span>{c.assigned}</span>
                      </Tooltip>
                    </td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums text-text">{c.started}</td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums text-text">{c.completed}</td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums" style={{ color: c.certified ? VIOLET : undefined }}>
                      {c.certified || '—'}
                    </td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right"><OverdueCell n={c.overdue} /></td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right"><ScoreCell score={c.avgScore} /></td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums">
                      {n.score === null
                        ? <span className="text-text-subtle">—</span>
                        : <span className="font-bold" style={{ color: n.score >= 50 ? '#22c55e' : n.score >= 0 ? '#f59e0b' : '#ef4444' }}>{n.score}</span>}
                    </td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right text-[11.5px] text-text-muted">
                      {relative(c.lastActivity, lang, never)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/* ══ Certificados ══════════════════════════════════════════════════════════
   Quién se certificó, uno por fila. El KPI de arriba dice cuántos son; esta
   pestaña es la lista que se pide fuera del equipo ("mándame quiénes se
   certificaron en el programa X"), con el diploma a un clic, el enlace público
   de verificación copiable y el aviso de los que se emitieron antes de que el
   curso creciera. El programa y el curso se eligen en la barra de alcance de
   arriba, la misma para todo el tablero: aquí no hay filtros propios que
   puedan contradecirla. */

export interface CertRowView {
  key: string;
  userId: string;
  courseId: string;
  certId: string;
  score: number;
  issuedAt: number;
  person: ProgramPerson | undefined;
  personName: string;
  email: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  country: string | null;
  courseTitle: string;
  courseIcon: string | null;
  programName: string | null;
  personProgram: string | null;
  missing: number;
}

function CertificatesTab({
  loading, known, rows, total, outdated, query, sort, onSort, onPerson, onExport, exporting, lang,
}: {
  loading: boolean;
  known: boolean;
  rows: CertRowView[];
  total: number;
  outdated: number;
  query: string;
  sort: { key: CertSort; dir: 'asc' | 'desc' };
  onSort: (s: { key: CertSort; dir: 'asc' | 'desc' }) => void;
  onPerson: (p: ProgramPerson) => void;
  onExport: () => void;
  exporting: boolean;
  lang: string;
}) {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(50);

  // Al cambiar búsqueda u orden se vuelve a la primera tanda, en el propio
  // render (mismo patrón que la tabla de personas): con 800 certificados, dejar
  // el límite viejo hacía pintar una lista larga que ya no correspondía.
  const listKey = `${query}|${sort.key}|${sort.dir}|${rows.length}`;
  const [lastKey, setLastKey] = useState(listKey);
  if (listKey !== lastKey) {
    setLastKey(listKey);
    setLimit(50);
  }

  const th = (key: CertSort, label: string, align: 'left' | 'right' = 'right', title?: string, className?: string) => (
    <SortableTh
      label={label}
      align={align}
      title={title}
      className={className}
      active={sort.key === key}
      dir={sort.key === key ? sort.dir : 'desc'}
      onClick={() => onSort({ key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' })}
    />
  );

  const openCertificate = (r: CertRowView) => {
    // En una pestaña nueva: el diploma es una vista del aprendiz y no debe
    // sacar al capacitador del tablero que está mirando.
    window.open(`/certificate/${r.courseId}/${r.userId}`, '_blank', 'noopener');
  };

  const copyVerify = async (r: CertRowView) => {
    const url = `${window.location.origin}/verify/${r.certId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(
        t('admin.progress_overview.cert_copied', 'Enlace copiado'),
        t('admin.progress_overview.cert_copied_desc', 'Cualquiera puede comprobar el certificado con ese enlace.'),
      );
    } catch {
      toast.error(t('admin.progress_overview.cert_copy_err', 'No se pudo copiar el enlace'));
    }
  };

  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString(lang, { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <SectionCard
      title={t('admin.progress_overview.certs_title', 'Certificados emitidos')}
      subtitle={
        known
          ? t('admin.progress_overview.certs_sub', {
              shown: Math.min(limit, rows.length),
              count: rows.length,
              total,
              defaultValue: 'Mostrando {{shown}} de {{count}} (de {{total}} en el alcance). Clic en una fila para abrir el diploma.',
            })
          : t('admin.progress_overview.certs_unknown', 'No se pudieron leer los certificados con este permiso. La lista puede estar incompleta: no es que no haya ninguno.')
      }
      icon={<Award className="h-4 w-4" />}
      accent={VIOLET}
      action={rows.length > 0 && (
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[12px] font-semibold text-text-muted transition-colors hover:border-[rgb(var(--brand-green))]/40 hover:text-text disabled:opacity-50"
        >
          <FileSpreadsheet className={cn('h-3.5 w-3.5', exporting && 'animate-pulse')} />
          {t('admin.progress_overview.certs_export', 'Excel de esta lista')}
        </button>
      )}
    >
      {loading ? (
        <SkeletonRows rows={8} cols={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Award className="h-6 w-6" />}
          title={t('admin.progress_overview.no_certs', 'Ningún certificado en este alcance')}
          description={t('admin.progress_overview.no_certs_desc', 'Prueba con otro programa o curso, amplía el rango de fechas o limpia la búsqueda. Terminar el temario no emite el diploma: la persona tiene que pasar por la pantalla de certificación del curso.')}
        />
      ) : (
        <>
          {/* Los desactualizados se avisan ARRIBA, no solo con un chip por fila:
              con 800 certificados nadie los va a descubrir bajando. */}
          {outdated > 0 && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-3.5 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-[12px] leading-relaxed text-text-muted">
                <span className="font-semibold text-text">
                  {t('admin.progress_overview.certs_outdated_count', { count: outdated, defaultValue: '{{count}} certificados ya no cubren todo el temario' })}
                </span>{' '}
                {t('admin.progress_overview.certs_outdated_hint', 'Se emitieron cuando el curso tenía menos módulos. Siguen siendo válidos; para ponerlos al día, pide la recertificación en Contenido → Cursos → pestaña Certificación.')}
              </p>
            </div>
          )}

          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[980px] table-fixed border-separate border-spacing-0 text-[12.5px]">
              <thead>
                <tr>
                  {th('person', t('admin.progress_overview.col_person', 'Persona'), 'left', undefined, 'w-[230px]')}
                  {th('course', t('admin.progress_overview.col_course', 'Curso'), 'left', t('admin.progress_overview.help_cert_course', 'El curso que acredita el diploma.'), 'w-[230px]')}
                  {th('campaign', t('admin.progress_overview.col_program_owner', 'Programa'), 'left', t('admin.progress_overview.help_cert_program', 'El programa dueño del curso. Si la persona viene de otro, aparece debajo de su nombre.'), 'w-[160px]')}
                  {th('score', t('admin.progress_overview.col_score_short', 'Nota'), 'right', t('admin.progress_overview.help_cert_score', 'Con la que se emitió el certificado.'), 'w-[70px]')}
                  {th('date', t('admin.progress_overview.col_issued', 'Emitido'), 'right', t('admin.progress_overview.help_cert_issued', 'Fecha de emisión del diploma.'), 'w-[120px]')}
                  {/* No se ordena por código: es un identificador, no un dato
                      que alguien quiera clasificar. */}
                  <th
                    scope="col"
                    className="sticky top-0 z-10 w-[170px] whitespace-nowrap border-b border-line bg-surface/95 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted backdrop-blur"
                  >
                    <Tooltip anchor="element" delay={120} maxWidth={260} label={t('admin.progress_overview.help_cert_code', 'Código público de verificación. El botón copia el enlace para comprobarlo desde fuera.')}>
                      <span>{t('admin.progress_overview.col_cert_code', 'Código')}</span>
                    </Tooltip>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((r) => (
                  <tr
                    key={r.key}
                    onClick={() => openCertificate(r)}
                    className="cursor-pointer transition-colors hover:bg-subtle/60"
                  >
                    <td className="border-b border-line/60 px-2.5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <PersonAvatar name={r.personName} url={r.avatarUrl} size={30} />
                        <Tooltip
                          anchor="element"
                          maxWidth={320}
                          delay={120}
                          className="min-w-0 flex-1"
                          label={
                            <span className="block">
                              {r.personName}
                              {r.email ? <span className="block opacity-80">{r.email}</span> : null}
                              <span className="block opacity-80">
                                {t('admin.progress_overview.cert_person_hint', 'Clic aquí para su ficha; clic en la fila para el diploma.')}
                              </span>
                            </span>
                          }
                        >
                          <span
                            className="block min-w-0"
                            onClick={(e) => {
                              // La ficha de la persona y el diploma son dos
                              // destinos distintos: el nombre lleva a la ficha.
                              if (!r.person) return;
                              e.stopPropagation();
                              onPerson(r.person);
                            }}
                          >
                            <span className="block truncate font-medium text-text hover:underline">
                              <Highlight text={r.personName} term={query} />
                            </span>
                            {r.email && (
                              <span className="block truncate text-[11px] text-text-subtle">
                                <Highlight text={r.email} term={query} />
                              </span>
                            )}
                          </span>
                        </Tooltip>
                      </div>
                    </td>

                    <td className="border-b border-line/60 px-2.5 py-2.5">
                      <Tooltip anchor="element" maxWidth={320} delay={120} className="min-w-0 w-full" label={r.courseTitle}>
                        <span className="flex min-w-0 items-center gap-1.5">
                          {r.courseIcon && <span className="shrink-0">{r.courseIcon}</span>}
                          <span className="block min-w-0 truncate text-text">
                            <Highlight text={r.courseTitle} term={query} />
                          </span>
                        </span>
                      </Tooltip>
                      {r.missing > 0 && (
                        <Tooltip
                          maxWidth={300}
                          label={t('admin.users.cert_outdated_hint', 'El certificado se emitió cuando el curso tenía menos módulos. Sigue siendo válido, pero ya no cubre el temario completo.')}
                        >
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3" />
                            {t('admin.users.cert_outdated', { count: r.missing, defaultValue: 'Faltan {{count}} módulos' })}
                          </span>
                        </Tooltip>
                      )}
                    </td>

                    <td className="border-b border-line/60 px-2.5 py-2.5 text-text-muted">
                      <span className="block min-w-0">
                        <span className="block truncate">{r.programName ?? '—'}</span>
                        {/* Solo cuando la persona NO es del programa dueño: es un
                            curso compartido, y esa diferencia explica por qué el
                            certificado no aparece en los conteos de su campaña. */}
                        {r.personProgram && r.personProgram !== r.programName && (
                          <Tooltip
                            maxWidth={280}
                            label={t('admin.progress_overview.cert_guest_hint', 'La persona pertenece a otro programa: hizo un curso compartido.')}
                          >
                            <span className="block truncate text-[11px] text-text-subtle">
                              {r.personProgram}
                            </span>
                          </Tooltip>
                        )}
                      </span>
                    </td>

                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right">
                      <ScoreCell score={r.score ?? null} />
                    </td>

                    <td className="whitespace-nowrap border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums text-text-muted">
                      {fmtDate(r.issuedAt)}
                    </td>

                    <td className="border-b border-line/60 px-2.5 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-subtle">
                          <Highlight text={r.certId} term={query} />
                        </span>
                        <Tooltip label={t('admin.progress_overview.cert_copy', 'Copiar enlace de verificación')}>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void copyVerify(r); }}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-subtle hover:text-text"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                        <Tooltip label={t('admin.progress_overview.cert_open', 'Abrir el diploma')}>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openCertificate(r); }}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-subtle hover:text-text"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length > limit && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setLimit((l) => l + 100)}
                className="rounded-xl border border-line px-4 py-2 text-[12.5px] font-semibold text-text-muted transition-colors hover:border-[rgb(var(--brand-green))]/40 hover:text-text"
              >
                {t('admin.progress_overview.load_more', { count: rows.length - limit, defaultValue: 'Ver {{count}} más' })}
              </button>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

/* ══ Examen final ══════════════════════════════════════════════════════════
   El examen es la medición de aprendizaje del programa, y hasta ahora solo se
   veía curso por curso, dentro de su editor. Aquí está el agregado: qué
   tan bien se aprueba, cuántos intentos hace falta, quién está en refuerzo y
   —lo que de verdad se usa para decidir— qué temas se están fallando. */

interface ExamSummary {
  perCourse: Array<{
    course: ProgramCourse;
    taken: number; passed: number; passRate: number;
    avgBest: number | null; attemptsAvg: number; inReinforcement: number;
  }>;
  taken: number;
  passed: number;
  passRate: number | null;
  avgScore: number | null;
  attemptsAvg: number;
  reinforcement: number;
  weakDomains: Array<{ id: string; name: string; hits: number; avg: number }>;
}

function ExamTab({
  loading, loaded, summary,
}: {
  loading: boolean;
  loaded: boolean;
  summary: ExamSummary;
}) {
  const { t } = useTranslation();
  const maxHits = Math.max(1, ...summary.weakDomains.map((d) => d.hits));

  if (!loading && loaded && summary.taken === 0) {
    return (
      <SectionCard
        title={t('admin.progress_overview.exam_title', 'Examen final')}
        subtitle={t('admin.progress_overview.exam_sub', 'Resultados agregados de los exámenes de certificación')}
        icon={<GraduationCap className="h-4 w-4" />}
        accent={AMBER}
      >
        <EmptyState
          icon={<GraduationCap className="h-6 w-6" />}
          title={t('admin.progress_overview.exam_empty', 'Todavía nadie ha presentado un examen final')}
          description={t('admin.progress_overview.exam_empty_desc', 'El examen se arma en la pestaña Evaluación de cada curso. En cuanto alguien lo presente, aquí verás la tasa de aprobación, los intentos y los temas que más se fallan.')}
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          delay={0.02}
          icon={<GraduationCap className="h-5 w-5" />}
          label={t('admin.progress_overview.exam_kpi_taken', 'Presentaron')}
          frame={t('admin.progress_std.iso_participation', 'ISO 30414 · Participación')}
          value={loading ? null : summary.taken}
          accent={AMBER}
          loading={loading}
          hint={t('admin.progress_overview.exam_kpi_taken_hint', 'Personas que han hecho al menos un intento del examen final.')}
        />
        <KpiCard
          delay={0.06}
          icon={<Award className="h-5 w-5" />}
          label={t('admin.progress_overview.exam_kpi_pass', 'Tasa de aprobación')}
          value={loading ? null : summary.passRate}
          suffix="%"
          accent={GREEN}
          loading={loading}
          hint={t('admin.progress_overview.exam_kpi_pass_hint', { passed: summary.passed, taken: summary.taken, defaultValue: '{{passed}} de {{taken}} aprobaron con el mínimo del curso.' })}
        />
        <KpiCard
          delay={0.1}
          icon={<Gauge className="h-5 w-5" />}
          label={t('admin.progress_overview.exam_kpi_score', 'Nota media')}
          value={loading ? null : summary.avgScore}
          accent={BLUE}
          loading={loading}
          hint={t('admin.progress_overview.exam_kpi_score_hint', 'Promedio del mejor intento de cada persona.')}
        />
        <KpiCard
          delay={0.14}
          icon={<TrendingUp className="h-5 w-5" />}
          label={t('admin.progress_overview.exam_kpi_attempts', 'Intentos por persona')}
          value={loading ? null : summary.attemptsAvg}
          accent={VIOLET}
          loading={loading}
          hint={t('admin.progress_overview.exam_kpi_attempts_hint', 'Cuántas veces hace falta presentarlo. Muy por encima de 1 indica examen o contenido desalineados.')}
        />
        <KpiCard
          delay={0.18}
          icon={<Hourglass className="h-5 w-5" />}
          label={t('admin.progress_overview.exam_kpi_reinforcement', 'En refuerzo')}
          value={loading ? null : summary.reinforcement}
          accent={CYAN}
          loading={loading}
          hint={t('admin.progress_overview.exam_kpi_reinforcement_hint', 'Reprobaron y tienen ruta de repaso pendiente antes de reintentar.')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Rise delay={0.06} className="lg:col-span-2">
          <SectionCard
            title={t('admin.progress_overview.exam_courses_title', 'Examen por curso')}
            subtitle={t('admin.progress_overview.exam_courses_sub', 'Solo aparecen los cursos cuyo examen ya se presentó')}
            icon={<GraduationCap className="h-4 w-4" />}
            accent={AMBER}
            className="h-full"
          >
            {loading ? (
              <SkeletonRows rows={5} cols={4} />
            ) : (
              <div className="group/table -mx-2 overflow-x-auto px-2">
                <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[12.5px]">
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-10 border-b border-line bg-surface/95 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted backdrop-blur">
                        {t('admin.progress_overview.col_course', 'Curso')}
                      </th>
                      <th className="sticky top-0 z-10 border-b border-line bg-surface/95 px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-text-muted backdrop-blur">
                        {t('admin.progress_overview.exam_col_taken', 'Presentaron')}
                      </th>
                      <th className="sticky top-0 z-10 border-b border-line bg-surface/95 px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-text-muted backdrop-blur">
                        {t('admin.progress_overview.exam_col_pass', 'Aprobación')}
                      </th>
                      <th className="sticky top-0 z-10 border-b border-line bg-surface/95 px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-text-muted backdrop-blur">
                        {t('admin.progress_overview.col_score_short', 'Nota')}
                      </th>
                      <th className="sticky top-0 z-10 border-b border-line bg-surface/95 px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-text-muted backdrop-blur">
                        {t('admin.progress_overview.exam_col_attempts', 'Intentos')}
                      </th>
                      <th className="sticky top-0 z-10 border-b border-line bg-surface/95 px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-text-muted backdrop-blur">
                        {t('admin.progress_overview.exam_col_reinforcement', 'Refuerzo')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.perCourse.map((r) => (
                      <tr key={r.course.id} className="transition-colors hover:bg-subtle/60">
                        <td className="border-b border-line/60 px-2.5 py-2.5">
                          <Tooltip anchor="element" maxWidth={320} delay={120} label={r.course.title} className="min-w-0">
                            <span className="block truncate font-medium text-text">{r.course.title}</span>
                          </Tooltip>
                        </td>
                        <td className="border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums text-text">{r.taken}</td>
                        <td className="border-b border-line/60 px-2.5 py-2.5 text-right">
                          <span className="inline-flex items-center gap-2">
                            <span className="hidden w-16 sm:block"><RankBar value={r.passed} max={Math.max(1, r.taken)} accent={GREEN} /></span>
                            <span className="font-bold tabular-nums" style={{ color: scoreHex(r.passRate) }}>{r.passRate}%</span>
                          </span>
                        </td>
                        <td className="border-b border-line/60 px-2.5 py-2.5 text-right"><ScoreCell score={r.avgBest} /></td>
                        <td className="border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums text-text-muted">{r.attemptsAvg}</td>
                        <td className="border-b border-line/60 px-2.5 py-2.5 text-right">
                          {r.inReinforcement > 0
                            ? <StatusPill tone="amber">{r.inReinforcement}</StatusPill>
                            : <span className="text-text-subtle">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </Rise>

        <Rise delay={0.1}>
          <SectionCard
            title={t('admin.progress_overview.exam_weak_title', 'Lo que más se falla')}
            subtitle={t('admin.progress_overview.exam_weak_sub', 'Temas del examen en los que la gente no alcanza el mínimo')}
            icon={<AlertTriangle className="h-4 w-4" />}
            accent="#ef4444"
            className="h-full"
          >
            {loading ? (
              <SkeletonRows rows={5} cols={2} />
            ) : summary.weakDomains.length === 0 ? (
              <EmptyState
                icon={<Award className="h-6 w-6" />}
                title={t('admin.progress_overview.exam_weak_none', 'Ningún tema aparece como flojo')}
                description={t('admin.progress_overview.exam_weak_none_desc', 'Nadie ha bajado del mínimo en un tema completo. Es buena señal — o el examen no está exigiendo lo suficiente.')}
              />
            ) : (
              <ul className="space-y-3.5">
                {summary.weakDomains.map((d, i) => (
                  <li key={d.id}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <Tooltip anchor="element" maxWidth={300} delay={120} label={d.name} className="min-w-0">
                        <span className="truncate text-[12.5px] font-medium text-text">{d.name}</span>
                      </Tooltip>
                      <span className="shrink-0 text-[11.5px] tabular-nums text-text-muted">
                        {t('admin.progress_overview.exam_weak_line', { count: d.hits, avg: d.avg, defaultValue: '{{count}} personas · {{avg}}% de acierto' })}
                      </span>
                    </div>
                    <RankBar value={d.hits} max={maxHits} accent="#ef4444" delay={0.04 * i} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </Rise>
      </div>

      <p className="px-1 text-[11.5px] text-text-subtle">
        {t('admin.progress_overview.exam_note', 'El banco de preguntas, los temas y el mínimo de aprobación se configuran en la pestaña Evaluación de cada curso; aquí solo se leen los resultados.')}
      </p>
    </div>
  );
}

/* ══ Matriz personas × cursos ══════════════════════════════════════════════
   Es la antigua "Vista global" del superadmin, ahora dentro del Panorama: la
   misma lectura de un vistazo (quién tiene qué, con qué nota y quién ya está
   certificado) pero compartiendo filtros y exportación con el resto del
   tablero, en vez de vivir en una pantalla aparte con sus propios controles. */

function MatrixSection({
  people, courses, cells, onPerson, onExport,
}: {
  people: ProgramPerson[];
  courses: ProgramCourse[];
  cells: Array<{ userId: string; courseId: string; assigned: boolean; started: boolean; score: number | null; certifiedAt: string | null }>;
  onPerson: (p: ProgramPerson) => void;
  onExport: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(40);

  const byKey = useMemo(
    () => new Map(cells.map((c) => [`${c.userId}|${c.courseId}`, c])),
    [cells],
  );

  // Columnas: como mucho 14 cursos en pantalla. Más que eso deja de leerse y
  // para eso está el Excel, que no tiene límite de ancho.
  const shownCourses = courses.slice(0, 14);
  const hiddenCourses = courses.length - shownCourses.length;

  return (
    <SectionCard
      title={t('admin.progress_overview.matrix_title', 'Matriz personas × cursos')}
      subtitle={t('admin.progress_overview.matrix_sub', 'Quién tiene cada curso, con qué nota y quién ya está certificado')}
      icon={<BarChart3 className="h-4 w-4" />}
      accent={VIOLET}
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onExport}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[12px] font-semibold text-text-muted transition-colors hover:border-[rgb(var(--brand-green))]/40 hover:text-text"
          >
            <Download className="h-3.5 w-3.5" />
            {t('admin.progress_overview.matrix_export', 'Excel')}
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-1.5 text-[12px] font-semibold text-text-muted transition-colors hover:text-text"
          >
            {open ? t('admin.progress_overview.matrix_hide', 'Ocultar') : t('admin.progress_overview.matrix_show', 'Ver matriz')}
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-300', open && 'rotate-90')} />
          </button>
        </div>
      }
    >
      {!open ? (
        <p className="text-[12.5px] text-text-muted">
          {t('admin.progress_overview.matrix_collapsed', {
            people: people.length, courses: courses.length,
            defaultValue: '{{people}} personas × {{courses}} cursos. Se despliega bajo demanda porque es la tabla más pesada del tablero.',
          })}
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded" style={{ background: VIOLET }} />{t('admin.progress_overview.cell_certified', 'Certificado')}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-green-500" />≥ 90</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-amber-500" />70 – 89</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-red-500" />&lt; 70</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded border border-line bg-subtle" />{t('admin.progress_overview.cell_assigned', 'Asignado')}</span>
          </div>

          <div className="-mx-2 overflow-auto px-2" style={{ maxHeight: 520 }}>
            <table className="border-separate border-spacing-0 text-[12px]">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 border-b border-line bg-surface/95 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted backdrop-blur">
                    {t('admin.progress_overview.col_person', 'Persona')}
                  </th>
                  {shownCourses.map((c) => (
                    <th
                      key={c.id}
                      className="sticky top-0 z-10 border-b border-line bg-surface/95 px-2 py-2 text-center backdrop-blur"
                      style={{ minWidth: 74, maxWidth: 74 }}
                    >
                      <Tooltip anchor="element" maxWidth={280} delay={100} label={c.title} className="w-full">
                        <span className="block w-full truncate text-[10.5px] font-semibold text-text-muted">{c.title}</span>
                      </Tooltip>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.slice(0, limit).map((p) => (
                  <tr key={p.id} className="group">
                    <td className="sticky left-0 z-10 border-b border-line/60 bg-surface px-3 py-2 group-hover:bg-subtle/70">
                      <Tooltip anchor="element" maxWidth={300} delay={120} label={p.name}>
                        <button
                          type="button"
                          onClick={() => onPerson(p)}
                          className="flex max-w-[220px] items-center gap-2 text-left"
                        >
                          <PersonAvatar name={p.name} url={p.avatarUrl} size={24} />
                          <span className="truncate text-[12px] text-text">{p.name}</span>
                        </button>
                      </Tooltip>
                    </td>
                    {shownCourses.map((c) => {
                      const cell = byKey.get(`${p.id}|${c.id}`);
                      const certified = !!cell?.certifiedAt;
                      const score = cell?.score ?? null;
                      const bg = certified
                        ? VIOLET
                        : score === null
                          ? (cell?.assigned ? 'rgb(var(--line))' : 'transparent')
                          : scoreHex(score);
                      return (
                        <td key={c.id} className="border-b border-line/60 px-1.5 py-1.5 text-center">
                          <span
                            className="mx-auto grid h-7 w-full max-w-[62px] place-items-center rounded-lg text-[11px] font-bold tabular-nums transition-transform duration-200 hover:scale-110"
                            style={{
                              background: bg === 'transparent' ? 'transparent' : `color-mix(in srgb, ${bg} ${certified ? 90 : 16}%, transparent)`,
                              color: certified ? '#fff' : score !== null ? bg : 'rgb(var(--text-subtle))',
                              border: bg === 'transparent' ? '1px dashed rgb(var(--line))' : undefined,
                            }}
                            /* Excepción consciente a [[tooltip_convention]]: aquí
                               hay cientos de celdas y montar un Tooltip en cada
                               una costaría más de lo que aporta. La cabecera y
                               el nombre de la fila sí llevan Tooltip. */
                            title={`${p.name} · ${c.title}`}
                          >
                            {certified ? <Award className="h-3.5 w-3.5" /> : score !== null ? score : cell?.assigned ? '·' : ''}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11.5px] text-text-muted">
            {hiddenCourses > 0 && (
              <span>{t('admin.progress_overview.matrix_hidden', { count: hiddenCourses, defaultValue: '{{count}} cursos más solo en el Excel' })}</span>
            )}
            {people.length > limit && (
              <button
                type="button"
                onClick={() => setLimit((l) => l + 60)}
                className="rounded-xl border border-line px-3 py-1.5 font-semibold transition-colors hover:text-text"
              >
                {t('admin.progress_overview.load_more', { count: people.length - limit, defaultValue: 'Ver {{count}} más' })}
              </button>
            )}
          </div>
        </>
      )}
    </SectionCard>
  );
}

/* ══ Satisfacción ══════════════════════════════════════════════════════════ */

function SurveyTab({
  loading, loaded, nps, courses, byCourse, lang,
}: {
  loading: boolean;
  loaded: boolean;
  nps: { score: number | null; promoters: number; passives: number; detractors: number; total: number };
  courses: ProgramCourse[];
  byCourse: Record<string, import('@/services/survey.service').SurveyResults | undefined>;
  lang: string;
}) {
  const { t } = useTranslation();

  const comments = useMemo(() => {
    const out: Array<{ course: string; at: string; q1: number; q2: number; text: string }> = [];
    for (const c of courses) {
      for (const cm of byCourse[c.id]?.comments ?? []) {
        if (!cm.text?.trim()) continue;
        out.push({ course: c.title, at: cm.at, q1: cm.q1, q2: cm.q2, text: cm.text });
      }
    }
    return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 12);
  }, [courses, byCourse]);

  const answered = useMemo(
    () => courses.filter((c) => (byCourse[c.id]?.total ?? 0) > 0),
    [courses, byCourse],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Rise delay={0.02}>
        <SectionCard
          title={t('admin.progress_overview.nps_title', 'NPS del programa')}
          subtitle={t('admin.progress_overview.nps_sub', 'Sobre la pregunta de experiencia general (0 a 10)')}
          icon={<HeartHandshake className="h-4 w-4" />}
          accent={MAGENTA}
          className="h-full"
        >
          {loading ? (
            <SkeletonRows rows={3} cols={2} />
          ) : (
            <NpsGauge
              score={nps.score}
              promoters={nps.promoters}
              passives={nps.passives}
              detractors={nps.detractors}
              labels={{
                promoters: t('admin.progress_overview.promoters', 'Promotores (9-10)'),
                passives: t('admin.progress_overview.passives', 'Pasivos (7-8)'),
                detractors: t('admin.progress_overview.detractors', 'Detractores (0-6)'),
                empty: loaded
                  ? t('admin.progress_overview.nps_none', 'Nadie ha contestado la encuesta todavía')
                  : t('admin.progress_overview.nps_loading', 'Calculando…'),
              }}
            />
          )}
        </SectionCard>
      </Rise>

      <Rise delay={0.06} className="lg:col-span-2">
        <SectionCard
          title={t('admin.progress_overview.survey_courses_title', 'Satisfacción por curso')}
          subtitle={t('admin.progress_overview.survey_courses_sub', 'Solo aparecen los cursos con respuestas')}
          icon={<Gauge className="h-4 w-4" />}
          accent={GREEN}
          className="h-full"
        >
          {loading ? (
            <SkeletonRows rows={4} cols={3} />
          ) : answered.length === 0 ? (
            <EmptyState
              icon={<MessageSquareQuote className="h-6 w-6" />}
              title={t('admin.progress_overview.survey_empty', 'Aún no hay encuestas contestadas')}
              description={t('admin.progress_overview.survey_empty_desc', 'La encuesta se responde al cerrar el curso, justo antes del certificado. En cuanto llegue la primera respuesta, el NPS aparece aquí.')}
            />
          ) : (
            <ul className="space-y-4">
              {answered.map((c) => {
                const res = byCourse[c.id];
                const n = npsFromHistogram(res?.q2_hist);
                return (
                  <li key={c.id}>
                    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-text">{c.title}</span>
                      <span className="flex items-center gap-3 text-[11.5px] text-text-muted">
                        <span>{t('admin.progress_overview.answers', { count: res?.total ?? 0, defaultValue: '{{count}} respuestas' })}</span>
                        <span className="font-bold tabular-nums" style={{ color: n.score === null ? undefined : n.score >= 50 ? '#22c55e' : n.score >= 0 ? '#f59e0b' : '#ef4444' }}>
                          NPS {n.score ?? '—'}
                        </span>
                      </span>
                    </div>
                    <StackedBar
                      height={8}
                      showLegend={false}
                      segments={[
                        { key: 'p', label: t('admin.progress_overview.promoters', 'Promotores (9-10)'), value: n.promoters, color: '#22c55e' },
                        { key: 'n', label: t('admin.progress_overview.passives', 'Pasivos (7-8)'), value: n.passives, color: '#f59e0b' },
                        { key: 'd', label: t('admin.progress_overview.detractors', 'Detractores (0-6)'), value: n.detractors, color: '#ef4444' },
                      ]}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </Rise>

      {comments.length > 0 && (
        <Rise delay={0.1} className="lg:col-span-3">
          <SectionCard
            title={t('admin.progress_overview.comments_title', 'Lo que escribieron')}
            subtitle={t('admin.progress_overview.comments_sub', 'Comentarios anónimos de la encuesta de cierre')}
            icon={<MessageSquareQuote className="h-4 w-4" />}
            accent={VIOLET}
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {comments.map((c, i) => (
                <figure
                  key={i}
                  className="rounded-2xl border border-line bg-subtle/40 p-4 transition-transform duration-300 hover:-translate-y-0.5"
                >
                  <blockquote className="text-[12.5px] leading-relaxed text-text [overflow-wrap:anywhere]">
                    “{c.text}”
                  </blockquote>
                  <figcaption className="mt-3 flex items-center justify-between gap-2 text-[11px] text-text-subtle">
                    <span className="truncate">{c.course}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-bold tabular-nums" style={{ color: scoreHex(c.q2 * 10) }}>{c.q2}/10</span>
                      <span>{new Date(c.at).toLocaleDateString(lang)}</span>
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </SectionCard>
        </Rise>
      )}
    </div>
  );
}
