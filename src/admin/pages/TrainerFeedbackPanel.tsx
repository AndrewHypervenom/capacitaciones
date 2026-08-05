import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { getPendingAttempts, saveTrainerFeedback, FeedbackPayload } from '@/services/activity.service';
import { notifyLearnerFeedback } from '@/services/notifications.service';
import { getModuleTimesForUsers, type ModuleTimeRow } from '@/services/moduleTime.service';
import { formatElapsed } from '@/hooks/useModuleTimer';
import { useAuth } from '@/hooks/useAuth';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { toast } from '@/stores/toastStore';
import {
  Code, LayoutTemplate, CheckCircle2, MessageSquare, Search,
  SlidersHorizontal, ChevronDown, ArrowDownUp, Clock, Send, Sparkles,
  ClipboardCheck, Award, ChevronRight, GraduationCap, Gamepad2, Video, HelpCircle,
  ArrowLeft, Building2, BookOpen, Layers, Users, ChevronLeft, RotateCcw,
  UserRound, TrendingUp, Zap, X, CornerDownLeft,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  CountUp, ProgressBar, ScoreDistribution, ScoreRing, StatTile, Highlight, useSearchHotkey,
  scoreHex, scoreTextTone, initials, tint,
} from './progress/ModulesChrome';
import { AttemptAnswers } from './progress/AttemptAnswers';

const MIN_FEEDBACK_CHARS = 8;

interface SubmittedAnswers {
  total?: number | string;
  aciertos?: number | string;
  errores?: number | string;
  total_preguntas?: number | string;
  correctas?: number | string;
  incorrectas?: number | string;
  total_cases?: number | string;
  [key: string]: any;
}

interface PendingAttempt {
  id: string;
  user_id: string;
  section_id?: string | null;
  module_id?: string | null;
  // Jerarquía Campaña → Curso → Módulo → Aprendiz.
  campaign_id?: string | null;
  campaign_name?: string | null;
  course_id?: string | null;
  course_title?: string | null;
  course_slug?: string | null;
  game_type: string;
  score: number;
  submitted_answers: SubmittedAnswers | null;
  started_at: string;
  trainer_comment?: string | null;
  feedback_date?: string | null;
  is_evaluated?: boolean;
  /**
   * El aprendiz volvió sobre un módulo que YA tenía completado. Es práctica, no
   * una entrega: por defecto el panel la oculta para no mezclarla con lo que sí
   * hay que evaluar (ver `reviewFilter`).
   */
  is_review?: boolean;
  student?: { id: string; name: string; email: string | null; } | null;
  campaign?: { title_es: string; } | null;
  module?: { title_es: string; } | null;
  section?: { heading_es: string; } | null;
}

type SortKey = 'recent' | 'score_desc' | 'score_asc' | 'name';

/** Segmentos activos de la navegación jerárquica del panel. */
interface NavPath {
  campaign?: { id: string; name: string };
  course?: { id: string; title: string };
  module?: { id: string; title: string };
  learner?: { id: string; name: string };
}

/** Clave centinela para agrupar intentos sin campaña/curso/módulo asignado. */
const NONE_KEY = '__none__';

type NavLevel = 'campaign' | 'course' | 'module' | 'learner' | 'attempt';

/** Un nodo de un nivel intermedio de la jerarquía (campaña/curso/módulo/aprendiz). */
interface HierNode {
  key: string;
  name: string;
  pending: number;
  total: number;
  learners: Set<string>;
  lastAt: number;
  /** Suma de notas para calcular el promedio del nodo. */
  scoreSum: number;
  /** Distribución de notas para la barra de 3 tramos. */
  perfect: number;
  passed: number;
  failed: number;
}

/** Una persona encontrada por la búsqueda global, con su resumen de avance. */
interface PersonHit {
  id: string;
  name: string;
  email: string | null;
  total: number;
  pending: number;
  avg: number;
  /** Cuántos cursos y módulos distintos ha tocado (lo primero que se pregunta). */
  courses: number;
  modules: number;
  lastAt: number;
}

