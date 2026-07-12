import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getPendingAttempts, saveTrainerFeedback, FeedbackPayload } from '@/services/activity.service';
import { getModuleTimesForUsers, type ModuleTimeRow } from '@/services/moduleTime.service';
import { formatElapsed } from '@/hooks/useModuleTimer';
import { useAuth } from '@/hooks/useAuth';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { toast } from '@/stores/toastStore';
import {
  Code, LayoutTemplate, CheckCircle2, XCircle, Info, MessageSquare, Search,
  SlidersHorizontal, ChevronDown, ArrowDownUp, Clock, Send, Sparkles,
  ClipboardCheck, Award, ChevronRight, GraduationCap, Gamepad2, Video, HelpCircle,
  ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/cn';

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
  module_id?: string | null;
  game_type: string;
  score: number;
  submitted_answers: SubmittedAnswers | null;
  started_at: string;
  student?: { id: string; name: string; email: string | null; } | null;
  campaign?: { title_es: string; } | null;
  module?: { title_es: string; } | null;
  section?: { heading_es: string; } | null;
}

type SortKey = 'recent' | 'score_desc' | 'score_asc' | 'name';

/** Clases de color de texto según la nota (verde / ámbar / rojo). */
const scoreTextTone = (score: number) => {
  if (score >= 90) return 'text-green-600 dark:text-green-400';
  if (score >= 70) return 'text-amber-500 dark:text-amber-400';
  return 'text-red-500 dark:text-red-400';
};

/** Color base (hex) usado para anillos y acentos. */
const scoreHex = (score: number) => {
  if (score >= 90) return '#22c55e';
  if (score >= 70) return '#f59e0b';
  return '#ef4444';
};

