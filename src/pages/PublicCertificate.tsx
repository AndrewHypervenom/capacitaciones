import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, Linkedin, Link2, ShieldCheck, AlertCircle } from 'lucide-react';
import { getPublicCertificate } from '@/services/certification.service';
import type { PublicCertificate as PublicCert } from '@/types/database';
import { Button } from '@/components/ui/Button';
import { CertificateSheet } from '@/components/certificate/CertificateSheet';
import { CertificateFrame, downloadCertificatePdf } from '@/components/certificate/CertificateFrame';

const SUPPORTED_LANGS = ['es', 'en', 'pt'];

function pickText(es: string, en: string | null, pt: string | null, lang: string): string {
  if (lang === 'en') return en || es;
  if (lang === 'pt') return pt || es;
  return es;
}

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

/**
 * Página PÚBLICA de verificación de un certificado (/verify/:certId).
 * No requiere sesión: es la que se comparte en LinkedIn para que un reclutador
 * vea el certificado y compruebe su autenticidad. Los datos llegan por el RPC
 * `get_public_certificate` (SECURITY DEFINER, solo expone datos no sensibles).
 */
export default function PublicCertificate() {
  const { i18n } = useTranslation();
  const { certId } = useParams<{ certId: string }>();
  const [params] = useSearchParams();
  // El enlace compartido lleva el idioma en que se emitió (`?lang=`): un
  // certificado en español debe verse en español aunque quien lo abra tenga el
  // navegador en inglés. Sin `?lang=` (enlaces viejos) se usa el del visitante.
  const linkLang = params.get('lang');
  const lang = SUPPORTED_LANGS.includes(linkLang ?? '')
    ? (linkLang as string)
    : (i18n.resolvedLanguage ?? 'es');
  // `getFixedT` traduce en ese idioma sin cambiar el del sitio para el visitante.
  const t = i18n.getFixedT(lang);
  const [cert, setCert] = useState<PublicCert | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const certRef = useRef<HTMLElement>(null);

  // La página se sirve con <html lang="es"> fijo; aquí el idioma lo manda el
  // enlace, así que hay que declararlo (lectores de pantalla, rastreadores).
  useEffect(() => {
    const prev = document.documentElement.lang;
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = prev; };
  }, [lang]);

  useEffect(() => {
    let active = true;
    if (!certId) { setLoading(false); setNotFound(true); return; }
    setLoading(true);
    getPublicCertificate(certId)
      .then((c) => {
        if (!active) return;
        if (!c) setNotFound(true);
        else setCert(c);
      })
      .catch(() => { if (active) setNotFound(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [certId]);

  // Al recompartir (o al escanear el QR) el idioma debe viajar con el enlace,
  // incluso si llegamos por un enlace viejo que no traía `?lang=`.
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/verify/${certId}?lang=${lang}`
    : '';

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard bloqueado */ }
  };

  const handleDownload = async () => {
    if (!certRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadCertificatePdf(
        certRef.current,
        `certificado-${(cert?.display_name ?? 'positivos').replace(/\s+/g, '-')}.pdf`,
      );
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-text-muted">
        {t('common.loading')}
      </div>
    );
  }

  if (notFound || !cert) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-subtle border border-line text-text-muted mb-5">
          <AlertCircle className="h-6 w-6" />
        </div>
        <h1 className="text-[20px] font-semibold tracking-tight mb-2">
          {t('public_certificate.not_found_title')}
        </h1>
        <p className="text-text-muted text-[14px] max-w-sm mb-6">
          {t('public_certificate.not_found_hint')}
        </p>
        <Link to="/">
          <Button variant="secondary" size="md">{t('public_certificate.go_home')}</Button>
        </Link>
      </div>
    );
  }

  const courseTitle = pickText(cert.title_es, cert.title_en, cert.title_pt, lang);
  const issuedOn = formatDate(new Date(cert.issued_at), lang);
  const showScore = cert.score > 0;
  const displayCertId = cert.cert_id.slice(0, 16).toUpperCase();

  const linkedInShareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;

  return (
    <div className="min-h-screen bg-canvas">
      {/* Barra pública */}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.jpg" alt="LearningAI" className="h-8 w-8 rounded-lg object-cover" />
            <div className="text-[15px] font-bold tracking-tight">LearningAI Academy</div>
          </div>
          <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: '#10D451' }}>
            <ShieldCheck className="h-4 w-4" />
            {t('public_certificate.verified_badge')}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 pt-10 pb-24">
        <div className="mb-6 text-center">
          <h1 className="text-[24px] font-semibold tracking-tight">
            {t('public_certificate.heading', { name: cert.display_name })}
          </h1>
          <p className="text-text-muted text-[14px] mt-1.5">
            {t('public_certificate.subheading', { course: courseTitle })}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
          <Button
            onClick={() => window.open(linkedInShareUrl, '_blank', 'noopener')}
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
          <Button onClick={handleDownload} variant="secondary" size="md" disabled={downloading}>
            <Download className="h-4 w-4" />
            {downloading ? t('certificate.downloading') : t('certificate.download')}
          </Button>
        </div>

        <CertificateFrame>
          <CertificateSheet
            ref={certRef}
            viewName={cert.display_name}
            courseTitle={courseTitle}
            completedCount={cert.modules_total}
            totalModules={cert.modules_total}
            showScore={showScore}
            scoreValue={cert.score}
            issuedOn={issuedOn}
            certId={displayCertId}
            verifyUrl={shareUrl}
            lang={lang}
          />
        </CertificateFrame>

        {/* Franja de autenticidad */}
        <div className="surface-card mt-8 mx-auto max-w-2xl flex items-center gap-3 px-5 py-4">
          <ShieldCheck className="h-5 w-5 shrink-0" style={{ color: '#10D451' }} />
          <p className="text-text-muted text-[12.5px] leading-relaxed">
            {t('public_certificate.authenticity', { id: displayCertId })}
          </p>
        </div>
      </div>
    </div>
  );
}
