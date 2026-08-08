import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight, CornerDownLeft, ImagePlus, Loader2, Lock, MessageSquare,
  Send, Sparkles, X,
} from 'lucide-react'
import i18n from '@/i18n'
import { useAuth } from '@/hooks/useAuth'
import { Avatar } from '@/components/ui/Avatar'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'
import type { FeedbackShot, SiteFeedbackRow } from '@/services/siteFeedback.service'
import {
  fetchFeedbackThread, markFeedbackThreadRead, postFeedbackMessage,
  subscribeFeedbackEvents, type FeedbackEvent,
} from '@/services/feedbackThread.service'
import { STATUS_COLOR } from './StatusPill'
import { ShotGallery } from './ShotGallery'
import { ShotUploader } from './ShotUploader'
import { kindMeta } from './config'

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * Cuánto tiene que estar el hilo delante de los ojos —en pantalla y con la
 * pestaña al frente— para darlo por leído. Marcar al montar convertía "pasé por
 * la bandeja" en "te leí", y del otro lado alguien veía un "visto" que nadie
 * había hecho.
 */
const READ_AFTER_MS = 1200

/** "hace 5 min": el hilo se lee como una conversación, no como un registro. */
function fmtRelative(iso: string) {
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return rtf.format(-Math.round(s), 'second')
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  if (s < 2592000) return rtf.format(-Math.round(s / 86400), 'day')
  return rtf.format(-Math.round(s / 2592000), 'month')
}

