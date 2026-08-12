import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Award,
  BookOpen,
  Check,
  ClipboardCheck,
  Clock,
  FileCheck2,
  Hourglass,
  ListChecks,
  Loader2,
  Lock,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
} from 'lucide-react';
import { FadeIn } from '@/components/ui/motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useUserStore } from '@/stores/userStore';
import { useLearnerCourses } from '@/hooks/useLearnerCourses';
import { useModuleDone, keyOfCourseModule } from '@/stores/progressStore';
import {
  ExamBlockedError,
  getExamState,
  markReinforcementModule,
  pickExamText,
  startExamAttempt,
} from '@/services/exams.service';
import type { ExamState } from '@/types/exam';
import { toast } from '@/stores/toastStore';
import { Tooltip } from '@/components/ui/Tooltip';
import { useBackdropDismiss } from '@/hooks/useBackdropDismiss';
import { cn } from '@/lib/cn';

const ease = [0.16, 1, 0.3, 1] as const;

/* ────────────────────────────────────────────────────────────────────────────
   Antesala del examen final.

   Es la pantalla que hace que esto se sienta una certificación y no un
   formulario: reglas por delante, dominios evaluados con su peso, historial de
   intentos y — cuando toca — la ruta de refuerzo que hay que completar antes
   de volver a presentarlo.
   ──────────────────────────────────────────────────────────────────────────── */

/** Cuenta atrás legible para la espera entre intentos ("en 3 h 20 min"). */
function useCountdown(target: string | null): string | null {
  const { t } = useTranslation();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!target) return;
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [target]);

  if (!target) return null;
  const ms = Date.parse(target) - Date.now();
  if (ms <= 0) return null;
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return t('exam.wait_minutes', { n: mins, defaultValue: '{{n}} min' });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0
    ? t('exam.wait_hours_minutes', { h, m, defaultValue: '{{h}} h {{m}} min' })
    : t('exam.wait_hours', { h, defaultValue: '{{h}} h' });
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tooltip,
  index,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  hint?: string;
  /** Qué significa el dato de verdad. Un número suelto no tranquiliza a nadie. */
  tooltip: string;
  index: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? undefined : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: reduce ? 0 : 0.1 + index * 0.06 }}
    >
      <Tooltip label={tooltip} maxWidth={240} anchor="element" describedBy>
        <div className="h-full cursor-help rounded-2xl border border-line px-4 py-3.5 transition-colors duration-300 hover:border-text-subtle/40">
          <Icon className="mb-2 h-4 w-4 text-text-subtle" />
          <div className="text-[19px] font-semibold leading-none tabular-nums text-text">
            {value}
          </div>
          <div className="mt-1.5 text-[11.5px] text-text-muted">{label}</div>
          {hint && <div className="mt-0.5 text-[11px] text-text-subtle">{hint}</div>}
        </div>
      </Tooltip>
    </motion.div>
  );
}

