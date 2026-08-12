import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Cloud,
  CloudOff,
  Flag,
  Keyboard,
  Loader2,
  Send,
  ShieldCheck,
  SkipForward,
} from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useUserStore } from '@/stores/userStore';
import {
  AnswerChoice,
  ExamProgress,
  ExamTimer,
  QuestionNav,
  type QuestionMark,
} from '@/components/exam/ExamBits';
import {
  pickExamText,
  saveExamProgress,
  startExamAttempt,
  submitExamAttempt,
} from '@/services/exams.service';
import type { ExamAttemptSession } from '@/types/exam';
import { toast } from '@/stores/toastStore';
import { Tooltip } from '@/components/ui/Tooltip';
import { useBackdropDismiss } from '@/hooks/useBackdropDismiss';
import { cn } from '@/lib/cn';

const ease = [0.16, 1, 0.3, 1] as const;

/* ────────────────────────────────────────────────────────────────────────────
   El examen en curso.

   Pantalla de foco: una pregunta a la vez, navegador para saltar, marcar para
   revisar y un reloj que corre contra el servidor. El estado vive aquí y se
   espeja a la base con rebote — cerrar la pestaña no pierde respuestas, y al
   volver la RPC devuelve el mismo intento con lo ya contestado.

   La calificación NO se hace aquí: se manda al servidor y él decide. Este
   componente nunca conoce la respuesta correcta.
   ──────────────────────────────────────────────────────────────────────────── */

