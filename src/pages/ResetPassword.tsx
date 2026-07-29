import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  motion, AnimatePresence, useMotionValue, useSpring, useMotionTemplate, useReducedMotion,
} from 'framer-motion'
import { ArrowRight, Check, Eye, EyeOff, KeyRound, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  PASSWORD_RESET_PATH, classifyRecoveryError, completePasswordReset, type RecoveryFailure,
} from '@/services/auth.service'
import { evaluatePassword } from '@/lib/password'
import { PasswordStrength } from '@/components/auth/PasswordStrength'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'

const GREEN = '#10D451'
const MAGENTA = '#B33D9E'
const ease = [0.16, 1, 0.3, 1] as const

type Stage = 'verifying' | 'ready' | 'invalid' | 'done'

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
}

/**
 * El canje del código es de UN SOLO USO. En StrictMode (dev) los efectos se
 * montan dos veces y el segundo intento fallaría con "invalid code", mostrando
 * un enlace roto que en realidad funcionó. Memorizamos la promesa por código
 * para que ambos montajes compartan el mismo resultado.
 */
const inflight = new Map<string, Promise<{ ok: boolean; failure?: RecoveryFailure }>>()

/** Lee el enlace del correo y establece la sesión de recuperación. */
async function consumeRecoveryLink(): Promise<{ ok: boolean; failure?: RecoveryFailure }> {
  const url = new URL(window.location.href)
  const query = url.searchParams
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))

  // Supabase puede devolver el fallo en la query o en el fragmento.
  const explicitError = query.get('error_description') ?? hash.get('error_description')
    ?? query.get('error') ?? hash.get('error')

  const code = query.get('code')
  const tokenHash = query.get('token_hash') ?? hash.get('token_hash')
  const accessToken = hash.get('access_token')
  const refreshToken = hash.get('refresh_token')

  // Los tokens salen de la barra de direcciones de inmediato: no deben quedar
  // en el historial, ni en el título de la pestaña, ni viajar en un `Referer`.
  window.history.replaceState(null, '', PASSWORD_RESET_PATH)

  if (explicitError) return { ok: false, failure: classifyRecoveryError(explicitError) }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return { ok: false, failure: classifyRecoveryError(error.message) }
    return { ok: true }
  }

  // Plantilla de correo con `{{ .TokenHash }}`.
  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
    if (error) return { ok: false, failure: classifyRecoveryError(error.message) }
    return { ok: true }
  }

  // Enlaces del flujo implícito antiguo (emitidos antes de migrar a PKCE).
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    if (error) return { ok: false, failure: classifyRecoveryError(error.message) }
    return { ok: true }
  }

  // Sin parámetros: puede ser un usuario ya autenticado que entró a mano.
  const { data } = await supabase.auth.getSession()
  if (data.session) return { ok: true }
  return { ok: false, failure: 'missing' }
}

