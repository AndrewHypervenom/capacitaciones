import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, Lock, Linkedin, Link2 } from 'lucide-react';
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
import { useProgressStore } from '@/stores/progressStore';
import { CertificateSheet } from '@/components/certificate/CertificateSheet';

function pickText(es: string | null, en: string | null, pt: string | null, lang: string): string {
  if (lang === 'en') return en || es || '';
  if (lang === 'pt') return pt || es || '';
  return es || '';
}

// ── Corporate palette (usada por LockedPreview) ──────────
const GREEN = '#10D451';
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
  const [copied, setCopied] = useState(false);
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

  // Logros de certificación: solo para el aprendiz mirando su PROPIO certificado
  // ya ganado. "Certificado" al obtenerlo; "Cuadro de Honor" si el puntaje ≥95%.
  const recordCertification = useProgressStore((s) => s.recordCertification);
  useEffect(() => {
    if (trainerMode || !status || !courseId) return;
    const earnedCert = status.certified || status.all_met;
    if (!earnedCert) return;
    // Registra la certificación + su puntaje; el motor otorga "Certificado",
    // "Cuadro de Honor" (≥95%) y cualquier logro de certificación configurado.
    const requireSim = !!status.require_simulator;
    const score = requireSim ? (status.cert_score ?? status.best_score) : activity.score;
    recordCertification(courseId, score);
  }, [trainerMode, status, courseId, activity.score, recordCertification]);

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

  // Enlace público verificable (para LinkedIn). Solo si hay cert_id real emitido.
  const shareUrl = certIdSource
    ? `${window.location.origin}/verify/${certIdSource}`
    : null;
  const linkedInShareUrl = () =>
    `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl ?? '')}`;

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard bloqueado */ }
  };

  return (
    <div className="mx-auto max-w-6xl px-5 pt-10 pb-24">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <Link
          to={backTo}
          className="inline-flex items-center gap-2 text-[13px] text-text-muted hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {t('certificate.back')}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {/* Compartir en LinkedIn — solo para el aprendiz dueño del certificado */}
          {!trainerMode && shareUrl && (
            <>
              <Button
                onClick={() => window.open(linkedInShareUrl(), '_blank', 'noopener')}
                size="md"
                style={{ background: '#0A66C2', borderColor: '#0A66C2', color: '#fff' }}
              >
                <Linkedin className="h-4 w-4" />
                {t('certificate.share_linkedin')}
              </Button>
              <Button onClick={handleCopyLink} variant="secondary" size="md">
                <Link2 className="h-4 w-4" />
                {copied ? t('certificate.link_copied') : t('certificate.copy_link')}
              </Button>
            </>
          )}
          <Button onClick={handleDownload} variant="secondary" size="md" disabled={downloading}>
            <Download className="h-4 w-4" />
            {downloading ? t('certificate.downloading') : t('certificate.download')}
          </Button>
        </div>
      </div>

      <Reveal>
        <CertificateSheet
          ref={certRef}
          viewName={viewName}
          courseTitle={courseTitle}
          completedCount={completedCount}
          totalModules={totalModules}
          showScore={showScore}
          scoreValue={scoreValue}
          issuedOn={issuedOn}
          certId={certId}
          verifyUrl={shareUrl ?? undefined}
        />
      </Reveal>
    </div>
  );
}
