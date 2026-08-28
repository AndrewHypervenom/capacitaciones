import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Award, Download, ExternalLink, Link2, Linkedin, Loader2, ShieldCheck, X,
} from 'lucide-react';
import { getCourseById, type CourseWithModules } from '@/services/courses.service';
import type { UserCertificate } from '@/services/certification.service';
import { CertificateSheet } from '@/components/certificate/CertificateSheet';
import { CertificateFrame, downloadCertificatePdf } from '@/components/certificate/CertificateFrame';
import { Button } from '@/components/ui/Button';
import { EntityIcon } from '@/components/ui/EntityIcon';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { backdropDismiss } from '@/lib/backdropDismiss';
import { pickLang } from '@/lib/contentLang';

/* ────────────────────────────────────────────────────────────────────────
   Vitrina de certificados: los certificados se tratan como logros, no como
   filas de una tabla. Cada tarjeta es un diploma en miniatura y se abre en
   un visor sobre la misma página (sin perder el contexto del perfil), con
   descarga en PDF, enlace público verificable y compartir en LinkedIn.
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Título del curso en el idioma activo. El respaldo importa: si la RLS no dejó
 * leer la fila del curso, el título llega vacío y una tarjeta sin nombre se ve
 * rota — es preferible el rótulo genérico.
 */
function pickTitle(c: UserCertificate, lang: string, fallback: string): string {
  return pickLang(c.titleEs, c.titleEn, c.titlePt, lang) || fallback;
}

function fmtDate(iso: string, lang: string) {
  try {
    return new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : lang === 'pt' ? 'pt-BR' : 'en-US', {
      day: 'numeric', month: 'long', year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleDateString();
  }
}

export interface CertificateWallProps {
  items: UserCertificate[];
  /** Nombre que va impreso en la hoja (el dueño del certificado). */
  ownerName: string;
  ownerNationalId?: string | null;
  /**
   * Id del aprendiz cuando el perfil NO es el propio. Cambia la ruta de la
   * página completa a /certificate/:courseId/:userId (vista de staff) y oculta
   * las acciones de compartir, que solo tienen sentido para el dueño.
   */
  targetUserId?: string | null;
  emptyHint?: string;
}

export function CertificateWall({
  items, ownerName, ownerNationalId, targetUserId, emptyHint,
}: CertificateWallProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState<UserCertificate | null>(null);
  const lang = i18n.resolvedLanguage ?? 'es';

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-3xl border border-dashed border-line bg-surface px-6 py-14 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-subtle text-text-subtle">
          <Award className="h-6 w-6" />
        </div>
        <p className="text-[15px] font-semibold text-text">
          {t('profile.certs_empty_title', 'Aún no hay certificados')}
        </p>
        <p className="mt-1 max-w-sm text-[13px] text-text-muted">
          {emptyHint ?? t('profile.certs_empty_hint', 'Completa un curso y aprueba su evaluación para ganar tu primer certificado.')}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((c, i) => (
          <CertificateCard
            key={c.certId || c.courseId}
            cert={c}
            index={i}
            lang={lang}
            onOpen={() => setOpen(c)}
          />
        ))}
      </div>

      <AnimatePresence>
        {open && (
          <CertificateViewer
            cert={open}
            ownerName={ownerName}
            ownerNationalId={ownerNationalId}
            targetUserId={targetUserId}
            lang={lang}
            onClose={() => setOpen(null)}
          />
        )}
      </AnimatePresence>

      {/* El fondo se congela mientras el visor está abierto */}
      {open && <BodyScrollLock />}
    </>
  );
}

function BodyScrollLock() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  return null;
}

/* ── Tarjeta: diploma en miniatura ──────────────────────────────────────── */

function CertificateCard({
  cert, index, lang, onOpen,
}: { cert: UserCertificate; index: number; lang: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const title = pickTitle(cert, lang, t('profile.cert_badge', 'Certificado'));

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={reduce ? undefined : { opacity: 0, y: 18, filter: 'blur(6px)' }}
      animate={reduce ? undefined : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      whileHover={reduce ? undefined : { y: -6 }}
      whileTap={reduce ? undefined : { scale: 0.985 }}
      className="group relative overflow-hidden rounded-3xl border border-line bg-surface p-5 text-left transition-shadow hover:shadow-card-hover"
    >
      {/* Cinta superior corporativa */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: 'linear-gradient(90deg, #10D451, #B33D9E)' }}
      />
      {/* Barrido de brillo al pasar el cursor */}
      {!reduce && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full"
        />
      )}

      <div className="relative flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[rgba(16,212,81,0.12)] text-[#0ca23e]">
          <EntityIcon value={cert.icon} fallback="🎓" size={24} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#0ca23e]">
            <ShieldCheck className="h-3 w-3" />
            {t('profile.cert_badge', 'Certificado')}
          </div>
          <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-text">{title}</h3>
          <p className="mt-1 text-[12px] text-text-muted">{fmtDate(cert.issuedAt, lang)}</p>
        </div>
      </div>

      <div className="relative mt-4 flex items-center justify-between border-t border-line pt-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[20px] font-bold tabular-nums text-text">
            {cert.score > 0 ? `${Math.round(cert.score)}%` : '—'}
          </span>
          <span className="text-[11px] text-text-subtle">{t('profile.cert_score', 'Puntaje')}</span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-muted transition-colors group-hover:text-text">
          {t('profile.cert_view', 'Ver')}
          <ExternalLink className="h-3.5 w-3.5" />
        </span>
      </div>
    </motion.button>
  );
}

