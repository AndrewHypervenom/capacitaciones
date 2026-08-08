import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { BellOff, LifeBuoy, Megaphone, MessageSquareText, X } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { useAuth } from '@/hooks/useAuth'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useNotificationsStore } from '@/stores/notificationsStore'
import { useNotificationPrefs } from '@/stores/notificationPrefsStore'
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode'
import type { AppNotification } from '@/services/notifications.service'
import { cn } from '@/lib/cn'

/** Cuánto se queda una tarjeta en pantalla antes de irse sola. */
const DISMISS_MS = 12_000
/** Máximo de tarjetas apiladas: más que esto tapa la pantalla. */
const MAX_STACK = 3
/** Minutos del botón "Silenciar". */
const MUTE_MINUTES = 30

const EASE = [0.16, 1, 0.3, 1] as const

/** Los avisos "de trabajo" que interrumpen al staff. */
type PingKind = 'help_chat' | 'site_feedback' | 'site_feedback_reply'

/** Los que nacen de una opinión: comparten bandeja, cita y interruptor. */
const FEEDBACK_KINDS: PingKind[] = ['site_feedback', 'site_feedback_reply']

/**
 * Todo lo que cambia entre un aviso y otro. Lo demás (avatar con ondas, metadatos,
 * cita, autocierre, silenciar) es idéntico y se pinta una sola vez.
 */
const PING_META: Record<
  PingKind,
  {
    icon: typeof LifeBuoy
    /** Degradado del acento: halo, anillo del avatar y botón principal. */
    from: string
    to: string
    ring: string
    glow: string
    /** Resplandor de la esquina y sombra del botón, a juego con el degradado. */
    halo: string
    ctaShadow: string
    /** Chip del rol de quien escribió. */
    pill: string
    /** A dónde se va a atenderlo. */
    route: string
    ctaKey: string
    ctaFallback: string
  }
> = {
  help_chat: {
    icon: LifeBuoy,
    from: 'from-neon-green',
    to: 'to-neon-cyan',
    ring: 'ring-neon-green/60',
    glow: 'border-neon-green/50',
    halo: 'from-neon-green/25 to-neon-cyan/10',
    ctaShadow: 'shadow-neon-green/25',
    pill: 'bg-neon-green/12 text-neon-green',
    route: '/admin/chat',
    ctaKey: 'notifications.help_chat.open',
    ctaFallback: 'Ver la conversación',
  },
  site_feedback: {
    icon: Megaphone,
    from: 'from-neon-violet',
    to: 'to-neon-magenta',
    ring: 'ring-neon-violet/60',
    glow: 'border-neon-violet/50',
    halo: 'from-neon-violet/25 to-neon-magenta/10',
    ctaShadow: 'shadow-neon-violet/25',
    pill: 'bg-neon-violet/12 text-neon-violet',
    route: '/admin/site-feedback',
    ctaKey: 'notifications.site_feedback.open',
    ctaFallback: 'Ver la opinión',
  },
  // La respuesta en un hilo se distingue en azul: no es una opinión nueva, es
  // una conversación que sigue y que ya tiene a alguien esperando del otro lado.
  site_feedback_reply: {
    icon: MessageSquareText,
    from: 'from-sky-400',
    to: 'to-neon-cyan',
    ring: 'ring-sky-400/60',
    glow: 'border-sky-400/50',
    halo: 'from-sky-400/25 to-neon-cyan/10',
    ctaShadow: 'shadow-sky-400/25',
    pill: 'bg-sky-400/12 text-sky-400',
    route: '/admin/site-feedback',
    ctaKey: 'notifications.site_feedback.open_thread',
    ctaFallback: 'Ver la conversación',
  },
}

/** ¿Este aviso lo tiene que ver el staff en una tarjeta? */
function isStaffPing(n: AppNotification): boolean {
  if (n.kind === 'help_chat' || n.kind === 'site_feedback') return true
  // El aviso de respuesta viaja a los dos lados con la misma forma: solo el del
  // equipo se pinta aquí; el de quien opinó se anuncia con un emergente normal.
  return n.kind === 'site_feedback_reply' && n.payload?.for_staff === true
}

/**
 * Avisos en vivo para el staff: "alguien está pidiendo ayuda en el chat" y
 * "alguien acaba de dejar una opinión del sitio".
 *
 * Viven fuera de la campana a propósito. La campana es el registro (queda para
 * después); esto es la interrupción del momento, y por eso trae lo único que
 * hace falta para decidir si atender: quién escribió, de qué campaña, qué dijo
 * y desde qué pantalla. El sonido lo dispara `useResetNotifications` al llegar
 * el aviso; aquí solo se pinta.
 *
 * Quién ve qué lo decide la BD, no esta pantalla: el chat de ayuda solo se
 * notifica a los superadmin, y las opiniones a los superadmin más los
 * capacitadores de la campaña de quien opinó. Aquí solo se respeta el
 * interruptor de cada tipo (engranaje de la campana).
 *
 * Los mensajes seguidos de una misma persona llegan agrupados desde la BD
 * (payload.count), así que una persona insistente = una sola tarjeta que crece.
 */
