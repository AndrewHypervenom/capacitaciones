import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Award,
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { FadeIn } from '@/components/ui/motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useUserStore } from '@/stores/userStore';
import { useLearnerCourses } from '@/hooks/useLearnerCourses';
import {
  AnswerChoice,
  Confetti,
  DomainBar,
  PassSeal,
  ScoreGauge,
} from '@/components/exam/ExamBits';
import {
  formatClock,
  getExamAttemptReport,
  pickExamText,
} from '@/services/exams.service';
import type { ExamReport } from '@/types/exam';
import { cn } from '@/lib/cn';

const ease = [0.16, 1, 0.3, 1] as const;

/* ────────────────────────────────────────────────────────────────────────────
   Informe del examen.

   Es el momento que da sentido a todo: no dice "62/100", dice en qué áreas
   estás sólido y en cuáles no, y qué hacer a continuación. Si aprobaste,
   celebra y lleva al certificado. Si no, entrega la ruta de refuerzo.
   ──────────────────────────────────────────────────────────────────────────── */

export default function ExamResult() {
  const { courseId, attemptId } = useParams<{ courseId: string; attemptId: string }>();
  const location = useLocation();
  const { t } = useTranslation();
  const language = useUserStore((s) => s.language);
  const reduce = useReducedMotion();

  // Al venir del envío el informe ya viaja en la navegación: la celebración no
  // debe esperar a otra vuelta al servidor.
  const passed0 = (location.state as { report?: ExamReport; fresh?: boolean } | null) ?? null;

  const [report, setReport] = useState<ExamReport | null>(passed0?.report ?? null);
  const [loading, setLoading] = useState(!passed0?.report);
  const [detailOpen, setDetailOpen] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const { courses } = useLearnerCourses();
  const course = useMemo(() => courses.find((c) => c.id === courseId), [courses, courseId]);

  useEffect(() => {
    if (report || !attemptId) return;
    getExamAttemptReport(attemptId)
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, [report, attemptId]);

  // El confeti solo la primera vez, al salir de un examen recién aprobado.
  useEffect(() => {
    if (report?.passed && passed0?.fresh) {
      setCelebrate(true);
      const id = window.setTimeout(() => setCelebrate(false), 5000);
      return () => window.clearTimeout(id);
    }
  }, [report?.passed, passed0?.fresh]);

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="mx-auto max-w-3xl px-5 pb-24 pt-24 text-center">
        <p className="mb-6 text-[14px] text-text-muted">
          {t('exam.report_missing', 'No encontramos este informe.')}
        </p>
        <Link
          to={`/exam/${courseId}`}
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[13px] text-text-muted transition-colors duration-300 hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('exam.back_to_exam', 'Volver al examen')}
        </Link>
      </div>
    );
  }

  const weak = report.domain_scores.filter((d) => !d.passed);
  const strong = report.domain_scores.filter((d) => d.passed);
  const gap = Math.max(0, report.pass_score - report.score_pct);
  const hasDetail = report.detail.length > 0;

  return (
    <>
      <Confetti fire={celebrate} />

      <div className="mx-auto max-w-3xl px-4 pb-28 pt-10 sm:px-8 sm:pt-14">
        <FadeIn>
          <Link
            to={`/exam/${courseId}`}
            className="group mb-8 inline-flex items-center gap-1.5 text-[13px] text-text-subtle transition-colors hover:text-text"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-500 ease-apple group-hover:-translate-x-1" />
            {t('exam.back_to_exam', 'Volver al examen')}
          </Link>
        </FadeIn>

        {/* ── Veredicto ── */}
        <div className="mb-12 flex flex-col items-center text-center">
          {report.passed ? (
            <PassSeal>
              <div className="mb-6 grid h-16 w-16 place-items-center rounded-full bg-primary text-on-primary shadow-lg shadow-primary/25">
                <Award className="h-7 w-7" />
              </div>
            </PassSeal>
          ) : (
            <motion.div
              initial={reduce ? undefined : { scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease }}
              className="mb-6 grid h-16 w-16 place-items-center rounded-full bg-amber-500/12 text-amber-500"
            >
              <TrendingUp className="h-7 w-7" />
            </motion.div>
          )}

          <motion.p
            initial={reduce ? undefined : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease, delay: 0.1 }}
            className={cn(
              'mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em]',
              report.passed ? 'text-primary' : 'text-amber-600',
            )}
          >
            {report.expired
              ? t('exam.result_expired_tag', 'Tiempo agotado')
              : report.passed
                ? t('exam.result_passed_tag', 'Aprobado')
                : t('exam.result_failed_tag', 'Aún no')}
          </motion.p>

          <motion.h1
            initial={reduce ? undefined : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease, delay: 0.15 }}
            className="mb-3 max-w-xl text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-text sm:text-[34px]"
          >
            {report.passed
              ? t('exam.result_passed_title', '¡Estás certificado!')
              : gap <= 10
                ? t('exam.result_close_title', 'Estuviste muy cerca')
                : t('exam.result_failed_title', 'Todavía no, y está bien')}
          </motion.h1>

          <motion.p
            initial={reduce ? undefined : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="mb-9 max-w-lg text-[14.5px] leading-relaxed text-text-muted"
          >
            {report.passed
              ? t(
                  'exam.result_passed_body',
                  'Superaste el examen final del curso. Tu certificado ya está disponible.',
                )
              : t('exam.result_failed_body', {
                  gap,
                  defaultValue:
                    'Te faltaron {{gap}} puntos. Abajo está exactamente dónde reforzar antes del próximo intento.',
                })}
          </motion.p>

          <ScoreGauge
            value={report.score_pct}
            passScore={report.pass_score}
            passed={report.passed}
            passLabel={t('exam.gauge_pass', {
              score: report.pass_score,
              defaultValue: '{{score}}% para aprobar',
            })}
          />

          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12.5px] text-text-muted">
            {typeof report.correct === 'number' && (
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" />
                {t('exam.result_correct', {
                  correct: report.correct,
                  total: report.total,
                  defaultValue: '{{correct}} de {{total}} correctas',
                })}
              </span>
            )}
            {typeof report.time_spent_sec === 'number' && report.time_spent_sec > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {formatClock(report.time_spent_sec)}
              </span>
            )}
            {typeof report.attempt_no === 'number' && (
              <span className="inline-flex items-center gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                {t('exam.result_attempt_no', {
                  n: report.attempt_no,
                  defaultValue: 'Intento {{n}}',
                })}
              </span>
            )}
          </div>
        </div>

        {/* ── Desglose por dominio ── */}
        {report.domain_scores.length > 0 && (
          <FadeIn className="mb-12">
            <div className="mb-6">
              <h2 className="text-[19px] font-semibold tracking-tight text-text">
                {t('exam.report_domains_title_v2', 'Cómo te fue en cada tema')}
              </h2>
              <p className="mt-0.5 text-[13px] text-text-muted">
                {weak.length === 0
                  ? t('exam.report_domains_all_ok_v2', 'Bien en todos los temas.')
                  : t('exam.report_domains_sub', {
                      n: weak.length,
                      defaultValue:
                        'Te quedan {{n}} tema(s) por reforzar: es justo lo que se te va a pedir repasar.',
                    })}
              </p>
            </div>

            <div className="space-y-5 rounded-3xl border border-line p-6">
              {report.domain_scores.map((d, i) => (
                <DomainBar
                  key={d.domain_id}
                  domain={d}
                  index={i}
                  label={pickExamText(d.name_es, d.name_en, d.name_pt, language)}
                />
              ))}
            </div>

            {strong.length > 0 && weak.length > 0 && (
              <p className="mt-3 text-[12.5px] text-text-subtle">
                {t('exam.report_strong_hint', {
                  n: strong.length,
                  defaultValue:
                    'Ya dominas {{n}} tema(s): eso no lo tienes que volver a estudiar.',
                })}
              </p>
            )}
          </FadeIn>
        )}

        {/* ── Revisión pregunta a pregunta ── */}
        {hasDetail && (
          <FadeIn className="mb-12">
            <button
              onClick={() => setDetailOpen((v) => !v)}
              aria-expanded={detailOpen}
              className="flex w-full items-center gap-3 rounded-2xl border border-line px-5 py-4 text-left transition-colors duration-300 hover:bg-subtle/50"
            >
              <div className="min-w-0 flex-1">
                <h2 className="text-[15.5px] font-medium text-text">
                  {t('exam.report_detail_title', 'Revisa cada pregunta')}
                </h2>
                <p className="text-[12.5px] text-text-muted">
                  {t(
                    'exam.report_detail_sub',
                    'Tu respuesta, la correcta y por qué. Es la mejor forma de cerrar el vacío.',
                  )}
                </p>
              </div>
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-text-subtle transition-transform duration-300',
                  detailOpen && 'rotate-180',
                )}
              />
            </button>

            {detailOpen && (
              <div className="mt-4 space-y-5">
                {report.detail.map((d, qi) => (
                  <motion.div
                    key={d.question_id}
                    initial={reduce ? undefined : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease, delay: reduce ? 0 : Math.min(qi, 8) * 0.04 }}
                    className="rounded-3xl border border-line p-5"
                  >
                    <div className="mb-3 flex items-start gap-3">
                      <span
                        className={cn(
                          'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums',
                          d.ok ? 'bg-primary/12 text-primary' : 'bg-danger/10 text-danger',
                        )}
                      >
                        {qi + 1}
                      </span>
                      <h3 className="text-[15px] font-medium leading-snug text-text">
                        {pickExamText(d.text_es, d.text_en, d.text_pt, language)}
                      </h3>
                    </div>

                    <div className="ml-9 space-y-2">
                      {d.options.map((opt, i) => {
                        const isCorrect = d.correct.includes(opt.id);
                        const isGiven = d.given.includes(opt.id);
                        return (
                          <AnswerChoice
                            key={opt.id}
                            index={i}
                            letter={String.fromCharCode(97 + i)}
                            text={pickExamText(opt.text_es, opt.text_en, opt.text_pt, language)}
                            selected={isGiven}
                            multi={d.kind === 'multi'}
                            state={
                              isCorrect && isGiven
                                ? 'correct'
                                : isCorrect
                                  ? 'missed'
                                  : isGiven
                                    ? 'wrong'
                                    : 'idle'
                            }
                          />
                        );
                      })}
                    </div>

                    {pickExamText(
                      d.explanation_es,
                      d.explanation_en,
                      d.explanation_pt,
                      language,
                    ) && (
                      <div className="ml-9 mt-3.5 rounded-2xl bg-subtle/60 px-4 py-3">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-subtle">
                          {t('exam.report_why', 'Por qué')}
                        </p>
                        <p className="text-[13.5px] leading-relaxed text-text-muted">
                          {pickExamText(
                            d.explanation_es,
                            d.explanation_en,
                            d.explanation_pt,
                            language,
                          )}
                        </p>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </FadeIn>
        )}

        {/* ── Qué sigue ── */}
        <FadeIn delay={0.1}>
          {report.passed ? (
            <div className="flex flex-col gap-4 rounded-3xl border border-primary/30 bg-primary/[0.04] p-6 sm:flex-row sm:items-center">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[16px] font-medium text-text">
                  {t('exam.next_certificate_title', 'Tu certificado te espera')}
                </h3>
                <p className="text-[13px] text-text-muted">
                  {course
                    ? t('exam.next_certificate_sub', {
                        course: pickExamText(
                          pickExamText(course.title_es, course.title_en, course.title_pt, language),
                          course.title_en,
                          course.title_pt,
                          language,
                        ),
                        defaultValue: 'Emítelo y compártelo: {{course}}.',
                      })
                    : t('exam.next_certificate_sub_generic', 'Emítelo y compártelo.')}
                </p>
              </div>
              <Link
                to={`/certificate/${courseId}`}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity duration-300 hover:opacity-90"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t('exam.next_certificate_cta', 'Ver certificado')}
              </Link>
            </div>
          ) : (
            <div className="rounded-3xl border border-line p-6">
              <div className="mb-1.5 flex items-center gap-2.5">
                <BookOpen className="h-4 w-4 text-amber-500" />
                <h3 className="text-[16px] font-medium text-text">
                  {t('exam.next_reinforcement_title', 'Tu ruta de refuerzo ya está lista')}
                </h3>
              </div>
              <p className="mb-5 text-[13.5px] leading-relaxed text-text-muted">
                {weak.length > 0
                  ? t('exam.next_reinforcement_sub', {
                      areas: weak
                        .map((d) => pickExamText(d.name_es, d.name_en, d.name_pt, language))
                        .join(', '),
                      defaultValue:
                        'Armamos un repaso con los módulos de: {{areas}}. Complétalo y se habilita tu siguiente intento.',
                    })
                  : t(
                      'exam.next_reinforcement_sub_generic',
                      'Repasa el curso y vuelve a presentarlo cuando estés listo.',
                    )}
              </p>
              <Link
                to={`/exam/${courseId}`}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity duration-300 hover:opacity-90"
              >
                <BookOpen className="h-3.5 w-3.5" />
                {t('exam.next_reinforcement_cta', 'Ir a mi refuerzo')}
              </Link>
            </div>
          )}
        </FadeIn>
      </div>
    </>
  );
}
