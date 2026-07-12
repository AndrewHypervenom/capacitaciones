import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, Lock, Check } from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import { getCourseById, type CourseWithModules } from '@/services/courses.service';
import {
  getCourseCertStatus, issueCertification,
  getCourseActivitySummary, getCourseEvaluationResults,
  type CourseActivitySummary,
} from '@/services/certification.service';
import type { CourseCertStatus, CourseEvaluationResult } from '@/types/database';
import { Button } from '@/components/ui/Button';
import { Reveal } from '@/components/ui/Reveal';

function pickText(es: string | null, en: string | null, pt: string | null, lang: string): string {
  if (lang === 'en') return en || es || '';
  if (lang === 'pt') return pt || es || '';
  return es || '';
}

// ── Corporate palette ────────────────────────────────────
const GREEN = '#10D451';
const MAGENTA = '#B33D9E';
const GRAY_LIGHT = '#E0EBE7';
const GRAY_MED = '#A1ADAD';
const WHITE = '#FFFFFF';
const INK = '#16211D';

const SANS =
  '"Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

function formatDate(d: Date, lang: string) {
  try {
    return new Intl.DateTimeFormat(
      lang === 'es' ? 'es-ES' : lang === 'pt' ? 'pt-BR' : 'en-US',
      { day: 'numeric', month: 'long', year: 'numeric' },
    ).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

/** Clean, modern verification badge (LearningAI mark + check ring). */
function VerifiedBadge() {
  return (
    <div style={{ position: 'relative', width: 84, height: 84 }}>
      <svg width="84" height="84" viewBox="0 0 100 100" style={{ display: 'block' }}>
        <circle cx="50" cy="50" r="47" fill="none" stroke={GRAY_LIGHT} strokeWidth="2" />
        <circle
          cx="50" cy="50" r="47" fill="none"
          stroke="url(#badgeGrad)" strokeWidth="3"
          strokeLinecap="round" strokeDasharray="220 295" transform="rotate(-90 50 50)"
        />
        <defs>
          <linearGradient id="badgeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={GREEN} />
            <stop offset="1" stopColor={MAGENTA} />
          </linearGradient>
        </defs>
      </svg>
      <img
        src="/logo.jpg"
        alt="LearningAI"
        style={{
          position: 'absolute', top: 16, left: 16, width: 52, height: 52,
          borderRadius: '50%', objectFit: 'cover',
        }}
      />
      <div style={{
        position: 'absolute', right: -2, bottom: -2, width: 26, height: 26,
        borderRadius: '50%', background: GREEN, border: `2.5px solid ${WHITE}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Check size={14} color={WHITE} strokeWidth={3.5} />
      </div>
    </div>
  );
}

function MetaItem({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 120 }}>
      <div style={{
        fontSize: 9.5, letterSpacing: 1.5, color: GRAY_MED,
        textTransform: 'uppercase', fontWeight: 600, marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 17, fontWeight: 700, letterSpacing: -0.2,
        color: accent ? MAGENTA : INK,
      }}>
        {value}
      </div>
    </div>
  );
}

function LockedPreview({ minScore, backTo }: { minScore: number; backTo: string }) {
  const { t } = useTranslation();
  const nav = useNavigate();

  return (
    <div className="mx-auto max-w-4xl px-5 pt-16 pb-24">
      <Link
        to={backTo}
        className="inline-flex items-center gap-2 text-[13px] text-text-muted hover:text-text mb-8"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {t('certificate.back')}
      </Link>

      <Reveal>
        <div style={{ position: 'relative', marginBottom: 24 }}>
          <div style={{ filter: 'blur(6px)', opacity: 0.5, pointerEvents: 'none', userSelect: 'none' }}>
            <div style={{
              background: WHITE, color: INK, aspectRatio: '1.414 / 1',
              fontFamily: SANS, boxShadow: '0 10px 40px rgba(0,0,0,0.12)',
              display: 'flex', flexDirection: 'column', justifyContent: 'center',
              alignItems: 'center', gap: 24, padding: 56, borderTop: `6px solid ${GREEN}`,
            }}>
              <div style={{ fontSize: 13, letterSpacing: 3, color: GRAY_MED, textTransform: 'uppercase' }}>
                {t('certificate.title')}
              </div>
              <div style={{ fontSize: 44, fontWeight: 300 }}>{t('certificate.sample_name')}</div>
              <div style={{ width: 60, height: 3, background: GREEN, borderRadius: 2 }} />
              <div style={{ fontSize: 15, color: GRAY_MED, maxWidth: 460, textAlign: 'center' }}>
                {t('certificate.completion_text')}
              </div>
            </div>
          </div>

          {/* Lock overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}>
            <div className="surface-card p-8 text-center max-w-sm mx-auto shadow-lg">
              <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-subtle border border-line text-text-muted mb-5">
                <Lock className="h-6 w-6" />
              </div>
              <h1 className="text-[20px] font-semibold tracking-tight mb-2">
                {t('certificate.locked_title')}
              </h1>
              <p className="text-text-muted text-[14px] mb-6">
                {t('certificate.locked_hint', { score: minScore })}
              </p>
              <Button onClick={() => nav(backTo)} size="md">
                {t('certificate.back')}
              </Button>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

export default function Certificate() {
  const { t, i18n } = useTranslation();
  const { courseId, userId: viewUserId } = useParams<{ courseId: string; userId?: string }>();
  const { name, language } = useUserStore();
  // Modo capacitador: se abre /certificate/:courseId/:userId para ver el
  // certificado de un aprendiz (datos vía RPC protegida por dueño/superadmin).
  const trainerMode = !!viewUserId;
  const [course, setCourse] = useState<CourseWithModules | null>(null);
  const [status, setStatus] = useState<CourseCertStatus | null>(null);
  const [learner, setLearner] = useState<CourseEvaluationResult | null>(null);
  const [activity, setActivity] = useState<CourseActivitySummary>({ score: null, completedAt: null });
  const [loading, setLoading] = useState(true);
  const certRef = useRef<HTMLElement>(null);
  const [downloading, setDownloading] = useState(false);
  const backTo = trainerMode
    ? `/admin/courses/${courseId}`
    : courseId ? `/courses` : '/dashboard';

  useEffect(() => {
    let active = true;
    if (!courseId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const load = async () => {
      const c = await getCourseById(courseId);
      if (!active) return;
      setCourse(c);
      const moduleIds = (c?.modules ?? []).map((m) => m.id);

      if (viewUserId) {
        // ── Vista del capacitador ──
        const [rows, act] = await Promise.all([
          getCourseEvaluationResults(courseId).catch(() => [] as CourseEvaluationResult[]),
          getCourseActivitySummary(courseId, moduleIds, viewUserId).catch(
            () => ({ score: null, completedAt: null }) as CourseActivitySummary,
          ),
        ]);
        if (!active) return;
        setLearner(rows.find((r) => r.user_id === viewUserId) ?? null);
        setActivity(act);
        return;
      }

      // ── Vista propia del aprendiz ──
      getCourseActivitySummary(courseId, moduleIds)
        .then((a) => { if (active) setActivity(a); })
        .catch(() => {});
      const st = await getCourseCertStatus(courseId);
      // Auto-emitir si cumple condiciones pero aún no está certificado.
      if (st.all_met && !st.certified) {
        try {
          await issueCertification(courseId);
          const fresh = await getCourseCertStatus(courseId);
          if (active) setStatus(fresh);
        } catch {
          if (active) setStatus(st);
        }
      } else if (active) {
        setStatus(st);
      }
    };

    load()
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
    };
  }, [courseId, viewUserId]);

  if (loading) return null;

  const earned = trainerMode
    ? !!learner?.certified
    : !!status && (status.certified || status.all_met);

  if (!earned) {
    if (trainerMode) {
      return (
        <div className="mx-auto max-w-2xl px-5 pt-16 pb-24 text-center">
          <Link to={backTo} className="inline-flex items-center gap-2 text-[13px] text-text-muted hover:text-text mb-8">
            <ArrowLeft className="h-3.5 w-3.5" /> {t('certificate.back')}
          </Link>
          <div className="surface-card p-8 max-w-sm mx-auto">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-subtle border border-line text-text-muted mb-5">
              <Lock className="h-6 w-6" />
            </div>
            <h1 className="text-[18px] font-semibold tracking-tight mb-2">
              {t('certificate.trainer_not_earned_title')}
            </h1>
            <p className="text-text-muted text-[14px]">
              {t('certificate.trainer_not_earned_hint', { name: learner?.display_name ?? '' })}
            </p>
          </div>
        </div>
      );
    }
    return <LockedPreview minScore={status?.min_score ?? 70} backTo={backTo} />;
  }

  const lang = i18n.resolvedLanguage ?? language;
  const courseTitle = course
    ? pickText(course.title_es, course.title_en, course.title_pt, lang)
    : '';

  // ── Variables unificadas (aprendiz propio / vista del capacitador) ──
  const viewName = trainerMode ? (learner?.display_name || '—') : name;
  const completedCount = trainerMode ? learner!.modules_done : status!.modules_done;
  const totalModules = trainerMode ? learner!.modules_total : status!.modules_total;
  const requireSim = trainerMode
    ? !!course?.cert_conditions?.require_simulator
    : !!status!.require_simulator;
  const simScore = trainerMode ? learner!.best_score : (status!.cert_score ?? status!.best_score);
  // Puntaje "Mejor Puntaje" IDÉNTICO para aprendiz y capacitador (paridad):
  //  - Si el curso exige simulador → el mejor puntaje del simulador.
  //  - Si no → el desempeño real en actividades (quizzes/juegos).
  // En la vista del capacitador el desempeño del aprendiz llega por el RPC
  // get_course_activity_summary (SECURITY DEFINER). Si por algo no viniera,
  // caemos al mejor puntaje registrado del aprendiz para no dejar el dato vacío.
  const scoreValue = requireSim
    ? simScore
    : (activity.score ?? (trainerMode ? (learner?.best_score ?? null) : null));
  const showScore = scoreValue != null && scoreValue > 0;
  // Fecha de finalización: último quiz/juego resuelto; si no hay, la de emisión.
  const issuedAtRaw = trainerMode ? learner?.issued_at : status?.issued_at;
  const dateSource = activity.completedAt ?? issuedAtRaw ?? null;
  const issuedOn = formatDate(dateSource ? new Date(dateSource) : new Date(), lang);
  const certIdSource = trainerMode ? learner?.cert_id : status?.cert_id;
  const certId = (certIdSource ?? `${viewName}-${Date.now()}`).slice(0, 16).toUpperCase();

  const handleDownload = async () => {
    if (!certRef.current || downloading) return;
    setDownloading(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');

      const el = certRef.current;
      const cssW = el.offsetWidth;
      const cssH = el.offsetHeight;

      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        scrollX: 0,
        scrollY: 0,
        width: cssW,
        height: cssH,
      });

      // 1 CSS px = 25.4/96 mm (standard 96 dpi)
      const pxToMm = 25.4 / 96;
      const pdfW = cssW * pxToMm;
      const pdfH = cssH * pxToMm;

      const pdf = new jsPDF({
        orientation: pdfW > pdfH ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [pdfW, pdfH],
      });

      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfW, pdfH);
      pdf.save(`certificado-${viewName.replace(/\s+/g, '-')}.pdf`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-5 pt-10 pb-24">
      {/* Controls */}
      <div className="flex items-center justify-between mb-8">
        <Link
          to={backTo}
          className="inline-flex items-center gap-2 text-[13px] text-text-muted hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {t('certificate.back')}
        </Link>
        <Button onClick={handleDownload} variant="secondary" size="md" disabled={downloading}>
          <Download className="h-4 w-4" />
          {downloading ? t('certificate.downloading') : t('certificate.download')}
        </Button>
      </div>

      <Reveal>
        <article
          ref={certRef}
          style={{
            background: WHITE,
            color: INK,
            position: 'relative',
            width: '100%',
            aspectRatio: '1.414 / 1',
            boxSizing: 'border-box',
            display: 'flex',
            boxShadow: '0 30px 80px rgba(0,0,0,0.18), 0 4px 24px rgba(0,0,0,0.06)',
            fontFamily: SANS,
            overflow: 'hidden',
          }}
        >
          {/* Left accent bar (green → magenta) */}
          <div style={{ width: 14, flexShrink: 0, background: `linear-gradient(180deg, ${GREEN}, ${MAGENTA})` }} />

          {/* Sheet body */}
          <div style={{ flex: 1, position: 'relative', padding: '44px 68px 40px', display: 'flex', flexDirection: 'column' }}>
            {/* Subtle corner mark */}
            <div aria-hidden style={{
              position: 'absolute', top: -70, right: -70, width: 260, height: 260,
              borderRadius: '50%', background: `radial-gradient(circle at 30% 30%, rgba(16,212,81,0.10), transparent 60%)`,
              pointerEvents: 'none',
            }} />
            <div aria-hidden style={{
              position: 'absolute', bottom: -90, left: -40, width: 220, height: 220,
              borderRadius: '50%', background: `radial-gradient(circle at 70% 70%, rgba(179,61,158,0.07), transparent 60%)`,
              pointerEvents: 'none',
            }} />

            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', flex: 1 }}>
              {/* Brand header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <img
                    src="/logo.jpg"
                    alt="LearningAI"
                    style={{ height: 42, width: 42, borderRadius: 10, objectFit: 'cover' }}
                  />
                  <div>
                    <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.4, color: INK, lineHeight: 1 }}>
                      LearningAI
                    </div>
                    <div style={{ fontSize: 10, letterSpacing: 1.5, color: GRAY_MED, textTransform: 'uppercase', marginTop: 3 }}>
                      Academy
                    </div>
                  </div>
                </div>
                <div style={{
                  fontSize: 10.5, letterSpacing: 2, color: GRAY_MED,
                  textTransform: 'uppercase', fontWeight: 600, textAlign: 'right',
                }}>
                  {t('certificate.subtitle')}
                </div>
              </div>

              {/* Title + recipient */}
              <div style={{ marginTop: 'auto', marginBottom: 'auto', paddingTop: 24, paddingBottom: 24 }}>
                <div style={{
                  fontSize: 13, letterSpacing: 4, color: GREEN,
                  textTransform: 'uppercase', fontWeight: 700, marginBottom: 6,
                }}>
                  {t('certificate.title')}
                </div>
                <div style={{ fontSize: 12.5, color: GRAY_MED, marginBottom: 26 }}>
                  {t('certificate.presented_to')}
                </div>

                <div style={{
                  fontSize: 54, fontWeight: 300, letterSpacing: -1,
                  color: INK, lineHeight: 1.05, marginBottom: 18,
                }}>
                  {viewName}
                </div>
                <div style={{ width: 64, height: 3, background: GREEN, borderRadius: 2, marginBottom: 22 }} />

                <p style={{
                  fontSize: 14.5, color: '#4A5650', lineHeight: 1.65,
                  maxWidth: 620, margin: 0,
                }}>
                  {t('certificate.completion_text')}
                </p>

                {courseTitle && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{
                      fontSize: 9.5, letterSpacing: 2, color: GRAY_MED,
                      textTransform: 'uppercase', fontWeight: 600, marginBottom: 4,
                    }}>
                      {t('certificate.program_label')}
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: MAGENTA, letterSpacing: -0.3, lineHeight: 1.15 }}>
                      {courseTitle}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div>
                {/* Meta row — el puntaje solo aplica si el curso exige simulador */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 32,
                  paddingBottom: 22, marginBottom: 22,
                  borderBottom: `1px solid ${GRAY_LIGHT}`,
                }}>
                  <MetaItem
                    label={t('certificate.modules_completed')}
                    value={`${completedCount}/${totalModules}`}
                  />
                  {/* Mejor Puntaje: mismo dato para el aprendiz y para el capacitador */}
                  {showScore && (
                    <>
                      <div style={{ width: 1, height: 34, background: GRAY_LIGHT }} />
                      <MetaItem
                        label={t('certificate.best_score')}
                        value={`${scoreValue}/100`}
                        accent
                      />
                    </>
                  )}
                  <div style={{ width: 1, height: 34, background: GRAY_LIGHT }} />
                  <MetaItem
                    label={t('certificate.completed_label')}
                    value={issuedOn}
                  />
                </div>

                {/* Signatures + badge */}
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
                  <div style={{ flex: 1, maxWidth: 220 }}>
                    <div style={{
                      fontFamily: '"Segoe Script", "Brush Script MT", cursive',
                      fontSize: 26, color: INK, borderBottom: `1.5px solid ${GRAY_MED}`,
                      paddingBottom: 4, marginBottom: 6,
                    }}>
                      Ejemplo 1
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: INK }}>
                      {t('certificate.sig_director')}
                    </div>
                    <div style={{ fontSize: 10, color: GRAY_MED, marginTop: 1 }}>LearningAI Academy</div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <VerifiedBadge />
                    <span style={{ fontSize: 8.5, letterSpacing: 1.5, color: GRAY_MED, textTransform: 'uppercase', fontWeight: 600 }}>
                      {t('certificate.verified')}
                    </span>
                  </div>

                  <div style={{ flex: 1, maxWidth: 220, textAlign: 'right' }}>
                    <div style={{
                      fontFamily: '"Segoe Script", "Brush Script MT", cursive',
                      fontSize: 26, color: INK, borderBottom: `1.5px solid ${GRAY_MED}`,
                      paddingBottom: 4, marginBottom: 6,
                    }}>
                      Ejemplo 2
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: INK }}>
                      {t('certificate.sig_training')}
                    </div>
                    <div style={{ fontSize: 10, color: GRAY_MED, marginTop: 1 }}>LearningAI Academy</div>
                  </div>
                </div>

                {/* Cert id */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  marginTop: 18, fontSize: 9.5, color: GRAY_MED, letterSpacing: 0.5,
                }}>
                  <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1.5 }}>
                    {t('certificate.cert_id_label')}
                  </span>
                  <span style={{ fontFamily: 'monospace', color: INK, letterSpacing: 1 }}>{certId}</span>
                  <span>·</span>
                  <span>{t('certificate.verify_text')}</span>
                </div>
              </div>
            </div>
          </div>
        </article>
      </Reveal>
    </div>
  );
}
