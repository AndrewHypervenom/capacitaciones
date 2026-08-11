import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, Eye, Lock, MessageSquare } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import type { ThreadStaffer, ThreadSummary } from '@/services/feedbackThread.service'
import { fmtExact, fmtRelative } from './time'

/**
 * Quién del equipo ya atendió esta opinión.
 *
 * Es la respuesta a la pregunta que se hace cualquiera antes de escribir: ¿ya le
 * contestó alguien? Sin esto, dos personas del equipo —un capacitador y el
 * superadmin, o dos capacitadores de la misma campaña— le responden lo mismo a
 * la misma persona con minutos de diferencia. Por eso la cara de quien atendió
 * viaja hasta la lista: se ve antes de abrir, no después de escribir.
 */

const EASE = [0.16, 1, 0.3, 1] as const

// En hex, no en el token `rgb(var(--brand-green))`: estos colores se concatenan
// con la opacidad (`${tone}12`) para los fondos, y eso solo funciona con hex.
const ANSWERED = '#10D451'
const NOTES_ONLY = '#f59e0b'

/** El color dice qué hizo esa persona: responder hacia afuera, o solo anotar. */
export function stafferTone(s: ThreadStaffer) {
  return s.onlyNotes ? NOTES_ONLY : ANSWERED
}

/**
 * Las caras del equipo que ya pasó por aquí, apiladas. El anillo de color separa
 * a quien le habló a la persona (verde) de quien solo dejó una nota interna
 * (ámbar): responder y anotar no son lo mismo, y confundirlos es justo lo que
 * lleva a la respuesta duplicada.
 */
export function StaffStack({ staff, size = 22, max = 3, viewerId, className }: {
  staff: ThreadStaffer[]
  size?: number
  max?: number
  viewerId?: string | null
  className?: string
}) {
  const reduce = useReducedMotion()
  if (staff.length === 0) return null

  const shown = staff.slice(0, max)
  const rest = staff.slice(max)

  return (
    <span className={cn('inline-flex items-center', className)}>
      {shown.map((s, i) => (
        // El tooltip envuelve por fuera y se queda quieto sobre la cara: una
        // ficha con avatar siguiendo al cursor marea, y aquí lo que se viene a
        // leer —quién es y qué hizo— pide un segundo de lectura.
        <Tooltip
          key={s.id}
          anchor="element"
          variant="panel"
          className={cn('relative', i > 0 && '-ml-1.5')}
          label={<StafferCard staffer={s} viewerId={viewerId} />}
        >
          <motion.span
            initial={reduce ? false : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 520, damping: 26, delay: i * 0.05 }}
            whileHover={reduce ? undefined : { y: -2, scale: 1.06 }}
            className="relative block rounded-full"
            style={{ zIndex: shown.length - i }}
          >
            {/* El aro va como caja propia y no como `ring`: así el color del
                estado se ve entero aunque el avatar caiga sobre otro avatar. */}
            <span
              className="block rounded-full p-[1.5px]"
              style={{ background: stafferTone(s) }}
            >
              <span className="block rounded-full p-[1.5px]" style={{ background: 'rgb(var(--surface))' }}>
                <Avatar src={s.avatar} name={s.name} size={size} />
              </span>
            </span>
          </motion.span>
        </Tooltip>
      ))}
      {rest.length > 0 && (
        // El "+2" también se explica: si no, es el único punto de la fila que
        // esconde nombres sin decir cuáles.
        <Tooltip
          anchor="element"
          variant="panel"
          className="-ml-1.5"
          label={
            <span className="flex flex-col gap-1.5">
              {rest.map((s) => <StafferCard key={s.id} staffer={s} viewerId={viewerId} />)}
            </span>
          }
        >
          <span
            className="inline-flex items-center justify-center rounded-full bg-subtle text-[10px] font-bold text-text-muted ring-2 ring-surface"
            style={{ width: size + 3, height: size + 3 }}
          >
            +{rest.length}
          </span>
        </Tooltip>
      )}
    </span>
  )
}