const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

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
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [isScoreOpen, setIsScoreOpen] = useState<boolean>(false);
  const [isSortOpen, setIsSortOpen] = useState<boolean>(false);
  const scoreRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

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

  const feedbackTemplates = [
    t('admin.trainer_panel.tpl_excellent'),
    t('admin.trainer_panel.tpl_review_errors'),
    t('admin.trainer_panel.tpl_keep_going'),
    t('admin.trainer_panel.tpl_needs_improvement'),
  ];

  useEffect(() => {
    const loadAttempts = async () => {
      setLoading(true);
      const { data, error: fetchError } = await getPendingAttempts({ excludeSuperadmins: !isSuperAdmin });
      if (fetchError) setError(t('admin.trainer_panel.load_err_title'));
      else if (data) {
        const rows = data as PendingAttempt[];
        setAttempts(rows);
        // Cargamos el tiempo activo de todos los aprendices con entregas en una
        // sola consulta y lo cruzamos por user_id+module_id al pintar cada intento.
        const userIds = rows.map((r) => r.user_id).filter(Boolean);
        getModuleTimesForUsers(userIds).then(setModuleTimes);
      }
      setLoading(false);
    };
    loadAttempts();
  }, [isSuperAdmin, t]);

  useEffect(() => {
    setComment('');
    setViewMode('graphic');
  }, [selectedAttempt]);

  // Cerrar los menús desplegables al hacer clic fuera de ellos
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (scoreRef.current && !scoreRef.current.contains(event.target as Node)) setIsScoreOpen(false);
      if (sortRef.current && !sortRef.current.contains(event.target as Node)) setIsSortOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatGameType = (type: string) => {
    switch (type) {
      case 'CLASSIFY_CASES': return t('admin.trainer_panel.type_classify');
      case 'SORT_PROCESS': return t('admin.trainer_panel.type_sort');
      case 'KNOWLEDGE_CHECK': return t('admin.trainer_panel.type_knowledge');
      case 'VIDEO_QUIZ': return t('admin.trainer_panel.type_video');
      default: return type.toUpperCase();
    }
  };

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
      // Auto-avance: seleccionamos la siguiente entrega pendiente para no perder el flujo.
      const remaining = visibleAttempts.filter((item) => item.id !== selectedAttempt.id);
      const currentIdx = visibleAttempts.findIndex((item) => item.id === selectedAttempt.id);
      const next = remaining[currentIdx] ?? remaining[currentIdx - 1] ?? null;

      setAttempts((prev) => prev.filter((item) => item.id !== selectedAttempt.id));
      setSelectedAttempt(next);
      setComment('');
      toast.success(t('admin.trainer_panel.saved_ok_title'), t('admin.trainer_panel.saved_ok_desc'));
    }
    setSubmitting(false);
  };

  // Filtrado + orden dinámico
  const visibleAttempts = useMemo(() => {
    const search = searchTerm.toLowerCase();
    const filtered = attempts.filter((attempt) => {
      const studentName = (attempt.student?.name || t('admin.trainer_panel.student_fallback')).toLowerCase();
      const gameLabel = formatGameType(attempt.game_type).toLowerCase();
      const matchesSearch = studentName.includes(search) || gameLabel.includes(search);

      let matchesScore = true;
      if (scoreFilter === 'perfect') matchesScore = attempt.score === 100;
      else if (scoreFilter === 'passed') matchesScore = attempt.score >= 70 && attempt.score < 100;
      else if (scoreFilter === 'failed') matchesScore = attempt.score < 70;

      return matchesSearch && matchesScore;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'score_desc': return b.score - a.score;
        case 'score_asc': return a.score - b.score;
        case 'name':
          return (a.student?.name || '').localeCompare(b.student?.name || '');
        case 'recent':
        default:
          return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
      }
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts, searchTerm, scoreFilter, sortKey, i18n.language]);

  // Estadísticas globales (sobre TODAS las pendientes, no las filtradas)
  const stats = useMemo(() => {
    const total = attempts.length;
    const avg = total === 0 ? 0 : Math.round(attempts.reduce((s, a) => s + a.score, 0) / total);
    const perfect = attempts.filter((a) => a.score === 100).length;
    const passed = attempts.filter((a) => a.score >= 70 && a.score < 100).length;
    const failed = attempts.filter((a) => a.score < 70).length;
    return { total, avg, perfect, passed, failed };
  }, [attempts]);

  const selectedScoreLabel = scoreOptions.find((opt) => opt.value === scoreFilter)?.label || '';
  const selectedSortLabel = sortOptions.find((opt) => opt.value === sortKey)?.label || '';

  // Vista analítica (dona + tarjetas detalladas)
  const renderAnalyticsView = (answers: any, generalScore: number) => {
    const aciertos = Number(answers.aciertos || answers.correctas || 0);
    const errores = Number(answers.errores || answers.incorrectas || 0);

    // Datos tipo quiz (pregunta / opción elegida / correcta)
    const pregunta = answers.pregunta ? String(answers.pregunta) : null;
    const elegida = answers.opcion_elegida != null ? String(answers.opcion_elegida) : null;
    const correcta = answers.opcion_correcta != null ? String(answers.opcion_correcta) : null;
    const isQuizAnswer = elegida != null || correcta != null;
    const acerto = elegida != null && correcta != null ? elegida === correcta : generalScore >= 70;

    const reservedKeys = [
      'total', 'aciertos', 'errores', 'total_preguntas', 'correctas', 'incorrectas', 'total_cases',
      'pregunta', 'opcion_elegida', 'opcion_correcta', 'mensaje_detalle',
    ];
    const infoKeys = Object.entries(answers).filter(([key]) => !reservedKeys.includes(key));

    return (
      <div className="space-y-6">
      {/* Lectura legible de la pregunta y la respuesta (quizzes) */}
      {isQuizAnswer && (
        <div className="border border-line rounded-2xl overflow-hidden">
          {pregunta && (
            <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-950/40 border-b border-line">
              <p className="text-[9px] font-bold uppercase tracking-wider text-text-muted mb-1">{t('admin.trainer_panel.q_question')}</p>
              <p className="text-sm font-medium text-text">{pregunta}</p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line">
            <div className={cn('px-4 py-3', acerto ? 'bg-green-50/40 dark:bg-green-950/10' : 'bg-red-50/40 dark:bg-red-950/10')}>
              <p className="text-[9px] font-bold uppercase tracking-wider text-text-muted mb-1.5">{t('admin.trainer_panel.q_your_answer')}</p>
              <div className={cn('flex items-center gap-2 text-sm font-semibold', acerto ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400')}>
                {acerto ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                <span>{elegida ?? '—'}</span>
              </div>
            </div>
            <div className="px-4 py-3">
              <p className="text-[9px] font-bold uppercase tracking-wider text-text-muted mb-1.5">{t('admin.trainer_panel.q_correct_answer')}</p>
              <div className="flex items-center gap-2 text-sm font-semibold text-green-600 dark:text-green-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{correcta ?? '—'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Dona de aciertos / errores */}
        <div className="bg-zinc-50/60 dark:bg-zinc-950/40 border border-line rounded-2xl p-5 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-4">{t('admin.trainer_panel.answer_ratio')}</span>
          <div
            className="relative w-28 h-28 rounded-full flex items-center justify-center border border-line shadow-inner"
            style={{ background: `conic-gradient(#22c55e 0% ${generalScore}%, #ef4444 ${generalScore}% 100%)` }}
          >
            <div className="absolute w-24 h-24 bg-white dark:bg-[#0d0e12] rounded-full flex flex-col items-center justify-center shadow-md">
              <span className={cn('text-xl font-mono font-bold', scoreTextTone(generalScore))}>{generalScore}%</span>
              <span className="text-[9px] text-text-muted uppercase font-semibold">{t('admin.trainer_panel.effectiveness')}</span>
            </div>
          </div>
          <div className="flex gap-4 mt-4 w-full justify-center">
            {aciertos > 0 || errores > 0 ? (
              <>
                <div className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                  <span className="text-text-muted font-medium">{t('admin.trainer_panel.hits')} ({aciertos})</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span className="text-text-muted font-medium">{t('admin.trainer_panel.misses')} ({errores})</span>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-text-muted italic">
                {t('admin.trainer_panel.score_based')}
              </div>
            )}
          </div>
        </div>

        {/* Tarjetas de variables */}
        <div className="md:col-span-2 space-y-3 flex flex-col justify-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted block">{t('admin.trainer_panel.submission_details')}</span>
          {infoKeys.length === 0 ? (
            <p className="text-xs text-text-muted italic">{t('admin.trainer_panel.no_extra_vars')}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {infoKeys.map(([key, value]) => {
                const keyStr = String(key).toLowerCase();
                const isCorrectOption = keyStr.includes('correcta');
                const isChosenOption = keyStr.includes('elegida') || keyStr.includes('enviada');
                const displayValue = value !== null && value !== undefined ? String(value) : 'Nulo';

                let VariableIcon = Info;
                if (keyStr.includes('mensaje')) VariableIcon = MessageSquare;
                else if (keyStr.includes('proceso') || keyStr.includes('finalizado')) VariableIcon = CheckCircle2;
                else if (isCorrectOption) VariableIcon = CheckCircle2;

                let dynamicClasses = 'bg-zinc-50 dark:bg-[#14151b] border-line text-text';
                if (isCorrectOption) dynamicClasses = 'bg-green-50/30 dark:bg-green-950/10 border-green-500/20 text-green-600 dark:text-green-400';
                else if (isChosenOption) dynamicClasses = 'bg-blue-50/30 dark:bg-blue-950/10 border-blue-500/20 text-blue-600 dark:text-blue-400';

                return (
                  <div key={key} className={cn('p-3 rounded-xl border flex flex-col justify-between transition-all', dynamicClasses)}>
                    <span className="text-[9px] font-bold uppercase tracking-wider opacity-70 block mb-1">{key.replace(/_/g, ' ')}</span>
                    <div className="flex items-center gap-2">
                      <VariableIcon className="w-4 h-4 shrink-0 opacity-80" />
                      <span className="text-xs font-semibold truncate" title={displayValue}>{displayValue}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </div>
    );
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-bg text-text font-medium text-sm">{t('admin.trainer_panel.loading')}</div>;
  if (error) return <div className="flex h-screen items-center justify-center bg-bg text-red-500 font-medium text-sm">{error}</div>;

  const remaining = comment.trim().length;
  const canSubmit = remaining >= MIN_FEEDBACK_CHARS && !submitting;

  return (
    <div className="flex flex-col h-screen bg-bg text-text overflow-hidden font-sans">

      {/* ===== Barra superior con resumen global ===== */}
      <header className="shrink-0 border-b border-line bg-white/60 dark:bg-zinc-900/30 backdrop-blur px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
            <ClipboardCheck className="w-5 h-5 text-green-500" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight truncate">{t('admin.trainer_panel.pending_evals')}</h1>
            <p className="text-xs text-text-muted truncate">{t('admin.trainer_panel.select_prompt')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <StatChip icon={<ClipboardCheck className="w-3.5 h-3.5" />} label={t('admin.trainer_panel.stat_pending')} value={String(stats.total)} />
          <StatChip icon={<Award className="w-3.5 h-3.5" />} label={t('admin.trainer_panel.stat_average')} value={`${stats.avg}%`} valueClass={scoreTextTone(stats.avg)} />
          <div className="hidden lg:flex items-center gap-1.5 pl-2 ml-1 border-l border-line">
            <Dot color="#22c55e" n={stats.perfect + stats.passed} title={t('admin.trainer_panel.filter_passed')} />
            <Dot color="#ef4444" n={stats.failed} title={t('admin.trainer_panel.filter_failed')} />
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* ===== Columna Izquierda: bandeja de entregas ===== */}
        <aside className={cn(
          'w-full md:w-[360px] xl:w-[400px] md:shrink-0 border-r border-line flex-col h-full bg-bg',
          selectedAttempt ? 'hidden md:flex' : 'flex',
        )}>
          <div className="p-4 border-b border-line shrink-0 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted/60" />
              <input
                type="text"
                placeholder={t('admin.trainer_panel.ph_search')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-zinc-900/50 border border-line rounded-xl pl-9 pr-4 py-2 text-xs text-text placeholder:text-text-muted/50 outline-none focus:border-green-500/40 transition-colors"
              />
            </div>

            <div className="flex gap-2">
              {/* Filtro por nota */}
              <Dropdown
                innerRef={scoreRef}
                open={isScoreOpen}
                onToggle={() => { setIsScoreOpen(!isScoreOpen); setIsSortOpen(false); }}
                icon={<SlidersHorizontal className="h-3.5 w-3.5 text-text-muted/60 absolute left-3" />}
                label={selectedScoreLabel}
                options={scoreOptions}
                selected={scoreFilter}
                onSelect={(v) => { setScoreFilter(v); setIsScoreOpen(false); }}
              />
              {/* Orden */}
              <Dropdown
                innerRef={sortRef}
                open={isSortOpen}
                onToggle={() => { setIsSortOpen(!isSortOpen); setIsScoreOpen(false); }}
                icon={<ArrowDownUp className="h-3.5 w-3.5 text-text-muted/60 absolute left-3" />}
                label={selectedSortLabel}
                options={sortOptions}
                selected={sortKey}
                onSelect={(v) => { setSortKey(v as SortKey); setIsSortOpen(false); }}
              />
            </div>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
            {visibleAttempts.length === 0 ? (
              attempts.length === 0 ? (
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
              )
            ) : (
              visibleAttempts.map((attempt) => {
                const isActive = selectedAttempt?.id === attempt.id;
                const studentName = attempt.student?.name || t('admin.trainer_panel.student_fallback');
                const meta = activityMeta(attempt.game_type);
                return (
                  <button
                    key={attempt.id}
                    onClick={() => setSelectedAttempt(attempt)}
                    className={cn(
                      'group w-full text-left p-3 rounded-2xl cursor-pointer border transition-all duration-200 select-none flex items-center gap-3 relative overflow-hidden',
                      isActive
                        ? 'bg-white dark:bg-zinc-900 border-green-500 shadow-lg shadow-green-500/5'
                        : 'bg-zinc-50/60 dark:bg-zinc-900/40 border-line hover:border-zinc-300 dark:hover:border-zinc-700'
                    )}
                  >
                    {/* Acento lateral según prioridad */}
                    <span className="absolute left-0 top-0 bottom-0 w-1 rounded-r" style={{ background: scoreHex(attempt.score), opacity: isActive ? 1 : 0.35 }} />

                    {/* Avatar */}
                    <div
                      className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-[13px] font-bold border ml-1"
                      style={{ background: `${scoreHex(attempt.score)}1a`, color: scoreHex(attempt.score), borderColor: `${scoreHex(attempt.score)}33` }}
                    >
                      {initials(studentName)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-text truncate">{studentName}</span>
                        <span className={cn('text-xs font-mono font-bold shrink-0', scoreTextTone(attempt.score))}>{attempt.score}%</span>
                      </div>
                      <p className="text-[11px] text-text-muted truncate mt-0.5">{formatGameType(attempt.game_type)}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800/70 border border-line text-[9px] font-bold uppercase tracking-wide text-text-muted">
                          <meta.Icon className="w-3 h-3" />
                          {meta.label}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-text-muted/70">
                          <Clock className="w-3 h-3" />
                          {relativeTime(attempt.started_at)}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className={cn('w-4 h-4 shrink-0 transition-colors', isActive ? 'text-green-500' : 'text-text-muted/30 group-hover:text-text-muted/60')} />
                  </button>
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
              <div className="p-4 sm:p-8 space-y-6 max-w-4xl w-full mx-auto">

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
                        </div>
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
                        {viewMode === 'graphic' && renderAnalyticsView(selectedAttempt.submitted_answers, selectedAttempt.score)}
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

              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-muted space-y-3 select-none px-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-900/60 border border-line flex items-center justify-center">
                <ClipboardCheck className="w-7 h-7 text-text-muted/50" />
              </div>
              <p className="text-sm font-medium text-text">{t('admin.trainer_panel.select_side')}</p>
              <p className="text-xs text-text-muted/60 max-w-xs">{t('admin.trainer_panel.review_before')}</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

/* ---------- Subcomponentes de presentación ---------- */

const StatChip: React.FC<{ icon: React.ReactNode; label: string; value: string; valueClass?: string }> = ({ icon, label, value, valueClass }) => (
  <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-900/60 border border-line rounded-xl px-3 py-1.5">
    <span className="text-text-muted/70">{icon}</span>
    <div className="leading-none">
      <p className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{label}</p>
      <p className={cn('text-sm font-bold font-mono mt-0.5', valueClass || 'text-text')}>{value}</p>
    </div>
  </div>
);

const Dot: React.FC<{ color: string; n: number; title: string }> = ({ color, n, title }) => (
  <span className="flex items-center gap-1 text-[11px] text-text-muted font-semibold" title={title}>
    <span className="w-2 h-2 rounded-full" style={{ background: color }} />
    {n}
  </span>
);

interface DropdownProps {
  innerRef: React.RefObject<HTMLDivElement>;
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