function fmtExact(iso: string) {
  return new Date(iso).toLocaleString(i18n.language, {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export interface FeedbackThreadProps {
  row: SiteFeedbackRow
  /** `staff` atiende (puede dejar notas internas); `author` es quien opinó. */
  variant: 'staff' | 'author'
  /** Se llama tras escribir: sirve para refrescar contadores de la lista. */
  onPosted?: (event: FeedbackEvent) => void
  /** Pinta el primer nodo ("envió su opinión"). Falso donde ya se muestra arriba. */
  showOrigin?: boolean
  /**
   * Cambiar este número vuelve a traer el hilo. Lo usa el panel cuando cambia el
   * estado desde fuera: el hito nuevo lo escribe un trigger en la BD, así que el
   * cliente no puede inventárselo sin volver a preguntar.
   */
  reloadKey?: number
  /** Se llama cuando el hilo se da por leído de verdad (visto en pantalla). */
  onRead?: () => void
  /**
   * Chat de verdad: los mensajes viven en su propia zona con scroll, abierta por
   * lo último dicho, y la caja de escribir siempre debajo a la vista. Es lo que
   * quiere el panel; en "Mis sugerencias" el hilo va dentro de una tarjeta en el
   * flujo de la página y ahí sobra.
   */
  boxed?: boolean
  /**
   * El hilo se come TODA la altura de su contenedor: los mensajes scrollean en
   * el hueco que quede y la caja de escribir se queda clavada abajo. Es el modo
   * de la bandeja del panel, donde la conversación es la pantalla entera y no
   * una tarjeta más de una ficha. Implica `boxed`.
   */
  fill?: boolean
  className?: string
}

/**
 * "Visto" honesto: dispara `onSeen` solo cuando el elemento lleva `delay` en
 * pantalla Y con la pestaña al frente. Si se sale de la vista o se cambia de
 * pestaña antes de tiempo, el reloj se reinicia y nadie queda marcado como leído
 * sin haberlo mirado.
 */
function useSeenWhenVisible(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onSeen: () => void,
  delay = READ_AFTER_MS,
) {
  // La última versión del aviso, sin volver a montar el observador por ello.
  const seenRef = useRef(onSeen)
  useEffect(() => { seenRef.current = onSeen }, [onSeen])

  useEffect(() => {
    const el = ref.current
    if (!active || !el) return

    let timer: ReturnType<typeof setTimeout> | null = null
    let onScreen = false

    const stop = () => { if (timer) { clearTimeout(timer); timer = null } }
    const evaluate = () => {
      if (onScreen && document.visibilityState === 'visible') {
        if (!timer) timer = setTimeout(() => { timer = null; seenRef.current() }, delay)
      } else stop()
    }

    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      evaluate()
    }, { threshold: 0.2 })
    io.observe(el)
    document.addEventListener('visibilitychange', evaluate)

    return () => {
      stop()
      io.disconnect()
      document.removeEventListener('visibilitychange', evaluate)
    }
  }, [ref, active, delay])
}

/**
 * La conversación completa de una opinión: quién respondió qué, cuándo, y cada
 * cambio de estado por el camino. Es la misma pieza en los dos lados —el panel
 * del equipo y "Mis sugerencias"— para que nadie vea una versión distinta de lo
 * que pasó; lo único que cambia es que el equipo puede dejar notas internas.
 */
export function FeedbackThread({
  row, variant, onPosted, showOrigin = true, reloadKey = 0, onRead, boxed = false,
  fill = false, className,
}: FeedbackThreadProps) {
  /** `fill` es `boxed` llevado al extremo: misma zona con scroll, sin techo fijo. */
  const inBox = boxed || fill
  const { t } = useTranslation()
  const { user, displayName, avatarUrl } = useAuth()
  const reduce = useReducedMotion()
  const isStaff = variant === 'staff'

  const [events, setEvents] = useState<FeedbackEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  /** El salto al final es de la apertura, no de cada mensaje que entra. */
  const landed = useRef(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setFailed(false)
    fetchFeedbackThread(row.id)
      .then((e) => { if (alive) setEvents(e) })
      .catch((e) => {
        console.error('feedback thread error:', e)
        if (alive) setFailed(true)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [row.id, reloadKey])

  // Mensajes nuevos mientras el hilo está abierto: entran solos, sin recargar.
  // Los propios ya se pintaron al enviarlos, y el filtro por id evita el doble.
  useEffect(() => subscribeFeedbackEvents((ev) => {
    setEvents((cur) => (cur.some((x) => x.id === ev.id) ? cur : [...cur, ev]))
  }, { feedbackId: row.id }), [row.id])

  /** Lo que escribió el otro lado y sigue sin leer. */
  const pending = useMemo(
    () => events.filter((e) => !e.read_at && e.type !== 'status' && e.author_id !== user?.id),
    [events, user?.id],
  )

  // Leer es mirar, no abrir: el hilo se da por leído tras un momento a la vista.
  const markSeen = useCallback(() => {
    const now = new Date().toISOString()
    setEvents((cur) => cur.map((e) => (
      e.read_at || e.author_id === user?.id ? e : { ...e, read_at: now }
    )))
    onRead?.()
    void markFeedbackThreadRead(row.id).catch(() => {})
  }, [row.id, user?.id, onRead])

  useSeenWhenVisible(rootRef, pending.length > 0, markSeen)

  // Dónde empieza lo que no habías leído. Se fija la primera vez y NO se borra al
  // marcar leído: la línea es lo que te dice qué mirar, y quitarla en el mismo
  // segundo en que la lees es perder el sitio.
  const [newFromId, setNewFromId] = useState<string | null>(null)
  useEffect(() => { setNewFromId(null) }, [row.id])
  useEffect(() => {
    setNewFromId((cur) => cur ?? (pending.length > 0 ? pending[0].id : null))
  }, [pending])

  // Al abrir, el hilo arranca por lo ÚLTIMO que se dijo —o por donde empieza lo
  // que no habías leído—, no por el principio de la historia. Es lo que
  // diferencia un chat de un expediente.
  useEffect(() => { landed.current = false }, [row.id])
  useEffect(() => {
    const box = listRef.current
    if (!inBox || !box || landed.current || events.length === 0) return
    landed.current = true
    requestAnimationFrame(() => {
      const mark = newFromId && box.querySelector(`[data-ev="${newFromId}"]`)
      if (mark) mark.scrollIntoView({ block: 'start' })
      else box.scrollTop = box.scrollHeight
    })
  }, [inBox, events, newFromId])

  // La zona de mensajes puede desaparecer y volver (en el panel se alterna entre
  // Conversación y Detalle): al volver, el navegador no devuelve la posición del
  // scroll, así que en cuanto recupera altura se vuelve a lo último dicho —que es
  // justo lo que uno espera al regresar a un chat.
  useEffect(() => {
    const box = listRef.current
    if (!fill || !box || typeof ResizeObserver === 'undefined') return
    let had = box.clientHeight > 0
    const ro = new ResizeObserver(() => {
      const has = box.clientHeight > 0
      if (has && !had && box.scrollTop === 0) box.scrollTop = box.scrollHeight
      had = has
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [fill])

  const append = useCallback((ev: FeedbackEvent) => {
    setEvents((cur) => [...cur, ev])
    onPosted?.(ev)
    // Un instante después de que Motion coloque la burbuja nueva.
    setTimeout(() => {
      const box = listRef.current
      if (box && box.scrollHeight > box.clientHeight) {
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' })
      } else {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }, 80)
  }, [onPosted])

  const meta = kindMeta(row.kind)

  return (
    <div
      ref={rootRef}
      className={cn(
        fill ? 'flex h-full min-h-0 flex-col gap-3.5' : 'space-y-4',
        className,
      )}
    >
      {/* Al recargar (p. ej. tras cambiar el estado) NO se vuelve al esqueleto:
          lo ya leído se queda en pantalla y el hito nuevo entra animado. */}
      {loading && events.length === 0 ? (
        <div className={cn(fill && 'min-h-0 flex-1')}>
          <ThreadSkeleton />
        </div>
      ) : failed ? (
        <p className={cn(
          'rounded-xl border border-dashed border-line px-3.5 py-3 text-[12.5px] text-text-muted',
          fill && 'flex-1',
        )}>
          {t('feedback_thread.load_error', 'No pudimos cargar la conversación. Vuelve a abrirla en un momento.')}
        </p>
      ) : (
        <ol
          ref={listRef}
          className={cn(
            'relative space-y-4',
            // Zona de mensajes con scroll propio: la caja de escribir queda
            // siempre debajo, a la vista, sin tener que bajar hasta el final.
            inBox && 'overflow-y-auto pr-1.5',
            // Con `fill` no hay techo a ojo: los mensajes se quedan con todo el
            // hueco que deje la caja de escribir.
            fill ? 'min-h-0 flex-1' : inBox && 'max-h-[clamp(14rem,38vh,30rem)]',
          )}
        >
          {/* Riel de la línea de tiempo: cose todos los nodos en un solo hilo. */}
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-2 left-[15px] top-2 w-px bg-gradient-to-b from-line via-line to-transparent"
          />

          {showOrigin && (
            <OriginNode row={row} color={meta.color} emoji={meta.emoji} isStaff={isStaff} />
          )}

          {/* La nota que existía antes de que hubiera hilo: se conserva y se
              marca como tal en vez de desaparecer bajo el modelo nuevo. */}
          {isStaff && row.staff_note && (
            <NoteNode
              body={row.staff_note}
              authorName={row.handled_by_name ?? null}
              at={row.handled_at}
              legacy
            />
          )}

          <AnimatePresence initial={false}>
            {/* Aplanado en vez de envuelto en Fragment: AnimatePresence solo ve
                a sus hijos directos, y dentro de un Fragment perdería el rastro. */}
            {events.flatMap((e, i) => [
              ...(e.id === newFromId ? [<NewFromHere key={`new-${e.id}`} id={e.id} />] : []),
              <EventNode
                key={e.id}
                event={e}
                index={i}
                ownerId={row.user_id}
                viewerId={user?.id ?? null}
                isStaff={isStaff}
                reduce={!!reduce}
              />,
            ])}
          </AnimatePresence>

          {events.length === 0 && !row.staff_note && (
            <EmptyHint isStaff={isStaff} />
          )}
        </ol>
      )}

      <div ref={endRef} />

      <div className={cn(fill && 'shrink-0')}>
        <Composer
          feedbackId={row.id}
          isStaff={isStaff}
          accent={meta.color}
          me={{ name: displayName, avatar: avatarUrl }}
          onPosted={append}
        />
      </div>
    </div>
  )
}

/* ═══════════════════════ Nodos del hilo ═══════════════════════ */

/** El punto de partida: la opinión tal como entró. */
function OriginNode({ row, color, emoji, isStaff }: {
  row: SiteFeedbackRow
  color: string
  emoji: string
  isStaff: boolean
}) {
  const { t } = useTranslation()
  const who = isStaff
    ? (row.display_name ?? t('admin.site_feedback.user_fallback', 'Usuario'))
    : t('feedback_thread.you', 'Tú')
  return (
    <li className="relative flex gap-3 pl-0">
      <span
        className="relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[15px] ring-4 ring-surface"
        style={{ background: `${color}1f` }}
      >
        {emoji}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <p className="text-[12.5px] text-text-muted">
          <span className="font-semibold text-text">{who}</span>{' '}
          {t('feedback_thread.origin', 'envió esta opinión')}
          {' · '}
          <time dateTime={row.created_at} title={fmtExact(row.created_at)}>
            {fmtRelative(row.created_at)}
          </time>
        </p>
      </div>
    </li>
  )
}

/** Cambio de estado: no es una burbuja, es un hito. */
function StatusNode({ event }: { event: FeedbackEvent }) {
  const { t } = useTranslation()
  const to = event.to_status ?? 'new'
  const color = STATUS_COLOR[to] ?? '#94a3b8'
  return (
    <li className="relative flex items-center gap-3">
      <span className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center">
        <span
          className="h-2.5 w-2.5 rounded-full ring-4 ring-surface"
          style={{ background: color }}
        />
      </span>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-text-muted">
        {event.from_status && (
          <>
            <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] text-text-muted">
              {t(`site_feedback.status.${event.from_status}`)}
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-text-subtle" />
          </>
        )}
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ background: `${color}1a`, color }}
        >
          {t(`site_feedback.status.${to}`)}
        </span>
        {event.author_name && (
          <span className="text-text-subtle">
            · {t('feedback_thread.by', 'por')} {event.author_name}
          </span>
        )}
        <span className="text-text-subtle" title={fmtExact(event.created_at)}>
          · {fmtRelative(event.created_at)}
        </span>
      </p>
    </li>
  )
}

/** Nota interna: mismo hilo, otro papel. Se ve que NO sale de la casa. */
function NoteNode({ body, authorName, at, shots, legacy }: {
  body: string
  authorName: string | null
  at?: string | null
  shots?: FeedbackShot[] | null
  legacy?: boolean
}) {
  const { t } = useTranslation()
  return (
    <li className="relative flex gap-3">
      <span className="relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/12 text-amber-500 ring-4 ring-surface">
        <Lock className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-dashed border-amber-500/35 bg-amber-500/[0.06] px-3.5 py-2.5">
        <p className="mb-1 flex flex-wrap items-center gap-x-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-amber-500">
          {t('feedback_thread.internal', 'Nota interna · solo la ve el equipo')}
          {legacy && (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] normal-case tracking-normal">
              {t('feedback_thread.legacy_note', 'nota original')}
            </span>
          )}
        </p>
        <p className="whitespace-pre-wrap text-[14px] leading-[1.6] text-text">{body}</p>
        {shots && shots.length > 0 && <ShotGallery shots={shots} className="mt-2.5" />}
        <p className="mt-1.5 text-[11px] text-text-subtle">
          {authorName ?? t('feedback_thread.someone', 'Alguien del equipo')}
          {at ? ` · ${fmtRelative(at)}` : ''}
        </p>
      </div>
    </li>
  )
}

/** Un mensaje del hilo. Quien opinó a la izquierda, el equipo a la derecha. */
function ReplyNode({ event, fromOwner, mine }: {
  event: FeedbackEvent
  fromOwner: boolean
  mine: boolean
}) {
  const { t } = useTranslation()
  const teamSide = !fromOwner
  const accent = teamSide ? 'rgb(var(--brand-green))' : undefined

  return (
    <li className={cn('relative flex gap-3', teamSide && 'flex-row-reverse')}>
      <span className="relative z-10 mt-0.5 shrink-0 rounded-full ring-4 ring-surface">
        <Avatar src={event.author_avatar} name={event.author_name} size={32} />
      </span>
      <div className={cn('min-w-0 max-w-[min(48rem,90%)]', teamSide && 'text-right')}>
        <p className={cn(
          'mb-1 flex items-center gap-1.5 text-[11.5px] text-text-subtle',
          teamSide && 'justify-end',
        )}>
          <span className="font-semibold text-text-muted">
            {mine
              ? t('feedback_thread.you', 'Tú')
              : event.author_name ?? t('feedback_thread.someone', 'Alguien del equipo')}
          </span>
          {teamSide && !mine && (
            <span className="rounded-full bg-[rgb(var(--brand-green))]/12 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-[rgb(var(--brand-green))]">
              {t('feedback_thread.team', 'Equipo')}
            </span>
          )}
          <span title={fmtExact(event.created_at)}>{fmtRelative(event.created_at)}</span>
          {/* Doble uso del "leído": al equipo le dice que la persona ya lo vio;
              a la persona, que el equipo ya leyó lo suyo. */}
          {mine && event.read_at && (
            <span className="text-[10.5px] text-[rgb(var(--brand-green))]">
              {t('feedback_thread.seen', 'visto')}
            </span>
          )}
        </p>
        <div
          className={cn(
            'inline-block w-full rounded-2xl border px-4 py-3 text-left',
            teamSide
              ? 'rounded-tr-sm border-[rgb(var(--brand-green))]/25 bg-[rgb(var(--brand-green))]/[0.07]'
              : 'rounded-tl-sm border-line bg-surface',
          )}
          style={teamSide ? { boxShadow: `0 1px 0 0 ${accent}0d` } : undefined}
        >
          <p className="whitespace-pre-wrap text-[14.5px] leading-[1.65] text-text">{event.body}</p>
          {event.shots && event.shots.length > 0 && (
            <ShotGallery shots={event.shots} className={cn('mt-2.5', teamSide && 'justify-end')} />
          )}
        </div>
      </div>
    </li>
  )
}

/** Dónde empieza lo que no habías leído. Una línea, no un cartel. */
function NewFromHere({ id }: { id: string }) {
  const { t } = useTranslation()
  return (
    <motion.li
      layout
      data-ev={id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative flex scroll-mt-2 items-center gap-2 py-0.5 pl-[42px] pr-1"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-400">
        {t('feedback_thread.new_from_here', 'Nuevo')}
      </span>
      <span className="h-px flex-1 bg-gradient-to-r from-sky-400/50 to-transparent" />
    </motion.li>
  )
}

function EventNode({ event, index, ownerId, viewerId, isStaff, reduce }: {
  event: FeedbackEvent
  index: number
  ownerId: string
  viewerId: string | null
  isStaff: boolean
  reduce: boolean
}) {
  const fromOwner = event.author_id === ownerId
  const mine = !!viewerId && event.author_id === viewerId

  return (
    <motion.div
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 14, filter: 'blur(4px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.42, ease: EASE, delay: Math.min(index, 6) * 0.045 }}
    >
      {event.type === 'status' ? (
        <StatusNode event={event} />
      ) : event.type === 'note' ? (
        isStaff ? (
          <NoteNode
            body={event.body ?? ''}
            authorName={event.author_name ?? null}
            at={event.created_at}
            shots={event.shots}
          />
        ) : null
      ) : (
        <ReplyNode event={event} fromOwner={fromOwner} mine={mine} />
      )}
    </motion.div>
  )
}

function EmptyHint({ isStaff }: { isStaff: boolean }) {
  const { t } = useTranslation()
  return (
    <li className="relative flex gap-3">
      <span className="relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-subtle text-text-subtle ring-4 ring-surface">
        <MessageSquare className="h-3.5 w-3.5" />
      </span>
      <p className="pt-1.5 text-[12.5px] leading-relaxed text-text-muted">
        {isStaff
          ? t('feedback_thread.empty_staff', 'Nadie ha respondido todavía. Lo que escribas aquí le llega a la persona con un aviso en su campana.')
          : t('feedback_thread.empty_author', 'El equipo todavía no ha respondido. Cuando lo haga, lo verás aquí y te avisaremos.')}
      </p>
    </li>
  )
}

function ThreadSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="flex gap-3">
          <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-line/60" />
          <span
            className="h-14 flex-1 animate-pulse rounded-2xl bg-line/40"
            style={{ animationDelay: `${i * 120}ms`, maxWidth: i ? '60%' : '80%' }}
          />
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════ Caja de escribir ═══════════════════════ */

/**
 * Escribir en el hilo. El equipo elige entre responder (le llega a la persona) o
 * dejar una nota interna, y el color de toda la caja cambia con la elección: el
 * error caro aquí es publicarle a alguien lo que era para el equipo, así que la
 * diferencia tiene que verse sin leer.
 */
function Composer({ feedbackId, isStaff, accent, me, onPosted }: {
  feedbackId: string
  isStaff: boolean
  accent: string
  me: { name: string; avatar: string | null }
  onPosted: (e: FeedbackEvent) => void
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [internal, setInternal] = useState(false)
  const [body, setBody] = useState('')
  const [shots, setShots] = useState<FeedbackShot[]>([])
  const [attaching, setAttaching] = useState(false)
  const [sending, setSending] = useState(false)
  const [focused, setFocused] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const tone = internal ? '#f59e0b' : accent
  const canSend = body.trim().length > 0 && !sending

  // Crece con lo que se escribe: una respuesta larga no se teclea por una rendija.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`
  }, [body])

  const templates = useMemo(() => [
    t('feedback_thread.tpl_reviewing', 'Gracias por avisarnos. Ya lo estamos revisando y te contamos apenas tengamos novedades.'),
    t('feedback_thread.tpl_fixed', 'Ya quedó corregido. Cierra sesión, vuelve a entrar y cuéntanos si te sigue pasando.'),
    t('feedback_thread.tpl_more_info', '¿Nos ayudas con una captura de la pantalla y el paso exacto donde se queda? Así lo reproducimos igual que tú.'),
  ], [t])

  async function send() {
    if (!canSend) return
    setSending(true)
    try {
      const ev = await postFeedbackMessage({
        feedbackId,
        body,
        shots,
        internal: isStaff && internal,
      })
      onPosted(ev)
      setBody('')
      setShots([])
      setAttaching(false)
      toast.success(internal
        ? t('feedback_thread.saved_note', 'Nota guardada')
        : t('feedback_thread.sent', 'Respuesta enviada'))
    } catch (e) {
      console.error('feedback reply error:', e)
      toast.error(t('feedback_thread.send_error', 'No pudimos enviar tu mensaje. Inténtalo otra vez.'))
    } finally {
      setSending(false)
    }
  }

  return (
    // Sin animación `layout`: lo que crece aquí dentro (plantillas, adjuntos) ya
    // anima su propia altura, y medir la caja entera mientras la ficha entera
    // está entrando hacía que la caja se estirara a la vista al abrir un chat.
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-surface transition-colors duration-300',
        focused ? 'border-transparent' : 'border-line',
      )}
      style={focused ? { boxShadow: `0 0 0 1.5px ${tone}55, 0 12px 30px -18px ${tone}` } : undefined}
    >
      {/* Filo de color: dice de un vistazo si esto sale o se queda en casa. */}
      <motion.span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px]"
        animate={{ background: tone, opacity: focused || internal ? 1 : 0.35 }}
        transition={{ duration: 0.35, ease: EASE }}
      />

      {isStaff && (
        <div className="flex flex-wrap items-center gap-1 border-b border-line/70 px-2 py-1.5">
          <ModeTab active={!internal} group={feedbackId} tone={accent} onClick={() => setInternal(false)}>
            <Send className="h-3 w-3" />
            {t('feedback_thread.mode_reply', 'Responder a la persona')}
          </ModeTab>
          <ModeTab active={internal} group={feedbackId} tone="#f59e0b" onClick={() => setInternal(true)}>
            <Lock className="h-3 w-3" />
            {t('feedback_thread.mode_note', 'Nota interna')}
          </ModeTab>
        </div>
      )}

      <div className="flex gap-3 px-3 pt-3">
        <span className="mt-0.5 hidden shrink-0 sm:block">
          <Avatar src={me.avatar} name={me.name} size={32} />
        </span>
        <textarea
          ref={areaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send() }
          }}
          rows={3}
          placeholder={
            internal
              ? t('feedback_thread.ph_note', 'Qué se hizo con esto, para el equipo…')
              : isStaff
                ? t('feedback_thread.ph_reply', 'Escríbele a la persona. Le llega con un aviso…')
                : t('feedback_thread.ph_author', 'Responde al equipo…')
          }
          className="w-full resize-none border-0 bg-transparent py-1 text-[14.5px] leading-[1.6] text-text outline-none placeholder:text-text-muted/60"
        />
      </div>

      {/* Plantillas: el 80 % de las respuestas son estas tres, y escribirlas a
          mano cada vez es la razón por la que las bandejas se quedan mudas. */}
      <AnimatePresence initial={false}>
        {isStaff && !internal && body.trim().length === 0 && (
          <motion.div
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-1.5 px-3 pt-2 sm:pl-[3.6rem]">
              {templates.map((tpl, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setBody(tpl); areaRef.current?.focus() }}
                  className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-text-muted transition-colors hover:border-transparent hover:bg-subtle hover:text-text"
                >
                  <Sparkles className="h-3 w-3 shrink-0 text-text-subtle transition-colors group-hover:text-[rgb(var(--brand-green))]" />
                  <span className="truncate">{tpl.split('.')[0]}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {attaching && (
          <motion.div
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="px-3 pt-3 sm:pl-[3.6rem]">
              <ShotUploader
                folder={`${feedbackId}/thread`}
                shots={shots}
                onChange={setShots}
                accent={tone}
                compact
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!attaching && shots.length > 0 && (
        <div className="px-3 pt-3 sm:pl-[3.6rem]">
          <ShotGallery shots={shots} />
        </div>
      )}

      <div className="flex items-center justify-between gap-3 px-3 py-2.5 sm:pl-[3.6rem]">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAttaching((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors',
              attaching ? 'bg-subtle text-text' : 'text-text-muted hover:bg-subtle hover:text-text',
            )}
          >
            {attaching ? <X className="h-3.5 w-3.5" /> : <ImagePlus className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">
              {attaching
                ? t('feedback_thread.attach_close', 'Listo')
                : t('feedback_thread.attach', 'Adjuntar')}
            </span>
          </button>
          <span className="hidden items-center gap-1 text-[11px] text-text-subtle md:inline-flex">
            <CornerDownLeft className="h-3 w-3" />
            {t('feedback_thread.shortcut', 'Ctrl+Enter para enviar')}
          </span>
        </div>

        <motion.button
          type="button"
          onClick={() => void send()}
          disabled={!canSend}
          whileTap={reduce || !canSend ? undefined : { scale: 0.96 }}
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-white transition-opacity disabled:opacity-35"
          style={{ background: tone, boxShadow: canSend ? `0 8px 20px -12px ${tone}` : undefined }}
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {internal
            ? t('feedback_thread.save_note', 'Guardar nota')
            : t('feedback_thread.send', 'Enviar')}
        </motion.button>
      </div>
    </div>
  )
}

function ModeTab({ active, group, tone, onClick, children }: {
  active: boolean
  /** Ata el fondo que se desliza a ESTE hilo: ver el porqué abajo. */
  group: string
  tone: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors',
        active ? '' : 'text-text-muted hover:text-text',
      )}
      style={active ? { color: tone } : undefined}
    >
      {active && (
        <motion.span
          // Único por hilo: con un `layoutId` compartido, al abrir otra opinión
          // el fondo de "Responder a la persona" salía volando desde la caja de
          // la anterior en lugar de estar ya puesto.
          layoutId={`composer-mode-${group}`}
          className="absolute inset-0 rounded-lg"
          style={{ background: `${tone}16` }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        />
      )}
      <span className="relative inline-flex items-center gap-1.5">{children}</span>
    </button>
  )
}