/** Quién es y qué hizo, con su cara: el contenido del globo de cada avatar. */
function StafferCard({ staffer: s, viewerId }: {
  staffer: ThreadStaffer
  viewerId?: string | null
}) {
  const { t } = useTranslation()
  return (
    <span className="flex items-center gap-2">
      <Avatar src={s.avatar} name={s.name} size={26} />
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold text-text">
          {s.id === viewerId
            ? t('feedback_thread.you', 'Tú')
            : s.name ?? t('feedback_thread.someone', 'Alguien del equipo')}
        </span>
        <span style={{ color: stafferTone(s) }}>
          {s.onlyNotes
            ? t('feedback_handled.only_note', 'dejó una nota interna')
            : t('feedback_handled.replied_verb', 'respondió')}
          {' · '}
          <span className="text-text-muted">{fmtRelative(s.at)}</span>
        </span>
        <span className="text-[10.5px] text-text-subtle">{fmtExact(s.at)}</span>
      </span>
    </span>
  )
}

/**
 * La misma información en una línea, para la lista: cara + "Respondió Ana ·
 * hace 2 h". Cuando nadie ha respondido no pinta nada — el hueco vacío ya es la
 * señal, y para eso está el chip de "Esperando respuesta".
 */
export function HandledByLine({ summary, viewerId, className }: {
  summary: ThreadSummary
  viewerId: string | null
  className?: string
}) {
  const { t } = useTranslation()
  if (summary.staff.length === 0) return null

  const last = summary.lastReplyBy ?? summary.staff[0]
  const mine = last.id === viewerId
  const tone = stafferTone(last)
  const who = mine
    ? t('feedback_thread.you', 'Tú')
    : last.name ?? t('feedback_thread.someone', 'Alguien del equipo')

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-[11px]', className)}>
      <StaffStack staff={summary.staff} viewerId={viewerId} size={18} max={3} />
      {/* El texto lleva su propio globo con la fecha exacta y el recuento del
          hilo: en la lista solo cabe "hace 2 h", y a veces lo que hace falta
          saber es si fue ayer a las 6 o esta mañana. */}
      <Tooltip
        anchor="element"
        variant="panel"
        maxWidth={260}
        className="min-w-0"
        label={
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold text-text">{fmtExact(last.at)}</span>
            <span className="text-text-muted">
              {t('feedback_handled.thread_size', {
                count: summary.replies,
                defaultValue: '{{count}} mensajes en la conversación',
              })}
              {summary.notes > 0 && (
                ` · ${t('feedback_handled.notes_count', {
                  count: summary.notes,
                  defaultValue: '{{count}} notas internas',
                })}`
              )}
            </span>
          </span>
        }
      >
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className="truncate" style={{ color: tone }}>
            {last.onlyNotes
              ? t('feedback_handled.noted_by', '{{who}} anotó', { who })
              : mine
                ? t('feedback_handled.you_replied', 'Respondiste tú')
                : t('feedback_handled.replied_by', 'Respondió {{who}}', { who })}
          </span>
          <span className="shrink-0 text-text-subtle">· {fmtRelative(last.at)}</span>
        </span>
      </Tooltip>
    </span>
  )
}

/**
 * La franja de la ficha: lo primero que se ve al abrir una opinión, encima de la
 * conversación. Dice en una línea si esto ya está atendido, por quién y hace
 * cuánto — y, si hay alguien más mirándola ahora mismo, también eso, que es el
 * choque que ni el historial puede avisar.
 */
