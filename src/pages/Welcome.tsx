import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { signInWithEmail } from '@/services/auth.service';
import { supabase } from '@/lib/supabase';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';

const GREEN = '#00C228';
const MAGENTA = '#C2185B';
const ease = [0.16, 1, 0.3, 1] as const;

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
    show: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: 0.45, ease },
    },
  },
};

export default function Welcome() {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { t } = useTranslation();

  useEffect(() => {
    if (!authLoading && isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, authLoading, navigate]);

  const [stats, setStats] = useState([
    { value: 0, label: t('welcome.stat_lessons') },
    { value: 0, label: t('welcome.stat_questions') },
    { value: 0, label: t('welcome.stat_scenarios') },
  ]);

  useEffect(() => {
    Promise.all([
      supabase.from('modules').select('id', { count: 'exact', head: true }).eq('is_published', true),
      supabase.from('section_quizzes').select('id', { count: 'exact', head: true }),
      supabase.from('scenarios').select('id', { count: 'exact', head: true }).eq('is_published', true),
    ]).then(([mods, quizzes, scens]) => {
      setStats([
        { value: mods.count ?? 0, label: t('welcome.stat_lessons') },
        { value: quizzes.count ?? 0, label: t('welcome.stat_questions') },
        { value: scens.count ?? 0, label: t('welcome.stat_scenarios') },
      ]);
    });
  }, [t]);

  /* ── Animación de máquina de escribir ───────────────────────────────── */
  const [headline] = useState(() => t('welcome.title_lead') + '\n' + t('welcome.title_accent'));
  const [displayed, setDisplayed] = useState('');
  const [typingDone, setTypingDone] = useState(false);
  const [showSub, setShowSub] = useState(false);
  const [showCTA, setShowCTA] = useState(false);

  useEffect(() => {
    let i = 0;
    const iv = setInterval(() => {
      if (i < headline.length) {
        setDisplayed(headline.slice(0, i + 1));
        i++;
      } else {
        clearInterval(iv);
        setTypingDone(true);
        setTimeout(() => setShowSub(true), 300);
        setTimeout(() => setShowCTA(true), 700);
      }
    }, 40);
    return () => clearInterval(iv);
  }, []);

  /* ── Estado del login y transición ──────────────────────────────────── */
  const [showLogin, setShowLogin] = useState(false);
  const [rippling, setRippling] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showLogin) {
      const t = setTimeout(() => emailRef.current?.focus(), 680);
      return () => clearTimeout(t);
    }
  }, [showLogin]);

  /* Click "Comenzar": efecto ripple → hero sale → login entra */
  const handleStart = () => {
    setRippling(true);
    setTimeout(() => setShowLogin(true), 380);
    setTimeout(() => setRippling(false), 900);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoginError(null);
    setSubmitting(true);
    try {
      await signInWithEmail(email.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('welcome.error_invalid');
      if (msg.includes('Invalid login credentials')) {
        setLoginError(t('welcome.error_invalid'));
      } else if (msg.includes('Email not confirmed')) {
        setLoginError(t('welcome.error_unconfirmed'));
      } else {
        setLoginError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Renderizado ────────────────────────────────────────────────────── */
  return (
    <div className="relative min-h-screen overflow-hidden flex flex-col bg-bg transition-colors duration-200">
      {/* Cuadrícula de puntos */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(rgb(var(--text) / 0.022) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          maskImage: 'radial-gradient(ellipse 85% 65% at 50% 50%, black 20%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 85% 65% at 50% 50%, black 20%, transparent 75%)',
        }}
      />

      {/* Resplandor verde */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-56 -left-56 w-[750px] h-[750px] rounded-full"
        style={{
          background: `radial-gradient(circle, ${GREEN}28 0%, transparent 68%)`,
          animation: 'bgPulse 7s ease-in-out infinite',
        }}
      />
      {/* Resplandor magenta */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-56 -right-56 w-[750px] h-[750px] rounded-full"
        style={{
          background: `radial-gradient(circle, ${MAGENTA}22 0%, transparent 68%)`,
          animation: 'bgPulse 9s ease-in-out infinite 2s',
        }}
      />

      {/* ── Efecto ripple — se expande desde el centro al hacer clic ─── */}
      <AnimatePresence>
        {rippling && (
          <motion.div
            aria-hidden
            className="fixed inset-0 z-30 pointer-events-none flex items-center justify-center"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.75, delay: 0.15, ease: 'easeOut' }}
          >
            <motion.div
              className="rounded-full"
              initial={{ width: 80, height: 80 }}
              animate={{ width: '280vw', height: '280vw' }}
              transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
              style={{
                background: `radial-gradient(circle, ${GREEN}20 0%, ${GREEN}08 40%, transparent 70%)`,
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Barra de navegación ─────────────────────────────────────────── */}
      <header
        className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 h-14"
        style={{
          background: 'rgb(var(--bg) / 0.8)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgb(var(--line))',
        }}
      >
        <div className="flex items-center gap-2.5">
          <img src="/logo.jpg" alt="Positivo S+" className="h-7 w-7 rounded-lg" />
          <span className="font-bold text-[15px] tracking-tight text-text">Concepto</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="hidden sm:flex items-center gap-2 rounded-full px-3 py-1.5 glass"
          >
            <motion.span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: GREEN }}
              animate={{ opacity: [1, 0.35, 1] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="text-[11px] text-apple-gray tracking-wide">
              {t('welcome.kicker')}
            </span>
          </div>
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      {/* ── Contenido principal ─────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 pt-14 pb-32 text-center">
        <div className="w-full max-w-4xl">
          <AnimatePresence mode="wait">

            {/* ─────────────────────── HERO ─────────────────────────────── */}
            {!showLogin && (
              <motion.div
                key="hero"
                exit={{
                  opacity: 0,
                  scale: 1.1,
                  y: -30,
                  filter: 'blur(28px)',
                  transition: { duration: 0.4, ease: [0.55, 0, 1, 0.5] },
                }}
              >
                {/* Texto superior */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.55, ease }}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-10 glass"
                >
                  <motion.span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: GREEN }}
                    animate={{ opacity: [1, 0.35, 1] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <span className="text-[11px] uppercase tracking-[0.16em] text-apple-gray">
                    {t('brand.tagline')}
                  </span>
                </motion.div>

                {/* Titular */}
                <h1
                  className="font-bold whitespace-pre-line text-text mb-8"
                  style={{
                    fontSize: 'clamp(3.2rem, 7vw + 1rem, 5.8rem)',
                    lineHeight: 1.03,
                    letterSpacing: '-0.047em',
                  }}
                >
                  {typingDone
                    ? t('welcome.title_lead') + '\n' + t('welcome.title_accent')
                    : displayed}
                  {!typingDone && (
                    <motion.span
                      className="inline-block ml-1 w-[3px] h-[0.82em] align-middle rounded-[2px]"
                      style={{ background: GREEN }}
                      animate={{ opacity: [1, 0, 1] }}
                      transition={{ duration: 0.85, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                </h1>

                {/* Subtítulo */}
                <AnimatePresence>
                  {showSub && (
                    <motion.p
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, ease }}
                      className="text-[17px] md:text-[19px] leading-[1.65] text-apple-gray max-w-[440px] mx-auto mb-10"
                    >
                      {t('welcome.subtitle')}
                    </motion.p>
                  )}
                </AnimatePresence>

                {/* Botón principal */}
                <AnimatePresence>
                  {showCTA && (
                    <motion.div
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, ease }}
                    >
                      <motion.button
                        onClick={handleStart}
                        whileHover={{ scale: 1.06 }}
                        whileTap={{ scale: 0.88 }}
                        transition={{ type: 'spring', stiffness: 360, damping: 20 }}
                        className="relative inline-flex items-center gap-2.5 rounded-full px-9 py-4 text-[15px] font-semibold text-black overflow-hidden"
                        style={{ background: GREEN }}
                      >
                        <span
                          aria-hidden
                          className="absolute inset-x-0 top-0 h-1/2 rounded-t-full pointer-events-none"
                          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 100%)' }}
                        />
                        <span className="relative z-10">{t('welcome.start_now')}</span>
                        <motion.span
                          className="relative z-10"
                          animate={{ x: [0, 3, 0] }}
                          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.5 }}
                        >
                          <ArrowRight className="h-4 w-4" />
                        </motion.span>
                      </motion.button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* ─────────────────────── TARJETA DE LOGIN ─────────────────── */}
            {showLogin && (
              <motion.div
                key="login"
                initial={{ opacity: 0, scale: 0.78, y: 90, filter: 'blur(20px)' }}
                animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                exit={{
                  opacity: 0,
                  scale: 0.9,
                  y: 20,
                  transition: { duration: 0.22, ease: [0.4, 0, 1, 1] },
                }}
                transition={{
                  type: 'spring',
                  stiffness: 210,
                  damping: 22,
                  mass: 0.85,
                  opacity: { duration: 0.38, ease: [0, 0, 0.2, 1] },
                  filter: { duration: 0.48, ease: 'easeOut' },
                }}
                className="w-full max-w-[380px] mx-auto text-left"
              >
                <div
                  className="relative overflow-hidden"
                  style={{
                    borderRadius: 28,
                    padding: '40px',
                    background: 'rgb(var(--surface) / 0.95)',
                    backdropFilter: 'blur(40px) saturate(160%)',
                    WebkitBackdropFilter: 'blur(40px) saturate(160%)',
                    border: '1px solid rgb(var(--line))',
                    boxShadow: [
                      'inset 0 1px 0 rgb(var(--line) / 0.5)',
                      '0 0 0 0.5px rgb(var(--line) / 0.25)',
                      `0 0 140px rgba(0,194,40,0.1)`,
                      '0 40px 100px rgba(0,0,0,0.25)',
                    ].join(', '),
                  }}
                >
                  {/* Profundidad interna */}
                  <div
                    aria-hidden
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(255,255,255,0.025) 0%, transparent 100%)',
                      borderRadius: 'inherit',
                    }}
                  />

                  {/* Línea de acento superior animada */}
                  <motion.div
                    className="absolute top-0 inset-x-0 h-px pointer-events-none"
                    style={{ background: `linear-gradient(90deg, transparent 5%, ${GREEN}80 50%, transparent 95%)` }}
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  />


                  {/* Elementos del formulario se revelan de a uno */}
                  <motion.div
                    variants={stagger.container}
                    initial="hidden"
                    animate="show"
                    className="relative z-10"
                  >
                    {/* Logo + título */}
                    <motion.div
                      variants={stagger.item}
                      className="flex items-center gap-3.5"
                      style={{
                        paddingBottom: 24,
                        marginBottom: 24,
                        borderBottom: '1px solid rgb(var(--line))',
                      }}
                    >
                      <img src="/logo.jpg" alt="Positivo S+" className="h-10 w-10 rounded-xl flex-shrink-0" />
                      <div>
                        <h2 className="text-[19px] font-bold tracking-[-0.025em] text-text leading-tight">
                          {t('welcome.login_title')}
                        </h2>
                        <p className="text-[11px] tracking-wide mt-0.5" style={{ color: 'rgb(var(--text-subtle))' }}>
                          Concepto · Positivo S+
                        </p>
                      </div>
                    </motion.div>

                    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                      {/* Correo electrónico */}
                      <motion.div variants={stagger.item}>
                        <label
                          className="block mb-2"
                          style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', color: 'rgb(var(--text-muted))' }}
                        >
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
                          onFocus={(e) => {
                            e.currentTarget.style.borderColor = `${GREEN}65`;
                            e.currentTarget.style.background = 'rgba(0,194,40,0.04)';
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.borderColor = 'rgb(var(--line))';
                            e.currentTarget.style.background = 'rgb(var(--surface))';
                          }}
                        />
                      </motion.div>

                      {/* Contraseña */}
                      <motion.div variants={stagger.item}>
                        <label
                          className="block mb-2"
                          style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', color: 'rgb(var(--text-muted))' }}
                        >
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
                            onFocus={(e) => {
                              e.currentTarget.style.borderColor = `${GREEN}65`;
                              e.currentTarget.style.background = 'rgba(0,194,40,0.04)';
                            }}
                            onBlur={(e) => {
                              e.currentTarget.style.borderColor = 'rgb(var(--line))';
                              e.currentTarget.style.background = 'rgb(var(--surface))';
                            }}
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

                      {/* Error */}
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

                      {/* Botón de envío */}
                      <motion.div variants={stagger.item}>
                        <motion.button
                          type="submit"
                          disabled={submitting || !email || !password}
                          whileHover={!submitting ? { scale: 1.02 } : {}}
                          whileTap={!submitting ? { scale: 0.96 } : {}}
                          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                          className="relative w-full flex items-center justify-center gap-2 overflow-hidden font-semibold text-black disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{
                            background: GREEN,
                            borderRadius: 14,
                            padding: '14px 20px',
                            fontSize: 15,
                            marginTop: 4,
                          }}
                        >
                          <span
                            aria-hidden
                            className="absolute inset-x-0 top-0 h-1/2 pointer-events-none"
                            style={{
                              background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 100%)',
                              borderRadius: '14px 14px 0 0',
                            }}
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

                    {/* Volver */}
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
            )}

          </AnimatePresence>
        </div>
      </main>

      {/* ── Stats (solo en hero) ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showCTA && !showLogin && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8, filter: 'blur(6px)', transition: { duration: 0.2 } }}
            transition={{ duration: 0.5, delay: 0.12, ease }}
            className="fixed bottom-8 inset-x-0 flex items-center justify-center pointer-events-none"
          >
            {stats.map((s, i) => (
              <div key={s.label} className="flex items-center">
                <div className="text-center px-8 md:px-12">
                  <div
                    className="tabular-nums leading-none text-text"
                    style={{ fontSize: 'clamp(24px, 3vw, 30px)', fontWeight: 600 }}
                  >
                    {s.value}
                  </div>
                  <div
                    className="uppercase mt-1.5"
                    style={{ fontSize: 10, letterSpacing: '0.18em', color: 'rgb(var(--text-muted))' }}
                  >
                    {s.label}
                  </div>
                </div>
                {i < stats.length - 1 && (
                  <div className="h-6 w-px" style={{ background: 'rgb(var(--line))' }} />
                )}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