export const TrainerFeedbackPanel: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user, isSuperAdmin } = useAuth();
  const confirm = useConfirm();

  const [attempts, setAttempts] = useState<PendingAttempt[]>([]);
  // Tiempo activo por aprendiz+módulo, indexado por `${user_id}:${module_id}`.
  const [moduleTimes, setModuleTimes] = useState<Record<string, ModuleTimeRow>>({});
  const [selectedAttempt, setSelectedAttempt] = useState<PendingAttempt | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'graphic' | 'json'>('graphic');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [scoreFilter, setScoreFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  // Repasos: fuera por defecto. El capacitador entra aquí a evaluar entregas; la
  // práctica sobre módulos ya terminados solo estorbaría (y falsearía los
  // contadores de pendientes). Se puede ver aparte o mezclada a voluntad.
  const [reviewFilter, setReviewFilter] = useState<string>('exclude');
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  // Navegación jerárquica: Campaña → Curso → Módulo → Aprendiz. El nivel actual se
  // deduce de qué segmentos están puestos (ver `level`), pensado para no volcar
  // miles de entregas planas: se baja por niveles con contadores de pendientes.
  const [path, setPath] = useState<NavPath>({});
  // Un único menú abierto a la vez (status/score/type/sort).
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Los filtros viven plegados: en el 90% de los casos se entra a evaluar con los
  // valores por defecto, y cinco desplegables permanentes le robaban la pantalla
  // a lo que importa (la lista de actividades). Lo que esté fuera de lo normal se
  // ve igual como "chip" debajo del buscador, aunque el cajón esté cerrado.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  // ⌘K / Ctrl+K / "/" enfocan la búsqueda: el panel se maneja sin soltar el teclado.
  const searchRef = useSearchHotkey();

  const statusOptions = [
    { value: 'pending', label: t('admin.trainer_panel.filter_status_pending') },
    { value: 'evaluated', label: t('admin.trainer_panel.filter_status_evaluated') },
    { value: 'all', label: t('admin.trainer_panel.filter_status_all') },
  ];

  const reviewOptions = [
    { value: 'exclude', label: t('admin.trainer_panel.filter_review_exclude', 'Sin repasos') },
    { value: 'only', label: t('admin.trainer_panel.filter_review_only', 'Solo repasos') },
    { value: 'all', label: t('admin.trainer_panel.filter_review_all', 'Entregas y repasos') },
  ];

  const scoreOptions = [
    { value: 'all', label: t('admin.trainer_panel.filter_all') },
    { value: 'perfect', label: t('admin.trainer_panel.filter_perfect') },
    { value: 'passed', label: t('admin.trainer_panel.filter_passed') },
    { value: 'failed', label: t('admin.trainer_panel.filter_failed') },
  ];

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: 'recent', label: t('admin.trainer_panel.sort_recent') },
    { value: 'score_desc', label: t('admin.trainer_panel.sort_score_desc') },
    { value: 'score_asc', label: t('admin.trainer_panel.sort_score_asc') },
    { value: 'name', label: t('admin.trainer_panel.sort_name') },
  ];

  // Opción de tipo derivada de las entregas realmente presentes.
  const typeOptions = useMemo(() => {
    const types = [...new Set(attempts.map((a) => a.game_type).filter(Boolean))];
    return [
      { value: 'all', label: t('admin.trainer_panel.filter_type_all') },
      ...types.map((type) => ({ value: type, label: formatGameType(type) })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts, i18n.language]);

  const feedbackTemplates = [
    t('admin.trainer_panel.tpl_excellent'),
    t('admin.trainer_panel.tpl_review_errors'),
    t('admin.trainer_panel.tpl_keep_going'),
    t('admin.trainer_panel.tpl_needs_improvement'),
  ];

  useEffect(() => {
    // Guarda de cancelación + try/finally: si el panel se desmonta (cambio rápido
    // de vista) o el fetch falla, no dejamos el spinner colgado ni tocamos estado
    // de una carga vieja.
    let cancelled = false;
    const loadAttempts = async () => {
      setLoading(true);
      try {
        const { data, error: fetchError } = await getPendingAttempts({ excludeSuperadmins: !isSuperAdmin });
        if (cancelled) return;
        if (fetchError) setError(t('admin.trainer_panel.load_err_title'));
        else if (data) {
          const rows = data as PendingAttempt[];
          setAttempts(rows);
          // Tiempo activo de todos los aprendices con entregas, en una sola consulta.
          const userIds = rows.map((r) => r.user_id).filter(Boolean);
          getModuleTimesForUsers(userIds).then((m) => { if (!cancelled) setModuleTimes(m); });
        }
      } catch (e) {
        if (!cancelled) { console.error('TrainerFeedbackPanel load error:', e); setError(t('admin.trainer_panel.load_err_title')); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadAttempts();
    return () => { cancelled = true; };
  }, [isSuperAdmin, t]);

  useEffect(() => {
    // En una entrega ya evaluada precargamos el comentario existente para poder
    // revisarlo o corregirlo; en las pendientes empezamos en blanco.
    setComment(selectedAttempt?.is_evaluated ? selectedAttempt.trainer_comment ?? '' : '');
    setViewMode('graphic');
  }, [selectedAttempt]);

  // Cerrar el menú desplegable abierto al hacer clic fuera del bloque de filtros.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Función declarada (hoisted) para poder usarla en los useMemo de arriba.
  function formatGameType(type: string) {
    switch (type) {
      case 'CLASSIFY_CASES': return t('admin.trainer_panel.type_classify');
      case 'SORT_PROCESS': return t('admin.trainer_panel.type_sort');
      case 'KNOWLEDGE_CHECK': return t('admin.trainer_panel.type_knowledge');
      case 'VIDEO_QUIZ': return t('admin.trainer_panel.type_video');
      default: return type.toUpperCase();
    }
  }

  /** Categoría de alto nivel de la actividad: ícono + etiqueta para el badge. */
  const activityMeta = (type: string): { label: string; Icon: typeof Gamepad2 } => {
    switch (type) {
      case 'KNOWLEDGE_CHECK': return { label: t('admin.trainer_panel.type_quiz'), Icon: HelpCircle };
      case 'VIDEO_QUIZ': return { label: t('admin.trainer_panel.type_video_quiz'), Icon: Video };
      case 'CLASSIFY_CASES':
      case 'SORT_PROCESS':
      default: return { label: t('admin.trainer_panel.type_game'), Icon: Gamepad2 };
    }
  };

  /** Hora relativa localizada del envío (ej. "hace 2 horas"). */
  const relativeTime = (iso: string) => {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diffSec = Math.round((then - Date.now()) / 1000);
    const abs = Math.abs(diffSec);
    const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
    if (abs < 60) return rtf.format(diffSec, 'second');
    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
    if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), 'day');
    return new Date(iso).toLocaleDateString(i18n.language);
  };

  const applyTemplate = (text: string) => {
    setComment((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
  };

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAttempt || comment.trim().length < MIN_FEEDBACK_CHARS || !user?.id) return;

    const ok = await confirm({
      tone: 'default',
      title: t('admin.trainer_panel.confirm_title'),
      description: t('admin.trainer_panel.confirm_desc'),
      confirmLabel: t('admin.trainer_panel.confirm_ok'),
    });
    if (!ok) return;

    setSubmitting(true);
    const payload: FeedbackPayload = {
      attempt_id: selectedAttempt.id,
      user_id: selectedAttempt.user_id,
      trainer_id: user.id,
      trainer_comment: comment.trim(),
      feedback_date: new Date().toISOString(),
    };

    const { error: submitError } = await saveTrainerFeedback(payload);
    if (submitError) {
      toast.error(t('admin.trainer_panel.save_err_title'), t('admin.trainer_panel.save_err_desc'));
    } else {
      // Avisamos al aprendiz (campana in-app). No bloqueamos el flujo si falla.
      notifyLearnerFeedback({
        userId: selectedAttempt.user_id,
        moduleTitle: selectedAttempt.module?.title_es ?? null,
        sectionHeading: selectedAttempt.section?.heading_es ?? null,
      }).catch((err) => console.error('No se pudo notificar la retroalimentación:', err));

      // Auto-avance: pasamos a la SIGUIENTE entrega pendiente visible para no perder
      // el flujo. La entrega evaluada NO se borra: queda marcada como evaluada y
      // sigue disponible en los filtros «Evaluadas»/«Todas».
      const nextPending = leafAttempts.find(
        (item) => item.id !== selectedAttempt.id && !item.is_evaluated,
      ) ?? null;

      setAttempts((prev) =>
        prev.map((item) =>
          item.id === selectedAttempt.id
            ? { ...item, trainer_comment: payload.trainer_comment, feedback_date: payload.feedback_date, is_evaluated: true }
            : item,
        ),
      );
      setSelectedAttempt(nextPending);
      setComment('');
      toast.success(t('admin.trainer_panel.saved_ok_title'), t('admin.trainer_panel.saved_ok_desc'));
    }
    setSubmitting(false);
  };

  // Pozo base: filtra por nota, tipo y repaso (afecta contadores de toda la
  // jerarquía, por eso el filtro de repaso vive aquí y no solo en la lista hoja).
  const pool = useMemo(() => {
    return attempts.filter((a) => {
      let matchesScore = true;
      if (scoreFilter === 'perfect') matchesScore = a.score === 100;
      else if (scoreFilter === 'passed') matchesScore = a.score >= 70 && a.score < 100;
      else if (scoreFilter === 'failed') matchesScore = a.score < 70;
      const matchesType = typeFilter === 'all' || a.game_type === typeFilter;
      const matchesReview =
        reviewFilter === 'all' ? true : reviewFilter === 'only' ? !!a.is_review : !a.is_review;
      return matchesScore && matchesType && matchesReview;
    });
  }, [attempts, scoreFilter, typeFilter, reviewFilter]);

  // Nivel actual de la navegación según los segmentos puestos. El aprendiz manda:
  // si hay una persona enfocada (por búsqueda global) mostramos TODAS sus entregas
  // aunque no se haya bajado por campaña → curso → módulo.
  const level: NavLevel = path.learner
    ? 'attempt'
    : !path.campaign
      ? 'campaign'
      : !path.course
        ? 'course'
        : !path.module
          ? 'module'
          : 'learner';

  /** ¿Se llegó a la persona por búsqueda global (sin bajar por la jerarquía)? */
  const personFocus = !!path.learner && !path.module;

  // ¿El intento cae dentro del prefijo de navegación actual?
  const inPrefix = (a: PendingAttempt) =>
    (!path.campaign || (a.campaign_id ?? NONE_KEY) === path.campaign.id) &&
    (!path.course || (a.course_id ?? NONE_KEY) === path.course.id) &&
    (!path.module || (a.module_id ?? NONE_KEY) === path.module.id) &&
    (!path.learner || a.user_id === path.learner.id);

  // Nodos del nivel intermedio actual (campaña/curso/módulo/aprendiz) con contadores.
  const nodes = useMemo<HierNode[]>(() => {
    if (level === 'attempt') return [];
    const scoped = pool.filter(inPrefix);
    const map = new Map<string, HierNode>();
    for (const a of scoped) {
      let key: string;
      let name: string;
      if (level === 'campaign') { key = a.campaign_id ?? NONE_KEY; name = a.campaign_name || t('admin.trainer_panel.no_campaign'); }
      else if (level === 'course') { key = a.course_id ?? NONE_KEY; name = a.course_title || t('admin.trainer_panel.no_course'); }
      else if (level === 'module') { key = a.module_id ?? NONE_KEY; name = a.module?.title_es || t('admin.trainer_panel.module_fallback'); }
      else { key = a.user_id; name = a.student?.name || t('admin.trainer_panel.student_fallback'); }
      let node = map.get(key);
      if (!node) {
        node = { key, name, pending: 0, total: 0, learners: new Set(), lastAt: 0, scoreSum: 0, perfect: 0, passed: 0, failed: 0 };
        map.set(key, node);
      }
      node.total++;
      if (!a.is_evaluated) node.pending++;
      node.scoreSum += a.score;
      if (a.score === 100) node.perfect++;
      else if (a.score >= 70) node.passed++;
      else node.failed++;
      node.learners.add(a.user_id);
      const at = new Date(a.started_at).getTime();
      if (at > node.lastAt) node.lastAt = at;
    }
    let arr = [...map.values()];
    const s = searchTerm.trim().toLowerCase();
    if (s) arr = arr.filter((n) => n.name.toLowerCase().includes(s));
    // Prioriza lo que tiene pendientes; luego lo más reciente; luego alfabético.
    arr.sort((a, b) => b.pending - a.pending || b.lastAt - a.lastAt || a.name.localeCompare(b.name));
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, path, level, searchTerm, i18n.language]);

  // Entregas del nivel hoja (aprendiz seleccionado): estado + búsqueda + orden.
  const leafAttempts = useMemo(() => {
    if (level !== 'attempt') return [] as PendingAttempt[];
    const s = searchTerm.trim().toLowerCase();
    const filtered = pool.filter((a) => {
      if (!inPrefix(a)) return false;
      let matchesStatus = true;
      if (statusFilter === 'pending') matchesStatus = !a.is_evaluated;
      else if (statusFilter === 'evaluated') matchesStatus = !!a.is_evaluated;
      if (!matchesStatus) return false;
      if (!s) return true;
      return (
        formatGameType(a.game_type).toLowerCase().includes(s) ||
        (a.section?.heading_es || '').toLowerCase().includes(s) ||
        (a.module?.title_es || '').toLowerCase().includes(s) ||
        (a.course_title || '').toLowerCase().includes(s)
      );
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'score_desc': return b.score - a.score;
        case 'score_asc': return a.score - b.score;
        case 'name': return (a.section?.heading_es || '').localeCompare(b.section?.heading_es || '');
        case 'recent':
        default: return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
      }
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, path, level, statusFilter, searchTerm, sortKey, i18n.language]);

  // Búsqueda global de PERSONAS: no importa en qué nivel estemos, si se escribe un
  // nombre (o correo) aparecen arriba las personas que coinciden, con su avance, y
  // un clic salta directo a todas sus entregas. Es el atajo que pidió el equipo:
  // "quiero buscar por persona", sin tener que adivinar campaña → curso → módulo.
  const peopleMatches = useMemo<PersonHit[]>(() => {
    const s = searchTerm.trim().toLowerCase();
    if (s.length < 2) return [];
    const map = new Map<string, PersonHit & { courseIds: Set<string>; moduleIds: Set<string> }>();
    for (const a of pool) {
      const name = a.student?.name || t('admin.trainer_panel.student_fallback');
      const email = a.student?.email ?? null;
      if (!name.toLowerCase().includes(s) && !(email || '').toLowerCase().includes(s)) continue;
      let hit = map.get(a.user_id);
      if (!hit) {
        hit = {
          id: a.user_id, name, email, total: 0, pending: 0, avg: 0,
          courses: 0, modules: 0, lastAt: 0,
          courseIds: new Set(), moduleIds: new Set(),
        };
        map.set(a.user_id, hit);
      }
      hit.total++;
      if (!a.is_evaluated) hit.pending++;
      hit.avg += a.score;
      hit.courseIds.add(a.course_id ?? NONE_KEY);
      hit.moduleIds.add(a.module_id ?? NONE_KEY);
      const at = new Date(a.started_at).getTime();
      if (at > hit.lastAt) hit.lastAt = at;
    }
    return [...map.values()]
      .map(({ courseIds, moduleIds, ...hit }) => ({
        ...hit,
        avg: hit.total ? Math.round(hit.avg / hit.total) : 0,
        courses: courseIds.size,
        modules: moduleIds.size,
      }))
      .sort((a, b) => b.pending - a.pending || b.lastAt - a.lastAt || a.name.localeCompare(b.name))
      .slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, searchTerm, i18n.language]);

  // Estadísticas globales del pozo filtrado: pendientes, evaluadas y avance de
  // revisión (lo que de verdad quiere saber el capacitador de un vistazo).
  const stats = useMemo(() => {
    const pending = pool.filter((a) => !a.is_evaluated);
    const total = pending.length;
    const avg = total === 0 ? 0 : Math.round(pending.reduce((s, a) => s + a.score, 0) / total);
    const perfect = pending.filter((a) => a.score === 100).length;
    const passed = pending.filter((a) => a.score >= 70 && a.score < 100).length;
    const failed = pending.filter((a) => a.score < 70).length;
    const evaluated = pool.length - total;
    const reviewPct = pool.length === 0 ? 100 : Math.round((evaluated / pool.length) * 100);
    const learners = new Set(pool.map((a) => a.user_id)).size;
    // Personas con alguna entrega reprobada pendiente: el foco de atención.
    const atRisk = new Set(pending.filter((a) => a.score < 70).map((a) => a.user_id)).size;
    return { total, avg, perfect, passed, failed, evaluated, reviewPct, learners, atRisk };
  }, [pool]);

  // Ficha de la persona enfocada. Se arma en dos niveles —curso → módulo— porque
  // la pregunta real del capacitador es "¿cuántos cursos y módulos lleva?", no
  // "¿cuántas filas hay?". Cada módulo cuenta como completado cuando el
  // cronómetro registró su finalización (misma señal que ve el aprendiz).
  const personSummary = useMemo(() => {
    if (!path.learner) return null;
    const mine = pool.filter((a) => a.user_id === path.learner!.id);
    if (mine.length === 0) return null;

    interface PMod { key: string; title: string; total: number; done: number; scoreSum: number; timeMs: number; completed: boolean }
    interface PCourse { key: string; title: string; modules: Map<string, PMod>; total: number; done: number; scoreSum: number }
    const byCourse = new Map<string, PCourse>();

    for (const a of mine) {
      const cKey = a.course_id ?? NONE_KEY;
      let course = byCourse.get(cKey);
      if (!course) {
        course = { key: cKey, title: a.course_title || t('admin.trainer_panel.no_course'), modules: new Map(), total: 0, done: 0, scoreSum: 0 };
        byCourse.set(cKey, course);
      }
      const mKey = a.module_id ?? NONE_KEY;
      let mod = course.modules.get(mKey);
      if (!mod) {
        const mt = a.module_id ? moduleTimes[`${a.user_id}:${a.module_id}`] : undefined;
        mod = {
          key: mKey,
          title: a.module?.title_es || t('admin.trainer_panel.module_fallback'),
          total: 0, done: 0, scoreSum: 0,
          timeMs: mt?.elapsedMs ?? 0,
          completed: !!mt?.completedAt,
        };
        course.modules.set(mKey, mod);
      }
      mod.total++; course.total++;
      if (a.is_evaluated) { mod.done++; course.done++; }
      mod.scoreSum += a.score; course.scoreSum += a.score;
    }

    const courses = [...byCourse.values()]
      .map((c) => {
        const modules = [...c.modules.values()]
          .map((m) => ({ ...m, avg: Math.round(m.scoreSum / m.total) }))
          .sort((a, b) => (b.total - b.done) - (a.total - a.done) || a.title.localeCompare(b.title));
        return {
          key: c.key,
          title: c.title,
          modules,
          total: c.total,
          done: c.done,
          avg: Math.round(c.scoreSum / c.total),
          modulesDone: modules.filter((m) => m.completed).length,
          timeMs: modules.reduce((s, m) => s + m.timeMs, 0),
        };
      })
      .sort((a, b) => (b.total - b.done) - (a.total - a.done) || a.title.localeCompare(b.title));

    const allModules = courses.flatMap((c) => c.modules);
    const pending = mine.filter((a) => !a.is_evaluated).length;
    return {
      name: path.learner.name,
      email: mine.find((a) => a.student?.email)?.student?.email ?? null,
      total: mine.length,
      pending,
      evaluated: mine.length - pending,
      avg: Math.round(mine.reduce((s, a) => s + a.score, 0) / mine.length),
      perfect: mine.filter((a) => a.score === 100).length,
      passed: mine.filter((a) => a.score >= 70 && a.score < 100).length,
      failed: mine.filter((a) => a.score < 70).length,
      courses,
      coursesCount: courses.length,
      modulesCount: allModules.length,
      modulesDone: allModules.filter((m) => m.completed).length,
      totalTimeMs: allModules.reduce((s, m) => s + m.timeMs, 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, path.learner, moduleTimes, i18n.language]);

  // ── Navegación por la jerarquía ──
  const enterNode = (node: HierNode) => {
    if (level === 'campaign') setPath((p) => ({ ...p, campaign: { id: node.key, name: node.name } }));
    else if (level === 'course') setPath((p) => ({ ...p, course: { id: node.key, title: node.name } }));
    else if (level === 'module') setPath((p) => ({ ...p, module: { id: node.key, title: node.name } }));
    else if (level === 'learner') setPath((p) => ({ ...p, learner: { id: node.key, name: node.name } }));
    setSelectedAttempt(null);
    setSearchTerm('');
  };

  // Salto directo a una persona desde la búsqueda global: se limpian los demás
  // segmentos para ver TODAS sus entregas, de cualquier campaña o curso.
  const focusPerson = (hit: PersonHit) => {
    setPath({ learner: { id: hit.id, name: hit.name } });
    setSelectedAttempt(null);
    setSearchTerm('');
    // Al mirar a una persona interesa su historia completa, no solo lo pendiente.
    setStatusFilter('all');
  };

  // Retrocede a una profundidad del breadcrumb (0=raíz, 1=campaña … 4=aprendiz).
  const goToDepth = (depth: number) => {
    setPath((p) => ({
      campaign: depth >= 1 ? p.campaign : undefined,
      course: depth >= 2 ? p.course : undefined,
      module: depth >= 3 ? p.module : undefined,
      learner: depth >= 4 ? p.learner : undefined,
    }));
    setSelectedAttempt(null);
    setSearchTerm('');
  };

  const selectedStatusLabel = statusOptions.find((opt) => opt.value === statusFilter)?.label || '';
  const selectedReviewLabel = reviewOptions.find((opt) => opt.value === reviewFilter)?.label || '';
  const selectedScoreLabel = scoreOptions.find((opt) => opt.value === scoreFilter)?.label || '';
  const selectedTypeLabel = typeOptions.find((opt) => opt.value === typeFilter)?.label || '';
  const selectedSortLabel = sortOptions.find((opt) => opt.value === sortKey)?.label || '';

  // Filtros que se apartan del valor por defecto: se muestran como chips y dan
  // el contador del botón "Filtros". Cada uno sabe cómo volver a su defecto.
  const activeFilters: { key: string; label: string; reset: () => void }[] = [
    ...(level === 'attempt' && statusFilter !== 'pending'
      ? [{ key: 'status', label: selectedStatusLabel, reset: () => setStatusFilter('pending') }] : []),
    ...(scoreFilter !== 'all' ? [{ key: 'score', label: selectedScoreLabel, reset: () => setScoreFilter('all') }] : []),
    ...(typeFilter !== 'all' ? [{ key: 'type', label: selectedTypeLabel, reset: () => setTypeFilter('all') }] : []),
    ...(reviewFilter !== 'exclude' ? [{ key: 'review', label: selectedReviewLabel, reset: () => setReviewFilter('exclude') }] : []),
    ...(level === 'attempt' && sortKey !== 'recent'
      ? [{ key: 'sort', label: selectedSortLabel, reset: () => setSortKey('recent') }] : []),
  ];

  const resetFilters = () => {
    setStatusFilter('pending'); setScoreFilter('all'); setTypeFilter('all');
    setReviewFilter('exclude'); setSortKey('recent');
  };


  if (loading) return <div className="flex h-full min-h-[60vh] items-center justify-center bg-bg text-text font-medium text-sm">{t('admin.trainer_panel.loading')}</div>;
  if (error) return <div className="flex h-full min-h-[60vh] items-center justify-center bg-bg text-red-500 font-medium text-sm">{error}</div>;

  const remaining = comment.trim().length;
  const canSubmit = remaining >= MIN_FEEDBACK_CHARS && !submitting;

  return (
    <div className="flex flex-col h-full bg-bg text-text overflow-hidden font-sans">

      {/* ===== Barra superior: identidad del panel + pulso del avance ===== */}
      <header className="relative shrink-0 border-b border-line bg-white/60 dark:bg-zinc-900/30 backdrop-blur px-4 sm:px-6 py-3 sm:py-4">
        <div aria-hidden className="absolute inset-x-0 top-0 h-0.5" style={{ background: 'linear-gradient(90deg, rgb(var(--brand-magenta)), transparent)' }} />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 text-white shadow-lg"
              style={{ background: 'linear-gradient(135deg, rgb(var(--brand-magenta)), color-mix(in srgb, rgb(var(--brand-magenta)) 72%, #000))', boxShadow: '0 8px 22px -8px color-mix(in srgb, rgb(var(--brand-magenta)) 55%, transparent)' }}
            >
              <ClipboardCheck className="w-5 h-5" />
            </motion.div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight truncate">{t('admin.trainer_panel.pending_evals')}</h1>
              {/* Avance de revisión: cuánto de lo que hay ya quedó evaluado. */}
              <div className="mt-1.5 flex items-center gap-2 max-w-[320px]">
                <ProgressBar pct={stats.reviewPct} accent="rgb(var(--brand-magenta))" height={5} className="min-w-[110px]" />
                <span className="text-[11px] font-semibold tabular-nums text-text-muted shrink-0">
                  <CountUp value={stats.reviewPct} suffix="%" /> {t('admin.trainer_panel.reviewed_label', 'revisado')}
                </span>
              </div>
            </div>
          </div>

          {/* KPIs: los dos primeros filtran (menos clics para llegar a lo urgente) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5 w-full sm:w-auto">
            <StatTile
              icon={<ClipboardCheck className="w-4 h-4" />}
              label={t('admin.trainer_panel.stat_pending')}
              value={stats.total}
              accent="#f59e0b"
              active={statusFilter === 'pending'}
            />
            <StatTile
              icon={<Award className="w-4 h-4" />}
              label={t('admin.trainer_panel.stat_average')}
              value={stats.avg}
              suffix="%"
              accent={scoreHex(stats.avg)}
              sub={<ScoreDistribution perfect={stats.perfect} passed={stats.passed} failed={stats.failed} />}
            />
            <StatTile
              icon={<Users className="w-4 h-4" />}
              label={t('admin.trainer_panel.stat_learners', 'Aprendices')}
              value={stats.learners}
              accent="rgb(var(--brand-green))"
            />
            <StatTile
              icon={<TrendingUp className="w-4 h-4" />}
              label={t('admin.trainer_panel.stat_at_risk', 'En riesgo')}
              value={stats.atRisk}
              accent="#ef4444"
              active={scoreFilter === 'failed'}
              onClick={() => setScoreFilter(scoreFilter === 'failed' ? 'all' : 'failed')}
            />
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* ===== Columna Izquierda: navegador jerárquico ===== */}
        <aside className={cn(
          'w-full md:w-[360px] xl:w-[400px] md:shrink-0 border-r border-line flex-col h-full bg-bg',
          selectedAttempt ? 'hidden md:flex' : 'flex',
        )}>
          <div className="p-3.5 border-b border-line shrink-0 space-y-2" ref={filtersRef}>
            {/* Migas de pan: Campañas › Campaña › Curso › Módulo › Aprendiz.
                El "subir un nivel" va como flecha a la izquierda de las migas:
                una sola fila de navegación en vez de dos. */}
            <div className="flex items-center gap-1 flex-wrap text-[11px]">
              {level !== 'campaign' && (
                <button
                  type="button"
                  onClick={() => goToDepth(
                    level === 'attempt' ? 3 : level === 'learner' ? 2 : level === 'module' ? 1 : 0,
                  )}
                  title={t('admin.trainer_panel.go_up')}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-line text-text-muted hover:text-text hover:border-green-500/40 transition-colors mr-0.5"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              )}
              {(() => {
                const crumbs: { label: string; depth: number }[] = [
                  {
                    label: personFocus
                      ? t('admin.trainer_panel.crumb_people', 'Personas')
                      : t('admin.trainer_panel.crumb_root'),
                    depth: 0,
                  },
                ];
                if (path.campaign) crumbs.push({ label: path.campaign.name, depth: 1 });
                if (path.course) crumbs.push({ label: path.course.title, depth: 2 });
                if (path.module) crumbs.push({ label: path.module.title, depth: 3 });
                if (path.learner) crumbs.push({ label: path.learner.name, depth: 4 });
                return crumbs.map((c, idx) => {
                  const isLast = idx === crumbs.length - 1;
                  return (
                    <span key={c.depth} className="flex items-center gap-1 min-w-0">
                      {idx > 0 && <ChevronRight className="w-3 h-3 text-text-muted/40 shrink-0" />}
                      <button
                        type="button"
                        disabled={isLast}
                        onClick={() => goToDepth(c.depth)}
                        className={cn(
                          'truncate max-w-[120px] rounded px-1 py-0.5 transition-colors',
                          isLast
                            ? 'font-semibold text-text cursor-default'
                            : 'text-text-muted hover:text-green-600 dark:hover:text-green-400 hover:bg-green-500/5',
                        )}
                        title={c.label}
                      >
                        {c.label}
                      </button>
                    </span>
                  );
                });
              })()}
            </div>

            {/* Buscador universal: filtra el nivel actual Y encuentra personas en
                toda la jerarquía (ver bloque "Personas" de la lista). */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted/60" />
              <input
                ref={searchRef}
                type="text"
                placeholder={
                  level === 'campaign' ? t('admin.trainer_panel.ph_search_any', 'Buscar persona, campaña…')
                    : level === 'course' ? t('admin.trainer_panel.ph_search_course')
                    : level === 'module' ? t('admin.trainer_panel.ph_search_module')
                    : level === 'learner' ? t('admin.trainer_panel.ph_search_learner')
                    : t('admin.trainer_panel.ph_search_activity')
                }
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchTerm('');
                  // Enter con una sola persona encontrada = saltar a ella.
                  if (e.key === 'Enter' && peopleMatches.length === 1) focusPerson(peopleMatches[0]);
                }}
                className="w-full bg-zinc-50 dark:bg-zinc-900/50 border border-line rounded-xl pl-9 pr-16 py-2 text-xs text-text placeholder:text-text-muted/50 outline-none focus:border-green-500/40 transition-colors"
              />
              {searchTerm ? (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  title={t('admin.trainer_panel.clear_search', 'Limpiar')}
                  className="absolute right-2.5 top-2 grid h-5 w-5 place-items-center rounded-md text-text-muted/60 hover:text-text hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : (
                <kbd className="pointer-events-none absolute right-2.5 top-2 hidden sm:inline-flex items-center rounded-md border border-line bg-surface px-1.5 py-0.5 text-[9.5px] font-semibold text-text-muted/70">
                  ⌘K
                </kbd>
              )}
            </div>

            {/* Barra de filtros: un botón + los chips de lo que esté activo */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                  filtersOpen || activeFilters.length > 0
                    ? 'border-green-500/40 text-green-600 dark:text-green-400 bg-green-500/5'
                    : 'border-line text-text-muted hover:text-text',
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t('admin.trainer_panel.filters', 'Filtros')}
                {activeFilters.length > 0 && (
                  <span className="grid h-4 min-w-[16px] place-items-center rounded-full bg-green-500/20 px-1 text-[9.5px] font-bold">
                    {activeFilters.length}
                  </span>
                )}
                <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', filtersOpen && 'rotate-180')} />
              </button>

              {activeFilters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={f.reset}
                  title={t('admin.trainer_panel.remove_filter', 'Quitar filtro')}
                  className="inline-flex max-w-[150px] items-center gap-1 rounded-lg border border-line bg-subtle/60 px-2 py-1 text-[10.5px] text-text-muted hover:text-text hover:border-red-500/30 transition-colors"
                >
                  <span className="truncate">{f.label}</span>
                  <X className="h-3 w-3 shrink-0" />
                </button>
              ))}

              {activeFilters.length > 1 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-[10.5px] font-semibold text-text-muted hover:text-text underline underline-offset-2 transition-colors"
                >
                  {t('admin.trainer_panel.clear_filters', 'Limpiar')}
                </button>
              )}
            </div>

            {/* Cajón de filtros (plegado por defecto) */}
            <AnimatePresence initial={false}>
              {filtersOpen && (
                <motion.div
                  key="filters"
                  // Sin animar la altura: los desplegables son absolutos y un
                  // contenedor con overflow recortado se los comería al abrirse.
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {/* Estado y orden solo importan en el nivel hoja (lista de intentos) */}
                    {level === 'attempt' && (
                      <Dropdown
                        open={openMenu === 'status'}
                        onToggle={() => setOpenMenu(openMenu === 'status' ? null : 'status')}
                        icon={<ClipboardCheck className="h-3.5 w-3.5 text-text-muted/60 absolute left-3" />}
                        label={selectedStatusLabel}
                        options={statusOptions}
                        selected={statusFilter}
                        onSelect={(v) => { setStatusFilter(v); setOpenMenu(null); }}
                      />
                    )}
                    {/* Filtro por nota (afecta contadores de toda la jerarquía) */}
                    <Dropdown
                      open={openMenu === 'score'}
                      onToggle={() => setOpenMenu(openMenu === 'score' ? null : 'score')}
                      icon={<Award className="h-3.5 w-3.5 text-text-muted/60 absolute left-3" />}
                      label={selectedScoreLabel}
                      options={scoreOptions}
                      selected={scoreFilter}
                      onSelect={(v) => { setScoreFilter(v); setOpenMenu(null); }}
                    />
                    {/* Filtro por tipo de actividad */}
                    <Dropdown
                      open={openMenu === 'type'}
                      onToggle={() => setOpenMenu(openMenu === 'type' ? null : 'type')}
                      icon={<Gamepad2 className="h-3.5 w-3.5 text-text-muted/60 absolute left-3" />}
                      label={selectedTypeLabel}
                      options={typeOptions}
                      selected={typeFilter}
                      onSelect={(v) => { setTypeFilter(v); setOpenMenu(null); }}
                    />
                    {/* Entregas vs. repasos: vive en todos los niveles porque cambia
                        los contadores de pendientes, no solo la lista. */}
                    <Dropdown
                      open={openMenu === 'review'}
                      onToggle={() => setOpenMenu(openMenu === 'review' ? null : 'review')}
                      icon={<RotateCcw className="h-3.5 w-3.5 text-text-muted/60 absolute left-3" />}
                      label={selectedReviewLabel}
                      options={reviewOptions}
                      selected={reviewFilter}
                      onSelect={(v) => { setReviewFilter(v); setOpenMenu(null); }}
                    />
                    {level === 'attempt' && (
                      <div className="col-span-2">
                        <Dropdown
                          open={openMenu === 'sort'}
                          onToggle={() => setOpenMenu(openMenu === 'sort' ? null : 'sort')}
                          icon={<ArrowDownUp className="h-3.5 w-3.5 text-text-muted/60 absolute left-3" />}
                          label={selectedSortLabel}
                          options={sortOptions}
                          selected={sortKey}
                          onSelect={(v) => { setSortKey(v as SortKey); setOpenMenu(null); }}
                        />
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Encabezado del nivel actual */}
          <div className="px-4 py-2 shrink-0 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
              {level === 'campaign' ? t('admin.trainer_panel.lvl_campaigns')
                : level === 'course' ? t('admin.trainer_panel.lvl_courses')
                : level === 'module' ? t('admin.trainer_panel.lvl_modules')
                : level === 'learner' ? t('admin.trainer_panel.lvl_learners')
                : t('admin.trainer_panel.lvl_activities')}
            </span>
            <span className="text-[10px] font-mono text-text-muted/70">
              {level === 'attempt' ? leafAttempts.length : nodes.length}
            </span>
          </div>

          {/* Lista (personas encontradas + nodos intermedios o entregas hoja) */}
          <div className="flex-1 overflow-y-auto p-3 pt-0 space-y-2 custom-scrollbar">

            {/* ── Personas encontradas (búsqueda global, en cualquier nivel) ── */}
            <AnimatePresence initial={false}>
              {peopleMatches.length > 0 && (
                <motion.div
                  key="people"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="mb-1.5 flex items-center gap-1.5 px-1 pt-1">
                    <UserRound className="h-3 w-3 text-[rgb(var(--brand-green))]" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                      {t('admin.trainer_panel.people_results', 'Personas')}
                    </span>
                    <span className="text-[10px] font-mono text-text-muted/60">{peopleMatches.length}</span>
                    {peopleMatches.length === 1 && (
                      <span className="ml-auto hidden sm:inline-flex items-center gap-1 text-[9.5px] text-text-muted/60">
                        <CornerDownLeft className="h-3 w-3" />
                        {t('admin.trainer_panel.enter_to_open', 'Enter para abrir')}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2 pb-2 mb-1 border-b border-line">
                    {peopleMatches.map((hit, i) => (
                      <motion.button
                        key={hit.id}
                        onClick={() => focusPerson(hit)}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                        whileHover={{ x: 3 }}
                        className="group w-full text-left p-3 rounded-2xl border border-[rgb(var(--brand-green))]/25 bg-[rgb(var(--brand-green))]/[0.06] hover:border-[rgb(var(--brand-green))]/50 transition-colors flex items-center gap-3"
                      >
                        <div
                          className="shrink-0 w-10 h-10 rounded-xl grid place-items-center text-[13px] font-bold border"
                          style={{ background: tint(scoreHex(hit.avg), 12), color: scoreHex(hit.avg), borderColor: tint(scoreHex(hit.avg), 28) }}
                        >
                          {initials(hit.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-semibold text-text truncate">
                              <Highlight text={hit.name} term={searchTerm} />
                            </span>
                            {hit.pending > 0 && (
                              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                                {hit.pending}
                              </span>
                            )}
                          </div>
                          {/* Cursos · módulos · actividades: la respuesta directa a
                              "¿cuánto ha hecho esta persona?" sin abrir nada. */}
                          <div className="mt-1 flex items-center gap-2.5 text-[10.5px] text-text-muted/85">
                            <span className="inline-flex items-center gap-1">
                              <BookOpen className="h-3 w-3" />
                              {t('admin.trainer_panel.sub_courses', { count: hit.courses })}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Layers className="h-3 w-3" />
                              {t('admin.trainer_panel.sub_modules', { count: hit.modules })}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className={cn('text-[10px] font-bold tabular-nums', scoreTextTone(hit.avg))}>{hit.avg}%</span>
                            <span className="text-[10px] text-text-muted/70">
                              {t('admin.trainer_panel.sub_activities', { count: hit.total })}
                            </span>
                          </div>
                        </div>
                        <Zap className="h-4 w-4 shrink-0 text-[rgb(var(--brand-green))]/40 group-hover:text-[rgb(var(--brand-green))] transition-colors" />
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {level !== 'attempt' ? (
              nodes.length === 0 ? (
                peopleMatches.length === 0 && <EmptyState attemptsEmpty={attempts.length === 0} t={t} />
              ) : (
                nodes.map((node, i) => {
                  const LevelIcon = level === 'campaign' ? Building2 : level === 'course' ? BookOpen : level === 'module' ? Layers : null;
                  const avg = node.total ? Math.round(node.scoreSum / node.total) : 0;
                  const donePct = node.total ? ((node.total - node.pending) / node.total) * 100 : 100;
                  return (
                    <motion.button
                      key={node.key}
                      layout="position"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, delay: Math.min(i, 12) * 0.03, ease: [0.16, 1, 0.3, 1] }}
                      whileHover={{ y: -2 }}
                      onClick={() => enterNode(node)}
                      className="group w-full text-left p-3 rounded-2xl cursor-pointer border border-line bg-zinc-50/60 dark:bg-zinc-900/40 hover:border-green-500/40 hover:shadow-card-hover transition-[border-color,box-shadow] duration-200 select-none flex items-center gap-3"
                    >
                      {LevelIcon ? (
                        <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400 transition-transform duration-300 group-hover:scale-105">
                          <LevelIcon className="w-5 h-5" />
                        </div>
                      ) : (
                        // A nivel de aprendiz el avatar cede su lugar al anillo de nota:
                        // de un vistazo se ve cómo va la persona, no solo cómo se llama.
                        <ScoreRing score={avg} size={40} stroke={4} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold text-text truncate">
                            <Highlight text={node.name} term={searchTerm} />
                          </span>
                          {node.pending > 0 ? (
                            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-bold">
                              {node.pending}
                            </span>
                          ) : (
                            <CheckCircle2 className="w-4 h-4 shrink-0 text-green-500" />
                          )}
                        </div>
                        {/* Avance de revisión del nodo + distribución de notas */}
                        <div className="mt-1.5 flex items-center gap-2">
                          <ProgressBar
                            pct={donePct}
                            accent={node.pending > 0 ? '#f59e0b' : '#22c55e'}
                            height={4}
                            delay={Math.min(i, 12) * 0.03}
                          />
                          <span className="shrink-0 text-[9.5px] font-semibold tabular-nums text-text-muted/70">
                            {node.total - node.pending}/{node.total}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-text-muted/80">
                          {level === 'learner' ? (
                            <span className="inline-flex items-center gap-1">
                              <ClipboardCheck className="w-3 h-3" />
                              {t('admin.trainer_panel.sub_activities', { count: node.total })}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {t('admin.trainer_panel.sub_learners', { count: node.learners.size })}
                            </span>
                          )}
                          <span className="text-text-muted/50">·</span>
                          <span className={cn('font-semibold tabular-nums', scoreTextTone(avg))}>{avg}%</span>
                          {node.lastAt > 0 && (
                            <>
                              <span className="text-text-muted/50">·</span>
                              <span className="truncate">{relativeTime(new Date(node.lastAt).toISOString())}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 shrink-0 text-text-muted/30 group-hover:text-green-500 group-hover:translate-x-0.5 transition-all" />
                    </motion.button>
                  );
                })
              )
            ) : leafAttempts.length === 0 ? (
              peopleMatches.length === 0 && <EmptyState attemptsEmpty={attempts.length === 0} t={t} />
            ) : (
              leafAttempts.map((attempt, i) => {
                const isActive = selectedAttempt?.id === attempt.id;
                const studentName = attempt.student?.name || t('admin.trainer_panel.student_fallback');
                const meta = activityMeta(attempt.game_type);
                return (
                  <motion.button
                    key={attempt.id}
                    layout="position"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: Math.min(i, 12) * 0.03, ease: [0.16, 1, 0.3, 1] }}
                    whileHover={{ y: -2 }}
                    onClick={() => setSelectedAttempt(attempt)}
                    className={cn(
                      'group w-full text-left p-3 rounded-2xl cursor-pointer border transition-[border-color,box-shadow] duration-200 select-none flex items-center gap-3 relative overflow-hidden',
                      isActive
                        ? 'bg-white dark:bg-zinc-900 border-green-500 shadow-lg shadow-green-500/5'
                        : 'bg-zinc-50/60 dark:bg-zinc-900/40 border-line hover:border-zinc-300 dark:hover:border-zinc-700'
                    )}
                  >
                    {/* Acento lateral según prioridad */}
                    <span className="absolute left-0 top-0 bottom-0 w-1 rounded-r" style={{ background: scoreHex(attempt.score), opacity: isActive ? 1 : 0.35 }} />

                    {/* Anillo de nota: la señal más útil de la fila */}
                    <div className="ml-1 shrink-0">
                      <ScoreRing score={attempt.score} size={40} stroke={4} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-text truncate">
                          {attempt.section?.heading_es || studentName}
                        </span>
                        {attempt.is_evaluated ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-green-500" />
                        ) : (
                          <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                            {t('admin.trainer_panel.filter_status_pending')}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-text-muted truncate mt-0.5">
                        {/* Al mirar a una persona, el módulo importa más que el tipo de juego */}
                        {personFocus
                          ? attempt.module?.title_es || t('admin.trainer_panel.module_fallback')
                          : formatGameType(attempt.game_type)}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800/70 border border-line text-[9px] font-bold uppercase tracking-wide text-text-muted">
                          <meta.Icon className="w-3 h-3" />
                          {meta.label}
                        </span>
                        {attempt.is_review && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                            <RotateCcw className="w-3 h-3" />
                            {t('admin.trainer_panel.review_badge', 'Repaso')}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-[10px] text-text-muted/70">
                          <Clock className="w-3 h-3" />
                          {relativeTime(attempt.started_at)}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className={cn('w-4 h-4 shrink-0 transition-colors', isActive ? 'text-green-500' : 'text-text-muted/30 group-hover:text-text-muted/60')} />
                  </motion.button>
                );
              })
            )}
          </div>
        </aside>

        {/* ===== Detalle de la Entrega ===== */}
        <main className={cn(
          'flex-1 flex-col h-full bg-zinc-50 dark:bg-[#111217] overflow-hidden',
          selectedAttempt ? 'flex' : 'hidden md:flex',
        )}>
          {selectedAttempt ? (
            <div className="flex flex-col h-full overflow-y-auto custom-scrollbar">
              {/* Volver a la lista — solo en móvil, donde el detalle ocupa toda la pantalla */}
              <button
                onClick={() => setSelectedAttempt(null)}
                className="md:hidden shrink-0 flex items-center gap-2 px-4 py-3 border-b border-line text-[13px] font-medium text-text-muted hover:text-text transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                {t('admin.trainer_panel.back_to_list', 'Volver a la lista')}
              </button>
              <motion.div
                // `key` por entrega: al saltar a la siguiente pendiente el detalle
                // vuelve a entrar, lo que hace evidente que cambió de aprendiz.
                key={selectedAttempt.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                className="p-4 sm:p-8 space-y-6 max-w-4xl w-full mx-auto"
              >

                {/* Hero del alumno */}
                <div className="bg-white dark:bg-zinc-900/50 rounded-2xl border border-line shadow-sm p-6">
                  <div className="flex items-start justify-between gap-6 flex-wrap">
                    <div className="flex items-center gap-4 min-w-0">
                      <div
                        className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold border shrink-0"
                        style={{
                          background: `${scoreHex(selectedAttempt.score)}1a`,
                          color: scoreHex(selectedAttempt.score),
                          borderColor: `${scoreHex(selectedAttempt.score)}33`,
                        }}
                      >
                        {initials(selectedAttempt.student?.name || t('admin.trainer_panel.student_fallback'))}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-lg font-bold text-text truncate">{selectedAttempt.student?.name || t('admin.trainer_panel.student_fallback')}</h2>
                          {(() => {
                            const meta = activityMeta(selectedAttempt.game_type);
                            return (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-500/10 border border-green-500/20 text-[10px] font-bold uppercase tracking-wide text-green-600 dark:text-green-400">
                                <meta.Icon className="w-3 h-3" />
                                {meta.label}
                              </span>
                            );
                          })()}
                          {selectedAttempt.is_review && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                              <RotateCcw className="w-3 h-3" />
                              {t('admin.trainer_panel.review_badge', 'Repaso')}
                            </span>
                          )}
                        </div>
                        {/* Un repaso no es una entrega: se avisa explícito para que
                            nadie evalúe (ni castigue) una práctica voluntaria. */}
                        {selectedAttempt.is_review && (
                          <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                            {t(
                              'admin.trainer_panel.review_note',
                              'Práctica sobre un módulo que ya tenía completado. No reemplaza su entrega original ni afecta su certificado.',
                            )}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 text-xs text-text-muted mt-1 min-w-0">
                          <GraduationCap className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{selectedAttempt.module?.title_es || t('admin.trainer_panel.module_fallback')}</span>
                          <ChevronRight className="w-3 h-3 shrink-0 opacity-50" />
                          <span className="truncate">{selectedAttempt.section?.heading_es || t('admin.trainer_panel.challenge_fallback')}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-text-muted/70 mt-1.5">
                          <Clock className="w-3 h-3" />
                          {t('admin.trainer_panel.submitted_at')} {relativeTime(selectedAttempt.started_at)}
                        </div>
                        {/* Tiempo activo real que el aprendiz pasó en el módulo */}
                        {(() => {
                          const mt = selectedAttempt.module_id
                            ? moduleTimes[`${selectedAttempt.user_id}:${selectedAttempt.module_id}`]
                            : undefined;
                          return (
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                                <Clock className="w-3 h-3" />
                                {t('admin.trainer_panel.module_time_label')}:{' '}
                                {mt ? formatElapsed(mt.elapsedMs) : t('admin.trainer_panel.module_time_none')}
                              </span>
                              {mt?.completedAt && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-500/10 border border-green-500/20 text-[10px] font-bold uppercase tracking-wide text-green-600 dark:text-green-400">
                                  <CheckCircle2 className="w-3 h-3" />
                                  {t('admin.trainer_panel.module_time_completed')}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Anillo de nota */}
                    <div className="flex flex-col items-center shrink-0">
                      <div
                        className="relative w-20 h-20 rounded-full flex items-center justify-center"
                        style={{ background: `conic-gradient(${scoreHex(selectedAttempt.score)} ${selectedAttempt.score}%, rgba(120,120,120,0.15) ${selectedAttempt.score}%)` }}
                      >
                        <div className="absolute w-[62px] h-[62px] bg-white dark:bg-zinc-900 rounded-full flex items-center justify-center">
                          <span className={cn('text-lg font-mono font-bold', scoreTextTone(selectedAttempt.score))}>{selectedAttempt.score}%</span>
                        </div>
                      </div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted mt-2">{t('admin.trainer_panel.final_score')}</span>
                    </div>
                  </div>
                </div>

                {/* Respuestas enviadas */}
                <div className="bg-white dark:bg-[#0d0e12] border border-line rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                      {t('admin.trainer_panel.answers_title')} ({formatGameType(selectedAttempt.game_type)})
                    </h4>
                    <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg border border-line">
                      <button
                        type="button"
                        onClick={() => setViewMode('graphic')}
                        className={cn('flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all duration-200',
                          viewMode === 'graphic' ? 'bg-white dark:bg-[#111217] text-text shadow-sm border border-line' : 'text-text-muted hover:text-text')}
                      >
                        <LayoutTemplate className="w-3.5 h-3.5" />
                        {t('admin.trainer_panel.view_graphic')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode('json')}
                        className={cn('flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all duration-200',
                          viewMode === 'json' ? 'bg-white dark:bg-[#111217] text-text shadow-sm border border-line' : 'text-text-muted hover:text-text')}
                      >
                        <Code className="w-3.5 h-3.5" />
                        {t('admin.trainer_panel.view_json')}
                      </button>
                    </div>
                  </div>

                  <div>
                    {selectedAttempt.submitted_answers && Object.keys(selectedAttempt.submitted_answers).length > 0 ? (
                      <>
                        {viewMode === 'graphic' && (
                          <AttemptAnswers
                            gameType={selectedAttempt.game_type}
                            answers={selectedAttempt.submitted_answers}
                            score={selectedAttempt.score}
                            sectionId={selectedAttempt.section_id}
                          />
                        )}
                        {viewMode === 'json' && (
                          <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-line shadow-inner max-h-80 overflow-y-auto custom-scrollbar">
                            <pre className="font-mono text-[11px] text-text whitespace-pre-wrap word-break leading-relaxed">
                              {JSON.stringify(selectedAttempt.submitted_answers, null, 2)}
                            </pre>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-text-muted italic text-xs py-10 flex items-center justify-center">
                        {t('admin.trainer_panel.no_json')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Composer de retroalimentación */}
                <form onSubmit={handleSubmitFeedback} className="bg-white dark:bg-zinc-900/50 border border-line rounded-2xl p-6 shadow-sm space-y-3">
                  <label className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" />
                    {t('admin.trainer_panel.feedback_label')}
                  </label>

                  {/* Plantillas rápidas */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-text-muted/70 uppercase tracking-wider mr-1">{t('admin.trainer_panel.templates_label')}:</span>
                    {feedbackTemplates.map((tpl, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => applyTemplate(tpl)}
                        title={tpl}
                        className="max-w-[220px] truncate px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-line text-[11px] text-text-muted hover:text-text hover:border-green-500/40 transition-colors"
                      >
                        {tpl}
                      </button>
                    ))}
                  </div>

                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={t('admin.trainer_panel.ph_observations')}
                    rows={4}
                    className="w-full bg-zinc-50 dark:bg-[#0d0e12] border border-line rounded-xl p-4 text-sm text-text placeholder:text-zinc-400 dark:placeholder:text-zinc-600 outline-none focus:border-green-500/40 transition-colors resize-none custom-scrollbar shadow-inner"
                  />

                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className={cn('text-[11px]', remaining >= MIN_FEEDBACK_CHARS ? 'text-text-muted/60' : 'text-amber-500')}>
                      {remaining >= MIN_FEEDBACK_CHARS
                        ? t('admin.trainer_panel.char_count', { count: remaining })
                        : t('admin.trainer_panel.min_chars', { count: MIN_FEEDBACK_CHARS })}
                    </p>
                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className="px-6 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-xs font-semibold uppercase tracking-wider text-white transition-all duration-200 select-none shadow-lg shadow-green-600/10 inline-flex items-center gap-2"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {submitting ? t('admin.trainer_panel.submitting') : t('admin.trainer_panel.submit')}
                    </button>
                  </div>
                </form>

              </motion.div>
            </div>
          ) : personSummary ? (
            /* Ficha de la persona: su avance completo antes de abrir una entrega */
            <div className="h-full overflow-y-auto custom-scrollbar p-4 sm:p-8">
              <div className="max-w-3xl mx-auto space-y-5">
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className="relative overflow-hidden rounded-2xl border border-line bg-white dark:bg-zinc-900/50 p-6 shadow-sm"
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-[0.12] blur-3xl"
                    style={{ background: scoreHex(personSummary.avg) }}
                  />
                  <div className="relative flex items-center gap-4 flex-wrap">
                    <div
                      className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border text-xl font-bold"
                      style={{
                        background: tint(scoreHex(personSummary.avg), 12),
                        color: scoreHex(personSummary.avg),
                        borderColor: tint(scoreHex(personSummary.avg), 30),
                      }}
                    >
                      {initials(personSummary.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-xl font-bold tracking-tight text-text">{personSummary.name}</h2>
                      {personSummary.email && <p className="truncate text-xs text-text-muted">{personSummary.email}</p>}
                      <div className="mt-2 flex items-center gap-2">
                        <ScoreDistribution
                          perfect={personSummary.perfect}
                          passed={personSummary.passed}
                          failed={personSummary.failed}
                          className="max-w-[220px]"
                          height={6}
                        />
                        <span className="shrink-0 text-[11px] text-text-muted">
                          {t('admin.trainer_panel.sub_activities', { count: personSummary.total })}
                        </span>
                      </div>
                    </div>
                    <ScoreRing score={personSummary.avg} size={72} stroke={6} />
                  </div>

                  {/* Las 4 cifras que responden "¿cuánto lleva?" de un vistazo */}
                  <div className="relative mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <MiniStat
                      icon={<BookOpen className="h-3.5 w-3.5" />}
                      label={t('admin.trainer_panel.lvl_courses')}
                      value={personSummary.coursesCount}
                      accent="rgb(var(--brand-green))"
                    />
                    <MiniStat
                      icon={<Layers className="h-3.5 w-3.5" />}
                      label={t('admin.trainer_panel.lvl_modules')}
                      value={personSummary.modulesCount}
                      accent="rgb(var(--brand-magenta))"
                      note={t('admin.trainer_panel.n_completed', '{{count}} completados', { count: personSummary.modulesDone })}
                    />
                    <MiniStat
                      icon={<ClipboardCheck className="h-3.5 w-3.5" />}
                      label={t('admin.trainer_panel.lvl_activities')}
                      value={personSummary.total}
                      accent="#f59e0b"
                      note={t('admin.trainer_panel.n_pending_short', '{{count}} por evaluar', { count: personSummary.pending })}
                    />
                    <MiniStat
                      icon={<Clock className="h-3.5 w-3.5" />}
                      label={t('admin.trainer_panel.module_time_label')}
                      text={personSummary.totalTimeMs > 0 ? formatElapsed(personSummary.totalTimeMs) : '—'}
                      accent="#3b82f6"
                    />
                  </div>
                </motion.div>

                {/* Avance curso por curso, con sus módulos dentro */}
                <div className="space-y-3">
                  {personSummary.courses.map((c, ci) => (
                    <motion.div
                      key={c.key}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.06 + ci * 0.06, ease: [0.16, 1, 0.3, 1] }}
                      className="rounded-2xl border border-line bg-white dark:bg-[#0d0e12] p-5 shadow-sm"
                    >
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[rgb(var(--brand-green))]/10 text-[rgb(var(--brand-green))]">
                          <BookOpen className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-[15px] font-bold text-text">{c.title}</h3>
                          <p className="mt-0.5 text-[11.5px] text-text-muted">
                            {t('admin.trainer_panel.sub_modules', { count: c.modules.length })}
                            {' · '}
                            {t('admin.trainer_panel.sub_activities', { count: c.total })}
                            {c.timeMs > 0 && ` · ${formatElapsed(c.timeMs)}`}
                          </p>
                        </div>
                        <ScoreRing score={c.avg} size={44} stroke={4} />
                      </div>

                      <div className="mt-4 space-y-3">
                        {c.modules.map((m, i) => (
                          <div key={m.key}>
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="flex min-w-0 items-center gap-1.5">
                                {m.completed && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />}
                                <span className="truncate text-[12.5px] font-medium text-text">{m.title}</span>
                              </span>
                              <span className={cn('shrink-0 text-[12px] font-bold tabular-nums', scoreTextTone(m.avg))}>{m.avg}%</span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <ProgressBar
                                pct={(m.done / m.total) * 100}
                                accent={m.done === m.total ? '#22c55e' : '#f59e0b'}
                                height={4}
                                delay={0.06 + ci * 0.06 + i * 0.04}
                              />
                              <span className="shrink-0 text-[10px] tabular-nums text-text-muted/80">
                                {m.done}/{m.total}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  ))}
                </div>

                <p className="text-center text-xs text-text-muted/60">{t('admin.trainer_panel.select_side')}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-muted space-y-3 select-none px-6 text-center">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 240, damping: 20 }}
                className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-900/60 border border-line flex items-center justify-center"
              >
                <ClipboardCheck className="w-7 h-7 text-text-muted/50" />
              </motion.div>
              <p className="text-sm font-medium text-text">{t('admin.trainer_panel.select_side')}</p>
              <p className="text-xs text-text-muted/60 max-w-xs">{t('admin.trainer_panel.review_before')}</p>
              <p className="inline-flex items-center gap-1.5 text-[11px] text-text-muted/60">
                <Search className="h-3 w-3" />
                {t('admin.trainer_panel.hint_people_search', 'Escribe un nombre en el buscador para saltar directo a una persona')}
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

/* ---------- Subcomponentes de presentación ---------- */

/** Estado vacío de la lista: "todo al día" si no hay entregas, o "sin resultados". */
const EmptyState: React.FC<{ attemptsEmpty: boolean; t: (k: string) => string }> = ({ attemptsEmpty, t }) =>
  attemptsEmpty ? (
    <div className="flex flex-col items-center justify-center py-16 text-text-muted space-y-3 text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
        <Sparkles className="w-6 h-6 text-green-500" />
      </div>
      <p className="text-sm font-semibold text-text">{t('admin.trainer_panel.all_caught_up')}</p>
      <p className="text-xs text-text-muted/70">{t('admin.trainer_panel.all_caught_up_desc')}</p>
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center py-12 text-text-muted space-y-2">
      <p className="text-sm text-center">{t('admin.trainer_panel.no_submissions')}</p>
      <p className="text-xs text-text-muted/60">{t('admin.trainer_panel.try_other_search')}</p>
    </div>
  );

/** Dato compacto de la ficha de persona: ícono + cifra grande + nota opcional.
 *  Acepta `value` (número, cuenta al aparecer) o `text` (ya formateado). */
const MiniStat: React.FC<{
  icon: React.ReactNode;
  label: string;
  value?: number;
  text?: string;
  suffix?: string;
  note?: string;
  accent: string;
}> = ({ icon, label, value, text, suffix, note, accent }) => (
  <div className="rounded-xl border border-line bg-zinc-50 dark:bg-zinc-900/50 px-3 py-2.5">
    <p className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-text-muted">
      <span style={{ color: accent }}>{icon}</span>
      <span className="truncate">{label}</span>
    </p>
    <p className="mt-1 text-[20px] font-bold leading-none tabular-nums text-text">
      {text ?? <CountUp value={value ?? 0} suffix={suffix} />}
    </p>
    {note && <p className="mt-1 truncate text-[10px] text-text-muted/80">{note}</p>}
  </div>
);

interface DropdownProps {
  innerRef?: React.RefObject<HTMLDivElement>;
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}

const Dropdown: React.FC<DropdownProps> = ({ innerRef, open, onToggle, icon, label, options, selected, onSelect }) => (
  <div className="relative flex-1 min-w-0" ref={innerRef}>
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full bg-zinc-50 dark:bg-zinc-900/50 border rounded-xl pl-9 pr-3 py-2 text-xs text-text text-left flex items-center justify-between transition-all outline-none',
        open ? 'border-green-500/50 shadow-md shadow-green-500/5' : 'border-line'
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      <ChevronDown className={cn('h-3 w-3 text-text-muted/60 transition-transform duration-200 shrink-0', open && 'rotate-180')} />
    </button>
    {open && (
      <div className="absolute z-30 w-full mt-1.5 bg-white dark:bg-[#14151b] border border-line rounded-xl shadow-xl overflow-hidden py-1 max-h-60 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-top-1 duration-150">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            className={cn(
              'w-full text-left px-4 py-2 text-xs transition-colors duration-150',
              selected === option.value
                ? 'bg-green-500/10 text-green-500 font-semibold'
                : 'text-text-muted hover:text-text hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    )}
  </div>
);
