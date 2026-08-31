import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { QRCodeSVG } from 'qrcode.react';

// ── Corporate palette ────────────────────────────────────
const GREEN = '#10D451';
const MAGENTA = '#B33D9E';
const GRAY_LIGHT = '#E2E8E5';
const GRAY_MED = '#8A9694';
const WHITE = '#FFFFFF';
const INK = '#0E1512';

const SANS =
  '"Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

/** Logo oficial PositivoS+ (1446×226). Vive en /public para que exista en producción. */
const LOGO_SRC = '/positivos-logo.png';
const LOGO_RATIO = 1446 / 226;

/** Logo del sello inferior derecho (1264×197). Reemplaza al monograma escrito. */
const SEAL_LOGO_SRC = '/positivos-logo-sello.png';

export interface CertificateSheetData {
  viewName: string;
  /** Documento de identidad de quien recibe el certificado (cédula, CURP…). */
  nationalId?: string | null;
  courseTitle: string;
  /**
   * Módulos aprobados / totales al emitir. El certificado impreso no los
   * muestra, pero se siguen recibiendo: son el dato con el que se decide si el
   * certificado quedó desfasado (recertificación) y evita tocar los llamadores
   * si se quisieran volver a imprimir.
   */
  completedCount: number;
  totalModules: number;
  showScore: boolean;
  scoreValue: number | null;
  issuedOn: string;
  /**
   * Intensidad horaria del curso, en MINUTOS (suma de `modules.duration_min`).
   * Si es 0 o falta, el dato simplemente no se imprime: un certificado sin
   * duración es preferible a uno que diga "0 horas".
   */
  durationMin?: number | null;
  /** Código público del certificado (para mostrar). */
  certId: string;
  /** URL pública verificable → se codifica en el QR. Si falta, no se muestra QR. */
  verifyUrl?: string;
  /**
   * Fuerza el idioma de la hoja ('es' | 'en' | 'pt'). Lo usa la página pública
   * para respetar el `?lang=` del enlace compartido. Si se omite, se usa el
   * idioma activo del sitio.
   */
  lang?: string;
}

/**
 * Minutos → texto de intensidad horaria. Por debajo de una hora se imprime en
 * minutos (decir "0,5 horas" en un diploma se lee raro); a partir de ahí en
 * horas, con un decimal solo cuando no es exacto (2 h / 2,5 h).
 */
function formatDuration(min: number, t: TFunction): string {
  if (min < 60) return t('certificate.duration_minutes', { count: min });
  const hours = Math.round((min / 60) * 10) / 10;
  const count = Number.isInteger(hours) ? hours : Number(hours.toFixed(1));
  return t('certificate.duration_hours', { count });
}

/**
 * Sello oficial PositivoS+ — es la marca de que Positivo certifica el
 * documento; reemplaza a las firmas manuscritas del certificado impreso.
 * Estampa circular con doble anillo, texto curvo (textPath), anillo de estrellas
 * y el logo corporativo al centro.
 */
function PositivoSeal({ label, sub, size = 118 }: { label: string; sub: string; size?: number }) {
  const R_TEXT = 82;
  const stars = Array.from({ length: 28 });

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg
        width={size} height={size} viewBox="0 0 200 200"
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
            d={`M ${100 - R_TEXT} 100 A ${R_TEXT} ${R_TEXT} 0 0 1 ${100 + R_TEXT} 100`} />
          <path id="sealBot" fill="none"
            d={`M ${100 - R_TEXT} 100 A ${R_TEXT} ${R_TEXT} 0 0 0 ${100 + R_TEXT} 100`} />
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
            const x = 100 + Math.cos(a) * 82;
            const y = 100 + Math.sin(a) * 82;
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

      </svg>
      {/* Logo corporativo en el centro del sello. Va como <img> HTML encima del
          SVG (no como <image> dentro de él): html2canvas serializa el SVG y
          perdería la imagen externa al exportar el PDF. Va derecho a propósito:
          la estampa gira -7°, el logo no. */}
      <img
        src={SEAL_LOGO_SRC}
        alt="Positivo S+"
        style={{
          position: 'absolute',
          left: '50%', top: '50%',
          width: '58%',
          transform: 'translate(-50%, -50%)',
          objectFit: 'contain',
        }}
      />
      {/* Brillo sutil para efecto relieve */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0, borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(circle at 34% 28%, rgba(255,255,255,0.55), transparent 46%)',
      }} />
    </div>
  );
}