/* ── Visor: la hoja real, sobre la página ───────────────────────────────── */

function CertificateViewer({
  cert, ownerName, ownerNationalId, targetUserId, lang, onClose,
}: {
  cert: UserCertificate;
  ownerName: string;
  ownerNationalId?: string | null;
  targetUserId?: string | null;
  lang: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const sheetRef = useRef<HTMLElement>(null);
  const [course, setCourse] = useState<CourseWithModules | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getCourseById(cert.courseId)
      .then((c) => { if (alive) setCourse(c); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [cert.courseId]);

  // Escape cierra: en un visor a pantalla completa es el gesto esperado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const title = pickTitle(cert, lang, t('profile.cert_badge', 'Certificado'));
  const modules = course?.modules ?? [];
  const durationMin = modules.reduce((acc, m) => acc + (m.duration_min || 0), 0);
  const shareUrl = cert.certId
    ? `${window.location.origin}/verify/${cert.certId}?lang=${lang}`
    : null;
  const fullPageHref = targetUserId
    ? `/certificate/${cert.courseId}/${targetUserId}`
    : `/certificate/${cert.courseId}`;

  const handleDownload = async () => {
    if (!sheetRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadCertificatePdf(
        sheetRef.current,
        `certificado-${ownerName.replace(/\s+/g, '-')}.pdf`,
      );
    } finally {
      setDownloading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* portapapeles bloqueado */ }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8"
      {...backdropDismiss(onClose)}
    >
      <motion.div
        initial={reduce ? undefined : { opacity: 0, y: 24, scale: 0.97 }}
        animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? undefined : { opacity: 0, y: 16, scale: 0.98 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="my-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#0ca23e]">
              {t('profile.cert_badge', 'Certificado')}
            </div>
            <h2 className="truncate text-[16px] font-bold text-text">{title}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close', 'Cerrar')}
            className="shrink-0 rounded-xl p-2 text-text-muted transition-colors hover:bg-subtle hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="bg-subtle/40 p-4 sm:p-6">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
            </div>
          ) : (
            <CertificateFrame>
              <CertificateSheet
                ref={sheetRef}
                viewName={ownerName}
                nationalId={ownerNationalId ?? null}
                courseTitle={title}
                completedCount={modules.length}
                totalModules={modules.length}
                showScore={cert.score > 0}
                scoreValue={cert.score}
                issuedOn={fmtDate(cert.issuedAt, lang)}
                durationMin={durationMin}
                certId={(cert.certId || cert.courseId).slice(0, 16).toUpperCase()}
                verifyUrl={shareUrl ?? undefined}
                lang={lang}
              />
            </CertificateFrame>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">
          <Link
            to={fullPageHref}
            className="mr-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-text-muted transition-colors hover:text-text"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('profile.cert_open_page', 'Abrir página completa')}
          </Link>

          {!targetUserId && shareUrl && (
            <>
              <Button
                size="sm"
                onClick={() => window.open(
                  `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
                  '_blank', 'noopener',
                )}
                style={{ background: '#0A66C2', borderColor: '#0A66C2', color: '#fff' }}
              >
                <Linkedin className="h-4 w-4" />
                {t('certificate.share_linkedin', 'Compartir en LinkedIn')}
              </Button>
              <Button size="sm" variant="secondary" onClick={handleCopy}>
                <Link2 className="h-4 w-4" />
                {copied ? t('certificate.link_copied', 'Enlace copiado') : t('certificate.copy_link', 'Copiar enlace')}
              </Button>
            </>
          )}
          <Button size="sm" variant="secondary" onClick={handleDownload} disabled={downloading || loading}>
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {downloading ? t('certificate.downloading', 'Generando…') : t('certificate.download', 'Descargar PDF')}
          </Button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
