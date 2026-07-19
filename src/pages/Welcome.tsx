import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Eye, EyeOff, Loader2, BookOpen, Sparkles, Gamepad2,
  Radio, BarChart3, Globe, Check, Trophy, Phone,
} from 'lucide-react';
import {
  motion, AnimatePresence, useScroll, useTransform, useInView, animate,
  useMotionValue, useSpring, useMotionTemplate, useReducedMotion,
  type Variants,
} from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { signInWithEmail } from '@/services/auth.service';
import { supabase } from '@/lib/supabase';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';

const GREEN = '#10D451';
const MAGENTA = '#B33D9E';
const ease = [0.16, 1, 0.3, 1] as const;

type TFn = (k: string) => string;

/* ── Helpers de estilo para inputs ──────────────────────────────────── */
const inputBase: React.CSSProperties = {
  width: '100%',
  borderRadius: 14,
  padding: '13px 16px',
  fontSize: 15,
  color: 'rgb(var(--text))',
  background: 'rgb(var(--surface))',
  border: '1px solid rgb(var(--line))',
  outline: 'none',
  transition: 'border-color 0.2s ease, background-color 0.2s ease',
};

/* ── Variantes escalonadas para elementos del formulario ─────────────── */
const stagger = {
  container: {
    hidden: {},
    show: { transition: { staggerChildren: 0.07, delayChildren: 0.18 } },
  },
  item: {
    hidden: { opacity: 0, y: 16, filter: 'blur(4px)' },
    show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.45, ease } },
  },
} satisfies Record<string, Variants>;

/* Revelado al hacer scroll (whileInView) ─────────────────────────────── */
const reveal: Variants = {
  hidden: { opacity: 0, y: 28, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease } },
};
const revealGroup: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

