import { useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, Lock, ShieldCheck } from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import {
  useProgressStore,
  selectCertificationEarned,
  selectBestAttempt,
  CERTIFICATION_MIN_SCORE,
} from '@/stores/progressStore';
import { useModules } from '@/hooks/useModules';
import { Button } from '@/components/ui/Button';
import { Reveal } from '@/components/ui/Reveal';

const GOLD = '#C9A052';
const NAVY = '#1C2B4B';
const PARCHMENT = '#FDFAF3';
const MUTED = '#8A7A5A';
const GOLD_SOFT = 'rgba(201,160,82,0.08)';

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

function CornerFlourish() {
  return (
    <svg width="60" height="60" viewBox="0 0 60 60" fill="none" style={{ display: 'block' }}>
      <path d="M4 4 L24 4" stroke={GOLD} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M4 4 L4 24" stroke={GOLD} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M9 9 L20 9" stroke={GOLD} strokeWidth="0.8" strokeLinecap="round" opacity="0.5" />
      <path d="M9 9 L9 20" stroke={GOLD} strokeWidth="0.8" strokeLinecap="round" opacity="0.5" />
      <rect x="10" y="10" width="5" height="5" fill={GOLD} transform="rotate(45 12.5 12.5)" />
      <path d="M20 4 Q24 4 24 8" stroke={GOLD} strokeWidth="0.8" fill="none" opacity="0.4" />
      <path d="M4 20 Q4 24 8 24" stroke={GOLD} strokeWidth="0.8" fill="none" opacity="0.4" />
    </svg>
  );
}

function CertificateSeal() {
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const angle = (i * 360) / 36;
    const rad = (angle * Math.PI) / 180;
    const isLong = i % 3 === 0;
    const r1 = isLong ? 41 : 43;
    return {
      x1: 50 + r1 * Math.cos(rad),
      y1: 50 + r1 * Math.sin(rad),
      x2: 50 + 46 * Math.cos(rad),
      y2: 50 + 46 * Math.sin(rad),
      isLong,
    };
  });

  const starAngles = [0, 72, 144, 216, 288];

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="116" height="116" viewBox="0 0 100 100">
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
            stroke={GOLD}
            strokeWidth={t.isLong ? 1.6 : 0.7}
          />
        ))}
        <circle cx="50" cy="50" r="40" stroke={GOLD} strokeWidth="1.5" fill="none" />
        <circle cx="50" cy="50" r="37" fill={NAVY} />
        <circle cx="50" cy="50" r="32" stroke={GOLD} strokeWidth="0.7" fill="none" opacity="0.4" />
        {starAngles.map((angle) => {
          const rad = ((angle - 90) * Math.PI) / 180;
          return (
            <circle
              key={angle}
              cx={50 + 27 * Math.cos(rad)}
              cy={50 + 27 * Math.sin(rad)}
              r="1.8"
              fill={GOLD}
            />
          );
        })}
        <circle cx="50" cy="50" r="21" fill={PARCHMENT} />
        <circle cx="50" cy="50" r="21" stroke={GOLD} strokeWidth="0.8" fill="none" opacity="0.5" />
      </svg>
      <img
        src="/logo.jpg"
        alt="Positivo S+"
        style={{
          position: 'absolute',
          width: 38,
          height: 38,
          borderRadius: '50%',
          objectFit: 'cover',
          border: `2px solid ${GOLD}`,
        }}
      />
    </div>
  );
}

