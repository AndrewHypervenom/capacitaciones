// src/admin/pages/progress/ProgressOverview.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users, UserCheck, Award, Gauge, HeartHandshake, ClipboardCheck, Download,
  Search, RefreshCw, Sparkles, TrendingUp, Clock, Layers, GraduationCap,
  ChevronRight, Inbox, FileSpreadsheet, CalendarRange, Filter, BarChart3,
  MessageSquareQuote, AlertTriangle, Hourglass, CircleSlash, ShieldCheck, ListChecks,
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
import type { Profile } from '@/types/database';
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
import { CourseProgressDrawer } from './CourseProgressDrawer';

/* ────────────────────────────────────────────────────────────────────────────
   Panorama de Progreso.

   La pregunta que responde esta pantalla no es "¿qué me falta calificar?" —esa
   es la Bandeja— sino "¿cómo va el programa?": a cuánta gente llegó, quiénes
   participaron, cómo les fue, cuántos se certificaron y qué opinan. De ahí que
   todo esté ordenado de lo general a lo particular, con UN control por
   pregunta y con cada cifra exportable a Excel para cruzarla con lo que el
   negocio ya tiene.
   ──────────────────────────────────────────────────────────────────────────── */

type Tab = 'summary' | 'people' | 'courses' | 'exam' | 'survey';
type Focus = 'none' | 'started' | 'idle' | 'certified' | 'pending' | 'risk' | 'mandatory';
type RangeKey = '7' | '30' | '90' | 'all';
type PeopleSort =
  | 'name' | 'campaign' | 'assigned' | 'mandatory' | 'syllabus' | 'started' | 'completed'
  | 'certified' | 'score' | 'time' | 'last' | 'pending';