export default function ResetPassword() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const reduce = !!useReducedMotion()

  const [stage, setStage] = useState<Stage>('verifying')
  const [failure, setFailure] = useState<RecoveryFailure>('missing')
  const [email, setEmail] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pwdRef = useRef<HTMLInputElement>(null)

  /* ── Canje del enlace ─────────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true
    const url = new URL(window.location.href)
    const key = url.search + url.hash || 'no-params'
    let task = inflight.get(key)
    if (!task) {
      task = consumeRecoveryLink()
      inflight.set(key, task)
    }
    void task.then(async (res) => {
      if (!alive) return
      if (!res.ok) {
        setFailure(res.failure ?? 'missing')
        setStage('invalid')
        return
      }
      const { data } = await supabase.auth.getUser()
      if (!alive) return
      setEmail(data.user?.email ?? null)
      setStage('ready')
      setTimeout(() => pwdRef.current?.focus(), 420)
    })
    return () => { alive = false }
  }, [])

  const verdict = evaluatePassword(password, { email })
  const matches = confirm.length > 0 && password === confirm
  const canSubmit = verdict.valid && matches && !saving

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      await completePasswordReset(password)
      setStage('done')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      // Supabase rechaza reutilizar la contraseña actual si el proyecto lo exige.
      if (/should be different|same as the old/i.test(msg)) setError(t('reset.error_same'))
      else if (/session|jwt|expired/i.test(msg)) setError(t('reset.error_session'))
      else setError(msg || t('reset.error_generic'))
      setSaving(false)
    }
  }

  /* ── Aurora que sigue al cursor (mismo lenguaje visual que el landing) ── */
  const gx = useMotionValue(50)
  const gy = useMotionValue(40)
  const sgx = useSpring(gx, { stiffness: 60, damping: 20 })
  const sgy = useSpring(gy, { stiffness: 60, damping: 20 })
  const aurora = useMotionTemplate`radial-gradient(620px circle at ${sgx}% ${sgy}%, ${GREEN}1f, transparent 62%)`

  const onMove = (e: React.MouseEvent) => {
    if (reduce) return
    gx.set((e.clientX / window.innerWidth) * 100)
    gy.set((e.clientY / window.innerHeight) * 100)
  }

  return (
    <div
      onMouseMove={onMove}
      className="relative min-h-screen flex items-center justify-center px-6 bg-bg text-text overflow-hidden"
    >
      {/* Fondo: auroras + cuadrícula, coherente con la portada */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <motion.div aria-hidden className="absolute inset-0" style={{ background: aurora }} />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(rgb(var(--text) / 0.022) 1px, transparent 1px)',
            backgroundSize: '26px 26px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 40%, black 10%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 40%, black 10%, transparent 75%)',
          }}
        />
        <motion.div
          aria-hidden
          className="absolute -top-52 -left-52 w-[700px] h-[700px] rounded-full"
          style={{ background: `radial-gradient(circle, ${GREEN}24 0%, transparent 68%)` }}
          animate={reduce ? undefined : { scale: [1, 1.12, 1], opacity: [0.6, 0.95, 0.6] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          aria-hidden
          className="absolute -bottom-52 -right-52 w-[700px] h-[700px] rounded-full"
          style={{ background: `radial-gradient(circle, ${MAGENTA}1f 0%, transparent 68%)` }}
          animate={reduce ? undefined : { scale: [1, 1.15, 1], opacity: [0.5, 0.85, 0.5] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        />
      </div>

      <div className="fixed top-4 right-5 z-20 flex items-center gap-2">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>

      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.9, y: 40, filter: 'blur(14px)' }}
        animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ type: 'spring', stiffness: 210, damping: 25, mass: 0.9 }}
        className="relative z-10 w-full max-w-[440px]"
      >
        <div
          className="relative overflow-hidden"
          style={{
            borderRadius: 28,
            padding: 36,
            background: 'rgb(var(--surface) / 0.98)',
            backdropFilter: 'blur(40px) saturate(160%)',
            WebkitBackdropFilter: 'blur(40px) saturate(160%)',
            border: '1px solid rgb(var(--line))',
            boxShadow: [
              'inset 0 1px 0 rgb(var(--line) / 0.5)',
              `0 0 140px ${GREEN}1f`,
              '0 40px 100px rgba(0,0,0,0.35)',
            ].join(', '),
          }}
        >
          <motion.div
            aria-hidden
            className="absolute top-0 inset-x-0 h-px pointer-events-none"
            style={{ background: `linear-gradient(90deg, transparent 5%, ${GREEN}80 50%, transparent 95%)` }}
            animate={reduce ? undefined : { opacity: [0.45, 1, 0.45] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />

          <AnimatePresence initial={false} mode="popLayout">
            {/* ─────────── Verificando el enlace ─────────── */}
            {stage === 'verifying' && (
              <motion.div
                key="verifying"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.28, ease }}
                className="flex flex-col items-center text-center py-6"
              >
                <motion.div
                  className="h-12 w-12 rounded-2xl flex items-center justify-center mb-5"
                  style={{ background: `${GREEN}1a`, border: `1px solid ${GREEN}33` }}
                  animate={reduce ? undefined : { scale: [1, 1.06, 1] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Loader2 className="h-5 w-5 animate-spin" style={{ color: GREEN }} />
                </motion.div>
                <p className="text-[14px]" style={{ color: 'rgb(var(--text-muted))' }}>
                  {t('reset.verifying')}
                </p>
              </motion.div>
            )}

            {/* ─────────── Enlace inválido / vencido ─────────── */}
            {stage === 'invalid' && (
              <motion.div
                key="invalid"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3, ease }}
                className="text-center"
              >
                <motion.div
                  className="h-12 w-12 rounded-2xl flex items-center justify-center mb-5 mx-auto"
                  style={{ background: 'rgba(240,68,56,0.12)', border: '1px solid rgba(240,68,56,0.25)' }}
                  initial={{ rotate: -8, scale: 0.8 }}
                  animate={{ rotate: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 14 }}
                >
                  <ShieldAlert className="h-5 w-5" style={{ color: '#F04438' }} />
                </motion.div>
                <h1 className="text-[19px] font-bold tracking-[-0.025em] mb-2">
                  {t('reset.invalid_title')}
                </h1>
                <p className="text-[13.5px] leading-relaxed mb-7" style={{ color: 'rgb(var(--text-muted))' }}>
                  {t(`reset.invalid_${failure}`)}
                </p>
                <motion.button
                  onClick={() => navigate('/', { replace: true })}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                  className="w-full font-semibold text-black"
                  style={{ background: GREEN, borderRadius: 14, padding: '13px 20px', fontSize: 14.5 }}
                >
                  {t('reset.invalid_cta')}
                </motion.button>
              </motion.div>
            )}

            {/* ─────────── Formulario de nueva contraseña ─────────── */}
            {stage === 'ready' && (
              <motion.div
                key="ready"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.32, ease }}
              >
                <div
                  className="flex items-center gap-3.5"
                  style={{ paddingBottom: 22, marginBottom: 22, borderBottom: '1px solid rgb(var(--line))' }}
                >
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${GREEN}1a`, border: `1px solid ${GREEN}33` }}
                  >
                    <KeyRound className="h-5 w-5" style={{ color: GREEN }} />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-[19px] font-bold tracking-[-0.025em] leading-tight">
                      {t('reset.title')}
                    </h1>
                    <p className="text-[11.5px] mt-0.5 truncate" style={{ color: 'rgb(var(--text-subtle))' }}>
                      {email ?? t('reset.subtitle')}
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                  <div>
                    <label className="block mb-2" style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', color: 'rgb(var(--text-muted))' }}>
                      {t('reset.new_password').toUpperCase()}
                    </label>
                    <div className="relative">
                      <input
                        ref={pwdRef}
                        type={showPwd ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); setError(null) }}
                        placeholder="••••••••••••"
                        autoComplete="new-password"
                        required
                        style={{ ...inputBase, paddingRight: 48 }}
                        className="placeholder:text-text-subtle"
                        onFocus={(e) => { e.currentTarget.style.borderColor = `${GREEN}65`; e.currentTarget.style.background = 'rgba(16,212,81,0.04)' }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = 'rgb(var(--line))'; e.currentTarget.style.background = 'rgb(var(--surface))' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd((v) => !v)}
                        aria-label={t(showPwd ? 'reset.hide_password' : 'reset.show_password')}
                        className="absolute right-4 top-1/2 -translate-y-1/2"
                        style={{ color: 'rgb(var(--text-subtle))' }}
                      >
                        {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <PasswordStrength verdict={verdict} visible={password.length > 0} />
                  </div>

                  <div>
                    <label className="block mb-2" style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.1em', color: 'rgb(var(--text-muted))' }}>
                      {t('reset.confirm_password').toUpperCase()}
                    </label>
                    <div className="relative">
                      <input
                        type={showPwd ? 'text' : 'password'}
                        value={confirm}
                        onChange={(e) => { setConfirm(e.target.value); setError(null) }}
                        placeholder="••••••••••••"
                        autoComplete="new-password"
                        required
                        style={{ ...inputBase, paddingRight: 48 }}
                        className="placeholder:text-text-subtle"
                        onFocus={(e) => { e.currentTarget.style.borderColor = `${GREEN}65`; e.currentTarget.style.background = 'rgba(16,212,81,0.04)' }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = 'rgb(var(--line))'; e.currentTarget.style.background = 'rgb(var(--surface))' }}
                      />
                      <AnimatePresence>
                        {matches && (
                          <motion.span
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0, opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                            className="absolute right-12 top-1/2 -translate-y-1/2"
                          >
                            <Check className="h-4 w-4" style={{ color: GREEN }} strokeWidth={3} />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                    <AnimatePresence>
                      {confirm.length > 0 && !matches && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="text-[12px] mt-2 overflow-hidden text-danger"
                        >
                          {t('reset.mismatch')}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.p
                        initial={{ opacity: 0, y: -6, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="text-[12.5px] overflow-hidden text-danger"
                      >
                        {error}
                      </motion.p>
                    )}
                  </AnimatePresence>

                  <motion.button
                    type="submit"
                    disabled={!canSubmit}
                    whileHover={canSubmit ? { scale: 1.02 } : {}}
                    whileTap={canSubmit ? { scale: 0.96 } : {}}
                    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                    className="relative w-full flex items-center justify-center gap-2 overflow-hidden font-semibold text-black disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: GREEN, borderRadius: 14, padding: '14px 20px', fontSize: 15, marginTop: 4 }}
                  >
                    <span
                      aria-hidden
                      className="absolute inset-x-0 top-0 h-1/2 pointer-events-none"
                      style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 100%)' }}
                    />
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin relative z-10" />
                    ) : (
                      <>
                        <span className="relative z-10">{t('reset.submit')}</span>
                        <ArrowRight className="h-4 w-4 relative z-10" />
                      </>
                    )}
                  </motion.button>

                  <p className="text-[11px] leading-relaxed text-center mt-1" style={{ color: 'rgb(var(--text-subtle))' }}>
                    {t('reset.signout_notice')}
                  </p>
                </form>
              </motion.div>
            )}

            {/* ─────────── Listo ─────────── */}
            {stage === 'done' && (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, ease }}
                className="text-center py-2"
              >
                <motion.div
                  className="h-14 w-14 rounded-2xl flex items-center justify-center mb-5 mx-auto"
                  style={{ background: `${GREEN}1a`, border: `1px solid ${GREEN}33` }}
                  initial={{ scale: 0.6, rotate: -12 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 13 }}
                >
                  <ShieldCheck className="h-6 w-6" style={{ color: GREEN }} />
                </motion.div>
                <h1 className="text-[20px] font-bold tracking-[-0.03em] mb-2">{t('reset.done_title')}</h1>
                <p className="text-[13.5px] leading-relaxed mb-7" style={{ color: 'rgb(var(--text-muted))' }}>
                  {t('reset.done_desc')}
                </p>
                <motion.button
                  onClick={() => navigate('/', { replace: true })}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                  className="w-full flex items-center justify-center gap-2 font-semibold text-black"
                  style={{ background: GREEN, borderRadius: 14, padding: '13px 20px', fontSize: 14.5 }}
                >
                  {t('reset.done_cta')}
                  <ArrowRight className="h-4 w-4" />
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}