export default function Welcome() {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading, profile, isAdminOrCapacitador } = useAuth();
  const { t } = useTranslation();
  const reduce = !!useReducedMotion();

  // Redirección post-login según el rol: el staff (superadmin/capacitador) aterriza
  // en su panel de gestión; el aprendiz en su dashboard. Esperamos a que el perfil
  // esté cargado (no solo la sesión) para conocer el rol y evitar la carrera en la
  // que `isAuthenticated` ya es true pero `profile` sigue null tras el login.
  useEffect(() => {
    if (authLoading || !isAuthenticated || !profile) return;
    const target = isAdminOrCapacitador && profile.onboarded ? '/admin' : '/dashboard';
    navigate(target, { replace: true });
  }, [isAuthenticated, authLoading, profile, isAdminOrCapacitador, navigate]);

  // Solo los NÚMEROS viven en el estado; la etiqueta se traduce al renderizar.
  // Si se guardara el texto ya traducido, cambiar de idioma dejaría las
  // etiquetas en el idioma anterior hasta que volviera a resolver el RPC.
  const [counts, setCounts] = useState({ lessons: 0, questions: 0, scenarios: 0 });

  useEffect(() => {
    // Aggregate counts come from a SECURITY DEFINER function so the logged-out
    // (anon) landing page can read them despite RLS hiding the content tables.
    supabase.rpc('public_landing_stats').then(({ data }) => {
      const s = (data ?? {}) as { lessons?: number; questions?: number; scenarios?: number };
      setCounts({ lessons: s.lessons ?? 0, questions: s.questions ?? 0, scenarios: s.scenarios ?? 0 });
    });
  }, []);

  const stats = [
    { id: 'lessons', value: counts.lessons, label: t('welcome.stat_lessons') },
    { id: 'questions', value: counts.questions, label: t('welcome.stat_questions') },
    { id: 'scenarios', value: counts.scenarios, label: t('welcome.stat_scenarios') },
  ];

  /* ── Animación de máquina de escribir del titular ───────────────────── */
  // Se recalcula al cambiar de idioma (antes quedaba congelado en el idioma
  // inicial y el titular seguía en español tras cambiar el switcher).
  const headline = t('welcome.title_lead') + '\n' + t('welcome.title_accent');
  const [displayed, setDisplayed] = useState('');
  const [typingDone, setTypingDone] = useState(false);
  const [showSub, setShowSub] = useState(false);
  const [showCTA, setShowCTA] = useState(false);

  useEffect(() => {
    if (reduce) {
      setDisplayed(headline); setTypingDone(true); setShowSub(true); setShowCTA(true);
      return;
    }
    let i = 0;
    const iv = setInterval(() => {
      if (i < headline.length) {
        setDisplayed(headline.slice(0, i + 1));
        i++;
      } else {
        clearInterval(iv);
        setTypingDone(true);
        setTimeout(() => setShowSub(true), 250);
        setTimeout(() => setShowCTA(true), 550);
      }
    }, 38);
    return () => clearInterval(iv);
  }, [reduce, headline]);

  /* ── Parallax + progreso de scroll ──────────────────────────────────── */
  const { scrollY, scrollYProgress } = useScroll();
  const heroTextY = useTransform(scrollY, [0, 500], [0, 80]);
  const heroPreviewY = useTransform(scrollY, [0, 500], [0, -60]);
  const heroFade = useTransform(scrollY, [0, 400], [1, 0]);

  /* ── Aurora que sigue el cursor en el hero ──────────────────────────── */
  const heroRef = useRef<HTMLDivElement>(null);
  const gx = useMotionValue(50);
  const gy = useMotionValue(35);
  const sgx = useSpring(gx, { stiffness: 60, damping: 20 });
  const sgy = useSpring(gy, { stiffness: 60, damping: 20 });
  const auroraBg = useMotionTemplate`radial-gradient(600px circle at ${sgx}% ${sgy}%, ${GREEN}22, transparent 60%)`;

  const onHeroMove = (e: React.MouseEvent) => {
    if (reduce) return;
    const r = heroRef.current?.getBoundingClientRect();
    if (!r) return;
    gx.set(((e.clientX - r.left) / r.width) * 100);
    gy.set(((e.clientY - r.top) / r.height) * 100);
  };

  /* ── Estado del login y transición ──────────────────────────────────── */
  const [showLogin, setShowLogin] = useState(false);
  const [rippling, setRippling] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showLogin) {
      const to = setTimeout(() => emailRef.current?.focus(), 480);
      return () => clearTimeout(to);
    }
  }, [showLogin]);

  const handleStart = () => {
    setRippling(true);
    setTimeout(() => setShowLogin(true), 320);
    setTimeout(() => setRippling(false), 850);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoginError(null);
    setSubmitting(true);
    try {
      await signInWithEmail(email.trim(), password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('welcome.error_invalid');
      if (msg.includes('Invalid login credentials')) setLoginError(t('welcome.error_invalid'));
      else if (msg.includes('Email not confirmed')) setLoginError(t('welcome.error_unconfirmed'));
      else setLoginError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // OJO con las `key`: NUNCA usar el texto traducido. Al cambiar de idioma la
  // key cambia, React desmonta y vuelve a montar la tarjeta, y la nueva nace con
  // la variante heredada `hidden` — el padre ya terminó su `whileInView` y no
  // vuelve a propagar "show", así que la tarjeta queda invisible. Es el bug de
  // "al cambiar de idioma se desaparecen las cosas". Con un `id` estable el
  // nodo se reutiliza y solo cambia el texto.
  const features = [
    { id: 'f1', icon: BookOpen, title: t('welcome.land.f1_title'), desc: t('welcome.land.f1_desc'), color: GREEN },
    { id: 'f2', icon: Sparkles, title: t('welcome.land.f2_title'), desc: t('welcome.land.f2_desc'), color: MAGENTA },
    { id: 'f3', icon: Gamepad2, title: t('welcome.land.f3_title'), desc: t('welcome.land.f3_desc'), color: GREEN },
    { id: 'f4', icon: Radio, title: t('welcome.land.f4_title'), desc: t('welcome.land.f4_desc'), color: MAGENTA },
    { id: 'f5', icon: BarChart3, title: t('welcome.land.f5_title'), desc: t('welcome.land.f5_desc'), color: GREEN },
    { id: 'f6', icon: Globe, title: t('welcome.land.f6_title'), desc: t('welcome.land.f6_desc'), color: MAGENTA },
  ];

  const steps = [
    { id: 's1', icon: BookOpen, title: t('welcome.land.s1_title'), desc: t('welcome.land.s1_desc') },
    { id: 's2', icon: Gamepad2, title: t('welcome.land.s2_title'), desc: t('welcome.land.s2_desc') },
    { id: 's3', icon: Trophy, title: t('welcome.land.s3_title'), desc: t('welcome.land.s3_desc') },
  ];

  const marquee = [
    t('welcome.land.f1_title'), t('welcome.land.f2_title'), t('welcome.land.f3_title'),
    t('welcome.land.f4_title'), t('welcome.land.f5_title'), t('welcome.land.f6_title'),
  ];

  /* ── Renderizado ────────────────────────────────────────────────────── */
  return (
    <div className="relative min-h-screen bg-bg text-text transition-colors duration-200 overflow-x-hidden">
      {/* Barra de progreso de scroll */}
      <motion.div
        className="fixed top-0 left-0 right-0 z-[80] h-[2px] origin-left"
        style={{ scaleX: scrollYProgress, background: `linear-gradient(90deg, ${GREEN}, ${MAGENTA})` }}
      />

      {/* ── Fondo fijo: grano + cuadrícula + auroras ──────────────────── */}
      <div className="pointer-events-none fixed inset-0 z-0">
        {/* Textura de grano */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.035] dark:opacity-[0.05] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(rgb(var(--text) / 0.022) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
            maskImage: 'radial-gradient(ellipse 90% 70% at 50% 0%, black 10%, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(ellipse 90% 70% at 50% 0%, black 10%, transparent 70%)',
          }}
        />
        <motion.div
          aria-hidden
          className="absolute -top-56 -left-56 w-[750px] h-[750px] rounded-full"
          style={{ background: `radial-gradient(circle, ${GREEN}28 0%, transparent 68%)` }}
          animate={reduce ? undefined : { scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          aria-hidden
          className="absolute top-[30%] -right-56 w-[750px] h-[750px] rounded-full"
          style={{ background: `radial-gradient(circle, ${MAGENTA}22 0%, transparent 68%)` }}
          animate={reduce ? undefined : { scale: [1, 1.15, 1], opacity: [0.6, 0.95, 0.6] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        />
      </div>

      {/* ── Efecto ripple al abrir login ──────────────────────────────── */}
      <AnimatePresence>
        {rippling && (
          <motion.div
            aria-hidden
            className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.75, delay: 0.15, ease: 'easeOut' }}
          >
            <motion.div
              className="rounded-full"
              initial={{ width: 80, height: 80 }}
              animate={{ width: '280vw', height: '280vw' }}
              transition={{ duration: 0.65, ease }}
              style={{ background: `radial-gradient(circle, ${GREEN}20 0%, ${GREEN}08 40%, transparent 70%)` }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Barra de navegación ───────────────────────────────────────── */}
      <header
        className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 h-14"
        style={{
          background: 'rgb(var(--bg) / 0.72)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgb(var(--line))',
        }}
      >
        <div className="flex items-center gap-2.5">
          <img src="/logo.jpg" alt="LearningAI" className="h-7 w-7 rounded-lg" />
          <span className="font-bold text-[15px] tracking-tight text-text">LearningAI</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => featuresRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="hidden md:inline-flex text-[13px] font-medium text-apple-gray hover:text-text transition-colors px-3 py-1.5"
          >
            {t('welcome.land.cta_secondary')}
          </button>
          <LanguageSwitcher />
          <ThemeToggle />
          <button
            onClick={handleStart}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold text-black"
            style={{ background: GREEN }}
          >
            {t('welcome.start_now')}
          </button>
        </div>
      </header>

      {/* ═════════════════════════ HERO ═════════════════════════════════ */}
      <motion.section
        ref={heroRef}
        onMouseMove={onHeroMove}
        style={{ opacity: heroFade }}
        className="relative z-10 min-h-screen flex items-center px-6 pt-24 pb-16"
      >
        {/* Aurora reactiva al cursor */}
        <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: auroraBg }} />

        <div className="mx-auto w-full max-w-6xl grid lg:grid-cols-[1.05fr_0.95fr] gap-14 lg:gap-10 items-center">

          {/* ── Columna de texto ──────────────────────────────────────── */}
          <motion.div style={{ y: heroTextY }} className="relative text-center lg:text-left">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease }}
              className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-8 glass"
            >
              <motion.span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: GREEN }}
                animate={reduce ? undefined : { opacity: [1, 0.35, 1] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
              />
              <span className="text-[11px] uppercase tracking-[0.16em] text-apple-gray">
                {t('welcome.land.badge')}
              </span>
            </motion.div>

            <h1
              className="font-bold whitespace-pre-line text-text mb-7"
              style={{ fontSize: 'clamp(2.7rem, 5.2vw + 1rem, 5rem)', lineHeight: 1.02, letterSpacing: '-0.045em' }}
            >
              {typingDone ? (
                <>
                  <span>{t('welcome.title_lead')}</span>
                  {'\n'}
                  <motion.span
                    style={{
                      background: `linear-gradient(100deg, ${GREEN}, ${MAGENTA}, ${GREEN})`,
                      backgroundSize: '200% auto',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      color: 'transparent',
                    }}
                    animate={reduce ? undefined : { backgroundPosition: ['0% center', '200% center'] }}
                    transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
                  >
                    {t('welcome.title_accent')}
                  </motion.span>
                </>
              ) : (
                displayed
              )}
              {!typingDone && (
                <motion.span
                  className="inline-block ml-1 w-[3px] h-[0.82em] align-middle rounded-[2px]"
                  style={{ background: GREEN }}
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ duration: 0.85, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </h1>

            <AnimatePresence>
              {showSub && (
                <motion.p
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease }}
                  className="text-[16px] md:text-[18px] leading-[1.6] text-apple-gray max-w-[500px] mx-auto lg:mx-0 mb-9"
                >
                  {t('welcome.subtitle')}
                </motion.p>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {showCTA && (
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease }}
                  className="flex flex-col sm:flex-row items-center lg:items-start gap-3 justify-center lg:justify-start"
                >
                  <Magnetic disabled={reduce}>
                    <motion.button
                      onClick={handleStart}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 360, damping: 20 }}
                      className="relative inline-flex items-center gap-2.5 rounded-full px-8 py-4 text-[15px] font-semibold text-black overflow-hidden"
                      style={{ background: GREEN, boxShadow: `0 12px 40px ${GREEN}44` }}
                    >
                      <span
                        aria-hidden
                        className="absolute inset-x-0 top-0 h-1/2 rounded-t-full pointer-events-none"
                        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 100%)' }}
                      />
                      <span className="relative z-10">{t('welcome.start_now')}</span>
                      <motion.span
                        className="relative z-10"
                        animate={reduce ? undefined : { x: [0, 3, 0] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.5 }}
                      >
                        <ArrowRight className="h-4 w-4" />
                      </motion.span>
                    </motion.button>
                  </Magnetic>

                  <motion.button
                    onClick={() => featuresRef.current?.scrollIntoView({ behavior: 'smooth' })}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 360, damping: 20 }}
                    className="inline-flex items-center gap-2 rounded-full px-7 py-4 text-[15px] font-semibold text-text glass-md"
                  >
                    {t('welcome.land.cta_secondary')}
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {showCTA && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="mt-9 flex items-center gap-2.5 justify-center lg:justify-start text-[12px] tracking-wide"
                  style={{ color: 'rgb(var(--text-muted))' }}
                >
                  <span className="text-base leading-none">🇨🇴 🇲🇽 🇦🇷</span>
                  <span>{t('welcome.land.ops')}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* ── Columna de preview (mockup 3D del panel) ──────────────── */}
          <motion.div
            style={{ y: heroPreviewY }}
            initial={{ opacity: 0, scale: 0.92, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease }}
            className="hidden lg:block"
          >
            <ProductPreview stats={stats} t={t} reduce={reduce} />
          </motion.div>
        </div>

        {/* Indicador de scroll */}
        <motion.div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 hidden md:flex flex-col items-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: showCTA ? 0.5 : 0 }}
          transition={{ duration: 1 }}
        >
          <div className="h-8 w-5 rounded-full border flex justify-center pt-1.5" style={{ borderColor: 'rgb(var(--line))' }}>
            <motion.div
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: GREEN }}
              animate={reduce ? undefined : { y: [0, 8, 0], opacity: [1, 0.2, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </motion.div>
      </motion.section>

      {/* ── Marquee de capacidades ────────────────────────────────────── */}
      <div
        className="relative z-10 py-5 border-y overflow-hidden"
        style={{ borderColor: 'rgb(var(--line))', background: 'rgb(var(--surface) / 0.4)' }}
      >
        <div
          className="flex"
          style={{
            maskImage: 'linear-gradient(90deg, transparent, black 12%, black 88%, transparent)',
            WebkitMaskImage: 'linear-gradient(90deg, transparent, black 12%, black 88%, transparent)',
          }}
        >
          <motion.div
            className="flex items-center gap-10 pr-10 whitespace-nowrap"
            animate={reduce ? undefined : { x: ['0%', '-50%'] }}
            transition={{ duration: 26, repeat: Infinity, ease: 'linear' }}
          >
            {[...marquee, ...marquee, ...marquee, ...marquee].map((m, i) => (
              <span key={i} className="inline-flex items-center gap-3 text-[14px] font-medium" style={{ color: 'rgb(var(--text-muted))' }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: i % 2 ? MAGENTA : GREEN }} />
                {m}
              </span>
            ))}
          </motion.div>
        </div>
      </div>

      {/* ═══════════════════════ CARACTERÍSTICAS ════════════════════════ */}
      <section ref={featuresRef} className="relative z-10 px-6 py-24 scroll-mt-14">
        <div className="mx-auto max-w-6xl">
          <motion.div
            variants={reveal}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-80px' }}
            className="text-center max-w-2xl mx-auto mb-16"
          >
            <SectionKicker>{t('welcome.land.features_kicker')}</SectionKicker>
            <h2 className="font-bold text-text mt-4 mb-4" style={{ fontSize: 'clamp(1.9rem, 3.5vw, 3rem)', letterSpacing: '-0.035em', lineHeight: 1.08 }}>
              {t('welcome.land.features_title')}
            </h2>
            <p className="text-[16px] leading-relaxed text-apple-gray">
              {t('welcome.land.features_subtitle')}
            </p>
          </motion.div>

          <motion.div
            variants={revealGroup}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-60px' }}
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5"
          >
            {features.map((f) => (
              <SpotlightCard key={f.id} color={f.color} disabled={reduce}>
                <div
                  className="relative inline-flex items-center justify-center h-12 w-12 rounded-2xl mb-5"
                  style={{ background: `${f.color}1a`, border: `1px solid ${f.color}33` }}
                >
                  <f.icon className="h-5 w-5" style={{ color: f.color }} />
                </div>
                <h3 className="relative text-[17px] font-semibold text-text mb-2 tracking-[-0.01em]">{f.title}</h3>
                <p className="relative text-[14px] leading-relaxed text-apple-gray">{f.desc}</p>
              </SpotlightCard>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════ CÓMO FUNCIONA ══════════════════════════ */}
      <section className="relative z-10 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <motion.div
            variants={reveal}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-80px' }}
            className="text-center max-w-2xl mx-auto mb-16"
          >
            <SectionKicker>{t('welcome.land.steps_kicker')}</SectionKicker>
            <h2 className="font-bold text-text mt-4" style={{ fontSize: 'clamp(1.9rem, 3.5vw, 3rem)', letterSpacing: '-0.035em', lineHeight: 1.08 }}>
              {t('welcome.land.steps_title')}
            </h2>
          </motion.div>

          <motion.div
            variants={revealGroup}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-60px' }}
            className="grid md:grid-cols-3 gap-6 relative"
          >
            {steps.map((s, i) => (
              <motion.div key={s.id} variants={reveal} className="relative text-center md:text-left">
                <div className="flex items-center gap-3 justify-center md:justify-start mb-4">
                  <span className="inline-flex items-center justify-center h-11 w-11 rounded-2xl text-[15px] font-bold text-black" style={{ background: GREEN }}>
                    {i + 1}
                  </span>
                  <s.icon className="h-5 w-5 text-apple-gray" />
                </div>
                <h3 className="text-[19px] font-semibold text-text mb-2 tracking-[-0.02em]">{s.title}</h3>
                <p className="text-[14px] leading-relaxed text-apple-gray max-w-[300px] mx-auto md:mx-0">{s.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════ ESTADÍSTICAS ═══════════════════════════ */}
      <section className="relative z-10 px-6 py-20">
        <motion.div
          variants={reveal}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="mx-auto max-w-5xl rounded-[2rem] px-8 py-14 overflow-hidden relative glass-strong"
          style={{ border: '1px solid rgb(var(--line))' }}
        >
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(ellipse 60% 80% at 50% 0%, ${GREEN}12 0%, transparent 70%)` }}
          />
          <div className="relative text-center mb-10">
            <SectionKicker>{t('welcome.land.stats_kicker')}</SectionKicker>
            <h2 className="font-bold text-text mt-3" style={{ fontSize: 'clamp(1.5rem, 2.6vw, 2.1rem)', letterSpacing: '-0.03em' }}>
              {t('welcome.land.stats_title')}
            </h2>
          </div>
          <div className="relative flex flex-wrap items-center justify-center gap-y-8">
            {stats.map((s, i) => (
              <div key={s.id} className="flex items-center">
                <div className="text-center px-8 md:px-14">
                  <div className="tabular-nums leading-none text-text" style={{ fontSize: 'clamp(38px, 6vw, 60px)', fontWeight: 700, letterSpacing: '-0.03em' }}>
                    <CountUp value={s.value} />
                    <span style={{ color: GREEN }}>+</span>
                  </div>
                  <div className="uppercase mt-2.5" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'rgb(var(--text-muted))' }}>
                    {s.label}
                  </div>
                </div>
                {i < stats.length - 1 && <div className="h-10 w-px hidden sm:block" style={{ background: 'rgb(var(--line))' }} />}
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ═══════════════════════ CTA FINAL ══════════════════════════════ */}
      <section className="relative z-10 px-6 py-24">
        <motion.div
          variants={reveal}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="mx-auto max-w-3xl text-center"
        >
          <h2 className="font-bold text-text mb-4" style={{ fontSize: 'clamp(2rem, 4vw, 3.2rem)', letterSpacing: '-0.04em', lineHeight: 1.05 }}>
            {t('welcome.land.cta_title')}
          </h2>
          <p className="text-[17px] text-apple-gray mb-9">{t('welcome.land.cta_subtitle')}</p>
          <Magnetic disabled={reduce}>
            <motion.button
              onClick={handleStart}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 360, damping: 20 }}
              className="relative inline-flex items-center gap-2.5 rounded-full text-[16px] font-semibold text-black overflow-hidden"
              style={{ background: GREEN, boxShadow: `0 16px 50px ${GREEN}55`, padding: '18px 40px' }}
            >
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-1/2 rounded-t-full pointer-events-none"
                style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 100%)' }}
              />
              <span className="relative z-10">{t('welcome.start_now')}</span>
              <ArrowRight className="relative z-10 h-5 w-5" />
            </motion.button>
          </Magnetic>
        </motion.div>
      </section>

      {/* ── Pie ───────────────────────────────────────────────────────── */}
      <footer className="relative z-10 px-6 py-10 border-t" style={{ borderColor: 'rgb(var(--line))' }}>
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <img src="/logo.jpg" alt="LearningAI" className="h-6 w-6 rounded-md" />
            <span className="font-semibold text-[14px] text-text">LearningAI</span>
          </div>
          <span className="text-[12px]" style={{ color: 'rgb(var(--text-muted))' }}>
            {t('welcome.land.footer_rights')} · © {new Date().getFullYear()}
          </span>
        </div>
      </footer>

      {/* ═══════════════════ OVERLAY DE LOGIN ═══════════════════════════ */}
      <AnimatePresence>
        {showLogin && (
          <motion.div
            className="fixed inset-0 z-[70] flex items-center justify-center px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <motion.div
              className="absolute inset-0"
              style={{ background: 'rgb(var(--bg) / 0.7)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
              onClick={() => { setShowLogin(false); setLoginError(null); }}
            />

            <motion.div
              key="login"
              initial={{ opacity: 0, scale: 0.82, y: 60, filter: 'blur(16px)' }}
              animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.92, y: 20, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', stiffness: 220, damping: 24, mass: 0.85, opacity: { duration: 0.32 } }}
              className="relative w-full max-w-[400px] text-left"
            >
              <div
                className="relative overflow-hidden"
                style={{
                  borderRadius: 28,
                  padding: 40,
                  background: 'rgb(var(--surface) / 0.98)',
                  backdropFilter: 'blur(40px) saturate(160%)',
                  WebkitBackdropFilter: 'blur(40px) saturate(160%)',
                  border: '1px solid rgb(var(--line))',
                  boxShadow: [
                    'inset 0 1px 0 rgb(var(--line) / 0.5)',
                    '0 0 0 0.5px rgb(var(--line) / 0.25)',
                    `0 0 140px rgba(16,212,81,0.12)`,
                    '0 40px 100px rgba(0,0,0,0.35)',
                  ].join(', '),
                }}
              >
                <motion.div
                  className="absolute top-0 inset-x-0 h-px pointer-events-none"
                  style={{ background: `linear-gradient(90deg, transparent 5%, ${GREEN}80 50%, transparent 95%)` }}
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                />

                <motion.div variants={stagger.container} initial="hidden" animate="show" className="relative z-10">
                  <motion.div
                    variants={stagger.item}
                    className="flex items-center gap-3.5"
                    style={{ paddingBottom: 24, marginBottom: 24, borderBottom: '1px solid rgb(var(--line))' }}
                  >
                    <img src="/logo.jpg" alt="LearningAI" className="h-10 w-10 rounded-xl flex-shrink-0" />
                    <div>
                      <h2 className="text-[19px] font-bold tracking-[-0.025em] text-text leading-tight">
                        {t('welcome.login_title')}
                      </h2>
                      <p className="text-[11px] tracking-wide mt-0.5" style={{ color: 'rgb(var(--text-subtle))' }}>
                        LearningAI
                      </p>
                    </div>
                  </motion.div>

                  <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                    <motion.div variants={stagger.item}>
                      <label className="block mb-2" style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', color: 'rgb(var(--text-muted))' }}>
                        {t('welcome.email_label').toUpperCase()}
                      </label>
                      <input
                        ref={emailRef}
                        type="email"
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); setLoginError(null); }}
                        placeholder={t('welcome.email_placeholder')}
                        autoComplete="email"
                        required
                        style={inputBase}
                        className="placeholder:text-text-subtle"
                        onFocus={(e) => { e.currentTarget.style.borderColor = `${GREEN}65`; e.currentTarget.style.background = 'rgba(16,212,81,0.04)'; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = 'rgb(var(--line))'; e.currentTarget.style.background = 'rgb(var(--surface))'; }}
                      />
                    </motion.div>

                    <motion.div variants={stagger.item}>
                      <label className="block mb-2" style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', color: 'rgb(var(--text-muted))' }}>
                        {t('welcome.password_label').toUpperCase()}
                      </label>
                      <div className="relative">
                        <input
                          type={showPwd ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => { setPassword(e.target.value); setLoginError(null); }}
                          placeholder="••••••••"
                          autoComplete="current-password"
                          required
                          style={{ ...inputBase, paddingRight: 48 }}
                          className="placeholder:text-text-subtle"
                          onFocus={(e) => { e.currentTarget.style.borderColor = `${GREEN}65`; e.currentTarget.style.background = 'rgba(16,212,81,0.04)'; }}
                          onBlur={(e) => { e.currentTarget.style.borderColor = 'rgb(var(--line))'; e.currentTarget.style.background = 'rgb(var(--surface))'; }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPwd((v) => !v)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 transition-colors"
                          style={{ color: 'rgb(var(--text-subtle))' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'rgb(var(--text-muted))'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgb(var(--text-subtle))'; }}
                        >
                          {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </motion.div>

                    <AnimatePresence>
                      {loginError && (
                        <motion.p
                          initial={{ opacity: 0, y: -8, height: 0 }}
                          animate={{ opacity: 1, y: 0, height: 'auto' }}
                          exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
                          className="text-[12.5px] tracking-wide overflow-hidden text-danger"
                        >
                          {loginError}
                        </motion.p>
                      )}
                    </AnimatePresence>

                    <motion.div variants={stagger.item}>
                      <motion.button
                        type="submit"
                        disabled={submitting || !email || !password}
                        whileHover={!submitting ? { scale: 1.02 } : {}}
                        whileTap={!submitting ? { scale: 0.96 } : {}}
                        transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                        className="relative w-full flex items-center justify-center gap-2 overflow-hidden font-semibold text-black disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: GREEN, borderRadius: 14, padding: '14px 20px', fontSize: 15, marginTop: 4 }}
                      >
                        <span
                          aria-hidden
                          className="absolute inset-x-0 top-0 h-1/2 pointer-events-none"
                          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 100%)', borderRadius: '14px 14px 0 0' }}
                        />
                        {submitting ? (
                          <Loader2 className="h-4 w-4 animate-spin relative z-10" />
                        ) : (
                          <>
                            <span className="relative z-10">{t('welcome.submit')}</span>
                            <ArrowRight className="h-4 w-4 relative z-10" />
                          </>
                        )}
                      </motion.button>
                    </motion.div>
                  </form>

                  <motion.div variants={stagger.item} className="flex justify-center mt-6">
                    <button
                      type="button"
                      onClick={() => { setShowLogin(false); setLoginError(null); }}
                      className="text-[12px] tracking-wide transition-colors"
                      style={{ color: 'rgb(var(--text-subtle))', letterSpacing: '0.04em' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'rgb(var(--text-muted))'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'rgb(var(--text-subtle))'; }}
                    >
                      {t('welcome.back')}
                    </button>
                  </motion.div>
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════ Sub-componentes ═══════════════════════════════ */

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 glass text-[11px] uppercase tracking-[0.16em]"
      style={{ color: 'rgb(var(--text-muted))' }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: GREEN }} />
      {children}
    </span>
  );
}

/* Botón magnético: se atrae hacia el cursor con física de resorte ──────── */
function Magnetic({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 200, damping: 15, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 200, damping: 15, mass: 0.4 });

  const onMove = (e: React.MouseEvent) => {
    if (disabled) return;
    const r = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * 0.35);
    y.set((e.clientY - (r.top + r.height / 2)) * 0.35);
  };
  const reset = () => { x.set(0); y.set(0); };

  return (
    <motion.div
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{ x: sx, y: sy }}
      className="inline-flex"
    >
      {children}
    </motion.div>
  );
}

/* Tarjeta con spotlight que sigue el cursor + borde reactivo ───────────── */
function SpotlightCard({ color, disabled, children }: { color: string; disabled?: boolean; children: React.ReactNode }) {
  const mx = useMotionValue(-200);
  const my = useMotionValue(-200);
  const bg = useMotionTemplate`radial-gradient(240px circle at ${mx}px ${my}px, ${color}22, transparent 70%)`;
  const border = useMotionTemplate`radial-gradient(200px circle at ${mx}px ${my}px, ${color}66, transparent 65%)`;

  const onMove = (e: React.MouseEvent) => {
    if (disabled) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(e.clientX - r.left);
    my.set(e.clientY - r.top);
  };

  return (
    <motion.div
      variants={reveal}
      onMouseMove={onMove}
      whileHover={{ y: -6 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      className="group relative rounded-3xl p-7 overflow-hidden glass-md"
      style={{ border: '1px solid rgb(var(--line))' }}
    >
      {/* Borde luminoso reactivo */}
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{ background: border, padding: 1, WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)', WebkitMaskComposite: 'xor', maskComposite: 'exclude' }}
      />
      {/* Halo interior */}
      <motion.div
        aria-hidden
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{ background: bg }}
      />
      {children}
    </motion.div>
  );
}

/* Contador que sube al entrar en viewport ─────────────────────────────── */
function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, value, {
      duration: 1.4,
      ease,
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, value]);

  return <span ref={ref}>{display}</span>;
}

/* Mockup animado del panel del agente con tilt 3D (hero) ───────────────── */
function ProductPreview({
  stats, t, reduce,
}: {
  stats: { value: number; label: string }[];
  t: TFn;
  reduce: boolean;
}) {
  const bars = [62, 88, 45, 74, 96, 58, 81];

  // Tilt 3D reactivo al puntero + reflejo especular
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 150, damping: 18 });
  const sry = useSpring(ry, { stiffness: 150, damping: 18 });
  const px = useMotionValue(50);
  const py = useMotionValue(0);
  const shine = useMotionTemplate`radial-gradient(circle at ${px}% ${py}%, rgba(255,255,255,0.14), transparent 45%)`;

  const onMove = (e: React.MouseEvent) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width;
    const ny = (e.clientY - r.top) / r.height;
    ry.set((nx - 0.5) * 16);
    rx.set(-(ny - 0.5) * 16);
    px.set(nx * 100);
    py.set(ny * 100);
  };
  const reset = () => { rx.set(0); ry.set(0); };

  return (
    <motion.div
      onMouseMove={onMove}
      onMouseLeave={reset}
      animate={reduce ? undefined : { y: [0, -10, 0] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      style={{ rotateX: srx, rotateY: sry, transformPerspective: 1200 }}
      className="relative [transform-style:preserve-3d]"
    >
      <div aria-hidden className="absolute -inset-8 rounded-[3rem] pointer-events-none" style={{ background: `radial-gradient(circle at 50% 40%, ${GREEN}18, transparent 65%)` }} />

      <div
        className="relative rounded-[28px] p-6 glass-strong"
        style={{ border: '1px solid rgb(var(--line))', boxShadow: '0 40px 100px rgba(0,0,0,0.28), inset 0 1px 0 rgb(var(--glass-border) / 0.08)' }}
      >
        {/* Reflejo especular que sigue el puntero */}
        <motion.div aria-hidden className="absolute inset-0 rounded-[28px] pointer-events-none" style={{ background: shine }} />

        {/* Encabezado del panel */}
        <div className="relative flex items-center justify-between mb-6" style={{ transform: 'translateZ(40px)' }}>
          <div>
            <div className="text-[13px] font-semibold text-text">{t('welcome.land.preview_title')}</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'rgb(var(--text-muted))' }}>Ana · Colombia</div>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 glass">
            <motion.span className="h-1.5 w-1.5 rounded-full" style={{ background: GREEN }} animate={reduce ? undefined : { opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} />
            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgb(var(--text-muted))' }}>{t('welcome.land.preview_live')}</span>
          </div>
        </div>

        {/* Fila de métricas */}
        <div className="relative grid grid-cols-2 gap-3 mb-4" style={{ transform: 'translateZ(30px)' }}>
          <div className="rounded-2xl p-4 glass flex items-center gap-3.5" style={{ border: '1px solid rgb(var(--line))' }}>
            <MasteryRing value={87} />
            <div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'rgb(var(--text-muted))' }}>{t('welcome.land.preview_mastery')}</div>
              <div className="text-[20px] font-bold text-text leading-tight tabular-nums">87%</div>
            </div>
          </div>
          <div className="rounded-2xl p-4 glass flex flex-col justify-center" style={{ border: '1px solid rgb(var(--line))' }}>
            <div className="flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5" style={{ color: MAGENTA }} />
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgb(var(--text-muted))' }}>{t('welcome.land.preview_streak')}</span>
            </div>
            <div className="text-[20px] font-bold text-text leading-tight mt-1">
              12 <span className="text-[12px] font-medium text-apple-gray">{t('welcome.land.preview_days')}</span>
            </div>
          </div>
        </div>

        {/* Gráfico de barras animado */}
        <div className="relative rounded-2xl p-4 glass mb-4" style={{ border: '1px solid rgb(var(--line))', transform: 'translateZ(20px)' }}>
          <div className="flex items-end gap-2 h-24">
            {bars.map((h, i) => (
              <motion.div
                key={i}
                className="flex-1 rounded-md"
                style={{ background: i === 4 ? MAGENTA : GREEN, opacity: i === 4 ? 1 : 0.55 }}
                initial={{ height: 0 }}
                whileInView={{ height: `${h}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, delay: i * 0.08, ease }}
              />
            ))}
          </div>
        </div>

        {/* Fila de simulación */}
        <div className="relative rounded-2xl p-3.5 glass flex items-center gap-3" style={{ border: '1px solid rgb(var(--line))', transform: 'translateZ(30px)' }}>
          <div className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${GREEN}1a`, border: `1px solid ${GREEN}33` }}>
            <Phone className="h-4 w-4" style={{ color: GREEN }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-text truncate">{t('welcome.land.preview_lesson')}</div>
            <div className="text-[11px]" style={{ color: 'rgb(var(--text-muted))' }}>{t('welcome.land.preview_score')} · 94/100</div>
          </div>
          <div className="h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: GREEN }}>
            <Check className="h-4 w-4 text-black" />
          </div>
        </div>
      </div>

      {/* Insignia flotante de logro */}
      <motion.div
        className="absolute -bottom-4 -left-4 rounded-2xl px-3.5 py-2.5 flex items-center gap-2.5 glass-strong"
        style={{ border: '1px solid rgb(var(--line))', boxShadow: '0 20px 50px rgba(0,0,0,0.25)', transform: 'translateZ(60px)' }}
        animate={reduce ? undefined : { y: [0, -8, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
      >
        <div className="h-8 w-8 rounded-xl flex items-center justify-center" style={{ background: `${MAGENTA}1a`, border: `1px solid ${MAGENTA}33` }}>
          <Sparkles className="h-4 w-4" style={{ color: MAGENTA }} />
        </div>
        <div>
          <div className="text-[11px] font-semibold text-text leading-tight">+{stats[1]?.value || 240} XP</div>
          <div className="text-[9px]" style={{ color: 'rgb(var(--text-muted))' }}>{t('welcome.land.preview_mastery')}</div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* Anillo de progreso de dominio ───────────────────────────────────────── */
function MasteryRing({ value }: { value: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg width={44} height={44} viewBox="0 0 44 44" className="flex-shrink-0 -rotate-90">
      <circle cx={22} cy={22} r={r} fill="none" stroke="rgb(var(--line))" strokeWidth={4} />
      <motion.circle
        cx={22}
        cy={22}
        r={r}
        fill="none"
        stroke={GREEN}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        whileInView={{ strokeDashoffset: c - (c * value) / 100 }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease }}
      />
    </svg>
  );
}