/** Código QR de verificación (apunta a la página pública /verify/:certId). */
function VerifyQR({ url }: { url: string }) {
  return (
    <div style={{
      padding: 6, background: WHITE, borderRadius: 8,
      border: `1px solid ${GRAY_LIGHT}`, flexShrink: 0,
    }}>
      <QRCodeSVG value={url} size={82} level="M" fgColor={INK} bgColor={WHITE} />
    </div>
  );
}

/** Dato de la fila inferior (módulos / calificación / horas / fecha). */
function MetaItem({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 118 }}>
      <div style={{
        fontSize: 9, letterSpacing: 1.6, color: GRAY_MED,
        textTransform: 'uppercase', fontWeight: 700, marginBottom: 5,
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
 * Hoja del certificado (A4 apaisado, 1123 × 794 px de diseño). Replica el
 * certificado corporativo de Positivo S+: marco degradado (magenta → negro →
 * verde), tarjeta blanca de esquinas muy redondeadas y todo el contenido
 * centrado. No lleva firmas manuscritas: la autoría la respalda el sello
 * oficial + el QR verificable.
 *
 * Es presentacional y sin dependencias de sesión, de modo que la usa tanto la
 * vista privada (Certificate.tsx) como la página pública verificable
 * (PublicCertificate.tsx). El `ref` apunta al <article> para exportarlo a PDF.
 */
export const CertificateSheet = forwardRef<HTMLElement, CertificateSheetData>(
  function CertificateSheet(
    { viewName, nationalId, courseTitle, completedCount, totalModules, showScore, scoreValue, issuedOn, durationMin, certId, verifyUrl, lang },
    ref,
  ) {
    // `lng` devuelve un `t` fijo a ese idioma SIN cambiar el idioma global:
    // el visitante que abre un certificado compartido en otro idioma no debe
    // ver cómo se le cambia el sitio entero.
    const { t } = useTranslation(undefined, lang ? { lng: lang } : undefined);
    const hasDuration = !!durationMin && durationMin > 0;

    return (
      <article
        ref={ref}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '1.414 / 1',
          boxSizing: 'border-box',
          padding: 30,
          // Marco degradado del certificado corporativo: verde en la esquina
          // superior derecha, magenta bajando por el flanco izquierdo, negro
          // en el resto. Son radial-gradients (no conic) porque html2canvas
          // sabe rasterizar estos y así el PDF sale idéntico a la pantalla.
          background: `
            radial-gradient(58% 78% at 100% 0%, ${GREEN} 0%, rgba(16,212,81,0.5) 16%, rgba(6,20,12,0) 44%),
            radial-gradient(60% 110% at 0% 22%, ${MAGENTA} 0%, rgba(179,61,158,0.72) 22%, rgba(12,6,12,0) 58%),
            radial-gradient(55% 70% at 8% 100%, rgba(179,61,158,0.55) 0%, rgba(12,6,12,0) 60%),
            radial-gradient(45% 60% at 100% 100%, rgba(179,61,158,0.35) 0%, rgba(12,6,12,0) 65%),
            #07090A
          `,
          fontFamily: SANS,
          color: INK,
          overflow: 'hidden',
        }}
      >
        {/* Tarjeta blanca */}
        <div style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          background: WHITE,
          borderRadius: 76,
          padding: '34px 92px 34px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}>
          {/* Logo oficial */}
          <img
            src={LOGO_SRC}
            alt="Positivo S+"
            style={{ width: 246, height: 246 / LOGO_RATIO, objectFit: 'contain' }}
          />

          {/* Cuerpo. El título arranca pegado al logo (como en el certificado
              impreso), NO centrado en el espacio libre: el aire sobrante se
              reparte más abajo, con el separador flexible previo a los datos. */}
          <div style={{
            marginTop: 50,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
          }}>
            <h1 style={{
              margin: 0,
              fontSize: 40,
              fontWeight: 400,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              color: INK,
              lineHeight: 1.15,
            }}>
              {t('certificate.title')}
            </h1>

            {/* Filete verde */}
            <div style={{ width: 372, height: 2, background: GREEN, margin: '18px 0 16px' }} />

            <div style={{
              fontSize: 14.5, letterSpacing: 0.6, color: '#2B3733', textTransform: 'uppercase',
            }}>
              {t('certificate.presented_to')}
            </div>

            {/* Nombre y documento de identidad */}
            <div style={{
              marginTop: 20,
              fontSize: 50,
              fontWeight: 700,
              letterSpacing: -0.6,
              color: INK,
              lineHeight: 1.12,
            }}>
              {viewName}
            </div>
            {nationalId && (
              <div style={{ marginTop: 7, fontSize: 13, color: '#5A6763', letterSpacing: 0.3 }}>
                {t('certificate.document_label')} {nationalId}
              </div>
            )}

            {/* Programa completado — una sola línea, como el certificado impreso */}
            <div style={{
              marginTop: 26, fontSize: 21, letterSpacing: 0.4,
              textTransform: 'uppercase', color: INK, lineHeight: 1.35, maxWidth: 860,
            }}>
              {t('certificate.for_completing', { course: courseTitle })}
            </div>

            {/* Línea de otorgamiento */}
            <div style={{
              marginTop: 14, fontSize: 13, color: '#4A5650', lineHeight: 1.5, maxWidth: 780,
            }}>
              {hasDuration
                ? t('certificate.offered_by_hours', { hours: formatDuration(durationMin!, t) })
                : t('certificate.offered_by')}
            </div>

          </div>

          <div style={{ flex: 1, minHeight: 26 }} />

          {/* Datos del logro */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 34,
            paddingBottom: 20,
          }}>
            <MetaItem
              label={t('certificate.modules_completed')}
              value={`${completedCount}/${totalModules}`}
            />
            {showScore && (
              <>
                <div style={{ width: 1, height: 32, background: GRAY_LIGHT }} />
                <MetaItem
                  label={t('certificate.best_score')}
                  value={`${scoreValue}/100`}
                  accent
                />
              </>
            )}
            {hasDuration && (
              <>
                <div style={{ width: 1, height: 32, background: GRAY_LIGHT }} />
                <MetaItem
                  label={t('certificate.duration_label')}
                  value={formatDuration(durationMin!, t)}
                />
              </>
            )}
            <div style={{ width: 1, height: 32, background: GRAY_LIGHT }} />
            <MetaItem
              label={t('certificate.completed_label')}
              value={issuedOn}
            />
          </div>

          {/* Pie: QR verificable (izq) · sello oficial (der). Sin firmas: lo que
              respalda el documento es el sello + la verificación en línea. */}
          <div style={{
            width: '100%',
            borderTop: `1px solid ${GRAY_LIGHT}`,
            paddingTop: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left' }}>
              {verifyUrl && <VerifyQR url={verifyUrl} />}
              <div style={{ fontSize: 9.5, color: GRAY_MED, lineHeight: 1.7 }}>
                {/* Sin QR (certificado aún sin `cert_id` emitido) no tiene
                    sentido invitar a escanear nada. */}
                {verifyUrl && (
                  <div style={{
                    fontSize: 8.5, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: 700,
                    color: GREEN, marginBottom: 2,
                  }}>
                    {t('certificate.scan_to_verify')}
                  </div>
                )}
                <div style={{ fontWeight: 700, color: '#42504C' }}>
                  {t('certificate.cert_id_label')}{' '}
                  <span style={{ fontFamily: 'monospace', letterSpacing: 0.6 }}>{certId}</span>
                </div>
                <div>{t('certificate.registry_line')}</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}>
              <div style={{ maxWidth: 178 }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: INK, letterSpacing: -0.1 }}>
                  {t('certificate.seal_issuer')}
                </div>
                <div style={{ fontSize: 9.5, color: GRAY_MED, lineHeight: 1.5, marginTop: 3 }}>
                  {t('certificate.seal_caption')}
                </div>
              </div>
              <PositivoSeal
                label={t('certificate.seal_label')}
                sub={t('certificate.seal_sub')}
                size={128}
              />
            </div>
          </div>
        </div>
      </article>
    );
  },
);