type CourseSort = 'title' | 'assigned' | 'started' | 'completed' | 'certified' | 'score' | 'nps' | 'last';

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

  const data = useProgramData(lang, !isSuperAdmin);
  const {
    loading, error, people, courses, cells, campaigns, activity, certificates,
    assignmentsKnown, modulesByCourse, doneModules, study, loadStudyTime, surveys, loadSurveys,
    exams, loadExams, reload,
  } = data;

  const [tab, setTab] = useState<Tab>('summary');
  const [campaign, setCampaign] = useState<string>('all');
  const [range, setRange] = useState<RangeKey>('all');
  const [onlyLearners, setOnlyLearners] = useState(true);
  const [job, setJob] = useState<string>('all');
  const [country, setCountry] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<Focus>('none');
  const [peopleSort, setPeopleSort] = useState<{ key: PeopleSort; dir: 'asc' | 'desc' }>({ key: 'last', dir: 'desc' });
  const [courseSort, setCourseSort] = useState<{ key: CourseSort; dir: 'asc' | 'desc' }>({ key: 'assigned', dir: 'desc' });
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

  const scopedPeople = useMemo(() => {
    return people.filter((p) => {
      if (onlyLearners && p.role !== 'learner') return false;
      if (campaign !== 'all' && p.campaignId !== campaign) return false;
      // Cargo y país salen del perfil; "sin dato" es un valor más y se puede
      // filtrar por él (suele ser el primer hallazgo: gente sin cargo).
      if (job !== 'all' && (p.jobTitle ?? NO_VALUE) !== job) return false;
      if (country !== 'all' && (p.country ?? NO_VALUE) !== country) return false;
      return true;
    });
  }, [people, onlyLearners, campaign, job, country]);

  /** Opciones de los cortes, sacadas de la gente que hay (no de un catálogo). */
  const jobOptions = useMemo(() => segmentOptions(people, (p) => p.jobTitle), [people]);
  const countryOptions = useMemo(() => segmentOptions(people, (p) => p.country), [people]);

  const peopleIds = useMemo(() => new Set(scopedPeople.map((p) => p.id)), [scopedPeople]);

  const scopedCourses = useMemo(
    () => (campaign === 'all' ? courses : courses.filter((c) => c.campaignId === campaign)),
    [courses, campaign],
  );
  const courseIds = useMemo(() => new Set(scopedCourses.map((c) => c.id)), [scopedCourses]);

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
      completed: number; certified: number; pending: number;
      modulesDone: number; modulesTotal: number; last: number | null;
    };
    const byUser = new Map<string, Agg>();
    for (const cell of scopedCells) {
      const agg: Agg = byUser.get(cell.userId) ?? {
        assigned: 0, mandatory: 0, mandatoryDone: 0, started: 0, completed: 0,
        certified: 0, pending: 0, modulesDone: 0, modulesTotal: 0, last: null,
      };
      if (cell.assigned) agg.assigned++;
      if (cell.started) agg.started++;
      if (cell.certifiedAt) agg.certified++;
      if (isCourseCompleted(cell)) {
        agg.completed++;
        if (cell.mandatory) agg.mandatoryDone++;
      }
      if (cell.mandatory) agg.mandatory++;
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
    // Avance de temario: módulos hechos sobre los módulos asignados.
    const modulesDone = reached.reduce((s, p) => s + p.modulesDone, 0);
    const modulesTotal = reached.reduce((s, p) => s + p.modulesTotal, 0);

    return {
      total, started, idle, certified, completedCourses, pending, risk, avgScore, studyMs,
      mandatoryTotal, mandatoryDone,
      compliance: mandatoryTotal > 0 ? Math.round((mandatoryDone / mandatoryTotal) * 100) : null,
      modulesDone, modulesTotal,
      syllabus: modulesTotal > 0 ? Math.round((modulesDone / modulesTotal) * 100) : null,
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
    const agg = new Map<string, { assigned: number; started: number; completed: number; certified: number; pending: number; last: number | null; sum: number; n: number }>();
    for (const cell of scopedCells) {
      const a = agg.get(cell.courseId) ?? { assigned: 0, started: 0, completed: 0, certified: 0, pending: 0, last: null, sum: 0, n: 0 };
      if (cell.assigned) a.assigned++;
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
        started: a?.started ?? 0,
        completed: a?.completed ?? 0,
        certified: a?.certified ?? 0,
        pendingReviews: a?.pending ?? 0,
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
    if (tab === 'survey' && courses.length > 0) loadSurveys(courses.map((c) => c.id));
  }, [tab, courses, loadSurveys]);

  useEffect(() => {
    if (tab === 'exam' && courses.length > 0) loadExams(courses.map((c) => c.id));
  }, [tab, courses, loadExams]);

  /* ── Examen final: agregados del alcance ──────────────────────────────── */

  const examSummary = useMemo(() => {
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
      const rows = exams.byCourse[c.id];
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
          const name = (lang === 'en' ? d.name_en : lang === 'pt' ? d.name_pt : d.name_es) || d.name_es;
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
  }, [scopedCourses, exams.byCourse, lang]);

  /* ── Exportaciones ────────────────────────────────────────────────────── */

  const L = {
    person: t('admin.progress_overview.col_person', 'Persona'),
    email: t('admin.progress_overview.col_email', 'Correo'),
    campaignCol: t('admin.progress_overview.col_campaign', 'Campaña'),
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
      [L.pending]: p.pendingReviews,
      [L.last]: p.lastActivity ? new Date(p.lastActivity).toLocaleString(i18n.language) : '',
    })),
  });

  const coursesSheet = (): Sheet => ({
    name: t('admin.progress_overview.sheet_courses', 'Cursos'),
    rows: visibleCourses.map<SheetRow>((c) => {
      const n = npsFromHistogram(surveys.byCourse[c.id]?.q2_hist);
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

  const certificatesSheet = (): Sheet => {
    const personById = new Map(people.map((p) => [p.id, p]));
    const courseById = new Map(courses.map((c) => [c.id, c]));
    return {
      name: t('admin.progress_overview.sheet_certificates', 'Certificados'),
      rows: scopedCerts
        .slice()
        .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime())
        .map<SheetRow>((c) => ({
          [L.person]: personById.get(c.userId)?.name ?? c.userId,
          [L.email]: personById.get(c.userId)?.email ?? '',
          [L.campaignCol]: personById.get(c.userId)?.campaignName ?? '',
          [L.course]: courseById.get(c.courseId)?.title ?? c.courseId,
          [L.score]: c.score,
          [L.certId]: c.certId,
          [L.date]: xlsDate(c.issuedAt, i18n.language),
        })),
    };
  };

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

  const examSheet = (): Sheet => ({
    name: t('admin.progress_overview.sheet_exam', 'Examen final'),
    rows: examSummary.perCourse.map<SheetRow>((r) => ({
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

  const weakSheet = (): Sheet => ({
    name: t('admin.progress_overview.sheet_weak', 'Temas flojos'),
    rows: examSummary.weakDomains.map<SheetRow>((d) => ({
      [t('admin.progress_overview.exam_weak_domain', 'Tema')]: d.name,
      [t('admin.progress_overview.exam_weak_people', 'Personas por debajo del mínimo')]: d.hits,
      [t('admin.progress_overview.exam_weak_avg', 'Acierto promedio')]: d.avg,
    })),
  });

  const surveySheet = (): Sheet => {
    const rowsOut: SheetRow[] = [];
    for (const c of visibleCourses) {
      const res = surveys.byCourse[c.id];
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

  const commentsSheet = (): Sheet => {
    const rowsOut: SheetRow[] = [];
    for (const c of visibleCourses) {
      for (const cm of surveys.byCourse[c.id]?.comments ?? []) {
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
      const sheets: Sheet[] =
        kind === 'people' ? [peopleSheet()]
          : kind === 'courses' ? [coursesSheet()]
            : kind === 'matrix' ? [matrixSheet()]
              : kind === 'certificates' ? [certificatesSheet()]
                : kind === 'deliveries' ? [deliveriesSheet()]
                  : kind === 'exam' ? [examSheet(), weakSheet()]
                    : kind === 'survey' ? [surveySheet(), commentsSheet()]
                      : [peopleSheet(), coursesSheet(), matrixSheet(), certificatesSheet(), deliveriesSheet(), examSheet(), weakSheet(), surveySheet(), commentsSheet()];
      const base = t('admin.progress_overview.file_base', 'progreso');
      const total = await downloadWorkbook(`${base}-${kind}`, sheets);
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
                      : t('admin.progress_overview.export_exam_hint', 'Abre la pestaña Examen final primero')}
                    disabled={!exams.loaded}
                    onClick={() => { close(); void runExport('exam'); }}
                  />
                  <MenuItem
                    icon={<HeartHandshake className="h-4 w-4" />}
                    label={t('admin.progress_overview.export_survey', 'Satisfacción y comentarios')}
                    description={surveys.loaded
                      ? undefined
                      : t('admin.progress_overview.export_survey_hint', 'Abre la pestaña Satisfacción primero')}
                    disabled={!surveys.loaded}
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
                { value: 'all', label: t('admin.progress_overview.all_campaigns', 'Todas las campañas') },
                ...campaigns.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>

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
        </div>
      </Rise>

      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      {/* Seis en fila solo cuando la pantalla de verdad da: por debajo de eso
          las tarjetas se estrechan tanto que la etiqueta no cabe. */}
      <div className="mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        <KpiCard
          delay={0.02}
          icon={<Users className="h-5 w-5" />}
          label={t('admin.progress_overview.kpi_reach', 'Personas alcanzadas')}
          frame={t('admin.progress_std.iso_coverage', 'ISO 30414 · Cobertura')}
          value={loading ? null : kpi.total}
          accent={BLUE}
          loading={loading}
          hint={assignmentsKnown
            ? t('admin.progress_overview.kpi_reach_hint', { count: kpi.total - kpi.idle, defaultValue: '{{count}} con actividad registrada' })
            : t('admin.progress_overview.kpi_reach_noassign', 'Sin datos de asignación visibles')}
        />
        <KpiCard
          delay={0.06}
          icon={<UserCheck className="h-5 w-5" />}
          label={t('admin.progress_overview.kpi_participation', 'Participación')}
          frame={t('admin.progress_std.iso_participation', 'ISO 30414 · Participación')}
          value={loading ? null : kpi.participation}
          suffix="%"
          accent={GREEN}
          loading={loading}
          active={focus === 'started'}
          onClick={() => toggleFocus('started')}
          delta={trend ? { value: trend.activePeople, label: trendLabel } : null}
          hint={t('admin.progress_overview.kpi_participation_hint', { started: kpi.started, total: kpi.total, defaultValue: '{{started}} de {{total}} han hecho al menos una actividad' })}
          footer={<StackedBar
            height={7}
            showLegend={false}
            segments={[
              { key: 'a', label: t('admin.progress_overview.seg_started', 'Participaron'), value: kpi.started, color: GREEN },
              { key: 'b', label: t('admin.progress_overview.seg_idle', 'Sin iniciar'), value: kpi.idle, color: '#a1a1aa' },
            ]}
          />}
        />
        <KpiCard
          delay={0.1}
          icon={<Gauge className="h-5 w-5" />}
          label={t('admin.progress_overview.kpi_score', 'Nota promedio')}
          value={loading ? null : kpi.avgScore}
          accent={AMBER}
          loading={loading}
          hint={t('admin.progress_overview.kpi_score_hint', { count: kpi.deliveries, defaultValue: 'Sobre {{count}} entregas evaluadas o resueltas' })}
        />
        <KpiCard
          delay={0.14}
          icon={<Award className="h-5 w-5" />}
          label={t('admin.progress_overview.kpi_certificates', 'Certificados')}
          frame={t('admin.progress_std.iso_completion', 'ISO 30414 · Finalización')}
          value={loading ? null : kpi.certificates}
          accent={VIOLET}
          loading={loading}
          active={focus === 'certified'}
          onClick={() => toggleFocus('certified')}
          delta={trend ? { value: trend.certificates, label: trendLabel } : null}
          hint={t('admin.progress_overview.kpi_certificates_hint', { count: kpi.certified, defaultValue: '{{count}} personas con al menos uno' })}
        />
        {/* Cumplimiento: la finalización de lo OBLIGATORIO, que es la cifra que
            se audita. Se pinta "—" si no hay nada marcado como obligatorio. */}
        <KpiCard
          delay={0.16}
          icon={<ShieldCheck className="h-5 w-5" />}
          label={t('admin.progress_overview.kpi_compliance', 'Cumplimiento obligatorio')}
          frame={t('admin.progress_std.iso_mandatory', 'ISO 30414 · Formación obligatoria')}
          value={loading ? null : kpi.compliance}
          suffix="%"
          accent="#f97316"
          loading={loading}
          active={focus === 'mandatory'}
          onClick={kpi.mandatoryTotal > 0 ? () => toggleFocus('mandatory') : undefined}
          hint={kpi.mandatoryTotal > 0
            ? t('admin.progress_overview.kpi_compliance_hint', { done: kpi.mandatoryDone, total: kpi.mandatoryTotal, defaultValue: '{{done}} de {{total}} asignaciones obligatorias terminadas' })
            : t('admin.progress_overview.kpi_compliance_none', 'Ningún curso está marcado como obligatorio todavía')}
        />
        {/* Avance de temario: el "cuánto llevan" real, módulo a módulo. */}
        <KpiCard
          delay={0.2}
          icon={<ListChecks className="h-5 w-5" />}
          label={t('admin.progress_overview.kpi_syllabus', 'Avance del temario')}
          value={loading ? null : kpi.syllabus}
          suffix="%"
          accent="#14b8a6"
          loading={loading}
          hint={t('admin.progress_overview.kpi_syllabus_hint', { done: kpi.modulesDone, total: kpi.modulesTotal, defaultValue: '{{done}} de {{total}} módulos asignados completados' })}
        />
        <KpiCard
          delay={0.18}
          icon={<HeartHandshake className="h-5 w-5" />}
          label={t('admin.progress_overview.kpi_nps', 'NPS')}
          value={nps.score}
          accent={MAGENTA}
          loading={surveys.loading}
          onClick={() => setTab('survey')}
          hint={nps.total > 0
            ? t('admin.progress_overview.kpi_nps_hint', { count: nps.total, defaultValue: 'De {{count}} encuestas de cierre' })
            : t('admin.progress_overview.kpi_nps_empty', 'Abre Satisfacción para calcularlo')}
        />
        <KpiCard
          delay={0.22}
          icon={<ClipboardCheck className="h-5 w-5" />}
          label={t('admin.progress_overview.kpi_pending', 'Por evaluar')}
          value={loading ? null : kpi.pending}
          accent={CYAN}
          loading={loading}
          active={focus === 'pending'}
          onClick={() => toggleFocus('pending')}
          hint={t('admin.progress_overview.kpi_pending_hint', 'Entregas esperando retroalimentación')}
        />
      </div>

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
            if (axis === 'job') setJob(value); else setCountry(value);
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
  onSegment: (axis: 'job' | 'country', value: string) => void;
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
              description={t('admin.progress_overview.no_activity_desc', 'Amplía el rango de fechas o cambia de campaña.')}
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

function SegmentBreakdown({
  people, onPick,
}: {
  people: ProgramPerson[];
  onPick: (axis: 'job' | 'country', value: string) => void;
}) {
  const { t } = useTranslation();
  const [axis, setAxis] = useState<'job' | 'country'>('job');

  const groups = useMemo(() => {
    const map = new Map<string, { total: number; started: number; completed: number; certified: number; scoreSum: number; scored: number }>();
    for (const p of people) {
      const key = (axis === 'job' ? p.jobTitle : p.country) ?? NO_VALUE;
      const g = map.get(key) ?? { total: 0, started: 0, completed: 0, certified: 0, scoreSum: 0, scored: 0 };
      g.total++;
      if (p.started > 0) g.started++;
      if (p.completed > 0) g.completed++;
      if (p.certified > 0) g.certified++;
      if (p.avgScore !== null) { g.scoreSum += p.avgScore; g.scored++; }
      map.set(key, g);
    }
    return [...map.entries()]
      .map(([key, g]) => ({
        key,
        label: key === NO_VALUE
          ? (axis === 'job'
              ? t('admin.progress_overview.no_job', 'Sin cargo')
              : t('admin.progress_overview.no_country', 'Sin país'))
          : axis === 'country'
            ? (countryLabel(key) ?? key)
            : key,
        ...g,
        participation: g.total > 0 ? Math.round((g.started / g.total) * 100) : 0,
        avg: g.scored > 0 ? Math.round(g.scoreSum / g.scored) : null,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [people, axis, t]);

  const maxTotal = Math.max(1, ...groups.map((g) => g.total));

  return (
    <SectionCard
      title={t('admin.progress_overview.segments_title', 'Cómo va cada grupo')}
      subtitle={t('admin.progress_overview.segments_sub', 'El mismo alcance, partido por cargo o por país')}
      icon={<Users className="h-4 w-4" />}
      accent={VIOLET}
      className="h-full"
      action={
        <div className="flex items-center gap-1 rounded-xl border border-line bg-subtle/50 p-1">
          {([
            { key: 'job' as const, label: t('admin.progress_overview.axis_job', 'Cargo') },
            { key: 'country' as const, label: t('admin.progress_overview.axis_country', 'País') },
          ]).map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setAxis(o.key)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
                axis === o.key ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
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
                onClick={() => onPick(axis, g.key)}
                className="w-full rounded-xl p-1.5 text-left transition-colors hover:bg-subtle"
              >
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <Tooltip anchor="element" maxWidth={300} delay={120} label={g.label} className="min-w-0">
                    <span className="truncate text-[12.5px] font-medium text-text">{g.label}</span>
                  </Tooltip>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-text-muted">
                    {t('admin.progress_overview.segment_line', {
                      count: g.total, participation: g.participation, certified: g.certified,
                      defaultValue: '{{count}} personas · {{participation}}% participación · {{certified}} certificados',
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex-1"><RankBar value={g.total} max={maxTotal} accent={VIOLET} delay={0.04 * i} /></span>
                  {g.avg !== null && (
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
          description={t('admin.progress_overview.no_people_desc', 'Prueba con otra campaña, amplía el rango o limpia la búsqueda.')}
        />
      ) : (
        <>
          <div className="group/table -mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[1120px] table-fixed border-separate border-spacing-0 text-[12.5px]">
              <thead>
                <tr>
                  {th('name', t('admin.progress_overview.col_person', 'Persona'), 'left', undefined, 'w-[215px]')}
                  {th('campaign', t('admin.progress_overview.col_campaign', 'Campaña'), 'left', undefined, 'w-[150px]')}
                  {th('assigned', t('admin.progress_overview.col_assigned', 'Asignados'), 'right', t('admin.progress_overview.help_assigned', 'Cursos que le tocan, por asignación directa o por su campaña.'))}
                  {th('mandatory', t('admin.progress_overview.col_mandatory', 'Obligatorios'), 'right', t('admin.progress_overview.help_mandatory', 'Cursos obligatorios terminados sobre los que le tocan. Es la cifra de cumplimiento que se audita.'))}
                  {th('syllabus', t('admin.progress_overview.col_syllabus', 'Temario'), 'right', t('admin.progress_overview.help_syllabus', 'Módulos completados sobre los módulos de sus cursos asignados.'))}
                  {th('completed', t('admin.progress_overview.col_completed', 'Completados'), 'right', t('admin.progress_overview.help_completed', 'Cursos certificados, o con todas sus entregas aprobadas y ninguna pendiente de evaluar.'))}
                  {th('certified', t('admin.progress_overview.col_certified', 'Certificados'), 'right', t('admin.progress_overview.help_certified', 'Certificados emitidos a esta persona.'))}
                  {th('score', t('admin.progress_overview.col_score_short', 'Nota'), 'right', t('admin.progress_overview.help_score', 'Promedio de todas sus entregas dentro del alcance elegido.'))}
                  {th('time', t('admin.progress_overview.col_time', 'Tiempo'), 'right', t('admin.progress_overview.help_time', 'Tiempo activo dentro de los módulos: no cuenta la pestaña abierta de fondo.'))}
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
          <table className="w-full min-w-[860px] border-separate border-spacing-0 text-[12.5px]">
            <thead>
              <tr>
                {th('title', t('admin.progress_overview.col_course', 'Curso'), 'left')}
                {th('assigned', t('admin.progress_overview.col_assigned', 'Asignados'), 'right', t('admin.progress_overview.help_course_assigned', 'Personas a las que les toca este curso.'))}
                {th('started', t('admin.progress_overview.col_started', 'Iniciados'), 'right', t('admin.progress_overview.help_course_started', 'Personas que ya resolvieron algo en este curso.'))}
                {th('completed', t('admin.progress_overview.col_completed', 'Completados'), 'right', t('admin.progress_overview.help_completed', 'Cursos certificados, o con todas sus entregas aprobadas y ninguna pendiente de evaluar.'))}
                {th('certified', t('admin.progress_overview.col_certified', 'Certificados'), 'right', t('admin.progress_overview.help_course_certified', 'Certificados emitidos de este curso.'))}
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
                            {c.campaignName && <span className="min-w-0 truncate text-[10.5px] text-text-subtle">· {c.campaignName}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums text-text-muted">{c.assigned}</td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums text-text">{c.started}</td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums text-text">{c.completed}</td>
                    <td className="border-b border-line/60 px-2.5 py-2.5 text-right tabular-nums" style={{ color: c.certified ? VIOLET : undefined }}>
                      {c.certified || '—'}
                    </td>
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
