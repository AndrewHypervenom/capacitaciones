import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  motion, useMotionValue, useScroll, useSpring, useTransform,
} from 'framer-motion';
import {
  Download, Linkedin, Link2, ShieldCheck, AlertCircle, Check, Clock,
  Layers, Sparkles, ArrowDown, BadgeCheck, Eye,
} from 'lucide-react';
import {
  getPublicCertificate, getPublicCertificateSyllabus,
} from '@/services/certification.service';
import type {
  PublicCertificate as PublicCert, PublicCertificateSyllabus,
} from '@/types/database';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { readCertSharePreview } from '@/lib/certSharePreview';
import { CertificateSheet } from '@/components/certificate/CertificateSheet';
import { CertificateFrame, downloadCertificatePdf } from '@/components/certificate/CertificateFrame';
import {
  EASE, PensumTimeline, SectionHead, SkillGrid,
  buildSkillList, formatDuration, pickText,
} from '@/components/certificate/SyllabusSections';

const SUPPORTED_LANGS = ['es', 'en', 'pt'];

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
 * Fondo vivo: dos halos de marca que respiran muy lento detrás del contenido.
 * Es lo que separa una página "correcta" de una que se siente cara — pero a
 * baja opacidad, para que el protagonista siga siendo el diploma. Respeta
 * `prefers-reduced-motion`, como todo el movimiento de esta página.
 */
function Aurora() {
  const reduce = useReducedMotion();
  const blob = 'pointer-events-none absolute rounded-full blur-[100px]';

  if (reduce) {
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className={`${blob} -top-40 -left-32 h-[34rem] w-[34rem] bg-brand-green/12`} />
        <div className={`${blob} -top-24 right-0 h-[30rem] w-[30rem] bg-brand-magenta/10`} />
      </div>
    );
  }

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className={`${blob} -top-40 -left-32 h-[34rem] w-[34rem] bg-brand-green/14`}
        animate={{ x: [0, 60, 0], y: [0, 40, 0], scale: [1, 1.12, 1] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className={`${blob} -top-24 right-0 h-[30rem] w-[30rem] bg-brand-magenta/12`}
        animate={{ x: [0, -50, 0], y: [0, 60, 0], scale: [1, 1.08, 1] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
      />
    </div>
  );
}

/** Cuenta ascendente de un número cuando entra en pantalla. */
function useCountUp(target: number, start: boolean, duration = 1100) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!start || reduce) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      // easeOutCubic: arranca rápido y aterriza suave, como un contador de Apple.
      setValue(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, start, duration, reduce]);

  // Con `prefers-reduced-motion` no hay conteo: el número sale directo.
  return reduce ? target : value;
}

/** Dato del logro (módulos / intensidad / desempeño / fecha). */
function StatTile({
  icon, label, value, format, plain, delay = 0,
}: {
  icon: ReactNode;
  label: string;
  /** Valor numérico a animar. Si se pasa `plain`, no se anima nada. */
  value?: number;
  format?: (n: number) => string;
  /** Texto fijo (fechas): no tiene sentido contar hacia una fecha. */
  plain?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const n = useCountUp(value ?? 0, seen);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setSeen(true); },
      { rootMargin: '-10% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 18, filter: 'blur(6px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.6, ease: EASE, delay }}
      className="surface-card px-5 py-5 text-center"
    >
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-subtle text-text-muted">
        {icon}
      </div>
      <div className="text-[26px] font-semibold tracking-[-0.02em] tabular-nums">
        {plain ?? (format ? format(n) : Math.round(n).toString())}
      </div>
      <div className="mt-1 text-[11.5px] font-medium uppercase tracking-[0.12em] text-text-subtle">
        {label}
      </div>
    </motion.div>
  );
}

/**
 * Página PÚBLICA de verificación de un certificado (/verify/:certId).
 * No requiere sesión: es la que abre el QR del diploma y la que se comparte en
 * LinkedIn. Además del documento muestra el PÉNSUM — qué aprendió la persona,
 * qué sabe hacer ahora y qué temas cubrió—, porque un certificado que solo dice
 * "hizo 3 módulos" no le sirve a quien está evaluando a esa persona. Los datos
 * llegan por RPCs SECURITY DEFINER que solo exponen información no sensible
 * (`get_public_certificate`, `get_public_certificate_syllabus`).
 */