function LockedPreview() {
  const { t } = useTranslation();
  const nav = useNavigate();

  return (
    <div className="mx-auto max-w-3xl px-5 pt-16 pb-24">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-2 text-[13px] text-text-muted hover:text-text mb-8"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {t('certificate.back')}
      </Link>

      <Reveal>
        {/* Blurred preview */}
        <div style={{ position: 'relative', marginBottom: 24 }}>
          <div style={{ filter: 'blur(6px)', opacity: 0.55, pointerEvents: 'none', userSelect: 'none' }}>
            <div style={{
              background: PARCHMENT, color: NAVY, padding: '40px 48px 32px',
              fontFamily: 'Georgia, serif', boxShadow: '0 10px 40px rgba(0,0,0,0.12)',
            }}>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>
                  LearningAI PositivoS+
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0' }}>
                  <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${GOLD})` }} />
                  <span style={{ color: GOLD, fontSize: 14, letterSpacing: 4 }}>✦ ✦ ✦</span>
                  <div style={{ flex: 1, height: 1, background: `linear-gradient(to left, transparent, ${GOLD})` }} />
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>
                  {t('certificate.title')}
                </div>
              </div>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div style={{ fontSize: 42, fontStyle: 'italic', fontFamily: 'Palatino, serif' }}>
                  Tu Nombre Aquí
                </div>
                <p style={{ fontSize: 13, color: MUTED, maxWidth: 420, margin: '12px auto 0' }}>
                  {t('certificate.completion_text')}
                </p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 20 }}>
                {[t('certificate.modules_completed'), t('certificate.best_score'), t('certificate.issued_label')].map((l, i) => (
                  <div key={i} style={{ border: `1px solid ${GOLD}`, borderRadius: 4, padding: '10px 18px', background: GOLD_SOFT, minWidth: 90, textAlign: 'center' }}>
                    <div style={{ fontSize: 8, letterSpacing: 2, color: MUTED, textTransform: 'uppercase', marginBottom: 6 }}>{l}</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: i === 1 ? GOLD : NAVY }}>—</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Lock overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 16,
          }}>
            <div className="surface-card p-8 text-center max-w-sm mx-auto shadow-lg">
              <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-subtle border border-line text-text-muted mb-5">
                <Lock className="h-6 w-6" />
              </div>
              <h1 className="text-[20px] font-semibold tracking-tight mb-2">
                {t('certificate.locked_title')}
              </h1>
              <p className="text-text-muted text-[14px] mb-6">
                {t('certificate.locked_hint', { score: CERTIFICATION_MIN_SCORE })}
              </p>
              <Button onClick={() => nav('/dashboard')} size="md">
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
  const { name, language } = useUserStore();
  const { modules, loading: modulesLoading } = useModules();
  const progressState = useProgressStore();
  const earned = selectCertificationEarned(progressState, modules);
  const bestAttempt = selectBestAttempt(progressState);
  const completedModules = progressState.completedModules.filter((id) =>
    modules.some((m) => m.id === id),
  );
  const certRef = useRef<HTMLElement>(null);
  const [downloading, setDownloading] = useState(false);

  if (modulesLoading) return null;
  if (!earned) return <LockedPreview />;

  const lang = i18n.resolvedLanguage ?? language;
  const issuedOn = formatDate(new Date(), lang);
  const certId = (bestAttempt?.id ?? `${name}-${Date.now()}`).slice(0, 16).toUpperCase();

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
      pdf.save(`certificado-${name.replace(/\s+/g, '-')}.pdf`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-5 pt-10 pb-24">
      {/* Controls */}
      <div className="flex items-center justify-between mb-8">
        <Link
          to="/dashboard"
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
            background: PARCHMENT,
            color: NAVY,
            position: 'relative',
            padding: '60px 60px 52px',
            boxShadow: '0 30px 80px rgba(0,0,0,0.2), 0 4px 24px rgba(0,0,0,0.08)',
            fontFamily: 'Georgia, "Times New Roman", serif',
          }}
        >
          {/* Outer gold border */}
          <div style={{ position: 'absolute', inset: 10, border: `2.5px solid ${GOLD}`, pointerEvents: 'none' }} />
          {/* Inner thin border */}
          <div style={{ position: 'absolute', inset: 16, border: `0.5px solid ${GOLD}`, opacity: 0.3, pointerEvents: 'none' }} />

          {/* Corner flourishes */}
          <div style={{ position: 'absolute', top: 0, left: 0 }}>
            <CornerFlourish />
          </div>
          <div style={{ position: 'absolute', top: 0, right: 0, transform: 'scaleX(-1)' }}>
            <CornerFlourish />
          </div>
          <div style={{ position: 'absolute', bottom: 0, right: 0, transform: 'scale(-1)' }}>
            <CornerFlourish />
          </div>
          <div style={{ position: 'absolute', bottom: 0, left: 0, transform: 'scaleY(-1)' }}>
            <CornerFlourish />
          </div>

          {/* Watermark */}
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none', overflow: 'hidden',
            }}
          >
            <div style={{
              fontSize: 160, fontWeight: 900, color: NAVY,
              opacity: 0.025, transform: 'rotate(-12deg)',
              letterSpacing: -8, userSelect: 'none', whiteSpace: 'nowrap',
              fontFamily: 'Georgia, serif',
            }}>
              LEARNINGAI
            </div>
          </div>

          {/* ── Main content ─────────────────────────────────── */}
          <div style={{ position: 'relative', zIndex: 1 }}>

            {/* Institution header */}
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 16, marginBottom: 20,
              }}>
                <img
                  src="/logo.jpg"
                  alt="Positivo S+"
                  style={{
                    height: 56, width: 56, borderRadius: 10,
                    objectFit: 'cover', border: `2px solid ${GOLD}`,
                  }}
                />
                <div style={{ textAlign: 'left', borderLeft: `2.5px solid ${GOLD}`, paddingLeft: 16 }}>
                  <div style={{
                    fontSize: 24, fontWeight: 700, letterSpacing: 2.5,
                    color: NAVY, textTransform: 'uppercase', lineHeight: 1.1,
                  }}>
                  LearningAI PositivoS+
                  </div>
                  <div style={{
                    fontSize: 9.5, letterSpacing: 2.5, color: MUTED,
                    textTransform: 'uppercase', marginTop: 4,
                  }}>
                    Five9 Professional Development Center &middot; Powered by Positivo S+
                  </div>
                </div>
              </div>

              {/* Ornamental divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
                <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${GOLD})` }} />
                <span style={{ color: GOLD, fontSize: 18, letterSpacing: 6 }}>✦ ✦ ✦</span>
                <div style={{ flex: 1, height: 1, background: `linear-gradient(to left, transparent, ${GOLD})` }} />
              </div>

              <div style={{ fontSize: 9, letterSpacing: 5.5, color: MUTED, textTransform: 'uppercase', marginBottom: 10 }}>
                {t('certificate.cert_label')}
              </div>
              <h1 style={{
                fontSize: 32, fontWeight: 700, color: NAVY,
                letterSpacing: 3, textTransform: 'uppercase', margin: '0 0 6px',
              }}>
                {t('certificate.title')}
              </h1>
              <div style={{ fontSize: 10.5, letterSpacing: 2.5, color: MUTED, textTransform: 'uppercase' }}>
                {t('certificate.subtitle')}
              </div>
            </div>

            {/* Recipient */}
            <div style={{ textAlign: 'center', marginBottom: 36 }}>
              <div style={{ fontSize: 9.5, letterSpacing: 5, color: MUTED, textTransform: 'uppercase', marginBottom: 14 }}>
                {t('certificate.presented_to')}
              </div>
              <div style={{
                fontSize: 56,
                fontFamily: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
                fontStyle: 'italic',
                fontWeight: 400,
                color: NAVY,
                lineHeight: 1.1,
                paddingBottom: 18,
                borderBottom: `1px solid ${GOLD}`,
                marginBottom: 22,
                maxWidth: 560,
                marginInline: 'auto',
              }}>
                {name}
              </div>
              <p style={{
                fontSize: 15, color: '#4A4030',
                maxWidth: 560, margin: '0 auto', lineHeight: 1.95,
              }}>
                {t('certificate.completion_text')}
              </p>
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 36 }}>
              <div style={{
                border: `1px solid ${GOLD}`, borderRadius: 4,
                padding: '16px 24px', textAlign: 'center',
                background: GOLD_SOFT, flex: 1, maxWidth: 200,
              }}>
                <div style={{ fontSize: 9, letterSpacing: 3, color: MUTED, textTransform: 'uppercase', marginBottom: 10, lineHeight: 1.5 }}>
                  {t('certificate.modules_completed')}
                </div>
                <div style={{ fontSize: 42, fontWeight: 700, color: NAVY, lineHeight: 1 }}>
                  {completedModules.length}
                </div>
                <div style={{ fontSize: 10, color: MUTED, marginTop: 5 }}>
                  {t('certificate.of_total', { total: modules.length })}
                </div>
              </div>

              <div style={{
                border: `1px solid ${GOLD}`, borderRadius: 4,
                padding: '16px 24px', textAlign: 'center',
                background: GOLD_SOFT, flex: 1, maxWidth: 200,
              }}>
                <div style={{ fontSize: 9, letterSpacing: 3, color: MUTED, textTransform: 'uppercase', marginBottom: 10, lineHeight: 1.5 }}>
                  {t('certificate.best_score')}
                </div>
                <div style={{ fontSize: 42, fontWeight: 700, color: GOLD, lineHeight: 1 }}>
                  {bestAttempt?.score ?? 0}
                </div>
                <div style={{ fontSize: 10, color: MUTED, marginTop: 5 }}>
                  {t('certificate.score_unit')}
                </div>
              </div>

              <div style={{
                border: `1px solid ${GOLD}`, borderRadius: 4,
                padding: '16px 24px', textAlign: 'center',
                background: GOLD_SOFT, flex: 1, maxWidth: 200,
              }}>
                <div style={{ fontSize: 9, letterSpacing: 3, color: MUTED, textTransform: 'uppercase', marginBottom: 10, lineHeight: 1.5 }}>
                  {t('certificate.issued_label')}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: NAVY, lineHeight: 1.5 }}>
                  {issuedOn}
                </div>
              </div>
            </div>

            {/* Divider */}
            <div style={{ marginBottom: 32 }}>
              <div style={{ height: 1, background: `linear-gradient(to right, transparent, ${GOLD} 20%, ${GOLD} 80%, transparent)` }} />
            </div>

            {/* Signatures + Seal */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 1fr', gap: 28, alignItems: 'end' }}>
              {/* Left signature */}
              <div>
                <div style={{ borderBottom: `1.5px solid ${GOLD}`, paddingBottom: 8, marginBottom: 10, minHeight: 52 }}>
                  <div style={{
                    fontFamily: '"Brush Script MT", "Segoe Script", cursive, serif',
                    fontSize: 34, color: NAVY, lineHeight: 1.2,
                  }}>
                    Ejemplo 1
                  </div>
                </div>
                <div style={{ fontSize: 9, letterSpacing: 2.5, color: MUTED, textTransform: 'uppercase' }}>
                  {t('certificate.sig_director')}
                </div>
                <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3 }}>LearningAI PositivoS+</div>
              </div>

              {/* Seal */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <CertificateSeal />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ShieldCheck size={11} color={GOLD} />
                  <span style={{ fontSize: 8, letterSpacing: 2, color: MUTED, textTransform: 'uppercase' }}>
                    {t('certificate.verified')}
                  </span>
                </div>
              </div>

              {/* Right signature */}
              <div style={{ textAlign: 'right' }}>
                <div style={{ borderBottom: `1.5px solid ${GOLD}`, paddingBottom: 8, marginBottom: 10, minHeight: 52 }}>
                  <div style={{
                    fontFamily: '"Brush Script MT", "Segoe Script", cursive, serif',
                    fontSize: 34, color: NAVY, lineHeight: 1.2,
                  }}>
                    Ejemplo 2
                  </div>
                </div>
                <div style={{ fontSize: 9, letterSpacing: 2.5, color: MUTED, textTransform: 'uppercase' }}>
                  {t('certificate.sig_training')}
                </div>
                <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3 }}>Five9 · Positivo S+</div>
              </div>
            </div>

            {/* Certificate ID */}
            <div style={{ textAlign: 'center', marginTop: 28 }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 14,
                borderTop: `1px solid ${GOLD}`, paddingTop: 14,
              }}>
                <span style={{ fontSize: 8.5, letterSpacing: 3, color: MUTED, textTransform: 'uppercase' }}>
                  {t('certificate.cert_id_label')}
                </span>
                <span style={{ fontSize: 9, fontFamily: 'monospace', color: NAVY, letterSpacing: 2 }}>
                  {certId}
                </span>
                <span style={{ fontSize: 9, color: MUTED }}>·</span>
                <span style={{ fontSize: 8.5, letterSpacing: 2, color: MUTED }}>
                  {t('certificate.verify_text')}
                </span>
              </div>
            </div>
          </div>
        </article>
      </Reveal>
    </div>
  );
}