export default function ExamLanding() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const language = useUserStore((s) => s.language);
  const reduce = useReducedMotion();
  const isModuleDone = useModuleDone();

  const { courses, loading: coursesLoading } = useLearnerCourses();
  const course = useMemo(() => courses.find((c) => c.id === courseId), [courses, courseId]);

  const [state, setState] = useState<ExamState | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const backdrop = useBackdropDismiss(() => setConfirmOpen(false), !starting);

  const load = useCallback(() => {
    if (!courseId) return;
    setLoading(true);
    getExamState(courseId)
      .then(setState)
      .catch(() => setState(null))
      .finally(() => setLoading(false));
  }, [courseId]);

  useEffect(load, [load]);

  const waitLabel = useCountdown(state?.next_attempt_at ?? null);

  const accent = course?.color ?? '#6366F1';
  const title = state
    ? pickExamText(state.title_es, state.title_en, state.title_pt, language)
    : '';
  const description = state
    ? pickExamText(state.description_es, state.description_en, state.description_pt, language)
    : '';

  /* Motivo por el que el examen NO se puede presentar ahora. Uno solo, el más
     importante: apilar tres avisos deja al aprendiz sin saber qué hacer. */
  const block = useMemo(() => {
    if (!state) return null;
    if (state.passed) return 'passed' as const;
    if (!state.unlocked) return 'locked' as const;
    if (state.reinforcement && state.require_reinforcement) return 'reinforcement' as const;
    if (state.attempts_left !== null && state.attempts_left <= 0) return 'no_attempts' as const;
    if (waitLabel) return 'cooldown' as const;
    if (state.bank_size === 0) return 'empty' as const;
    return null;
  }, [state, waitLabel]);

  const handleStart = async () => {
    if (!courseId) return;
    setStarting(true);
    try {
      const session = await startExamAttempt(courseId);
      navigate(`/exam/${courseId}/run`, { state: { session } });
    } catch (err) {
      const reason = err instanceof ExamBlockedError ? err.reason : 'error';
      toast.error(
        t(`exam.error_${reason}`, {
          defaultValue: t('exam.error_generic', 'No se pudo abrir el examen.'),
        }),
      );
      setConfirmOpen(false);
      load();
    } finally {
      setStarting(false);
    }
  };

  // Módulos de la ruta de refuerzo, resueltos contra el curso.
  const reinforcementModules = useMemo(() => {
    if (!state?.reinforcement || !course) return [];
    const done = new Set(state.reinforcement.done_ids);
    return state.reinforcement.module_ids.flatMap((id) => {
      const m = course.modules.find((mm) => mm.id === id);
      if (!m) return [];
      return [{
        module: m,
        done: done.has(id),
        // Repasado de verdad: además de marcarlo, el módulo tiene que estar
        // completado en el progreso. Marcar sin abrir no cuenta.
        studied: isModuleDone(keyOfCourseModule(m)),
      }];
    });
  }, [state, course, isModuleDone]);

  const handleMarkReviewed = async (moduleId: string) => {
    if (!state?.reinforcement) return;
    setMarkingId(moduleId);
    try {
      const res = await markReinforcementModule(state.reinforcement.id, moduleId);
      if (res.status === 'completed') {
        toast.success(t('exam.reinforcement_done', '¡Refuerzo completado! Ya puedes reintentar.'));
      }
      load();
    } catch {
      toast.error(t('exam.error_generic', 'No se pudo guardar.'));
    } finally {
      setMarkingId(null);
    }
  };

  /* ── Cargando ── */
  if (loading || coursesLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-24 pt-12 sm:px-8 sm:pt-16">
        <div className="space-y-6">
          <div className="h-9 w-40 rounded-xl bg-subtle skeleton-shine" />
          <div className="h-32 rounded-3xl bg-subtle skeleton-shine" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-24 rounded-2xl bg-subtle skeleton-shine"
                style={{ animationDelay: `${i * 90}ms` }}
              />
            ))}
          </div>
          <div className="h-40 rounded-2xl bg-subtle skeleton-shine" />
        </div>
      </div>
    );
  }

  /* ── Sin examen ── */
  if (!state) {
    return (
      <div className="mx-auto max-w-3xl px-5 pb-24 pt-24 text-center">
        <ClipboardCheck className="mx-auto mb-4 h-8 w-8 text-text-subtle" />
        <h1 className="mb-1 text-[17px] font-medium text-text">
          {t('exam.none_title', 'Este curso no tiene examen final')}
        </h1>
        <p className="mb-6 text-[13.5px] text-text-muted">
          {t('exam.none_subtitle', 'Cuando el capacitador lo publique, aparecerá aquí.')}
        </p>
        <Link
          to={course ? `/courses/${course.slug}` : '/courses'}
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[13px] text-text-muted transition-colors duration-300 hover:border-text-subtle hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('courses.back_to_courses')}
        </Link>
      </div>
    );
  }

  const totalDomainQuestions = state.domains.reduce((s, d) => s + d.question_count, 0);

  return (
    <>
      <div className="mx-auto max-w-3xl px-4 pb-28 pt-10 sm:px-8 sm:pt-14">
        <FadeIn>
          <Link
            to={course ? `/courses/${course.slug}` : '/courses'}
            className="group mb-7 inline-flex items-center gap-1.5 text-[13px] text-text-subtle transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-500 ease-apple group-hover:-translate-x-1" />
            {course
              ? pickExamText(course.title_es, course.title_en, course.title_pt, language)
              : t('courses.back_to_courses')}
          </Link>
        </FadeIn>

        {/* ── Encabezado: emblema, título y descripción ── */}
        <FadeIn delay={0.05} className="mb-10">
          <div className="mb-5 flex items-center gap-3.5">
            <motion.div
              initial={reduce ? undefined : { scale: 0.85, opacity: 0, rotate: -8 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 18 }}
              className="grid h-14 w-14 place-items-center rounded-2xl text-white shadow-sm"
              style={{
                background: `linear-gradient(135deg, ${accent}, ${accent}b0)`,
                boxShadow: `0 8px 26px -12px ${accent}`,
              }}
            >
              <ShieldCheck className="h-6 w-6" />
            </motion.div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-subtle">
                {t('exam.tag', 'Examen de certificación')}
              </p>
              {state.passed && (
                <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                  <Check className="h-3 w-3" strokeWidth={3} />
                  {t('exam.status_passed', 'Aprobado')}
                </span>
              )}
            </div>
          </div>

          <h1 className="text-[30px] font-semibold leading-[1.12] tracking-[-0.03em] text-text sm:text-[38px]">
            {title}
          </h1>
          {description && (
            <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-text-muted">
              {description}
            </p>
          )}
        </FadeIn>

        {/* ── Las reglas, por delante ── */}
        <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            index={0}
            icon={ListChecks}
            label={t('exam.stat_questions', 'Preguntas')}
            value={String(state.question_count)}
            hint={
              state.bank_size > state.question_count
                ? t('exam.stat_from_bank', {
                    n: state.bank_size,
                    defaultValue: 'de un banco de {{n}}',
                  })
                : undefined
            }
            tooltip={
              state.bank_size > state.question_count
                ? t('exam.tip_questions_bank', {
                    n: state.question_count,
                    bank: state.bank_size,
                    defaultValue:
                      'Se sortean {{n}} preguntas de un banco de {{bank}}: cada intento es distinto, así que memorizar no sirve.',
                  })
                : t('exam.tip_questions', {
                    n: state.question_count,
                    defaultValue: 'El examen tiene {{n}} preguntas.',
                  })
            }
          />
          <StatCard
            index={1}
            icon={Clock}
            label={t('exam.stat_time', 'Tiempo')}
            value={
              state.time_limit_min > 0
                ? `${state.time_limit_min} min`
                : t('exam.no_limit', 'Libre')
            }
            tooltip={
              state.time_limit_min > 0
                ? t(
                    'exam.tip_time',
                    'El reloj arranca al empezar y corre en el servidor: sigue aunque cierres la pestaña. Al llegar a cero se envía solo con lo que hayas respondido.',
                  )
                : t(
                    'exam.tip_time_free',
                    'Sin límite de tiempo: puedes tomarte lo que necesites.',
                  )
            }
          />
          <StatCard
            index={2}
            icon={Target}
            label={t('exam.stat_pass', 'Para aprobar')}
            value={`${state.pass_score}%`}
            tooltip={t('exam.tip_pass', {
              score: state.pass_score,
              n: Math.ceil((state.pass_score / 100) * state.question_count),
              total: state.question_count,
              defaultValue:
                'Necesitas {{score}}%: unas {{n}} de {{total}} preguntas correctas. Las que dejes en blanco cuentan como incorrectas.',
            })}
          />
          <StatCard
            index={3}
            icon={RotateCcw}
            label={t('exam.stat_attempts', 'Intentos')}
            value={
              state.attempts_left === null
                ? t('exam.unlimited', 'Sin límite')
                : `${state.attempts_left}`
            }
            hint={
              state.attempts_left !== null
                ? t('exam.stat_attempts_used', {
                    used: state.attempts_used,
                    defaultValue: 'usaste {{used}}',
                  })
                : undefined
            }
            tooltip={
              state.attempts_left === null
                ? t('exam.tip_attempts_free', 'Puedes presentarlo las veces que necesites.')
                : state.cooldown_hours > 0
                  ? t('exam.tip_attempts', {
                      n: state.attempts_left,
                      h: state.cooldown_hours,
                      defaultValue:
                        'Te quedan {{n}} intentos, con {{h}} h de espera entre uno y otro. Si los agotas, solo tu capacitador puede darte otro.',
                    })
                  : t('exam.tip_attempts_no_wait', {
                      n: state.attempts_left,
                      defaultValue:
                        'Te quedan {{n}} intentos. Si los agotas, solo tu capacitador puede darte otro.',
                    })
            }
          />
        </div>

        {/* ── Dominios evaluados ── */}
        {state.domains.length > 0 && (
          <FadeIn className="mb-10">
            <div className="mb-5">
              <h2 className="text-[19px] font-semibold tracking-tight text-text">
                {t('exam.domains_title', 'Qué se evalúa')}
              </h2>
              <p className="mt-0.5 text-[13px] text-text-muted">
                {t(
                  'exam.domains_subtitle',
                  'El examen reparte las preguntas entre estos temas. Al terminar verás cómo te fue en cada uno.',
                )}
              </p>
            </div>

            <div className="space-y-3">
              {state.domains.map((d, i) => (
                <motion.div
                  key={d.id}
                  initial={reduce ? undefined : { opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.45, ease, delay: reduce ? 0 : i * 0.07 }}
                  className="flex items-center gap-4 rounded-2xl border border-line px-4 py-3.5"
                >
                  <span
                    className="h-9 w-1 shrink-0 rounded-full"
                    style={{ background: d.color }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-text">
                      {pickExamText(d.name_es, d.name_en, d.name_pt, language)}
                    </div>
                    {d.description_es && (
                      <p className="mt-0.5 line-clamp-1 text-[12.5px] text-text-muted">
                        {d.description_es}
                      </p>
                    )}
                  </div>
                  <Tooltip
                    label={t('exam.tip_domain_weight', {
                      pct: d.weight_pct,
                      n: Math.round((d.weight_pct / 100) * state.question_count),
                      defaultValue:
                        'Alrededor de {{n}} preguntas del examen ({{pct}}%) son de este tema.',
                    })}
                    maxWidth={230}
                    anchor="element"
                    describedBy
                  >
                    <div className="shrink-0 cursor-help text-right">
                      <div className="text-[15px] font-semibold tabular-nums text-text">
                        {d.weight_pct}%
                      </div>
                      <div className="text-[11px] text-text-subtle">
                        {t('exam.domain_weight', 'del examen')}
                      </div>
                    </div>
                  </Tooltip>
                </motion.div>
              ))}
            </div>

            {totalDomainQuestions > 0 && (
              <p className="mt-3 text-[12px] text-text-subtle">
                {t('exam.domains_bank_hint', {
                  n: totalDomainQuestions,
                  defaultValue:
                    'Las preguntas se sortean de un banco de {{n}}: cada intento es distinto.',
                })}
              </p>
            )}
          </FadeIn>
        )}

        {/* ── Ruta de refuerzo pendiente ── */}
        {state.reinforcement && reinforcementModules.length > 0 && (
          <FadeIn className="mb-10">
            <div
              className="rounded-3xl border p-6"
              style={{ borderColor: 'rgb(245 158 11 / 0.35)', background: 'rgb(245 158 11 / 0.05)' }}
            >
              <div className="mb-1.5 flex items-center gap-2.5">
                <BookOpen className="h-4 w-4 text-amber-500" />
                <h2 className="text-[17px] font-semibold tracking-tight text-text">
                  {t('exam.reinforcement_title', 'Tu ruta de refuerzo')}
                </h2>
              </div>
              <p className="mb-5 text-[13.5px] leading-relaxed text-text-muted">
                {t(
                  'exam.reinforcement_subtitle',
                  'No aprobaste todavía. Estos son los módulos de los temas que se te complicaron: repásalos y márcalos aquí. Cuando termines, se habilita tu siguiente intento.',
                )}
              </p>

              {/* Avance de la ruta */}
              <div className="mb-5">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-[12px] text-text-muted">
                    {t('exam.reinforcement_progress', 'Avance del refuerzo')}
                  </span>
                  <span className="text-[12px] tabular-nums text-text-muted">
                    {reinforcementModules.filter((m) => m.done).length}/
                    {reinforcementModules.length}
                  </span>
                </div>
                <div className="h-[6px] w-full overflow-hidden rounded-full bg-subtle">
                  <motion.div
                    className="h-full rounded-full bg-amber-500"
                    initial={{ width: 0 }}
                    animate={{
                      width: `${
                        (reinforcementModules.filter((m) => m.done).length /
                          reinforcementModules.length) *
                        100
                      }%`,
                    }}
                    transition={{ duration: reduce ? 0 : 0.9, ease }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                {reinforcementModules.map(({ module, done, studied }, i) => (
                  <motion.div
                    key={module.id}
                    initial={reduce ? undefined : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease, delay: reduce ? 0 : i * 0.05 }}
                    className={cn(
                      'flex items-center gap-3 rounded-2xl border bg-bg/60 px-4 py-3 transition-colors duration-300',
                      done ? 'border-primary/40' : 'border-line',
                    )}
                  >
                    <div
                      className={cn(
                        'grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-medium tabular-nums',
                        done ? 'bg-primary/12 text-primary' : 'bg-subtle text-text-subtle',
                      )}
                    >
                      {done ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-text">
                        {pickExamText(
                          module.title_es,
                          module.title_en,
                          module.title_pt,
                          language,
                        )}
                      </div>
                      <div className="text-[12px] text-text-muted">
                        {module.duration_min} min
                        {!studied && !done && (
                          <> · {t('exam.reinforcement_open_hint', 'ábrelo antes de marcarlo')}</>
                        )}
                      </div>
                    </div>

                    <Link
                      to={`/modules/${module.slug}`}
                      className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] font-medium text-text-muted transition-colors duration-300 hover:border-primary/50 hover:text-primary"
                    >
                      {t('exam.reinforcement_review', 'Repasar')}
                    </Link>

                    {!done && (
                      <Tooltip
                        label={
                          studied
                            ? t('exam.reinforcement_mark', 'Marcar como repasado')
                            : t(
                                'exam.reinforcement_locked_hint',
                                'Termina el módulo para poder marcarlo',
                              )
                        }
                      >
                        <button
                          onClick={() => handleMarkReviewed(module.id)}
                          disabled={!studied || markingId === module.id}
                          className={cn(
                            'grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors duration-300',
                            studied
                              ? 'bg-primary text-on-primary hover:opacity-90'
                              : 'cursor-not-allowed bg-subtle text-text-subtle',
                          )}
                        >
                          {markingId === module.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" strokeWidth={3} />
                          )}
                        </button>
                      </Tooltip>
                    )}
                  </motion.div>
                ))}
              </div>
            </div>
          </FadeIn>
        )}

        {/* ── Historial ── */}
        {state.attempts_used > 0 && (
          <FadeIn className="mb-10">
            <h2 className="mb-3 text-[19px] font-semibold tracking-tight text-text">
              {t('exam.history_title', 'Tus intentos')}
            </h2>
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-5 py-4">
              <div>
                <div className="text-[22px] font-semibold leading-none tabular-nums text-text">
                  {state.best_score}%
                </div>
                <div className="mt-1 text-[11.5px] text-text-muted">
                  {t('exam.history_best', 'Mejor puntaje')}
                </div>
              </div>
              <span className="mx-2 h-8 w-px bg-line" aria-hidden />
              <div>
                <div className="text-[22px] font-semibold leading-none tabular-nums text-text">
                  {state.attempts_used}
                </div>
                <div className="mt-1 text-[11.5px] text-text-muted">
                  {t('exam.history_attempts', 'Intentos hechos')}
                </div>
              </div>
              {state.last_attempt_id && (
                <Link
                  to={`/exam/${courseId}/result/${state.last_attempt_id}`}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12.5px] font-medium text-text-muted transition-colors duration-300 hover:border-primary/50 hover:text-primary"
                >
                  <FileCheck2 className="h-3.5 w-3.5" />
                  {t('exam.history_view_last', 'Ver último informe')}
                </Link>
              )}
            </div>
          </FadeIn>
        )}

        {/* ── Acción principal / motivo de bloqueo ── */}
        <FadeIn delay={0.1}>
          {block === 'passed' ? (
            <div className="flex flex-col gap-4 rounded-3xl border border-primary/30 bg-primary/[0.04] p-6 sm:flex-row sm:items-center">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
                <Award className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[16px] font-medium text-text">
                  {t('exam.passed_title', 'Ya aprobaste este examen')}
                </h3>
                <p className="text-[13px] text-text-muted">
                  {t('exam.passed_subtitle', {
                    score: state.best_score,
                    defaultValue: 'Tu puntaje fue {{score}}%. Ya puedes emitir tu certificado.',
                  })}
                </p>
              </div>
              <Link
                to={`/certificate/${courseId}`}
                className="shrink-0 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity duration-300 hover:opacity-90"
              >
                {t('course_cert.view', 'Ver certificado')}
              </Link>
            </div>
          ) : block ? (
            <div className="flex items-start gap-3.5 rounded-3xl border border-line p-6">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-subtle text-text-subtle">
                {block === 'cooldown' ? (
                  <Hourglass className="h-4 w-4" />
                ) : block === 'reinforcement' ? (
                  <BookOpen className="h-4 w-4" />
                ) : block === 'empty' ? (
                  <TriangleAlert className="h-4 w-4" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="mb-1 text-[15.5px] font-medium text-text">
                  {block === 'locked' && t('exam.blocked_locked_title', 'Aún no está disponible')}
                  {block === 'cooldown' &&
                    t('exam.blocked_cooldown_title', 'Tiempo de espera entre intentos')}
                  {block === 'reinforcement' &&
                    t('exam.blocked_reinforcement_title', 'Completa tu refuerzo primero')}
                  {block === 'no_attempts' &&
                    t('exam.blocked_attempts_title', 'Agotaste tus intentos')}
                  {block === 'empty' &&
                    t('exam.blocked_empty_title', 'El examen todavía no tiene preguntas')}
                </h3>
                <p className="text-[13.5px] leading-relaxed text-text-muted">
                  {block === 'locked' &&
                    t(
                      'exam.blocked_locked_body',
                      'Termina los módulos del curso y el examen se abre solo.',
                    )}
                  {block === 'cooldown' &&
                    t('exam.blocked_cooldown_body', {
                      wait: waitLabel,
                      defaultValue:
                        'Podrás presentarlo de nuevo en {{wait}}. Aprovecha para repasar.',
                    })}
                  {block === 'reinforcement' &&
                    t(
                      'exam.blocked_reinforcement_body',
                      'Repasa los módulos de tu ruta y márcalos arriba. Al terminarla se habilita el reintento.',
                    )}
                  {block === 'no_attempts' &&
                    t(
                      'exam.blocked_attempts_body',
                      'Habla con tu capacitador: solo él puede concederte un intento adicional.',
                    )}
                  {block === 'empty' &&
                    t(
                      'exam.blocked_empty_body',
                      'Tu capacitador todavía está armando el banco de preguntas.',
                    )}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-4 rounded-3xl border border-line p-6 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <h3 className="text-[16px] font-medium text-text">
                  {state.open_attempt_id
                    ? t('exam.resume_title', 'Tienes un examen abierto')
                    : t('exam.ready_title', 'Todo listo para presentarlo')}
                </h3>
                <p className="text-[13px] text-text-muted">
                  {state.open_attempt_id
                    ? t(
                        'exam.resume_subtitle',
                        'El reloj siguió corriendo. Retómalo donde lo dejaste.',
                      )
                    : t(
                        'exam.ready_subtitle',
                        'Busca un lugar tranquilo: el reloj no se detiene una vez que empieces.',
                      )}
                </p>
              </div>
              <motion.button
                onClick={() =>
                  state.open_attempt_id ? void handleStart() : setConfirmOpen(true)
                }
                disabled={starting}
                whileTap={reduce ? undefined : { scale: 0.97 }}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-6 py-3 text-[14px] font-medium text-on-primary transition-opacity duration-300 hover:opacity-90 disabled:opacity-60"
              >
                {starting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {state.open_attempt_id
                  ? t('exam.cta_resume', 'Retomar examen')
                  : t('exam.cta_start', 'Comenzar examen')}
              </motion.button>
            </div>
          )}
        </FadeIn>
      </div>

      {/* ── Confirmación: las reglas una última vez ── */}
      {confirmOpen &&
        // Portal a <body> + z-[120] (el estándar del sitio): así el modal nunca
        // queda atrapado en el contexto de apilamiento de un ancestro animado.
        createPortal(
          <div
            className="fixed inset-0 z-[120] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
            {...backdrop}
          >
          <motion.div
            initial={reduce ? undefined : { opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.3, ease }}
            className="w-full max-w-md rounded-3xl border border-line bg-surface p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
          >
            <div className="mb-4 grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h2 className="mb-1.5 text-[19px] font-semibold tracking-tight text-text">
              {t('exam.confirm_title', 'Antes de empezar')}
            </h2>
            <p className="mb-5 text-[13.5px] leading-relaxed text-text-muted">
              {t(
                'exam.confirm_subtitle',
                'Lee estas reglas. Al comenzar se abre tu intento y ya no se puede deshacer.',
              )}
            </p>

            <ul className="mb-6 space-y-2.5">
              {[
                state.time_limit_min > 0
                  ? t('exam.rule_time', {
                      n: state.time_limit_min,
                      defaultValue:
                        'Tienes {{n}} minutos. El reloj sigue aunque cierres la pestaña.',
                    })
                  : t('exam.rule_no_time', 'Este examen no tiene límite de tiempo.'),
                t('exam.rule_questions', {
                  n: state.question_count,
                  score: state.pass_score,
                  defaultValue: '{{n}} preguntas. Necesitas {{score}}% para aprobar.',
                }),
                state.attempts_left !== null
                  ? t('exam.rule_attempts', {
                      n: state.attempts_left,
                      defaultValue: 'Te quedan {{n}} intentos.',
                    })
                  : t('exam.rule_attempts_free', 'Puedes reintentarlo las veces que necesites.'),
                state.require_reinforcement
                  ? t(
                      'exam.rule_reinforcement',
                      'Si no apruebas, tendrás una ruta de refuerzo antes de reintentar.',
                    )
                  : t('exam.rule_report_v2', 'Al terminar verás cómo te fue en cada tema.'),
              ].map((rule, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[13.5px] text-text">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={3} />
                  {rule}
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-full px-4 py-2.5 text-[13.5px] text-text-muted transition-colors duration-300 hover:text-text"
              >
                {t('common.cancel', 'Cancelar')}
              </button>
              <motion.button
                onClick={handleStart}
                disabled={starting}
                whileTap={reduce ? undefined : { scale: 0.97 }}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity duration-300 hover:opacity-90 disabled:opacity-60"
              >
                {starting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('exam.confirm_start', 'Empezar ahora')}
              </motion.button>
            </div>
          </motion.div>
          </div>,
          document.body,
        )}
    </>
  );
}