export default function PublicCertificate() {
  const { i18n } = useTranslation();
  const { certId } = useParams<{ certId: string }>();
  const [params] = useSearchParams();
  const reduce = useReducedMotion();
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
  const [syllabus, setSyllabus] = useState<PublicCertificateSyllabus | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Mientras se exporta el PDF hay que quitar la inclinación 3D de la hoja:
  // html2canvas no lee bien un elemento con un ancestro transformado (es el
  // mismo motivo por el que CertificateFrame anula su `scale` al exportar).
  const [exporting, setExporting] = useState(false);
  const certRef = useRef<HTMLElement>(null);

  // Barra de progreso de lectura (arriba del todo).
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 });
  // Las acciones compactas de la cabecera aparecen al dejar atrás el encabezado.
  const headerActions = useTransform(scrollYProgress, [0.04, 0.1], [0, 1]);
  // Invisible NO es lo mismo que ausente: sin esto, arriba del todo quedarían
  // tres botones transparentes capturando clics sobre la cabecera.
  const headerActionsHit = useTransform(headerActions, (v) => (v > 0.5 ? 'auto' : 'none'));

  // Inclinación 3D del diploma siguiendo al cursor.
  const tiltX = useMotionValue(0);
  const tiltY = useMotionValue(0);
  const rx = useSpring(tiltX, { stiffness: 150, damping: 18, mass: 0.4 });
  const ry = useSpring(tiltY, { stiffness: 150, damping: 18, mass: 0.4 });
  const glareX = useMotionValue(50);
  const glareY = useMotionValue(50);
  // Brillo del papel siguiendo al cursor. Se calcula siempre (nunca dentro de
  // una rama del render: sería un hook condicional) y solo se pinta si procede.
  const glare = useTransform(
    [glareX, glareY],
    ([px, py]: number[]) =>
      `radial-gradient(420px circle at ${px}% ${py}%, rgba(255,255,255,0.35), transparent 60%)`,
  );

  const onSheetMove = (e: React.MouseEvent) => {
    if (reduce || exporting) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    tiltX.set((0.5 - py) * 7);
    tiltY.set((px - 0.5) * 9);
    glareX.set(px * 100);
    glareY.set(py * 100);
  };
  const onSheetLeave = () => { tiltX.set(0); tiltY.set(0); };

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

    // ── Vista previa del editor de curso (`/verify/preview`) ──────────────
    // Es ESTA página, con el borrador que el capacitador tiene en pantalla en
    // vez de un certificado emitido. Se monta un certificado de ejemplo: sin
    // puntaje (no hay intento real) y con la fecha de hoy.
    if (certId === 'preview') {
      const draft = readCertSharePreview();
      setLoading(false);
      if (!draft) { setNotFound(true); return; }
      setCert({
        cert_id: 'VISTA-PREVIA',
        score: 0,
        issued_at: new Date().toISOString(),
        display_name: draft.learnerName,
        job_title: null,
        course_id: draft.courseId,
        title_es: draft.courseTitle,
        title_en: null,
        title_pt: null,
        modules_total: draft.modules.length,
        duration_min: draft.modules.reduce((a, m) => a + (m.duration_min || 0), 0),
        national_id: null,
      });
      setSyllabus({
        course: {
          description_es: draft.courseDescription,
          description_en: null,
          description_pt: null,
          level: null,
          category: null,
        },
        modules: draft.modules,
      });
      return;
    }

    setLoading(true);
    getPublicCertificate(certId)
      .then((c) => {
        if (!active) return;
        if (!c) { setNotFound(true); return; }
        setCert(c);
        // El pénsum es secundario: llega aparte y nunca bloquea al diploma.
        getPublicCertificateSyllabus(certId)
          .then((s) => { if (active) setSyllabus(s); })
          .catch(() => {});
      })
      .catch(() => { if (active) setNotFound(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [certId]);

  const isPreview = certId === 'preview';

  // Al recompartir (o al escanear el QR) el idioma debe viajar con el enlace,
  // incluso si llegamos por un enlace viejo que no traía `?lang=`.
  // En vista previa no hay certificado emitido: el QR y el pie llevan un código
  // de ejemplo, que al escanearlo dice honestamente que no existe.
  // Dominio del sitio, para explicar en el tooltip cómo se verifica un código.
  const verifyBase = typeof window === 'undefined' ? '' : window.location.origin;
  const shareUrl = typeof window === 'undefined'
    ? ''
    : isPreview
      ? `${window.location.origin}/verify/EJEMPLO?lang=${lang}`
      : `${window.location.origin}/verify/${certId}?lang=${lang}`;

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
    setExporting(true);
    try {
      // Dos cuadros: uno para que React pinte la hoja ya sin transform y otro
      // para que el navegador aplique el estilo antes de rasterizar.
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      await downloadCertificatePdf(
        certRef.current,
        `certificado-${(cert?.display_name ?? 'positivos').replace(/\s+/g, '-')}.pdf`,
      );
    } finally {
      setDownloading(false);
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-bg">
        <Aurora />
        <div className="relative mx-auto max-w-3xl px-5 pt-32">
          <div className="mx-auto h-6 w-44 rounded-full bg-subtle skeleton-shine" />
          <div className="mx-auto mt-6 h-12 w-full max-w-lg rounded-2xl bg-subtle skeleton-shine" />
          <div className="mx-auto mt-3 h-5 w-64 rounded-full bg-subtle skeleton-shine" />
          <div className="mt-12 aspect-[1.414/1] w-full rounded-3xl bg-subtle skeleton-shine" />
        </div>
      </div>
    );
  }

  if (notFound || !cert) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center">
        <Aurora />
        <motion.div
          initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="relative"
        >
          <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-subtle text-text-muted">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h1 className="mb-2 text-[20px] font-semibold tracking-tight">
            {certId === 'preview'
              ? t('public_certificate.preview_missing_title')
              : t('public_certificate.not_found_title')}
          </h1>
          <p className="mx-auto mb-6 max-w-sm text-[14px] text-text-muted">
            {certId === 'preview'
              ? t('public_certificate.preview_missing_hint')
              : t('public_certificate.not_found_hint')}
          </p>
          <Link to="/">
            <Button variant="secondary" size="md">{t('public_certificate.go_home')}</Button>
          </Link>
        </motion.div>
      </div>
    );
  }

  const courseTitle = pickText(cert.title_es, cert.title_en, cert.title_pt, lang);
  const issuedOn = formatDate(new Date(cert.issued_at), lang);
  const showScore = cert.score > 0;
  const displayCertId = cert.cert_id.slice(0, 16).toUpperCase();
  const linkedInShareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;

  const modules = syllabus?.modules ?? [];
  const course = syllabus?.course ?? null;
  const courseDescription = course
    ? pickText(course.description_es ?? '', course.description_en, course.description_pt, lang)
    : '';

  // Intensidad horaria: la del certificado si vino; si no, la suma del pénsum.
  const pensumMinutes = modules.reduce((acc, m) => acc + (m.duration_min || 0), 0);
  const durationMin = cert.duration_min || pensumMinutes;
  // El pénsum manda sobre `modules_total` cuando lo tenemos: son los módulos que
  // realmente se van a listar, y decir "8 módulos" bajo una lista de 7 se nota.
  const modulesTotal = modules.length || cert.modules_total;
  const skills = buildSkillList(modules, lang);

  const nameWords = cert.display_name.split(' ').filter(Boolean);
  const levelLabel = course?.level ? t(`courses.level_${course.level}`) : null;

  const shareButtons = (compact = false) => (
    <>
      {/* En vista previa los botones se ven, porque son parte de cómo queda la
          página, pero no funcionan: no hay enlace real que compartir todavía. */}
      <Button
        onClick={() => window.open(linkedInShareUrl, '_blank', 'noopener')}
        size={compact ? 'sm' : 'md'}
        disabled={isPreview}
        title={isPreview ? t('public_certificate.preview_disabled_action') : undefined}
        style={{ background: '#0A66C2', borderColor: '#0A66C2', color: '#fff' }}
      >
        <Linkedin className="h-4 w-4" />
        {t('certificate.share_linkedin')}
      </Button>
      <Button
        onClick={handleCopyLink}
        variant="secondary"
        size={compact ? 'sm' : 'md'}
        disabled={isPreview}
        title={isPreview ? t('public_certificate.preview_disabled_action') : undefined}
      >
        {copied ? <Check className="h-4 w-4 text-brand-green" /> : <Link2 className="h-4 w-4" />}
        {copied ? t('certificate.link_copied') : t('certificate.copy_link')}
      </Button>
      <Button
        onClick={handleDownload}
        variant="secondary"
        size={compact ? 'sm' : 'md'}
        disabled={downloading}
      >
        <Download className="h-4 w-4" />
        {downloading ? t('certificate.downloading') : t('certificate.download')}
      </Button>
    </>
  );

  return (
    <div className="min-h-screen bg-bg">
      {/* Progreso de lectura */}
      <motion.div
        aria-hidden
        className="fixed inset-x-0 top-0 z-50 h-[2px] origin-left"
        style={{
          scaleX: progress,
          background: 'linear-gradient(90deg, rgb(var(--brand-green)), rgb(var(--brand-magenta)))',
        }}
      />

      {/* Franja de vista previa. Va arriba del todo y no se puede cerrar: esta
          página es idéntica a la real, y confundirlas sería peor que el ruido. */}
      {isPreview && (
        <div className="relative z-40 border-b border-amber-500/30 bg-amber-500/[0.12] px-5 py-2.5">
          <div className="mx-auto flex max-w-6xl items-start gap-2.5">
            <Eye className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p className="text-[12.5px] leading-relaxed text-amber-600 dark:text-amber-400">
              <span className="font-semibold">{t('public_certificate.preview_banner_title')}</span>{' '}
              {t('public_certificate.preview_banner_hint')}
            </p>
          </div>
        </div>
      )}

      {/* Cabecera translúcida */}
      <header className="sticky top-0 z-40 border-b border-line/70 nav-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src="/logo.jpg" alt="LearningAI" className="h-8 w-8 rounded-lg object-cover" />
            <div className="truncate text-[15px] font-bold tracking-tight">LearningAI Academy</div>
          </div>

          {/* En escritorio, al bajar aparecen las acciones sin robar espacio arriba. */}
          <motion.div
            className="hidden items-center gap-2 lg:flex"
            style={reduce ? undefined : { opacity: headerActions, pointerEvents: headerActionsHit }}
          >
            {shareButtons(true)}
          </motion.div>

          <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-green/25 bg-brand-green/8 px-3 py-1.5 text-[12px] font-semibold text-brand-green lg:hidden">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t('public_certificate.verified_badge')}
          </div>
        </div>
      </header>

      {/* ── Encabezado ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <Aurora />
        <div className="relative mx-auto max-w-4xl px-5 pb-16 pt-16 text-center sm:pt-24">
          {/* Sello verificado */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, filter: 'blur(6px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{ duration: 0.7, ease: EASE }}
            className="inline-flex items-center gap-2 rounded-full border border-brand-green/25 bg-brand-green/8 px-4 py-2 text-[12.5px] font-semibold text-brand-green"
          >
            <motion.span
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.25, type: 'spring', stiffness: 300, damping: 14 }}
              className="inline-flex"
            >
              <ShieldCheck className="h-4 w-4" />
            </motion.span>
            {t('public_certificate.verified_badge')}
          </motion.div>

          {/* Nombre — entra palabra por palabra */}
          <h1 className="mt-7 text-[clamp(2.2rem,6.5vw,4rem)] font-semibold leading-[1.05] tracking-[-0.04em] text-balance">
            {nameWords.map((w, i) => (
              <motion.span
                key={`${w}-${i}`}
                initial={reduce ? undefined : { opacity: 0, y: 24, filter: 'blur(8px)' }}
                animate={reduce ? undefined : { opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ duration: 0.7, ease: EASE, delay: 0.15 + i * 0.07 }}
                className="mr-[0.25em] inline-block"
              >
                {w}
              </motion.span>
            ))}
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.15 + nameWords.length * 0.07 }}
            className="mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-text-muted text-balance"
          >
            {t('public_certificate.completed_program')}{' '}
            <span className="bg-gradient-to-r from-brand-green to-brand-magenta bg-clip-text font-semibold text-transparent">
              {courseTitle}
            </span>
          </motion.p>

          {/* Píldoras del programa: cargo, nivel y categoría */}
          {(cert.job_title || levelLabel || course?.category) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.5 }}
              className="mt-4 flex flex-wrap items-center justify-center gap-2"
            >
              {cert.job_title && (
                <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-text-muted">
                  {cert.job_title}
                </span>
              )}
              {levelLabel && (
                <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-text-muted">
                  {levelLabel}
                </span>
              )}
              {course?.category && (
                <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-text-muted">
                  {course.category}
                </span>
              )}
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.4 + nameWords.length * 0.05 }}
            className="mt-9 flex flex-wrap items-center justify-center gap-2.5"
          >
            {shareButtons()}
          </motion.div>

          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2, duration: 0.8 }}
            className="mt-14 flex justify-center text-text-subtle"
          >
            <motion.span
              animate={reduce ? undefined : { y: [0, 7, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ArrowDown className="h-4 w-4" />
            </motion.span>
          </motion.div>
        </div>
      </section>

      {/* ── El diploma ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.97, filter: 'blur(10px)' }}
          whileInView={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.9, ease: EASE }}
          onMouseMove={onSheetMove}
          onMouseLeave={onSheetLeave}
          className="relative"
        >
          {/* Resplandor bajo la hoja: da peso físico al documento. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-6 -z-10 rounded-[3rem] opacity-70 blur-3xl"
            style={{
              background:
                'radial-gradient(60% 60% at 30% 20%, rgb(var(--brand-magenta) / 0.18), transparent 70%),' +
                'radial-gradient(60% 60% at 75% 80%, rgb(var(--brand-green) / 0.18), transparent 70%)',
            }}
          />
          <motion.div
            // Sin transform durante la exportación: ver `exporting`.
            style={exporting || reduce ? undefined : {
              rotateX: rx, rotateY: ry, transformPerspective: 1400,
            }}
            className="group relative overflow-hidden rounded-2xl shadow-glass-lg"
          >
            <CertificateFrame>
              <CertificateSheet
                ref={certRef}
                viewName={cert.display_name}
                nationalId={cert.national_id}
                courseTitle={courseTitle}
                completedCount={cert.modules_total}
                totalModules={cert.modules_total}
                showScore={showScore}
                scoreValue={cert.score}
                issuedOn={issuedOn}
                durationMin={durationMin}
                certId={displayCertId}
                verifyUrl={shareUrl}
                lang={lang}
              />
            </CertificateFrame>

            {/* Brillo que recorre el papel al pasar el cursor. Va FUERA del
                nodo que se exporta (certRef), así que no ensucia el PDF. */}
            {!reduce && !exporting && (
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                style={{ background: glare, mixBlendMode: 'overlay' }}
              />
            )}
          </motion.div>
        </motion.div>
      </section>

      {/* ── Datos del logro ────────────────────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-5 pt-14">
        <div className={`grid gap-3 ${showScore ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3'}`}>
          <StatTile
            icon={<Layers className="h-4 w-4" />}
            label={t('public_certificate.stat_modules')}
            value={modulesTotal}
            delay={0}
          />
          {durationMin > 0 && (
            <StatTile
              icon={<Clock className="h-4 w-4" />}
              label={t('public_certificate.stat_hours')}
              value={durationMin}
              format={(n) => formatDuration(Math.round(n), t)}
              delay={0.06}
            />
          )}
          {showScore && (
            <StatTile
              icon={<Sparkles className="h-4 w-4" />}
              label={t('public_certificate.stat_score')}
              value={cert.score}
              format={(n) => `${Math.round(n)}/100`}
              delay={0.12}
            />
          )}
          <StatTile
            icon={<ShieldCheck className="h-4 w-4" />}
            label={t('public_certificate.stat_issued')}
            plain={issuedOn}
            delay={0.18}
          />
        </div>
      </section>

      {/* ── De qué trata el programa ───────────────────────────────────── */}
      {courseDescription && (
        <section className="mx-auto max-w-3xl px-5 pt-20">
          <SectionHead
            eyebrow={t('public_certificate.about_eyebrow')}
            title={t('public_certificate.about_title')}
          />
          <motion.p
            initial={{ opacity: 0, y: 18, filter: 'blur(6px)' }}
            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.7, ease: EASE }}
            className="surface-card px-6 py-6 text-center text-[15.5px] leading-relaxed text-text-muted text-balance sm:px-8"
          >
            {courseDescription}
          </motion.p>
        </section>
      )}

      {/* ── Lo que sabe hacer ahora ────────────────────────────────────── */}
      {skills.length > 0 && (
        <section className="mx-auto max-w-4xl px-5 pt-20">
          <SectionHead
            eyebrow={t('public_certificate.skills_eyebrow')}
            title={t('public_certificate.skills_title', { name: nameWords[0] ?? cert.display_name })}
            hint={t('public_certificate.skills_hint')}
          />
          <SkillGrid items={skills} />
        </section>
      )}

      {/* ── Pénsum ─────────────────────────────────────────────────────── */}
      {modules.length > 0 && (
        <section className="mx-auto max-w-4xl px-5 pt-20">
          <SectionHead
            eyebrow={t('public_certificate.pensum_eyebrow')}
            title={t('public_certificate.pensum_title')}
            hint={t('public_certificate.pensum_subtitle', { count: modules.length })}
          />
          <PensumTimeline modules={modules} lang={lang} t={t} />

          {/* Cierre del recorrido: el pénsum termina en el certificado. */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.6, ease: EASE }}
            className="mt-4 flex items-center gap-4"
          >
            <div className="z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-brand-green/30 bg-brand-green/10 text-brand-green">
              <BadgeCheck className="h-6 w-6" />
            </div>
            <div className="text-[14px] leading-relaxed text-text-muted">
              {t('public_certificate.pensum_end', { date: issuedOn })}
            </div>
          </motion.div>
        </section>
      )}

      {/* ── Cierre ─────────────────────────────────────────────────────── */}
      {/* Sin QR y sin tarjeta de verificación: quien lee esta página YA llegó
          por el enlace o escaneando el QR del diploma, y el código ya está en
          la píldora de arriba. Acá solo queda con qué compartirla. */}
      <section className="mx-auto max-w-3xl px-5 pb-24 pt-20">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <p className="mx-auto max-w-xl text-center text-[13.5px] leading-relaxed text-text-muted text-balance">
            {t('public_certificate.authenticity')}
          </p>

          {/* El código, con la explicación de cómo se verifica de verdad. No
              hay buscador por código: la verificación ES esta página, y el
              código es el final de su dirección. Decir "puede verificarse en
              línea" sin explicar dónde era una promesa que nadie podía cumplir. */}
          <div className="mt-4 flex justify-center">
            <Tooltip
              label={t('public_certificate.code_tooltip', { url: `${verifyBase}/verify/` })}
              maxWidth={320}
              anchor="element"
              describedBy
            >
              <span className="inline-flex cursor-help items-center gap-2 rounded-full border border-line bg-subtle px-3.5 py-1.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-text-subtle">
                  {t('public_certificate.code_label')}
                </span>
                {/* Seleccionable de un clic: es el dato que alguien copia. */}
                <span className="select-all font-mono text-[12.5px] tracking-[0.04em] text-text">
                  {displayCertId}
                </span>
              </span>
            </Tooltip>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
            {shareButtons()}
          </div>
        </motion.div>

        <p className="mt-12 text-center text-[12px] text-text-subtle">
          {t('certificate.registry_line')}
        </p>
      </section>
    </div>
  );
}
