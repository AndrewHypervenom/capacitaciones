import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  MessageSquarePlus, X, ArrowLeft, ArrowRight, Send, Check, Sparkles,
  Loader2, Phone, Mail, Users, ChevronRight, Copy,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useHelpChatStore } from '@/stores/helpChatStore'
import { useSiteFeedbackStore } from '@/stores/siteFeedbackStore'
import { useFloatingDockStore } from '@/stores/floatingDockStore'
import {
  submitSiteFeedback,
  type ContactPref, type FeedbackKind, type FeedbackShot,
} from '@/services/siteFeedback.service'
import { ShotUploader } from './ShotUploader'
import {
  AREAS, KINDS, MOODS, TEAM_CONTACTS, areaFromPath, guessDevice, kindMeta, pageLabelFor,
  questionsFor, shouldShowFeedbackFab, type AreaKey,
} from './config'
import { cn } from '@/lib/cn'

const TOTAL_STEPS = 5
/** Una sola vez por navegador mostramos la invitación junto al botón. */
const INVITE_KEY = 'site_feedback_invite_seen'

type Step = 0 | 1 | 2 | 3 | 4

export function FeedbackWidget() {
  const { t, i18n } = useTranslation()
  const { isAuthenticated, displayName, profile, user } = useAuth()
  const location = useLocation()
  const reduce = useReducedMotion()
  const helpOpen = useHelpChatStore((s) => s.isOpen)
  const closeHelp = useHelpChatStore((s) => s.close)
  /** El botón vive en el rincón compartido: de ahí salen lado y visibilidad. */
  const dockSide = useFloatingDockStore((s) => s.side)
  const dockHidden = useFloatingDockStore((s) => s.hidden)

  // El panel se abre desde el botón flotante, desde el menú o desde "Mis
  // sugerencias": por eso su estado vive en un store compartido.
  const open = useSiteFeedbackStore((s) => s.isOpen)
  const openStore = useSiteFeedbackStore((s) => s.open)
  const closeStore = useSiteFeedbackStore((s) => s.close)
  const setOpen = (v: boolean) => (v ? openStore() : closeStore())

  const [step, setStep] = useState<Step>(0)
  /** +1 avanza, -1 retrocede: da dirección a la transición entre pasos. */
  const [dir, setDir] = useState(1)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(false)
  const [showInvite, setShowInvite] = useState(false)

  // Respuestas
  const [mood, setMood] = useState<number | null>(null)
  const [kind, setKind] = useState<FeedbackKind | null>(null)
  const [ease, setEase] = useState<number | null>(null)
  const [areas, setAreas] = useState<AreaKey[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [shots, setShots] = useState<FeedbackShot[]>([])
  /**
   * Carpeta de las capturas de ESTE borrador. Se genera una nueva por envío:
   * así las de una opinión no se mezclan con las de la siguiente, aunque la
   * persona escriba dos seguidas sin cerrar el panel.
   */
  const [shotFolder, setShotFolder] = useState(() => crypto.randomUUID())
  const [contactOk, setContactOk] = useState(false)
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [pref, setPref] = useState<ContactPref>('email')
  const [note, setNote] = useState('')

  /** Pantalla desde la que se abrió el formulario (se congela al abrir). */
  const originRef = useRef({ path: location.pathname, label: pageLabelFor(location.pathname) })

  const panelRef = useRef<HTMLDivElement>(null)
  const visible = isAuthenticated && shouldShowFeedbackFab(location.pathname)

  // Datos de contacto por defecto: los que ya conocemos, editables.
  useEffect(() => {
    if (user?.email) setEmail((e) => e || user.email || '')
    if (profile?.phone) setPhone((p) => p || profile.phone || '')
  }, [user?.email, profile?.phone])

  // Invitación sutil la primera vez, ya con el usuario ubicado en el sitio.
  useEffect(() => {
    if (!visible || open || dockHidden) return
    if (localStorage.getItem(INVITE_KEY)) return
    const id = setTimeout(() => setShowInvite(true), 6000)
    return () => clearTimeout(id)
  }, [visible, open])

  // Al abrirse —desde el botón, el menú o "Mis sugerencias"— congelamos desde
  // qué pantalla se está opinando y preseleccionamos lo que podemos deducir.
  useEffect(() => {
    if (!open) return
    originRef.current = { path: location.pathname, label: pageLabelFor(location.pathname) }
    const suggested = areaFromPath(location.pathname)
    setAreas((a) => (a.length === 0 && suggested ? [suggested] : a))
    setAnswers((a) => (a.device ? a : { ...a, device: guessDevice() }))
    // El chat de ayuda y este panel ocupan el mismo rincón: nunca los dos.
    if (helpOpen) closeHelp()
    // Solo al abrir: si el usuario navega con el panel abierto, el contexto
    // que vale sigue siendo el de la pantalla desde donde lo abrió.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // El panel scrollea por dentro: cada paso arranca desde arriba.
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  }, [step, reduce])

  if (!visible) return null

  const dismissInvite = () => {
    setShowInvite(false)
    localStorage.setItem(INVITE_KEY, '1')
  }

  function openPanel() {
    dismissInvite()
    setOpen(true)
  }

  // Solo se llama después de enviar: las capturas ya viajaron con la opinión,
  // así que aquí se sueltan (no se borran) y se estrena carpeta para la próxima.
  function reset() {
    setStep(0); setDir(1); setMood(null); setKind(null); setEase(null)
    setAreas([]); setAnswers({}); setMessage(''); setContactOk(false)
    setNote(''); setDone(false); setError(false)
    setShots([]); setShotFolder(crypto.randomUUID())
  }

  const go = (next: Step) => { setDir(next > step ? 1 : -1); setStep(next) }

  const presets = kind ? questionsFor(kind) : []

  /** Cada paso decide si ya se puede avanzar (nada obligatorio salvo lo mínimo). */
  const canAdvance =
    step === 0 ? mood !== null :
    step === 1 ? kind !== null :
    step === 4 ? (!contactOk || !!email.trim() || !!phone.trim()) :
    true

  async function send() {
    if (!kind || sending) return
    setSending(true)
    setError(false)
    try {
      await submitSiteFeedback({
        kind, mood, ease, areas: [...areas], answers, message, shots,
        contactOk,
        contactEmail: email, contactPhone: phone, contactPref: pref, contactNote: note,
        lang: i18n.resolvedLanguage ?? 'es',
        page: originRef.current.path,
        pageLabel: originRef.current.label,
      })
      setDone(true)
    } catch {
      setError(true)
    } finally {
      setSending(false)
    }
  }

  const firstName = displayName?.split(' ')[0] || ''
  const accent = kind ? kindMeta(kind).color : 'rgb(var(--brand-green))'

  return createPortal(
    <>
      {/* ── Invitación (una sola vez) ───────────────────────────── */}
      <AnimatePresence>
        {showInvite && !open && !dockHidden && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            // Justo encima del rincón flotante, del lado donde esté.
            className={cn(
              'fixed bottom-[4.75rem] z-[9991] w-[min(19rem,calc(100vw-2rem))] rounded-2xl border border-glass-border/10 glass-strong p-4 shadow-2xl shadow-black/30',
              dockSide === 'left' ? 'left-4 sm:left-5' : 'right-4 sm:right-5',
            )}
          >
            <button
              onClick={dismissInvite}
              aria-label={t('site_feedback.close', 'Cerrar')}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-subtle hover:text-text"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-neon-green to-neon-cyan text-black shadow-lg shadow-neon-green/25">
                <Sparkles className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0 pr-4">
                <p className="text-[13.5px] font-semibold text-text">
                  {t('site_feedback.invite_title', '¿Nos ayudas a mejorar?')}
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-text-muted">
                  {t('site_feedback.invite_desc', 'Cuéntanos qué te gustó y qué no. Toma menos de un minuto.')}
                </p>
                <button
                  onClick={openPanel}
                  className="mt-2.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-neon-green transition-transform hover:translate-x-0.5"
                >
                  {t('site_feedback.invite_cta', 'Dar mi opinión')}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* El botón que abre este panel ya no vive aquí: es una acción del rincón
          flotante compartido (CornerDock). Antes eran dos burbujas apiladas más
          la flecha de "volver arriba", y entre las tres tapaban el contenido. */}

      {/* ── Panel ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <>
            {/* Fondo solo en móvil: el panel ocupa casi toda la pantalla */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[9990] bg-black/50 sm:hidden"
              aria-hidden
            />
            <motion.div
              key="panel"
              role="dialog"
              aria-modal="true"
              aria-label={t('site_feedback.title', 'Tu opinión')}
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                'fixed z-[9992] flex flex-col overflow-hidden',
                // Fondo sólido, no cristal: el panel ocupa casi toda la pantalla
                // en móvil y sobre el degradado del panel del aprendiz el vidrio
                // dejaba los textos lavados y los chips ilegibles.
                'bg-surface border border-line shadow-2xl shadow-black/40',
                'bottom-0 right-0 left-0 h-[90vh] max-h-[calc(100dvh-2rem)] rounded-t-[28px]',
                // En escritorio se abre encima del rincón flotante, del lado
                // donde el usuario lo haya dejado.
                'sm:bottom-[4.75rem] sm:h-[640px] sm:max-h-[80vh] sm:w-[26rem] sm:rounded-[28px]',
                dockSide === 'left' ? 'sm:left-5 sm:right-auto' : 'sm:right-5 sm:left-auto',
              )}
            >
              {/* Asa de arrastre visual (móvil) */}
              <div className="flex justify-center pt-2.5 sm:hidden">
                <span className="h-1 w-10 rounded-full bg-text-subtle/30" />
              </div>

              <Header
                accent={accent}
                done={done}
                step={step}
                onClose={() => setOpen(false)}
              />

              {/* Contenido del paso */}
              <div ref={panelRef} className="help-scroll flex-1 overflow-y-auto px-5 pb-4 pt-4">
                <AnimatePresence mode="wait" initial={false} custom={dir}>
                  {done ? (
                    <StepShell key="done" dir={dir} reduce={!!reduce}>
                      <SuccessView
                        reduce={!!reduce}
                        onAgain={() => { reset() }}
                        onClose={() => { setOpen(false); setTimeout(reset, 400) }}
                      />
                    </StepShell>
                  ) : step === 0 ? (
                    <StepShell key="mood" dir={dir} reduce={!!reduce}>
                      <StepTitle
                        title={firstName
                          ? t('site_feedback.mood_title_name', { name: firstName, defaultValue: '{{name}}, ¿cómo te ha ido en el sitio?' })
                          : t('site_feedback.mood_title', '¿Cómo te ha ido en el sitio?')}
                        subtitle={t('site_feedback.mood_subtitle', 'Tu respuesta nos dice por dónde empezar a mejorar.')}
                      />
                      <MoodPicker
                        value={mood}
                        reduce={!!reduce}
                        onPick={(v) => { setMood(v); setTimeout(() => go(1), reduce ? 0 : 260) }}
                      />
                    </StepShell>
                  ) : step === 1 ? (
                    <StepShell key="kind" dir={dir} reduce={!!reduce}>
                      <StepTitle
                        title={t('site_feedback.kind_title', '¿Qué quieres contarnos?')}
                        subtitle={t('site_feedback.kind_subtitle', 'Elige lo que más se parezca a lo que tienes en mente.')}
                      />
                      <div className="space-y-2.5">
                        {KINDS.map((k, i) => (
                          <motion.button
                            key={k.key}
                            onClick={() => { setKind(k.key); setTimeout(() => go(2), reduce ? 0 : 220) }}
                            initial={reduce ? false : { opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.06 * i, duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                            whileHover={reduce ? undefined : { x: 3 }}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors',
                              kind === k.key ? 'bg-subtle/70' : 'border-line bg-subtle/25 hover:bg-subtle/50',
                            )}
                            style={kind === k.key ? { borderColor: k.color, boxShadow: `0 0 0 1px ${k.color}55` } : undefined}
                          >
                            <span
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[20px]"
                              style={{ background: `${k.color}1f` }}
                            >
                              {k.emoji}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[14px] font-semibold text-text">
                                {t(`site_feedback.kind.${k.key}.label`)}
                              </span>
                              <span className="block text-[12px] leading-snug text-text-muted">
                                {t(`site_feedback.kind.${k.key}.desc`)}
                              </span>
                            </span>
                            <ArrowRight className="h-4 w-4 shrink-0 text-text-subtle" />
                          </motion.button>
                        ))}
                      </div>
                    </StepShell>
                  ) : step === 2 ? (
                    <StepShell key="detail" dir={dir} reduce={!!reduce}>
                      <StepTitle
                        title={t('site_feedback.detail_title', 'Cuéntanos un poco más')}
                        subtitle={t('site_feedback.detail_subtitle', 'Toques rápidos, sin escribir nada.')}
                      />

                      {/* Facilidad */}
                      <Field label={t('site_feedback.ease_title', '¿Qué tan fácil te resultó lo que estabas haciendo?')}>
                        <ScalePicker
                          value={ease}
                          accent={accent}
                          lowLabel={t('site_feedback.ease_low', 'Difícil')}
                          highLabel={t('site_feedback.ease_high', 'Muy fácil')}
                          onPick={setEase}
                        />
                      </Field>

                      {/* Preguntas predefinidas según el tipo */}
                      {presets.map((q) => (
                        <Field key={q.key} label={t(`site_feedback.q.${q.key}.title`)}>
                          <div className="flex flex-wrap gap-2">
                            {q.options.map((opt) => {
                              const active = answers[q.key] === opt
                              return (
                                <Chip
                                  key={opt}
                                  active={active}
                                  accent={accent}
                                  onClick={() => setAnswers((a) => ({ ...a, [q.key]: active ? '' : opt }))}
                                >
                                  {t(`site_feedback.q.${q.key}.opt.${opt}`)}
                                </Chip>
                              )
                            })}
                          </div>
                        </Field>
                      ))}

                      {/* Zonas del sitio */}
                      <Field
                        label={t('site_feedback.areas_title', '¿De qué parte del sitio hablas?')}
                        hint={t('site_feedback.areas_hint', 'Puedes elegir varias')}
                      >
                        <div className="flex flex-wrap gap-2">
                          {AREAS.map((a) => {
                            const active = areas.includes(a)
                            return (
                              <Chip
                                key={a}
                                active={active}
                                accent={accent}
                                onClick={() => setAreas((cur) => (active ? cur.filter((x) => x !== a) : [...cur, a]))}
                              >
                                {t(`site_feedback.areas.${a}`)}
                              </Chip>
                            )
                          })}
                        </div>
                      </Field>
                    </StepShell>
                  ) : step === 3 ? (
                    <StepShell key="message" dir={dir} reduce={!!reduce}>
                      <StepTitle
                        title={t('site_feedback.message_title', 'Escríbelo con tus palabras')}
                        subtitle={t('site_feedback.message_subtitle', 'Entre más detalle, más rápido lo arreglamos.')}
                      />
                      <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value.slice(0, 1500))}
                        rows={7}
                        autoFocus
                        placeholder={t(`site_feedback.message_ph.${kind ?? 'idea'}`)}
                        className="w-full resize-none rounded-2xl border border-line bg-subtle/40 px-3.5 py-3 text-[13.5px] leading-relaxed text-text placeholder:text-text-subtle transition-colors focus:bg-subtle/60 focus:outline-none"
                        style={{ borderColor: message ? `${accent}66` : undefined }}
                      />
                      <div className="mt-1.5 flex items-center justify-between text-[11px] text-text-subtle">
                        <span>{t('site_feedback.message_optional', 'Opcional, pero se agradece muchísimo')}</span>
                        <span className="tabular-nums">{message.length}/1500</span>
                      </div>
                      {/* Capturas: en un reporte de error valen más que el
                          texto, y aquí caen justo donde se está describiendo. */}
                      <div className="mt-5">
                        <p className="mb-2 text-[12.5px] font-medium text-text">
                          {kind === 'bug'
                            ? t('site_feedback.shots.title_bug', 'Muéstranos el error')
                            : t('site_feedback.shots.title', '¿Nos muestras una captura?')}
                          <span className="ml-1.5 font-normal text-text-subtle">
                            · {t('site_feedback.shots.optional', 'opcional')}
                          </span>
                        </p>
                        <ShotUploader
                          folder={shotFolder}
                          shots={shots}
                          onChange={setShots}
                          accent={accent}
                          captureGlobalPaste
                        />
                      </div>

                      <p className="mt-4 rounded-xl border border-line bg-subtle/30 px-3 py-2 text-[11.5px] text-text-muted">
                        {t('site_feedback.page_context', 'Enviado desde: {{page}}', { page: originRef.current.label })}
                      </p>
                    </StepShell>
                  ) : (
                    <StepShell key="contact" dir={dir} reduce={!!reduce}>
                      <StepTitle
                        title={t('site_feedback.contact_title', '¿Quieres que te contactemos?')}
                        subtitle={t('site_feedback.contact_subtitle', 'Solo si prefieres que alguien te escriba o te llame.')}
                      />

                      <button
                        onClick={() => setContactOk((v) => !v)}
                        role="switch"
                        aria-checked={contactOk}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors',
                          contactOk ? 'bg-subtle/70' : 'border-line bg-subtle/25 hover:bg-subtle/50',
                        )}
                        style={contactOk ? { borderColor: accent } : undefined}
                      >
                        <span
                          className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', contactOk ? '' : 'bg-line')}
                          style={contactOk ? { background: accent } : undefined}
                        >
                          <motion.span
                            layout
                            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                            className={cn(
                              'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm',
                              contactOk ? 'left-[1.375rem]' : 'left-0.5',
                            )}
                          />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-semibold text-text">
                            {t('site_feedback.contact_toggle', 'Sí, quiero que me contacten')}
                          </span>
                          <span className="block text-[11.5px] leading-snug text-text-muted">
                            {t('site_feedback.contact_toggle_hint', 'Tu capacitador verá tus datos para responderte.')}
                          </span>
                        </span>
                      </button>

                      <AnimatePresence initial={false}>
                        {contactOk && (
                          <motion.div
                            initial={reduce ? false : { opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                            className="overflow-hidden"
                          >
                            <div className="space-y-3 pt-4">
                              <Field label={t('site_feedback.contact_pref', '¿Cómo prefieres que te busquemos?')}>
                                <div className="grid grid-cols-3 gap-2">
                                  {([
                                    { key: 'email', icon: Mail },
                                    { key: 'teams', icon: Users },
                                    { key: 'call', icon: Phone },
                                  ] as { key: ContactPref; icon: typeof Mail }[]).map(({ key, icon: Icon }) => {
                                    const active = pref === key
                                    return (
                                      <button
                                        key={key}
                                        onClick={() => setPref(key)}
                                        className={cn(
                                          'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-[11.5px] font-medium transition-colors',
                                          active ? 'text-text' : 'border-line text-text-muted hover:bg-subtle/50',
                                        )}
                                        style={active ? { borderColor: accent, background: `${accent}14`, color: accent } : undefined}
                                      >
                                        <Icon className="h-4 w-4" />
                                        {t(`site_feedback.contact_pref_${key}`)}
                                      </button>
                                    )
                                  })}
                                </div>
                              </Field>

                              <Field label={t('site_feedback.contact_email', 'Correo')}>
                                <input
                                  type="email"
                                  value={email}
                                  onChange={(e) => setEmail(e.target.value)}
                                  placeholder="tucorreo@empresa.com"
                                  className="w-full rounded-xl border border-line bg-subtle/40 px-3 py-2.5 text-[13px] text-text placeholder:text-text-subtle focus:outline-none focus:bg-subtle/60"
                                />
                              </Field>

                              <Field label={t('site_feedback.contact_phone', 'Teléfono / WhatsApp')}>
                                <input
                                  type="tel"
                                  value={phone}
                                  onChange={(e) => setPhone(e.target.value)}
                                  placeholder="+57 300 000 0000"
                                  className="w-full rounded-xl border border-line bg-subtle/40 px-3 py-2.5 text-[13px] text-text placeholder:text-text-subtle focus:outline-none focus:bg-subtle/60"
                                />
                              </Field>

                              <Field label={t('site_feedback.contact_note', '¿Cuándo es buen momento?')}>
                                <input
                                  type="text"
                                  value={note}
                                  onChange={(e) => setNote(e.target.value.slice(0, 200))}
                                  placeholder={t('site_feedback.contact_note_ph', 'Ej.: en la mañana, después de las 10')}
                                  className="w-full rounded-xl border border-line bg-subtle/40 px-3 py-2.5 text-[13px] text-text placeholder:text-text-subtle focus:outline-none focus:bg-subtle/60"
                                />
                              </Field>

                              <p className="text-[11px] leading-relaxed text-text-subtle">
                                {t('site_feedback.contact_privacy', 'Solo tu capacitador y el equipo del sitio ven estos datos, y únicamente para responderte.')}
                              </p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <TeamContacts accent={accent} />

                      {error && (
                        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[12.5px] text-red-400">
                          {t('site_feedback.error', 'No pudimos enviar tu opinión. Revisa tu conexión e inténtalo otra vez.')}
                        </p>
                      )}
                    </StepShell>
                  )}
                </AnimatePresence>
              </div>

              {/* Pie: navegación entre pasos */}
              {!done && (
                <div className="border-t border-line/70 p-3">
                  <div className="flex items-center gap-2">
                    {step > 0 && (
                      <button
                        onClick={() => go((step - 1) as Step)}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-text-muted transition-colors hover:bg-subtle hover:text-text"
                        aria-label={t('site_feedback.back', 'Atrás')}
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </button>
                    )}
                    {step < TOTAL_STEPS - 1 ? (
                      <motion.button
                        onClick={() => canAdvance && go((step + 1) as Step)}
                        disabled={!canAdvance}
                        whileTap={canAdvance ? { scale: 0.98 } : undefined}
                        className={cn(
                          'flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold transition-colors',
                          canAdvance ? 'text-white' : 'bg-line text-text-subtle',
                        )}
                        style={canAdvance ? { background: accent, color: '#fff' } : undefined}
                      >
                        {t('site_feedback.next', 'Continuar')}
                        <ArrowRight className="h-4 w-4" />
                      </motion.button>
                    ) : (
                      <motion.button
                        onClick={send}
                        disabled={sending || !canAdvance}
                        whileTap={!sending && canAdvance ? { scale: 0.98 } : undefined}
                        className={cn(
                          'flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-[13.5px] font-semibold transition-colors',
                          !sending && canAdvance ? 'text-white' : 'bg-line text-text-subtle',
                        )}
                        style={!sending && canAdvance ? { background: accent, color: '#fff' } : undefined}
                      >
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {sending ? t('site_feedback.sending', 'Enviando…') : t('site_feedback.send', 'Enviar opinión')}
                      </motion.button>
                    )}
                  </div>
                  {step === 3 && (
                    <button
                      onClick={() => go(4)}
                      className="mt-2 w-full text-center text-[12px] text-text-subtle transition-colors hover:text-text"
                    >
                      {t('site_feedback.skip', 'Prefiero no escribir nada')}
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>,
    document.body,
  )
}

// ─────────────────────────────────────────────────────────────
// Cabecera: título, progreso y cierre
// ─────────────────────────────────────────────────────────────
function Header({ accent, done, step, onClose }: {
  accent: string
  done: boolean
  step: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const pct = done ? 100 : ((step + 1) / TOTAL_STEPS) * 100

  return (
    <div className="relative overflow-hidden border-b border-line/70">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.13]"
        style={{ background: `linear-gradient(135deg, ${accent}, transparent 65%)` }}
      />
      <div className="relative flex items-center gap-3 px-4 py-3.5">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-lg"
          style={{ background: accent, boxShadow: `0 8px 20px -8px ${accent}` }}
        >
          <MessageSquarePlus className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold leading-tight text-text">
            {t('site_feedback.title', 'Tu opinión')}
            <span className="rounded-full bg-fuchsia-500/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-fuchsia-400">
              {t('site_feedback.badge', 'Beta')}
            </span>
          </p>
          <p className="text-[11.5px] leading-tight text-text-muted">
            {done
              ? t('site_feedback.step_done', '¡Listo!')
              : t('site_feedback.step_of', 'Paso {{n}} de {{total}}', { n: step + 1, total: TOTAL_STEPS })}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label={t('site_feedback.close', 'Cerrar')}
          className="flex h-9 w-9 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-subtle hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* Barra de progreso */}
      <div className="h-[3px] w-full bg-line/60">
        <motion.div
          className="h-full rounded-r-full"
          style={{ background: accent }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Envoltura de cada paso: entra y sale en la dirección del avance
// ─────────────────────────────────────────────────────────────
function StepShell({ children, dir, reduce }: { children: React.ReactNode; dir: number; reduce: boolean }) {
  return (
    <motion.div
      custom={dir}
      initial={reduce ? false : { opacity: 0, x: dir * 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * -28 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

function StepTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-[17px] font-bold leading-snug text-text text-balance">{title}</h3>
      <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">{subtitle}</p>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-2 text-[12.5px] font-medium text-text">
        {label}
        {hint && <span className="ml-1.5 font-normal text-text-subtle">· {hint}</span>}
      </p>
      {children}
    </div>
  )
}

function Chip({ active, accent, onClick, children }: {
  active: boolean
  accent: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      className={cn(
        'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
        active ? 'text-text' : 'border-line bg-subtle/30 text-text-muted hover:bg-subtle/60 hover:text-text',
      )}
      style={active ? { borderColor: accent, background: `${accent}1f`, color: accent } : undefined}
    >
      {children}
    </motion.button>
  )
}

// ─────────────────────────────────────────────────────────────
// Correos del equipo: para quien prefiere escribirnos directo
// ─────────────────────────────────────────────────────────────
function TeamContacts({ accent }: { accent: string }) {
  const { t } = useTranslation()
  const subject = encodeURIComponent(t('site_feedback.team_subject', 'Opinión sobre la plataforma'))
  /** Qué se acaba de copiar: el correo de alguien o 'all'. Se borra solo. */
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(null), 2000)
    } catch { /* portapapeles bloqueado: el correo sigue visible para copiarlo a mano */ }
  }

  const allEmails = TEAM_CONTACTS.map((c) => c.email).join('; ')

  return (
    <div className="mt-6 border-t border-line/70 pt-4">
      <p className="text-[12.5px] font-medium text-text">
        {t('site_feedback.team_title', '¿Prefieres escribirnos directo?')}
      </p>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-muted">
        {t('site_feedback.team_desc', 'Este es el equipo que revisa las opiniones. Escríbenos cuando quieras.')}
      </p>
      <div className="mt-2.5 space-y-1.5">
        {TEAM_CONTACTS.map((c) => {
          const isCopied = copied === c.email
          return (
            <div
              key={c.email}
              className="flex items-center gap-2.5 rounded-xl border border-line bg-subtle/25 px-3 py-2 transition-colors hover:bg-subtle/40"
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{ background: `${accent}1f`, color: accent }}
              >
                <Mail className="h-3.5 w-3.5" />
              </span>
              {/* El correo también se puede seleccionar a mano: no lo tapamos */}
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium leading-tight text-text">{c.name}</span>
                <span className="block truncate text-[11px] leading-tight text-text-muted">{c.email}</span>
              </span>
              <button
                type="button"
                onClick={() => void copy(c.email, c.email)}
                aria-label={t('site_feedback.team_copy', 'Copiar correo')}
                title={t('site_feedback.team_copy', 'Copiar correo')}
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors',
                  isCopied ? 'border-transparent' : 'border-line text-text-muted hover:bg-subtle hover:text-text',
                )}
                style={isCopied ? { background: `${accent}1f`, color: accent } : undefined}
              >
                {isCopied ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              <a
                href={`mailto:${c.email}?subject=${subject}`}
                aria-label={t('site_feedback.team_write', 'Escribir correo')}
                title={t('site_feedback.team_write', 'Escribir correo')}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-text-muted transition-colors hover:bg-subtle hover:text-text"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => void copy(allEmails, 'all')}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-[12px] font-medium text-text-muted transition-colors hover:bg-subtle hover:text-text"
      >
        {copied === 'all' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Copy className="h-3.5 w-3.5" />}
        {copied === 'all'
          ? t('site_feedback.team_copied_all', 'Los tres correos quedaron copiados')
          : t('site_feedback.team_copy_all', 'Copiar los tres correos')}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Selector de ánimo: caritas que crecen al elegirlas
// ─────────────────────────────────────────────────────────────
function MoodPicker({ value, onPick, reduce }: {
  value: number | null
  onPick: (v: number) => void
  reduce: boolean
}) {
  const { t } = useTranslation()
  return (
    <div>
      <div className="flex items-end justify-between gap-1">
        {MOODS.map((m, i) => {
          const active = value === m.value
          return (
            <motion.button
              key={m.value}
              onClick={() => onPick(m.value)}
              aria-label={t(`site_feedback.mood.${m.value}`)}
              aria-pressed={active}
              initial={reduce ? false : { opacity: 0, y: 16, scale: 0.7 }}
              animate={{
                opacity: value === null || active ? 1 : 0.45,
                y: 0,
                scale: active ? 1.12 : 1,
              }}
              transition={{ delay: reduce ? 0 : 0.05 * i, type: 'spring', stiffness: 320, damping: 22 }}
              whileHover={reduce ? undefined : { scale: active ? 1.14 : 1.09, y: -3 }}
              whileTap={{ scale: 0.94 }}
              className={cn(
                'flex flex-1 flex-col items-center gap-1.5 rounded-2xl border px-1 py-3 transition-colors',
                active ? 'border-neon-green bg-neon-green/10' : 'border-transparent hover:bg-subtle/50',
              )}
            >
              <span className="text-[27px] leading-none">{m.emoji}</span>
              <span className={cn('text-[10px] font-medium leading-tight text-center', active ? 'text-neon-green' : 'text-text-subtle')}>
                {t(`site_feedback.mood.${m.value}`)}
              </span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Escala 1-5 con extremos etiquetados
// ─────────────────────────────────────────────────────────────
function ScalePicker({ value, onPick, accent, lowLabel, highLabel }: {
  value: number | null
  onPick: (v: number | null) => void
  accent: string
  lowLabel: string
  highLabel: string
}) {
  return (
    <div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value !== null && n <= value
          const exact = value === n
          return (
            <motion.button
              key={n}
              onClick={() => onPick(value === n ? null : n)}
              whileTap={{ scale: 0.92 }}
              aria-label={String(n)}
              aria-pressed={exact}
              className={cn(
                'h-10 flex-1 rounded-xl border text-[13px] font-semibold tabular-nums transition-colors',
                active ? 'text-white' : 'border-line bg-subtle/30 text-text-muted hover:bg-subtle/60',
              )}
              style={active
                ? { background: accent, borderColor: accent, color: '#fff', opacity: exact ? 1 : 0.55 }
                : undefined}
            >
              {n}
            </motion.button>
          )
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] text-text-subtle">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Confirmación con celebración breve
// ─────────────────────────────────────────────────────────────
function SuccessView({ onAgain, onClose, reduce }: {
  onAgain: () => void
  onClose: () => void
  reduce: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="relative flex flex-col items-center pt-6 text-center">
      {/* Confeti sencillo: partículas que salen del check */}
      {!reduce && (
        <div className="pointer-events-none absolute left-1/2 top-12 h-0 w-0">
          {Array.from({ length: 14 }).map((_, i) => {
            const angle = (i / 14) * Math.PI * 2
            const dist = 60 + (i % 4) * 22
            const colors = ['#10D451', '#B33D9E', '#38bdf8', '#f59e0b']
            return (
              <motion.span
                key={i}
                className="absolute h-1.5 w-1.5 rounded-full"
                style={{ background: colors[i % colors.length] }}
                initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                animate={{
                  opacity: 0,
                  x: Math.cos(angle) * dist,
                  y: Math.sin(angle) * dist,
                  scale: 0.4,
                }}
                transition={{ duration: 1.1, delay: 0.1 + (i % 5) * 0.04, ease: 'easeOut' }}
              />
            )
          })}
        </div>
      )}

      <motion.div
        initial={reduce ? false : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 16 }}
        className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-neon-green to-neon-cyan text-black shadow-xl shadow-neon-green/30"
      >
        <Check className="h-10 w-10" strokeWidth={3} />
      </motion.div>

      <motion.h3
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mt-5 text-[19px] font-bold text-text"
      >
        {t('site_feedback.done_title', '¡Gracias! Ya lo tenemos')}
      </motion.h3>
      <motion.p
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.26, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mt-2 max-w-[19rem] text-[13px] leading-relaxed text-text-muted"
      >
        {t('site_feedback.done_desc', 'Tu opinión llega directo al equipo. Si pediste que te contactaran, te buscaremos pronto.')}
      </motion.p>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.34, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mt-7 w-full space-y-2"
      >
        <Link
          to="/suggestions"
          onClick={onClose}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-subtle px-4 py-3 text-[13px] font-semibold text-text transition-colors hover:bg-line"
        >
          {t('site_feedback.done_see_mine', 'Ver mis sugerencias')}
          <ChevronRight className="h-4 w-4" />
        </Link>
        <button
          onClick={onAgain}
          className="w-full rounded-xl px-4 py-2.5 text-[12.5px] font-medium text-text-muted transition-colors hover:text-text"
        >
          {t('site_feedback.done_again', 'Quiero contar algo más')}
        </button>
      </motion.div>
    </div>
  )
}
