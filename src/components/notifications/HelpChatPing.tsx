import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { BellOff, LifeBuoy, MessageSquareText, X } from 'lucide-react'
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

/**
 * Aviso en vivo para el superadmin: "alguien está pidiendo ayuda en el chat".
 *
 * Vive fuera de la campana a propósito. La campana es el registro (queda para
 * después); esto es la interrupción del momento, y por eso trae lo único que
 * hace falta para decidir si atender: quién pregunta, de qué campaña, qué
 * preguntó y desde qué pantalla. El sonido lo dispara `useResetNotifications`
 * al llegar el aviso; aquí solo se pinta.
 *
 * Las preguntas seguidas de una misma persona llegan agrupadas desde la BD
 * (payload.count), así que una persona atascada = una sola tarjeta que crece.
 */
export function HelpChatPing() {
  const { isSuperAdmin } = useAuth()
  const justArrived = useNotificationsStore((s) => s.justArrived)
  const clearJustArrived = useNotificationsStore((s) => s.clearJustArrived)
  const markRead = useNotificationsStore((s) => s.markRead)
  const helpAlerts = useNotificationPrefs((s) => s.helpAlerts)

  const pings = useMemo(
    () => justArrived.filter((n) => n.kind === 'help_chat').slice(-MAX_STACK),
    [justArrived],
  )

  // Con los avisos apagados igual hay que vaciar la cola: si no, se quedarían
  // ahí y aparecerían de golpe al volver a encenderlos.
  useEffect(() => {
    if (helpAlerts) return
    for (const n of justArrived) {
      if (n.kind === 'help_chat') clearJustArrived(n.id)
    }
  }, [helpAlerts, justArrived, clearJustArrived])

  if (IS_LEARNER_PREVIEW || !isSuperAdmin || !helpAlerts) return null

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

  const p = n.payload ?? {}
  const count = Number(p.count) > 1 ? Number(p.count) : 1
  const name = p.from_name?.trim() || t('notifications.help_chat.someone', 'Alguien')
  const roleLabel =
    p.from_role === 'capacitador'
      ? t('roles.capacitador')
      : p.from_role === 'superadmin'
        ? t('roles.superadmin')
        : t('roles.learner')

  // Cierre automático, en pausa mientras el cursor está encima (leer la pregunta
  // no debe correr contra el reloj).
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
      {/* Resplandor de marca en la esquina: identifica el aviso de un vistazo. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-neon-green/25 to-neon-cyan/10 blur-2xl"
      />

      <div className="relative flex gap-3 p-3.5">
        {/* Avatar con ondas: el "está sonando" hecho imagen. */}
        <div className="relative mt-0.5 h-11 w-11 shrink-0">
          {!reduce &&
            [0, 1].map((i) => (
              <motion.span
                key={i}
                aria-hidden
                className="absolute inset-0 rounded-full border border-neon-green/50"
                initial={{ scale: 1, opacity: 0.55 }}
                animate={{ scale: 1.85, opacity: 0 }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut', delay: i * 1.1 }}
              />
            ))}
          <Avatar
            src={p.from_avatar ?? null}
            name={name}
            size={44}
            className="ring-2 ring-neon-green/60"
          />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-surface bg-gradient-to-br from-neon-green to-neon-cyan text-black">
            <LifeBuoy className="h-2.5 w-2.5" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-[13px] font-semibold leading-tight text-text">
              <span className="truncate">{name}</span>{' '}
              <span className="font-normal text-text-muted">
                {count > 1
                  ? t('notifications.help_chat.asked_many', {
                      count,
                      defaultValue: 'hizo {{count}} preguntas al asistente',
                    })
                  : t('notifications.help_chat.asked_one', 'está pidiendo ayuda al asistente')}
              </span>
            </p>
            <button
              onClick={onDismiss}
              aria-label={t('common.close', 'Cerrar')}
              className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-subtle hover:text-text"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Metadatos: rol, campaña y hora. */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-text-subtle">
            <span className="rounded-full bg-neon-green/12 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-neon-green">
              {roleLabel}
            </span>
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

          {/* La pregunta, tal cual la escribió. */}
          {p.question && (
            <motion.p
              key={p.question}
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE, delay: 0.08 }}
              className="mt-2 line-clamp-3 rounded-xl border border-line/70 bg-subtle/40 px-2.5 py-2 text-[12.5px] italic leading-snug text-text-muted"
            >
              “{p.question}”
            </motion.p>
          )}

          {p.page && (
            <p className="mt-1.5 truncate text-[10.5px] text-text-subtle">
              {t('notifications.help_chat.from_page', 'Desde')} <span className="font-mono">{p.page}</span>
            </p>
          )}

          {/* Acciones */}
          <div className="mt-2.5 flex items-center gap-1.5">
            <motion.button
              whileHover={reduce ? undefined : { y: -1 }}
              whileTap={reduce ? undefined : { scale: 0.96 }}
              onClick={() => {
                onOpen()
                navigate('/admin/chat')
              }}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-neon-green to-neon-cyan px-3 py-1.5 text-[12px] font-semibold text-black shadow-md shadow-neon-green/25"
            >
              <MessageSquareText className="h-3.5 w-3.5" />
              {t('notifications.help_chat.open', 'Ver la conversación')}
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
          className={cn('h-full bg-gradient-to-r from-neon-green to-neon-cyan')}
          initial={{ width: paused ? '100%' : '100%' }}
          animate={{ width: paused ? '100%' : '0%' }}
          transition={{ duration: paused ? 0 : DISMISS_MS / 1000, ease: 'linear' }}
        />
      </div>
    </motion.div>
  )
}