export default function ExamRunner() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const language = useUserStore((s) => s.language);
  const reduce = useReducedMotion();

  // La antesala ya abrió el intento y lo pasa por navegación: entrar al examen
  // no debe costar una segunda vuelta al servidor.
  const preloaded = (location.state as { session?: ExamAttemptSession } | null)?.session ?? null;

  const [session, setSession] = useState<ExamAttemptSession | null>(preloaded);
  const [loading, setLoading] = useState(!preloaded);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>(preloaded?.answers ?? {});
  const [flagged, setFlagged] = useState<string[]>(preloaded?.flagged ?? []);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Estado del espejo a la base. Se enseña con letra pequeña junto al reloj:
  // en un examen cronometrado, no saber si tus respuestas están a salvo es la
  // principal fuente de ansiedad.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const submittedRef = useRef(false);

  const backdrop = useBackdropDismiss(() => setReviewOpen(false), !submitting);

  /* Recarga directa de /exam/:id/run (sin pasar por la antesala): se retoma el
     intento abierto. Sin esto, refrescar la página tiraba el examen. */
  useEffect(() => {
    if (session || !courseId) return;
    let active = true;
    startExamAttempt(courseId)
      .then((s) => {
        if (!active) return;
        setSession(s);
        setAnswers(s.answers ?? {});
        setFlagged(s.flagged ?? []);
      })
      .catch(() => {
        if (active) navigate(`/exam/${courseId}`, { replace: true });
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [session, courseId, navigate]);

  // Estable entre renders: si fuera `session?.questions ?? []` el arreglo vacío
  // sería nuevo en cada render y los useMemo de abajo se recalcularían siempre.
  const questions = useMemo(() => session?.questions ?? [], [session]);
  const total = questions.length;
  const current = questions[idx];

  const answeredCount = useMemo(
    () => questions.filter((q) => (answers[q.id]?.length ?? 0) > 0).length,
    [questions, answers],
  );

  const marks: QuestionMark[] = useMemo(
    () =>
      questions.map((q) =>
        flagged.includes(q.id)
          ? 'flagged'
          : (answers[q.id]?.length ?? 0) > 0
            ? 'answered'
            : 'empty',
      ),
    [questions, answers, flagged],
  );

  /* ── Autoguardado con rebote ──
     El envío final manda todo de nuevo, así que esto es una red de seguridad,
     no la fuente de verdad. Por eso es best-effort y no bloquea la interfaz. */
  const saveTimer = useRef<number | null>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (!session || submittedRef.current) return;
    // El primer render no es un cambio del aprendiz: sin esto la pantalla
    // arranca diciendo "Guardando" sin que nadie haya tocado nada.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setSaveState('saving');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveExamProgress(session.attempt_id, answers, flagged)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 1200);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [answers, flagged, session]);

  /* Cerrar la pestaña a mitad del examen: aviso del navegador. */
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (submittedRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const toggleAnswer = (questionId: string, optionId: string, multi: boolean) => {
    setAnswers((prev) => {
      const cur = prev[questionId] ?? [];
      if (multi) {
        return {
          ...prev,
          [questionId]: cur.includes(optionId)
            ? cur.filter((o) => o !== optionId)
            : [...cur, optionId],
        };
      }
      // Volver a tocar la misma opción la deselecciona: cambiar de opinión no
      // debe obligar a dejar una respuesta que ya no se cree correcta.
      return { ...prev, [questionId]: cur[0] === optionId ? [] : [optionId] };
    });
  };

  const toggleFlag = (questionId: string) => {
    setFlagged((prev) =>
      prev.includes(questionId) ? prev.filter((f) => f !== questionId) : [...prev, questionId],
    );
  };

  const submit = useCallback(
    async (auto = false) => {
      if (!session || submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        const report = await submitExamAttempt(session.attempt_id, answers);
        navigate(`/exam/${courseId}/result/${session.attempt_id}`, {
          state: { report, fresh: true },
          replace: true,
        });
      } catch {
        submittedRef.current = false;
        setSubmitting(false);
        toast.error(
          auto
            ? t('exam.error_autosubmit', 'Se acabó el tiempo pero no se pudo enviar. Reintenta.')
            : t('exam.error_submit', 'No se pudo enviar el examen. Revisa tu conexión.'),
        );
      }
    },
    [session, answers, courseId, navigate, t],
  );

  /* Se acabó el tiempo: se envía solo, con lo que haya. */
  const handleExpire = useCallback(() => {
    toast.error(t('exam.time_up', 'Se acabó el tiempo. Enviando tu examen…'));
    void submit(true);
  }, [submit, t]);

  /* Avisos del reloj a los 5 y al 1 minuto. Uno solo por hito: el aprendiz
     necesita saberlo, no que se lo repitan cada segundo. */
  const handleMilestone = useCallback(
    (secs: number) => {
      toast.info(
        secs >= 300
          ? t('exam.warn_5min', 'Quedan 5 minutos.')
          : t('exam.warn_1min', 'Queda 1 minuto. Revisa lo que te falte.'),
      );
    },
    [t],
  );

  /* Ir a la primera sin responder: en un examen largo, buscarla a mano por el
     navegador es justo el trabajo que la máquina debería hacer. */
  const firstUnanswered = useMemo(
    () => questions.findIndex((q) => (answers[q.id]?.length ?? 0) === 0),
    [questions, answers],
  );

  const goToFirstUnanswered = useCallback(() => {
    if (firstUnanswered >= 0) {
      setIdx(firstUnanswered);
      setReviewOpen(false);
    }
  }, [firstUnanswered]);

  /* Atajos de teclado: el examen se puede hacer sin soltar el teclado. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (reviewOpen || submitting) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'ArrowRight') setIdx((i) => Math.min(i + 1, total - 1));
      else if (e.key === 'ArrowLeft') setIdx((i) => Math.max(i - 1, 0));
      else if (e.key.toLowerCase() === 'f' && current) toggleFlag(current.id);
      else if (/^[1-9]$/.test(e.key) && current) {
        const opt = current.options[Number(e.key) - 1];
        if (opt) toggleAnswer(current.id, opt.id, current.kind === 'multi');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, total, reviewOpen, submitting]);

  if (loading || !session || !current) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
      </div>
    );
  }

  const multi = current.kind === 'multi';
  const selected = answers[current.id] ?? [];
  const isFlagged = flagged.includes(current.id);
  const unanswered = total - answeredCount;

  return (
    <>
      {/* ── Barra superior fija: reloj, avance y salida ── */}
      <div className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto max-w-3xl px-4 py-3 sm:px-8">
          <div className="mb-2.5 flex items-center gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-[13px] font-medium text-text">
                {t('exam.running_title', 'Examen en curso')}
              </span>
            </div>

            {/* Autoguardado: sin esto nadie sabe si cerrar la pestaña le cuesta
                el examen. Se calla mientras no hay nada que decir. */}
            {saveState !== 'idle' && (
              <Tooltip
                label={
                  saveState === 'error'
                    ? t(
                        'exam.save_error_hint',
                        'No pudimos guardar en el servidor. Tus respuestas siguen aquí y se envían al terminar.',
                      )
                    : t(
                        'exam.save_ok_hint',
                        'Tus respuestas se guardan solas. Si cierras la pestaña, retomas donde ibas.',
                      )
                }
                maxWidth={240}
                describedBy
              >
                <span
                  className={cn(
                    'ml-auto inline-flex shrink-0 items-center gap-1.5 text-[11.5px]',
                    saveState === 'error' ? 'text-amber-600' : 'text-text-subtle',
                  )}
                >
                  {saveState === 'error' ? (
                    <CloudOff className="h-3.5 w-3.5" />
                  ) : (
                    <Cloud className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">
                    {saveState === 'saving'
                      ? t('exam.saving', 'Guardando…')
                      : saveState === 'error'
                        ? t('exam.save_failed', 'Sin conexión')
                        : t('exam.saved', 'Guardado')}
                  </span>
                </span>
              </Tooltip>
            )}

            <Tooltip
              label={t('exam.progress_hint', {
                done: answeredCount,
                total,
                left: total - answeredCount,
                defaultValue: 'Respondidas {{done}} de {{total}} · te faltan {{left}}',
              })}
              describedBy
            >
              <span
                className={cn(
                  'shrink-0 text-[12.5px] tabular-nums text-text-muted',
                  saveState === 'idle' && 'ml-auto',
                )}
              >
                {t('exam.progress_count', {
                  done: answeredCount,
                  total,
                  defaultValue: '{{done}} de {{total}}',
                })}
              </span>
            </Tooltip>

            <Tooltip
              label={
                session.expires_at
                  ? t(
                      'exam.timer_hint',
                      'El reloj corre en el servidor: sigue avanzando aunque cierres la pestaña. Al llegar a cero se envía solo.',
                    )
                  : t('exam.timer_none_hint', 'Este examen no tiene límite de tiempo.')
              }
              maxWidth={250}
              describedBy
            >
              <span className="shrink-0">
                <ExamTimer
                  expiresAt={session.expires_at}
                  onExpire={handleExpire}
                  onMilestone={handleMilestone}
                />
              </span>
            </Tooltip>
          </div>
          <ExamProgress done={answeredCount} total={total} />
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 pb-40 pt-10 sm:px-8">
        {/* ── Pregunta ──
            La `key` remonta el bloque en cada pregunta: la entrada se anima sola
            sin necesidad de AnimatePresence anidado. */}
        <motion.div
          key={current.id}
          initial={reduce ? undefined : { opacity: 0, y: 18, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.45, ease }}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-subtle">
                {t('exam.question_n', {
                  n: idx + 1,
                  total,
                  defaultValue: 'Pregunta {{n}} de {{total}}',
                })}
              </span>
              {multi && (
                <span className="ml-2.5 rounded-full bg-subtle px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-text-muted">
                  {t('exam.multi_tag', 'Varias respuestas')}
                </span>
              )}
            </div>

            <Tooltip
              label={
                isFlagged
                  ? t('exam.flag_off_hint', 'Quitar la marca')
                  : t(
                      'exam.flag_hint',
                      'La deja resaltada en el navegador para volver antes de enviar. No afecta tu respuesta.',
                    )
              }
              shortcut="F"
              maxWidth={230}
            >
              <button
                onClick={() => toggleFlag(current.id)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors duration-300',
                  isFlagged
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-600'
                    : 'border-line text-text-subtle hover:text-text',
                )}
                aria-pressed={isFlagged}
              >
                <Flag className={cn('h-3.5 w-3.5', isFlagged && 'fill-current')} />
                {isFlagged
                  ? t('exam.flagged', 'Marcada')
                  : t('exam.flag', 'Marcar para revisar')}
              </button>
            </Tooltip>
          </div>

          <h1 className="mb-7 text-[21px] font-medium leading-snug tracking-tight text-text sm:text-[24px]">
            {pickExamText(current.text_es, current.text_en, current.text_pt, language)}
          </h1>

          <div className="space-y-2.5">
            {current.options.map((opt, i) => (
              <AnswerChoice
                key={opt.id}
                index={i}
                letter={String.fromCharCode(97 + i)}
                text={pickExamText(opt.text_es, opt.text_en, opt.text_pt, language)}
                selected={selected.includes(opt.id)}
                multi={multi}
                hint={i < 9 ? String(i + 1) : undefined}
                onClick={() => toggleAnswer(current.id, opt.id, multi)}
              />
            ))}
          </div>

          <p className="mt-3.5 text-[12.5px] text-text-subtle">
            {multi
              ? t('exam.multi_hint', 'Esta pregunta tiene más de una respuesta correcta.')
              : selected.length > 0
                ? t('exam.deselect_hint', 'Toca de nuevo tu respuesta para dejarla en blanco.')
                : t('exam.single_hint', 'Elige una sola respuesta.')}
          </p>
        </motion.div>
      </div>

      {/* ── Riel lateral: el mapa del examen siempre a la vista ──
          Solo en pantallas anchas (a partir de xl), donde sobra sitio al lado
          de la columna de lectura. En pantallas chicas el mapa vive en el panel
          de revisión, que es donde no estorba. */}
      <aside className="pointer-events-none fixed inset-y-0 right-0 z-20 hidden w-64 items-center pr-6 xl:flex">
        <div className="pointer-events-auto w-full rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur-xl">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-subtle">
              {t('exam.map_title', 'Mapa')}
            </span>
            <span className="text-[11.5px] tabular-nums text-text-muted">
              {answeredCount}/{total}
            </span>
          </div>

          <QuestionNav
            marks={marks}
            current={idx}
            cols="grid-cols-6"
            labelPrefix={t('exam.question_short', 'Pregunta')}
            tooltipFor={(i, m) =>
              `${t('exam.question_short', 'Pregunta')} ${i + 1} · ${
                m === 'answered'
                  ? t('exam.legend_answered', 'Respondida')
                  : m === 'flagged'
                    ? t('exam.legend_flagged', 'Marcada')
                    : t('exam.legend_empty', 'Sin responder')
              }`
            }
            onPick={setIdx}
          />

          {firstUnanswered >= 0 && (
            <button
              onClick={goToFirstUnanswered}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[11.5px] font-medium text-text-muted transition-colors duration-300 hover:border-primary/50 hover:text-primary"
            >
              <SkipForward className="h-3 w-3" />
              {t('exam.jump_unanswered', 'Sin responder')}
            </button>
          )}

          {flagged.length > 0 && (
            <p className="mt-3 text-[11px] text-text-subtle">
              {t('exam.map_flagged', {
                n: flagged.length,
                defaultValue: '{{n}} marcada(s) para revisar',
              })}
            </p>
          )}
        </div>
      </aside>

      {/* ── Pie fijo: navegación ── */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3.5 sm:px-8">
          <Tooltip label={t('exam.prev', 'Anterior')} shortcut="←">
            <button
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              disabled={idx === 0}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2.5 text-[13px] font-medium text-text-muted transition-colors duration-300 hover:text-text disabled:opacity-40"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('exam.prev', 'Anterior')}</span>
            </button>
          </Tooltip>

          <Tooltip
            label={t(
              'exam.review_hint',
              'Abre el mapa del examen para saltar a cualquier pregunta y enviar.',
            )}
            maxWidth={220}
          >
            <button
              onClick={() => setReviewOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-medium text-text-muted transition-colors duration-300 hover:text-text"
            >
              {t('exam.review', 'Revisar')}
              {flagged.length > 0 && (
                <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-amber-600">
                  {flagged.length}
                </span>
              )}
            </button>
          </Tooltip>

          {/* Saltar a la primera pendiente: solo aparece si de verdad falta algo
              y no estás ya parado en ella. */}
          {firstUnanswered >= 0 && firstUnanswered !== idx && (
            <Tooltip
              label={t('exam.jump_hint', {
                n: firstUnanswered + 1,
                defaultValue: 'Ir a la pregunta {{n}}, la primera sin responder',
              })}
            >
              <button
                onClick={goToFirstUnanswered}
                className="hidden items-center gap-1.5 rounded-full px-3 py-2.5 text-[13px] font-medium text-text-subtle transition-colors duration-300 hover:text-text sm:inline-flex"
              >
                <SkipForward className="h-3.5 w-3.5" />
                {t('exam.jump_unanswered', 'Sin responder')}
              </button>
            </Tooltip>
          )}

          <div className="ml-auto" />

          {idx < total - 1 ? (
            <Tooltip label={t('exam.next', 'Siguiente')} shortcut="→">
              <motion.button
                onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
                whileTap={reduce ? undefined : { scale: 0.97 }}
                className="group inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity duration-300 hover:opacity-90"
              >
                {t('exam.next', 'Siguiente')}
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-500 ease-apple group-hover:translate-x-1" />
              </motion.button>
            </Tooltip>
          ) : (
            <Tooltip
              label={t('exam.finish_hint', 'Revisa el mapa y envía cuando estés listo.')}
            >
              <motion.button
                onClick={() => setReviewOpen(true)}
                whileTap={reduce ? undefined : { scale: 0.97 }}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity duration-300 hover:opacity-90"
              >
                <Send className="h-3.5 w-3.5" />
                {t('exam.finish', 'Terminar')}
              </motion.button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* ── Panel de revisión y envío ── */}
      {reviewOpen &&
        // Portal a <body> + z-[120] (el estándar del sitio): la barra fija del
        // pie del examen no puede quedar por encima del panel de envío.
        createPortal(
          <div
            className="fixed inset-0 z-[120] grid place-items-end bg-black/50 backdrop-blur-sm sm:place-items-center sm:p-4"
            {...backdrop}
          >
          <motion.div
            initial={reduce ? undefined : { opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease }}
            className="w-full max-w-lg rounded-t-3xl border border-line bg-surface p-6 shadow-xl sm:rounded-3xl"
            role="dialog"
            aria-modal="true"
          >
            <h2 className="mb-1.5 text-[19px] font-semibold tracking-tight text-text">
              {t('exam.review_title', 'Revisa antes de enviar')}
            </h2>
            <p className="mb-5 text-[13.5px] text-text-muted">
              {unanswered > 0
                ? t('exam.review_pending', {
                    n: unanswered,
                    defaultValue:
                      'Te faltan {{n}} preguntas por responder. Las vacías cuentan como incorrectas.',
                  })
                : t('exam.review_complete', 'Respondiste todas. Puedes enviar cuando quieras.')}
            </p>

            <QuestionNav
              marks={marks}
              current={idx}
              labelPrefix={t('exam.question_short', 'Pregunta')}
              tooltipFor={(i, m) =>
                `${t('exam.question_short', 'Pregunta')} ${i + 1} · ${
                  m === 'answered'
                    ? t('exam.legend_answered', 'Respondida')
                    : m === 'flagged'
                      ? t('exam.legend_flagged', 'Marcada')
                      : t('exam.legend_empty', 'Sin responder')
                }`
              }
              onPick={(i) => {
                setIdx(i);
                setReviewOpen(false);
              }}
              className="mb-5"
            />

            {firstUnanswered >= 0 && (
              <button
                onClick={goToFirstUnanswered}
                className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12.5px] font-medium text-text-muted transition-colors duration-300 hover:border-primary/50 hover:text-primary"
              >
                <SkipForward className="h-3.5 w-3.5" />
                {t('exam.jump_first_unanswered', {
                  n: firstUnanswered + 1,
                  defaultValue: 'Ir a la primera sin responder (#{{n}})',
                })}
              </button>
            )}

            <div className="mb-4 hidden items-center gap-2 text-[11.5px] text-text-subtle sm:flex">
              <Keyboard className="h-3.5 w-3.5" />
              {t('exam.shortcuts_hint', 'Atajos:')}
              <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px]">
                &larr; &rarr;
              </kbd>
              {t('exam.shortcuts_move', 'moverte')}
              <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px]">
                1-9
              </kbd>
              {t('exam.shortcuts_pick', 'responder')}
              <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10.5px]">
                F
              </kbd>
              {t('exam.shortcuts_flag', 'marcar')}
            </div>

            <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[3px] bg-primary/25" />
                {t('exam.legend_answered', 'Respondida')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[3px] bg-amber-500/35" />
                {t('exam.legend_flagged', 'Marcada')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[3px] bg-subtle" />
                {t('exam.legend_empty', 'Sin responder')}
              </span>
            </div>

            {unanswered > 0 && (
              <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <p className="text-[12.5px] text-text-muted">
                  {t(
                    'exam.review_warning',
                    'Una vez que envíes no podrás cambiar tus respuestas.',
                  )}
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setReviewOpen(false)}
                className="rounded-full px-4 py-2.5 text-[13.5px] text-text-muted transition-colors duration-300 hover:text-text"
              >
                {t('exam.keep_going', 'Seguir respondiendo')}
              </button>
              <motion.button
                onClick={() => void submit()}
                disabled={submitting}
                whileTap={reduce ? undefined : { scale: 0.97 }}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity duration-300 hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                )}
                {t('exam.submit', 'Enviar examen')}
              </motion.button>
            </div>
          </motion.div>
          </div>,
          document.body,
        )}
    </>
  );
}