export function StaffPings() {
  const { isAdminOrCapacitador } = useAuth()
  const justArrived = useNotificationsStore((s) => s.justArrived)
  const clearJustArrived = useNotificationsStore((s) => s.clearJustArrived)
  const markRead = useNotificationsStore((s) => s.markRead)
  const helpAlerts = useNotificationPrefs((s) => s.helpAlerts)
  const feedbackAlerts = useNotificationPrefs((s) => s.feedbackAlerts)

  // La respuesta a una opinión se apaga con el mismo interruptor que la opinión:
  // son la misma bandeja, y separarlos sería un ajuste más que nadie pidió.
  const enabled = useMemo(
    () => ({
      help_chat: helpAlerts,
      site_feedback: feedbackAlerts,
      site_feedback_reply: feedbackAlerts,
    }),
    [helpAlerts, feedbackAlerts],
  )

  const pings = useMemo(
    () =>
      justArrived
        .filter((n) => isStaffPing(n) && enabled[n.kind as PingKind])
        .slice(-MAX_STACK),
    [justArrived, enabled],
  )

  // Con un tipo de aviso apagado igual hay que vaciar su cola: si no, se
  // quedarían ahí y aparecerían de golpe al volver a encenderlo.
  useEffect(() => {
    for (const n of justArrived) {
      if (isStaffPing(n) && !enabled[n.kind as PingKind]) clearJustArrived(n.id)
    }
  }, [enabled, justArrived, clearJustArrived])

  if (IS_LEARNER_PREVIEW || !isAdminOrCapacitador) return null

  return createPortal(
    <div className="pointer-events-none fixed right-4 top-20 z-[9995] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2.5">
      <AnimatePresence initial={false} mode="popLayout">
        {pings.map((n) => (
          <PingCard
            key={n.id}
            notification={n}
            onDismiss={() => clearJustArrived(n.id)}
            onOpen={() => {
              void markRead(n.id)
              clearJustArrived(n.id)
            }}
          />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  )
}

function PingCard({
  notification: n,
  onDismiss,
  onOpen,
}: {
  notification: AppNotification
  onDismiss: () => void
  onOpen: () => void
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const muteFor = useNotificationPrefs((s) => s.muteFor)
  const [paused, setPaused] = useState(false)

  const kind = (PING_META[n.kind as PingKind] ? n.kind : 'help_chat') as PingKind
  const meta = PING_META[kind]
  const Icon = meta.icon
  const isFeedback = FEEDBACK_KINDS.includes(kind)
  const isReply = kind === 'site_feedback_reply'

  const p = n.payload ?? {}
  const count = Number(p.count) > 1 ? Number(p.count) : 1
  const name = p.from_name?.trim() || t('notifications.help_chat.someone', 'Alguien')
  const roleLabel =
    p.from_role === 'capacitador'
      ? t('roles.capacitador')
      : p.from_role === 'superadmin'
        ? t('roles.superadmin')
        : t('roles.learner')

  // Lo que se cita entre comillas: la pregunta al chat, o el texto de la opinión.
  const quote = isFeedback ? p.message : p.question
  // Qué hizo esa persona, en una línea.
  const action = isReply
    ? t('notifications.site_feedback.replied', 'respondió en su opinión')
    : isFeedback
    ? count > 1
      ? t('notifications.site_feedback.sent_many', {
          count,
          defaultValue: 'dejó {{count}} opiniones del sitio',
        })
      : t('notifications.site_feedback.sent_one', 'dejó una opinión del sitio')
    : count > 1
      ? t('notifications.help_chat.asked_many', {
          count,
          defaultValue: 'hizo {{count}} preguntas al asistente',
        })
      : t('notifications.help_chat.asked_one', 'está pidiendo ayuda al asistente')

  // Cierre automático, en pausa mientras el cursor está encima (leer lo que
  // escribieron no debe correr contra el reloj).
  useEffect(() => {
    if (paused) return
    const id = setTimeout(onDismiss, DISMISS_MS)
    return () => clearTimeout(id)
  }, [paused, onDismiss, n.payload?.count])

  const time = new Date(n.created_at).toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <motion.div
      layout
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: 64, scale: 0.94, filter: 'blur(6px)' }}
      animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 48, scale: 0.96, transition: { duration: 0.22 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className="pointer-events-auto relative overflow-hidden rounded-2xl border border-glass-border/12 bg-surface/95 shadow-2xl shadow-black/30 backdrop-blur-xl"
    >
      {/* Resplandor de marca en la esquina: identifica el tipo de aviso de un vistazo. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br blur-2xl',
          meta.halo,
        )}
      />

      <div className="relative flex gap-3 p-3.5">
        {/* Avatar con ondas: el "está sonando" hecho imagen. */}
        <div className="relative mt-0.5 h-11 w-11 shrink-0">
          {!reduce &&
            [0, 1].map((i) => (
              <motion.span
                key={i}
                aria-hidden
                className={cn('absolute inset-0 rounded-full border', meta.glow)}
                initial={{ scale: 1, opacity: 0.55 }}
                animate={{ scale: 1.85, opacity: 0 }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut', delay: i * 1.1 }}
              />
            ))}
          <Avatar src={p.from_avatar ?? null} name={name} size={44} className={cn('ring-2', meta.ring)} />
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-surface bg-gradient-to-br text-black',
              meta.from,
              meta.to,
            )}
          >
            <Icon className="h-2.5 w-2.5" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-[13px] font-semibold leading-tight text-text">
              <span className="truncate">{name}</span>{' '}
              <span className="font-normal text-text-muted">{action}</span>
            </p>
            <button
              onClick={onDismiss}
              aria-label={t('common.close', 'Cerrar')}
              className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-subtle hover:text-text"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Metadatos: rol, campaña, tipo de opinión y hora. */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-text-subtle">
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wide',
                meta.pill,
              )}
            >
              {roleLabel}
            </span>
            {isFeedback && p.feedback_kind && (
              <span className="rounded-full bg-subtle px-1.5 py-0.5 font-medium text-text-muted">
                {t(`site_feedback.kind.${p.feedback_kind}.label`)}
              </span>
            )}
            {p.campaign_name && <span className="truncate max-w-[140px]">· {p.campaign_name}</span>}
            <span>· {time}</span>
            <AnimatePresence>
              {count > 1 && (
                <motion.span
                  key={count}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 18 }}
                  className="rounded-full bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-500"
                >
                  ×{count}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          {/* Lo que escribió, tal cual. */}
          {quote && (
            <motion.p
              key={quote}
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE, delay: 0.08 }}
              className="mt-2 line-clamp-3 rounded-xl border border-line/70 bg-subtle/40 px-2.5 py-2 text-[12.5px] italic leading-snug text-text-muted"
            >
              “{quote}”
            </motion.p>
          )}

          {p.page && (
            <p className="mt-1.5 truncate text-[10.5px] text-text-subtle">
              {t('notifications.help_chat.from_page', 'Desde')}{' '}
              <span className="font-mono">{p.page_label || p.page}</span>
            </p>
          )}

          {/* Acciones */}
          <div className="mt-2.5 flex items-center gap-1.5">
            <motion.button
              whileHover={reduce ? undefined : { y: -1 }}
              whileTap={reduce ? undefined : { scale: 0.96 }}
              onClick={() => {
                onOpen()
                // La ficha exacta, no la bandeja entera: con siete opiniones ya
                // cuesta encontrar de cuál hablaba el aviso.
                navigate(isFeedback && p.feedback_id
                  ? `${meta.route}?id=${p.feedback_id}`
                  : meta.route)
              }}
              className={cn(
                'inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br px-3 py-1.5 text-[12px] font-semibold text-black shadow-md',
                meta.from,
                meta.to,
                meta.ctaShadow,
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(meta.ctaKey, meta.ctaFallback)}
            </motion.button>
            <button
              onClick={() => {
                muteFor(MUTE_MINUTES)
                onDismiss()
              }}
              title={t('notifications.prefs.mute_for', { count: MUTE_MINUTES, defaultValue: 'Silenciar {{count}} min' })}
              aria-label={t('notifications.prefs.mute_for', { count: MUTE_MINUTES, defaultValue: 'Silenciar {{count}} min' })}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-line text-text-subtle transition-colors hover:border-amber-500/40 hover:text-amber-500"
            >
              <BellOff className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Barra de vida: se congela mientras el cursor está encima. */}
      <div className="h-[3px] w-full bg-line/60">
        <motion.div
          key={`${n.id}:${count}:${paused}`}
          className={cn('h-full bg-gradient-to-r', meta.from, meta.to)}
          initial={{ width: '100%' }}
          animate={{ width: paused ? '100%' : '0%' }}
          transition={{ duration: paused ? 0 : DISMISS_MS / 1000, ease: 'linear' }}
        />
      </div>
    </motion.div>
  )
}