export function AttentionBar({ summary, viewerId, awaiting, watchers, className }: {
  summary: ThreadSummary
  viewerId: string | null
  /** Nadie ha respondido, o la última palabra es de la persona. */
  awaiting: boolean
  /** Compañeros con esta misma opinión abierta ahora mismo. */
  watchers?: { user_id: string; name: string; avatar_url: string | null }[]
  className?: string
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const last = summary.lastReplyBy ?? summary.staff[0] ?? null
  const answered = !!summary.lastReplyBy

  const tone = answered ? ANSWERED : last ? NOTES_ONLY : '#38bdf8'
  const who = last
    ? last.id === viewerId
      ? t('feedback_thread.you', 'Tú')
      : last.name ?? t('feedback_thread.someone', 'Alguien del equipo')
    : null

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
      className={cn(
        'flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-xl px-2.5 py-1.5 text-[11.5px]',
        className,
      )}
      style={{ background: `${tone}12` }}
    >
      <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: tone }}>
        {answered
          ? <Check className="h-3.5 w-3.5" />
          : last
            ? <Lock className="h-3.5 w-3.5" />
            : <MessageSquare className="h-3.5 w-3.5" />}
        {answered && who
          ? (last?.id === viewerId
            ? t('feedback_handled.bar_you', 'Ya le respondiste tú')
            : t('feedback_handled.bar_other', 'Ya respondió {{who}}', { who }))
          : last && who
            ? t('feedback_handled.bar_note_only', '{{who}} anotó, pero nadie le ha respondido', { who })
            : t('feedback_handled.bar_none', 'Nadie del equipo ha respondido todavía')}
      </span>

      {last && (
        <Tooltip anchor="element" label={fmtExact(last.at)}>
          <span className="text-text-subtle">{fmtRelative(last.at)}</span>
        </Tooltip>
      )}

      {summary.staff.length > 0 && (
        <StaffStack staff={summary.staff} viewerId={viewerId} size={20} max={4} />
      )}

      {/* La pelota volvió al equipo: ya se respondió una vez, pero la persona
          contestó de nuevo. Sin esto, un hilo atendido parece cerrado. */}
      {awaiting && answered && (
        <Tooltip
          anchor="element"
          maxWidth={230}
          label={t(
            'feedback_handled.back_to_you_hint',
            'Ya se le respondió, pero la persona escribió otra vez: lee lo último antes de contestar.',
          )}
        >
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 font-medium text-sky-400">
            {t('feedback_handled.back_to_you', 'Volvió a escribir')}
          </span>
        </Tooltip>
      )}

      {watchers && watchers.length > 0 && (
        <Tooltip
          anchor="element"
          variant="panel"
          maxWidth={240}
          className="ml-auto"
          label={
            <span className="flex flex-col gap-1.5">
              <span className="text-text-muted">
                {t('feedback_handled.watching_hint', 'Tienen esta opinión abierta ahora mismo. Habla con quien esté dentro antes de responder.')}
              </span>
              {watchers.map((w) => (
                <span key={w.user_id} className="flex items-center gap-1.5">
                  <Avatar src={w.avatar_url} name={w.name} size={20} />
                  <span className="font-semibold text-text">{w.name}</span>
                </span>
              ))}
            </span>
          }
        >
          <motion.span
            initial={reduce ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 460, damping: 28 }}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface/80 px-2 py-0.5 text-[11px] text-text-muted"
          >
            <Eye className="h-3 w-3 shrink-0 text-sky-400" />
            <span className="inline-flex items-center">
              {watchers.slice(0, 3).map((w, i) => (
                <span key={w.user_id} className={cn('rounded-full ring-2 ring-surface', i > 0 && '-ml-1.5')}>
                  <Avatar src={w.avatar_url} name={w.name} size={16} />
                </span>
              ))}
            </span>
            <span className="truncate">
              {watchers.length === 1
                ? t('feedback_handled.watching_one', '{{who}} la está viendo ahora', { who: watchers[0].name })
                : t('feedback_handled.watching_many', '{{count}} personas la están viendo', { count: watchers.length })}
            </span>
          </motion.span>
        </Tooltip>
      )}
    </motion.div>
  )
}
