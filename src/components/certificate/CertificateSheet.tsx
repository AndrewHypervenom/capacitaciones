import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { Check } from 'lucide-react';

// ── Corporate palette ────────────────────────────────────
const GREEN = '#10D451';
const MAGENTA = '#B33D9E';
const GRAY_LIGHT = '#E0EBE7';
const GRAY_MED = '#A1ADAD';
const WHITE = '#FFFFFF';
const INK = '#16211D';

const SANS =
  '"Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

export interface CertificateSheetData {
  viewName: string;
  courseTitle: string;
  completedCount: number;
  totalModules: number;
  showScore: boolean;
  scoreValue: number | null;
  issuedOn: string;
  /** Código público del certificado (para mostrar). */
  certId: string;
  /** URL pública verificable → se codifica en el QR. Si falta, no se muestra QR. */
  verifyUrl?: string;
}

/** Clean, modern verification badge (LearningAI mark + check ring). */
function VerifiedBadge() {
  return (
    <div style={{ position: 'relative', width: 72, height: 72 }}>
      <svg width="72" height="72" viewBox="0 0 100 100" style={{ display: 'block' }}>
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
          position: 'absolute', top: 14, left: 14, width: 44, height: 44,
          borderRadius: '50%', objectFit: 'cover',
        }}
      />
      <div style={{
        position: 'absolute', right: -2, bottom: -2, width: 24, height: 24,
        borderRadius: '50%', background: GREEN, border: `2.5px solid ${WHITE}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Check size={13} color={WHITE} strokeWidth={3.5} />
      </div>
    </div>
  );
}

/**
 * Sello oficial PositivoS+ — reemplaza a las firmas manuscritas.
 * Estampa circular con doble anillo, texto curvo (textPath), anillo de estrellas
 * y monograma central. Ligeramente rotado y con brillo para leer como un sello
 * en relieve auténtico.
 */
function PositivoSeal({ label, sub }: { label: string; sub: string }) {
  const R_TEXT_TOP = 82;   // radio del texto superior
  const R_TEXT_BOT = 82;   // radio del texto inferior
  const stars = Array.from({ length: 28 });

  return (
    <div style={{ position: 'relative', width: 176, height: 176 }}>
      <svg
        width="176" height="176" viewBox="0 0 200 200"
        style={{ display: 'block', transform: 'rotate(-7deg)' }}
      >
        <defs>
          <linearGradient id="sealGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={GREEN} />
            <stop offset="1" stopColor={MAGENTA} />
          </linearGradient>
          <radialGradient id="sealFace" cx="38%" cy="32%" r="75%">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="0.72" stopColor="#F4FBF7" />
            <stop offset="1" stopColor="#E7F4EC" />
          </radialGradient>
          {/* Curvas para el texto (superior de izq→der, inferior invertida). */}
          <path id="sealTop" fill="none"
            d={`M ${100 - R_TEXT_TOP} 100 A ${R_TEXT_TOP} ${R_TEXT_TOP} 0 0 1 ${100 + R_TEXT_TOP} 100`} />
          <path id="sealBot" fill="none"
            d={`M ${100 - R_TEXT_BOT} 100 A ${R_TEXT_BOT} ${R_TEXT_BOT} 0 0 0 ${100 + R_TEXT_BOT} 100`} />
        </defs>

        {/* Cara del sello */}
        <circle cx="100" cy="100" r="94" fill="url(#sealFace)" />
        {/* Anillos degradados */}
        <circle cx="100" cy="100" r="94" fill="none" stroke="url(#sealGrad)" strokeWidth="5" />
        <circle cx="100" cy="100" r="70" fill="none" stroke="url(#sealGrad)" strokeWidth="2" opacity="0.9" />
        <circle cx="100" cy="100" r="65" fill="none" stroke={GRAY_LIGHT} strokeWidth="1" />

        {/* Anillo de estrellas entre los dos aros */}
        <g fill={MAGENTA}>
          {stars.map((_, i) => {
            const a = (i / stars.length) * Math.PI * 2;
            const r = 82;
            const x = 100 + Math.cos(a) * r;
            const y = 100 + Math.sin(a) * r;
            return <circle key={i} cx={x} cy={y} r={1.1} opacity={0.5} />;
          })}
        </g>

        {/* Texto curvo */}
        <text fontFamily={SANS} fontSize="12.5" fontWeight={800}
          letterSpacing="2.5" fill={GREEN}>
          <textPath href="#sealTop" startOffset="50%" textAnchor="middle">
            {label}
          </textPath>
        </text>
        <text fontFamily={SANS} fontSize="9" fontWeight={700}
          letterSpacing="2.5" fill={MAGENTA}>
          <textPath href="#sealBot" startOffset="50%" textAnchor="middle">
            {sub}
          </textPath>
        </text>

        {/* Monograma central */}
        <g textAnchor="middle" fontFamily={SANS}>
          <text x="100" y="104" fontSize="26" fontWeight={900} fill={INK} letterSpacing="-0.5">
            Positivo<tspan fill={GREEN}>S</tspan><tspan fill={MAGENTA}>+</tspan>
          </text>
        </g>
        {/* Check de autenticidad */}
        <g transform="translate(100 134)">
          <circle cx="0" cy="0" r="9" fill={GREEN} />
          <path d="M -4 0 L -1 3 L 4.5 -3.5" fill="none" stroke={WHITE} strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
      {/* Brillo sutil para efecto relieve */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0, borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(circle at 34% 28%, rgba(255,255,255,0.55), transparent 46%)',
      }} />
    </div>
  );
}

/** Código QR de verificación (apunta a la página pública /verify/:certId). */
function VerifyQR({ url, caption }: { url: string; caption: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{
        padding: 7, background: WHITE, borderRadius: 10,
        border: `1px solid ${GRAY_LIGHT}`, boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
      }}>
        <QRCodeSVG value={url} size={84} level="M" fgColor={INK} bgColor={WHITE} />
      </div>
      <span style={{
        fontSize: 8, letterSpacing: 1.2, color: GRAY_MED, textTransform: 'uppercase',
        fontWeight: 600, maxWidth: 110, textAlign: 'center', lineHeight: 1.4,
      }}>
        {caption}
      </span>
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

/**
 * Hoja del certificado (A4 apaisado). Presentacional y sin dependencias de
 * sesión, de modo que la usa tanto la vista privada (Certificate.tsx) como la
 * página pública verificable (PublicCertificate.tsx). El `ref` apunta al
 * <article> para exportarlo a PDF.
 */
export const CertificateSheet = forwardRef<HTMLElement, CertificateSheetData>(
  function CertificateSheet(
    { viewName, courseTitle, completedCount, totalModules, showScore, scoreValue, issuedOn, certId, verifyUrl },
    ref,
  ) {
    const { t } = useTranslation();

    return (
      <article
        ref={ref}
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
          {/* Subtle corner marks */}
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
                paddingBottom: 22, marginBottom: 18,
                borderBottom: `1px solid ${GRAY_LIGHT}`,
              }}>
                <MetaItem
                  label={t('certificate.modules_completed')}
                  value={`${completedCount}/${totalModules}`}
                />
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

              {/* Sello oficial PositivoS+ (izq) + QR verificable / insignia (der) */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <PositivoSeal
                    label={t('certificate.seal_label')}
                    sub={t('certificate.seal_sub')}
                  />
                  <div style={{ maxWidth: 190 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: INK, letterSpacing: -0.2 }}>
                      {t('certificate.seal_issuer')}
                    </div>
                    <div style={{ fontSize: 10.5, color: GRAY_MED, lineHeight: 1.5, marginTop: 3 }}>
                      {t('certificate.seal_caption')}
                    </div>
                  </div>
                </div>

                {verifyUrl ? (
                  <VerifyQR url={verifyUrl} caption={t('certificate.scan_to_verify')} />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <VerifiedBadge />
                    <span style={{ fontSize: 8.5, letterSpacing: 1.5, color: GRAY_MED, textTransform: 'uppercase', fontWeight: 600 }}>
                      {t('certificate.verified')}
                    </span>
                  </div>
                )}
              </div>

              {/* Cert id */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                marginTop: 16, fontSize: 9.5, color: GRAY_MED, letterSpacing: 0.5,
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
    );
  },
);
