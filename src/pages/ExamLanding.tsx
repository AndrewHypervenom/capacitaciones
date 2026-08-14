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
import { useAuth } from '@/hooks/useAuth';
import {
  getReinforcementStudy,
  type ReinforcementStudyRow,
} from '@/services/reinforcementStudy.service';
import { useLearnerCourses } from '@/hooks/useLearnerCourses';
import {
  REINFORCEMENT_STUDY_EVENT,
  isStudyDone,
  readStudy,
  remainingMs,
  requiredStudyMs,
  saveActiveReinforcement,
  studyPct,
} from '@/lib/reinforcementStudy';
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
import { questionQuotas } from '@/lib/examQuotas';

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
      // `flex` a propósito: el Tooltip envuelve a su hijo en un span `inline-flex`,
      // que se encoge al ancho del texto y se alinea por línea base. Dentro de un
      // flex el span se vuelve bloque y estira, y así las cuatro tarjetas miden
      // exactamente lo mismo aunque una lleve una línea de más.
      className="flex"
    >
      <Tooltip label={tooltip} maxWidth={240} anchor="element" describedBy className="w-full">
        <div className="flex h-full w-full cursor-help flex-col rounded-2xl border border-line px-4 py-4 text-left transition-colors duration-300 hover:border-text-subtle/40">
          <Icon className="mb-3 h-4 w-4 shrink-0 text-text-subtle" />
          {/* El valor pegado abajo: con o sin pista, la cifra y la etiqueta de
              las cuatro tarjetas quedan a la misma altura. */}
          <div className="mt-auto text-[19px] font-semibold leading-none tabular-nums text-text">
            {value}
          </div>
          {/* La pista va en la MISMA línea que la etiqueta, no debajo: tres
              renglones apilados en una tarjeta tan chica se leían amontonados.
              Así las cuatro tarjetas tienen exactamente el mismo pie. */}
          <div className="mt-2 text-[11.5px] leading-[1.35] text-text-muted">
            {label}
            {hint && (
              <>
                <span className="mx-1 text-text-subtle/60" aria-hidden>
                  ·
                </span>
                <span className="text-text-subtle">{hint}</span>
              </>
            )}
          </div>
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
  const { profile } = useAuth();
  const userId = profile?.id;

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

  /* Repaso medido: cada módulo de la ruta pide un mínimo de tiempo ACTIVO
     dentro del módulo (lo cuenta useReinforcementStudy en la página del
     módulo). `studyTick` obliga a releerlo cuando el aprendiz vuelve a esta
     pestaña o cuando el propio módulo avisa que ya cumplió. */
  const [studyTick, setStudyTick] = useState(0);
  useEffect(() => {
    const bump = () => setStudyTick((n) => n + 1);
    const onVisible = () => {
      if (!document.hidden) bump();
    };
    window.addEventListener(REINFORCEMENT_STUDY_EVENT, bump);
    window.addEventListener('focus', bump);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(REINFORCEMENT_STUDY_EVENT, bump);
      window.removeEventListener('focus', bump);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  /* Lo que la base ya tiene por repasado. La medición ocurre en el navegador,
     así que sin esto alguien que repasó en el computador de la oficina y entra
     desde otro equipo vería su ruta en cero. */
  const [remoteStudy, setRemoteStudy] = useState<Record<string, ReinforcementStudyRow>>({});
  useEffect(() => {
    const rid = state?.reinforcement?.id;
    if (!rid || !userId) return;
    let alive = true;
    getReinforcementStudy(userId, rid)
      .then((rows) => {
        if (alive) setRemoteStudy(rows);
      })
      .catch(() => {
        /* sin la tabla en BD la ruta sigue funcionando con lo local */
      });
    return () => {
      alive = false;
    };
    // `studyTick` refresca al volver a esta pestaña desde el módulo.
  }, [state?.reinforcement?.id, userId, studyTick]);

  // Módulos de la ruta de refuerzo, resueltos contra el curso.
  const reinforcementModules = useMemo(() => {
    if (!state?.reinforcement || !course) return [];
    const rid = state.reinforcement.id;
    const done = new Set(state.reinforcement.done_ids);
    void studyTick; // releer el repaso acumulado, no es un valor que se pinte
    return state.reinforcement.module_ids.flatMap((id) => {
      const m = course.modules.find((mm) => mm.id === id);
      if (!m) return [];
      const requiredMs = requiredStudyMs(m.duration_min);
      const rec = readStudy(userId, rid, id);
      /* Repasado de verdad = haber recorrido el módulo entero dándole tiempo a
         cada pantalla, acreditado por el servidor (RPC `reinforcement_beat`).
         Antes pedíamos que el módulo estuviera "completado", y eso no probaba
         nada: para llegar al examen ya hay que haber completado el curso, así
         que el check se abría sin haber repasado — y a quien le faltaba el
         completado se le quedaba trabado sin manera de reintentar nunca.

         Cuando la base tiene la fila, manda ella; lo local solo pinta mientras
         llega la respuesta o si el SQL todavía no está corrido. El candado de
         verdad no es este cálculo: es el trigger que rechaza marcar un módulo
         sin repaso cumplido. */
      const srv = remoteStudy[id];
      const studied = srv ? srv.completedAt !== null : isStudyDone(rec, requiredMs);
      const remaining = srv
        ? Math.max(0, srv.requiredMs - srv.creditedMs)
        : remainingMs(rec, requiredMs);
      return [{
        module: m,
        done: done.has(id),
        requiredMs,
        /* Avance del repaso, 0-100. El 100% coincide exactamente con "cumplido":
           una barra que llega al final con el botón todavía apagado es la peor
           forma de explicar una regla. */
        pct: studied ? 100 : srv ? srv.progressPct : studyPct(rec, requiredMs),
        remainingMin: Math.max(1, Math.ceil(remaining / 60_000)),
        studied,
      }];
    });
  }, [state, course, userId, studyTick, remoteStudy]);

  /* Publicamos la ruta vigente para que la página del módulo sepa que lo que
     se está abriendo es un repaso y lo cronometre. Si ya no hay ruta (o se
     terminó), se borra: nada debe seguir contando. */
  useEffect(() => {
    if (!courseId) return;
    if (!state?.reinforcement || !course) {
      saveActiveReinforcement(userId, courseId, null);
      return;
    }
    const done = new Set(state.reinforcement.done_ids);
    saveActiveReinforcement(userId, courseId, {
      reinforcementId: state.reinforcement.id,
      courseId: course.id,
      modules: state.reinforcement.module_ids
        .filter((id) => !done.has(id))
        .flatMap((id) => {
          const m = course.modules.find((mm) => mm.id === id);
          return m ? [{ id, requiredMs: requiredStudyMs(m.duration_min) }] : [];
        }),
    });
  }, [state, course, userId, courseId]);

  const handleMarkReviewed = async (moduleId: string) => {
    if (!state?.reinforcement) return;
    setMarkingId(moduleId);
    try {
      const res = await markReinforcementModule(state.reinforcement.id, moduleId);
      if (res.status === 'completed') {
        toast.success(t('exam.reinforcement_done', '¡Refuerzo completado! Ya puedes reintentar.'));
      }
      load();
    } catch (err) {
      /* La base valida el repaso por su cuenta (trigger `reinforcement_done_guard`).
         Si lo rechaza no es un fallo de guardado: es que ese módulo todavía no
         está repasado, y hay que decirlo así. */
      const msg = err instanceof Error ? err.message : String(err ?? '');
      if (msg.includes('REPASO_INCOMPLETO')) {
        toast.error(
          t(
            'exam.reinforcement_rejected',
            'Todavía no está repasado: ábrelo y recórrelo entero para poder marcarlo.',
          ),
        );
        setRemoteStudy({});
        load();
      } else {
        toast.error(t('exam.error_generic', 'No se pudo guardar.'));
      }
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

  /* El tamaño del banco es el del examen, no la suma de los temas: las
     preguntas sin tema también entran al sorteo y sumándolas por tema se
     quedaban fuera de la cuenta. */
  const bankSize =
    state.bank_size || state.domains.reduce((s, d) => s + d.question_count, 0);

  /* Cuántas preguntas le tocan a cada tema, repartidas de una vez: redondear
     cada tema por su lado dejaba sumas de 21 preguntas en un examen de 20. */
  const domainQuotas = questionQuotas(
    state.question_count,
    state.domains.map((d) => d.weight_pct),
  );

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
                      n: domainQuotas[i] ?? 0,
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

            {bankSize > 0 && (
              <p className="mt-3 text-[12px] text-text-subtle">
                {t('exam.domains_bank_hint', {
                  n: bankSize,
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
                  'No aprobaste todavía. Estos son los módulos de los temas que se te complicaron: ábrelos, dedícales el tiempo que se indica y márcalos aquí. Cuando termines la ruta se habilita tu siguiente intento.',
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
                {reinforcementModules.map((
                  { module, done, studied, pct, remainingMin, requiredMs },
                  i,
                ) => (
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
                        {!done && studied && (
                          <> · {t('exam.reinforcement_studied', 'repasado, ya puedes marcarlo')}</>
                        )}
                        {!done && !studied && (
                          <>
                            {' · '}
                            {pct === 0
                              ? t('exam.reinforcement_not_started', {
                                  n: Math.round(requiredMs / 60_000),
                                  defaultValue: 'ábrelo y recórrelo entero (unos {{n}} min)',
                                })
                              : t('exam.reinforcement_left', {
                                  pct,
                                  n: remainingMin,
                                  defaultValue: 'repasado {{pct}}% · te faltan unos {{n}} min',
                                })}
                          </>
                        )}
                      </div>

                      {/* Barra del repaso: el aprendiz ve cuánto lleva, no un
                          check apagado sin explicación. Solo aparece cuando ya
                          empezó a repasar. */}
                      {!done && !studied && pct > 0 && (
                        <div className="mt-1.5 h-[3px] w-full max-w-[180px] overflow-hidden rounded-full bg-subtle">
                          <div
                            className="h-full rounded-full bg-amber-500/70"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
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
                            : t('exam.reinforcement_locked_hint', {
                                n: remainingMin,
                                defaultValue:
                                  'Ábrelo y recórrelo entero: cada pantalla del módulo pide su tiempo. Te faltan {{n}} min para poder marcarlo.',
                              })
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
