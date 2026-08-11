import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowDown, ArrowRight, ImagePlus, Loader2, Lock, MessageSquare,
  Send, Sparkles, X,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Avatar } from '@/components/ui/Avatar'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'
import type { FeedbackShot, SiteFeedbackRow } from '@/services/siteFeedback.service'
import {
  fetchFeedbackThread, markFeedbackThreadRead, postFeedbackMessage,
  subscribeFeedbackEvents, type FeedbackEvent,
} from '@/services/feedbackThread.service'
import { Tooltip } from '@/components/ui/Tooltip'
import { STATUS_COLOR } from './StatusPill'
import { ShotGallery } from './ShotGallery'
import { ShotUploader } from './ShotUploader'
import { kindMeta } from './config'
import { fmtExact, fmtRelative, minutesSince } from './time'

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * Cuánto tiene que estar el hilo delante de los ojos —en pantalla y con la
 * pestaña al frente— para darlo por leído. Marcar al montar convertía "pasé por
 * la bandeja" en "te leí", y del otro lado alguien veía un "visto" que nadie
 * había hecho.
 */
const READ_AFTER_MS = 1200

/**
 * A cuántos píxeles del final se considera que "estás abajo". Con margen: si
 * estás leyendo lo último, el mensaje que entra debe aparecer solo; si te fuiste
 * a buscar algo más arriba, moverte el scroll es quitarte el sitio donde estabas.
 */
const NEAR_BOTTOM_PX = 96

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
  const endRef = useRef<HTMLLIElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  /** El salto al final es de la apertura, no de cada mensaje que entra. */
  const landed = useRef(false)

  /**
   * Lo que llegó mientras mirabas hacia arriba. La píldora es la respuesta al
   * dilema del chat: arrastrarte al final cada vez que entra un mensaje te quita
   * de donde estabas leyendo, y no avisarte esconde lo que acaba de pasar. Así,
   * si estás abajo entra solo; si no, se anuncia y tú decides.
   */
  const [pendingNew, setPendingNew] = useState<{
    count: number; name: string | null; avatar: string | null
  } | null>(null)
  /** ¿Estás mirando el final del hilo? En el ref para poder leerlo desde Realtime. */
  const atBottomRef = useRef(true)
  const [scrolledUp, setScrolledUp] = useState(false)
  /** Espejo de los eventos para decidir en el callback de Realtime sin re-suscribir. */
  const eventsRef = useRef<FeedbackEvent[]>([])
  useEffect(() => { eventsRef.current = events }, [events])

  const scrollToEnd = useCallback((smooth = true) => {
    const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto'
    const box = listRef.current
    if (box && box.scrollHeight > box.clientHeight) {
      box.scrollTo({ top: box.scrollHeight, behavior })
    } else {
      endRef.current?.scrollIntoView({ behavior, block: 'nearest' })
    }
    atBottomRef.current = true
    setPendingNew(null)
    setScrolledUp(false)
  }, [])

  /** Dónde estás parada la conversación: cerca del final o buscando algo arriba. */
  const onListScroll = useCallback(() => {
    const box = listRef.current
    if (!box) return
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM_PX
    atBottomRef.current = near
    setScrolledUp(!near && box.scrollHeight > box.clientHeight + NEAR_BOTTOM_PX)
    // Llegar al final ES haber visto lo que había: la píldora se apaga sola.
    if (near) setPendingNew(null)
  }, [])

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
    // Se comprueba contra el espejo y no dentro del `setEvents`: el updater se
    // ejecuta dos veces en desarrollo (StrictMode) y contar allí dentro haría
    // que la píldora dijera 2 por cada mensaje que llega.
    if (eventsRef.current.some((x) => x.id === ev.id)) return
    eventsRef.current = [...eventsRef.current, ev]
    setEvents((cur) => (cur.some((x) => x.id === ev.id) ? cur : [...cur, ev]))

    // Fuera de la caja con scroll (la tarjeta de "Mis sugerencias") mandar la
    // página al final sería secuestrar el scroll de toda la pantalla.
    if (!inBox) return
    if (atBottomRef.current) {
      // Un cuadro después, cuando Motion ya colocó la burbuja nueva.
      requestAnimationFrame(() => scrollToEnd(true))
    } else {
      setPendingNew((n) => ({
        count: (n?.count ?? 0) + 1,
        name: ev.author_name,
        avatar: ev.author_avatar,
      }))
    }
  }, { feedbackId: row.id }), [row.id, inBox, scrollToEnd])

  // Cada opinión empieza con su propia cuenta: la píldora de la anterior no se
  // hereda al saltar de hilo.
  useEffect(() => {
    setPendingNew(null)
    setScrolledUp(false)
    atBottomRef.current = true
  }, [row.id])

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
    eventsRef.current = [...eventsRef.current, ev]
    setEvents((cur) => [...cur, ev])
    onPosted?.(ev)
    // Escribir SIEMPRE te lleva al final, estuvieras donde estuvieras: acabas de
    // hablar tú, y lo tuyo es lo último que hay que ver.
    setTimeout(() => scrollToEnd(true), 80)
  }, [onPosted, scrollToEnd])

  /**
   * Un compañero del equipo ya le respondió a la persona y esa sigue siendo la
   * última palabra. Es EL aviso de esta pantalla: sin él, dos personas del
   * equipo le contestan lo mismo al mismo usuario con minutos de diferencia.
   */
  const answeredByPeer = useMemo(() => {
    if (!isStaff) return null
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.type !== 'reply') continue
      // La persona volvió a escribir: la pelota es del equipo otra vez y
      // responder ya no duplica nada.
      if (e.author_id === row.user_id) return null
      return e.author_id && e.author_id !== user?.id ? e : null
    }
    return null
  }, [events, isStaff, row.user_id, user?.id])

  const meta = kindMeta(row.kind)

  return (
    <div
      ref={rootRef}
      className={cn(
        fill ? 'flex h-full min-h-0 flex-col gap-2.5' : 'space-y-4',
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
        // Envoltura relativa: la píldora de mensajes nuevos flota SOBRE la
        // conversación, pegada a su borde inferior, sin robarle altura ni
        // moverle los mensajes al aparecer.
        <div className={cn('relative flex min-h-0', fill ? 'flex-1 flex-col' : 'flex-col')}>
          <ol
            ref={listRef}
            onScroll={inBox ? onListScroll : undefined}
            className={cn(
              'relative space-y-3',
              // Zona de mensajes con scroll propio: la caja de escribir queda
              // siempre debajo, a la vista, sin tener que bajar hasta el final.
              inBox && 'overflow-y-auto pr-1.5',
              // Con `fill` no hay techo a ojo: los mensajes se quedan con todo el
              // hueco que deje la caja de escribir.
              fill ? 'min-h-0 flex-1' : inBox && 'max-h-[clamp(14rem,38vh,30rem)]',
            )}
          >
            {/* Riel de la línea de tiempo: cose todos los nodos en un solo hilo.
                Solo fuera del chat. Cuando esto es una conversación, los mensajes
                van a los dos lados y el riel deja de coser nada: es una raya que
                cruza el panel por detrás de los avatares, ruido y no estructura. */}
            {!inBox && (
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-2 left-[15px] top-2 w-px bg-gradient-to-b from-line via-line to-transparent"
              />
            )}

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

            <li ref={endRef} aria-hidden className="h-px" />
          </ol>

          {inBox && (
            <JumpToLatest
              pending={pendingNew}
              scrolledUp={scrolledUp}
              reduce={!!reduce}
              onClick={() => scrollToEnd(true)}
            />
          )}
        </div>
      )}

      <div className={cn(fill && 'shrink-0')}>
        <Composer
          feedbackId={row.id}
          isStaff={isStaff}
          accent={meta.color}
          me={{ name: displayName, avatar: avatarUrl }}
          answeredByPeer={answeredByPeer}
          onPosted={append}
        />
      </div>
    </div>
  )
}

/**
 * "Bajar a lo último". Dos formas del mismo botón, y la forma es el mensaje:
 * redondo y discreto cuando solo te alejaste, píldora con cara y número cuando
 * hay algo nuevo que no has visto. Nunca los dos a la vez.
 */
function JumpToLatest({ pending, scrolledUp, reduce, onClick }: {
  pending: { count: number; name: string | null; avatar: string | null } | null
  scrolledUp: boolean
  reduce: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const show = !!pending || scrolledUp

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-1 z-20 flex justify-center">
      <AnimatePresence initial={false}>
        {show && (
          <motion.button
            // Una sola clave para las dos formas: al llegar un mensaje mientras
            // el botón redondo está puesto, se ESTIRA hasta píldora en vez de
            // salir uno y entrar otro.
            key="jump"
            type="button"
            layout
            onClick={onClick}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            className={cn(
              'pointer-events-auto inline-flex items-center gap-2 rounded-full text-[12px] font-semibold shadow-lg backdrop-blur transition-colors',
              pending
                ? 'bg-sky-500 py-1.5 pl-1.5 pr-3.5 text-white shadow-sky-500/30'
                : 'h-9 w-9 justify-center border border-line bg-surface/90 text-text-muted shadow-black/20 hover:text-text',
            )}
          >
            {pending ? (
              <>
                <motion.span
                  layout="position"
                  className="relative flex h-6 w-6 items-center justify-center rounded-full bg-white/20"
                >
                  {pending.avatar
                    ? <Avatar src={pending.avatar} name={pending.name} size={24} />
                    : <MessageSquare className="h-3.5 w-3.5" />}
                  {/* Latido: lo nuevo llama la atención una vez y se queda quieto. */}
                  {!reduce && (
                    <motion.span
                      aria-hidden
                      className="absolute inset-0 rounded-full ring-2 ring-white/70"
                      initial={{ opacity: 0.9, scale: 1 }}
                      animate={{ opacity: 0, scale: 1.7 }}
                      transition={{ duration: 1.6, repeat: 2, ease: 'easeOut' }}
                    />
                  )}
                </motion.span>
                <motion.span layout="position" className="whitespace-nowrap">
                  {pending.count === 1 && pending.name
                    ? t('feedback_thread.new_from', '{{who}} respondió', { who: pending.name })
                    : t('feedback_thread.new_count', {
                      count: pending.count,
                      defaultValue: '{{count}} mensajes nuevos',
                    })}
                </motion.span>
                <ArrowDown className="h-3.5 w-3.5 shrink-0 opacity-80" />
              </>
            ) : (
              <ArrowDown className="h-4 w-4" />
            )}
          </motion.button>
        )}
      </AnimatePresence>
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
          <Tooltip anchor="element" label={fmtExact(row.created_at)}>
            <time dateTime={row.created_at}>{fmtRelative(row.created_at)}</time>
          </Tooltip>
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
        <Tooltip anchor="element" label={fmtExact(event.created_at)}>
          <span className="text-text-subtle">· {fmtRelative(event.created_at)}</span>
        </Tooltip>
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
      {/* El punteado ámbar sobraba: el candado, el tinte y el rótulo ya dicen
          tres veces lo mismo, y el borde era el único que además hacía ruido. */}
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-amber-500/[0.08] px-3 py-2">
        <p className="mb-0.5 flex flex-wrap items-center gap-x-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-amber-500">
          {t('feedback_thread.internal', 'Nota interna · solo la ve el equipo')}
          {legacy && (
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] normal-case tracking-normal">
              {t('feedback_thread.legacy_note', 'nota original')}
            </span>
          )}
        </p>
        <p className="whitespace-pre-wrap text-[13.5px] leading-[1.55] text-text">{body}</p>
        {shots && shots.length > 0 && <ShotGallery shots={shots} className="mt-2" />}
        <p className="mt-1 text-[11px] text-text-subtle">
          {authorName ?? t('feedback_thread.someone', 'Alguien del equipo')}
          {at ? ` · ${fmtRelative(at)}` : ''}
        </p>
      </div>
    </li>
  )
}

/** Un mensaje del hilo. Quien opinó a la izquierda, el equipo a la derecha. */
function ReplyNode({ event, fromOwner, mine, isStaff }: {
  event: FeedbackEvent
  fromOwner: boolean
  mine: boolean
  /** Cambia a quién señala el "visto": a la persona o al equipo. */
  isStaff: boolean
}) {
  const { t } = useTranslation()
  const teamSide = !fromOwner

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
          <Tooltip anchor="element" label={fmtExact(event.created_at)}>
            <span>{fmtRelative(event.created_at)}</span>
          </Tooltip>
          {/* Doble uso del "leído": al equipo le dice que la persona ya lo vio;
              a la persona, que el equipo ya leyó lo suyo. Una palabra de cinco
              letras cargando con eso pide explicarse: el globo dice QUIÉN lo vio
              y CUÁNDO, que es lo que de verdad se quiere saber. */}
          {mine && event.read_at && (
            <Tooltip
              anchor="element"
              maxWidth={220}
              label={
                <>
                  {isStaff
                    ? t('feedback_thread.seen_by_person', 'La persona ya lo leyó')
                    : t('feedback_thread.seen_by_team', 'El equipo ya lo leyó')}
                  {' · '}
                  {fmtExact(event.read_at)}
                </>
              }
            >
              <span className="text-[10.5px] text-[rgb(var(--brand-green))]">
                {t('feedback_thread.seen', 'visto')}
              </span>
            </Tooltip>
          )}
        </p>
        {/* Sin borde: en un hilo largo, un contorno por mensaje convierte la
            conversación en una rejilla de cajas. El relleno ya separa lo dicho
            del fondo, y el lado más el avatar ya dicen quién habla. */}
        <div
          className={cn(
            'inline-block w-full rounded-2xl px-3.5 py-2.5 text-left',
            teamSide
              ? 'rounded-tr-sm bg-[rgb(var(--brand-green))]/[0.09]'
              : 'rounded-tl-sm bg-subtle',
          )}
        >
          <p className="whitespace-pre-wrap text-[14px] leading-[1.6] text-text">{event.body}</p>
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
        <ReplyNode event={event} fromOwner={fromOwner} mine={mine} isStaff={isStaff} />
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
function Composer({ feedbackId, isStaff, accent, me, answeredByPeer, onPosted }: {
  feedbackId: string
  isStaff: boolean
  accent: string
  me: { name: string; avatar: string | null }
  /** Respuesta de un compañero que sigue siendo la última palabra del hilo. */
  answeredByPeer?: FeedbackEvent | null
  onPosted: (e: FeedbackEvent) => void
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [internal, setInternal] = useState(false)
  /** El aviso se puede apartar, pero de a uno: apartarlo no vale para el siguiente. */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [shots, setShots] = useState<FeedbackShot[]>([])
  const [attaching, setAttaching] = useState(false)
  const [sending, setSending] = useState(false)
  const [focused, setFocused] = useState(false)
  const [picking, setPicking] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const tone = internal ? '#f59e0b' : accent
  const canSend = body.trim().length > 0 && !sending

  // Crece con lo que se escribe, desde UNA línea: la caja de escribir es lo que
  // menos espacio debe pedir mientras nadie escribe —el sitio es de la
  // conversación— y solo se estira cuando de verdad hay texto que mostrar.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [body])

  /**
   * Las tres respuestas de siempre. Van en un desplegable y no a la vista: como
   * fila fija se comían un tercio del panel y dejaban la conversación en una
   * rendija. `short` es lo que se lee en el menú; `text` lo que se escribe.
   */
  const templates = useMemo(() => [
    {
      short: t('feedback_thread.tpl_reviewing_short', 'Gracias por avisarnos'),
      text: t('feedback_thread.tpl_reviewing', 'Gracias por avisarnos. Ya lo estamos revisando y te contamos apenas tengamos novedades.'),
    },
    {
      short: t('feedback_thread.tpl_fixed_short', 'Ya quedó corregido'),
      text: t('feedback_thread.tpl_fixed', 'Ya quedó corregido. Cierra sesión, vuelve a entrar y cuéntanos si te sigue pasando.'),
    },
    {
      short: t('feedback_thread.tpl_more_info_short', 'Pedir una captura'),
      text: t('feedback_thread.tpl_more_info', '¿Nos ayudas con una captura de la pantalla y el paso exacto donde se queda? Así lo reproducimos igual que tú.'),
    },
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

  const warn = answeredByPeer && answeredByPeer.id !== dismissed && !internal
    ? answeredByPeer
    : null

  return (
    <>
    {/* El aviso va FUERA de la caja y encima: dentro quedaría por debajo de las
        pestañas de modo, que es justo donde nadie mira antes de escribir. */}
    <AnimatePresence initial={false}>
      {warn && (
        <motion.div
          key={warn.id}
          initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0, y: 6 }}
          animate={{ opacity: 1, height: 'auto', y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0, y: 6 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="overflow-hidden"
        >
          <div className="mb-1.5 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.09] px-2.5 py-1.5">
            <span className="shrink-0 rounded-full ring-2 ring-amber-500/40">
              <Avatar src={warn.author_avatar} name={warn.author_name} size={22} />
            </span>
            <p className="min-w-0 flex-1 text-[12px] leading-snug text-amber-500">
              <span className="font-semibold">
                {t('feedback_thread.peer_answered', '{{who}} ya respondió', {
                  who: warn.author_name ?? t('feedback_thread.someone', 'Alguien del equipo'),
                })}
              </span>
              <span className="text-amber-500/80">
                {' · '}{fmtRelative(warn.created_at)}
                {minutesSince(warn.created_at) < 30
                  ? ` · ${t('feedback_thread.peer_answered_hint', 'revisa lo suyo antes de escribir')}`
                  : ''}
              </span>
            </p>
            <button
              type="button"
              onClick={() => setDismissed(warn.id)}
              className="shrink-0 rounded-lg p-1 text-amber-500/70 transition-colors hover:bg-amber-500/15 hover:text-amber-500"
              aria-label={t('common.close', 'Cerrar')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Sin animación `layout`: lo que crece aquí dentro (plantillas, adjuntos) ya
        anima su propia altura, y medir la caja entera mientras la ficha entera
        está entrando hacía que la caja se estirara a la vista al abrir un chat. */}
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-surface transition-colors duration-300',
        focused ? 'border-transparent' : 'border-line',
      )}
      style={focused ? { boxShadow: `0 0 0 1.5px ${tone}55, 0 12px 30px -18px ${tone}` } : undefined}
    >
      {/* Filo de color: dice de un vistazo que esto NO sale de casa. Solo en
          nota interna —que es el error caro— y no en la respuesta normal: una
          raya de color permanente es adorno, y de adorno esta pantalla va
          sobrada. */}
      <AnimatePresence>
        {internal && (
          <motion.span
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="absolute inset-x-0 top-0 h-[2px]"
            style={{ background: tone }}
          />
        )}
      </AnimatePresence>

      {isStaff && (
        <div className="flex flex-wrap items-center gap-0.5 px-1.5 pt-1">
          {/* Sin color: responder es lo normal y lo normal no se pinta. El color
              queda para la nota interna, que es lo que hay que ver sin leer. */}
          <ModeTab
            active={!internal}
            group={feedbackId}
            hint={t('feedback_thread.mode_reply_hint', 'Sale de la casa: la persona lo lee y le llega un aviso.')}
            onClick={() => setInternal(false)}
          >
            <Send className="h-3 w-3" />
            {t('feedback_thread.mode_reply', 'Responder a la persona')}
          </ModeTab>
          <ModeTab
            active={internal}
            group={feedbackId}
            tone="#f59e0b"
            hint={t('feedback_thread.mode_note_hint', 'Se queda en casa: solo lo ve el equipo, nunca quien opinó.')}
            onClick={() => setInternal(true)}
          >
            <Lock className="h-3 w-3" />
            {t('feedback_thread.mode_note', 'Nota interna')}
          </ModeTab>
        </div>
      )}

      <AnimatePresence initial={false}>
        {attaching && (
          <motion.div
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pt-2.5">
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
        <div className="px-2.5 pt-2.5">
          <ShotGallery shots={shots} />
        </div>
      )}

      {/* Todo en una fila: escribir, adjuntar, plantillas y enviar. La caja de
          escribir de un chat mide una línea hasta que hay algo que decir; con las
          acciones en su propia banda debajo, esto pedía el triple de alto y la
          conversación —lo que se viene a leer— quedaba en una rendija. */}
      <div className="flex items-end gap-2 px-2.5 py-2">
        <span className="mb-1 hidden shrink-0 sm:block">
          <Avatar src={me.avatar} name={me.name} size={28} />
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
          rows={1}
          placeholder={
            internal
              ? t('feedback_thread.ph_note', 'Qué se hizo con esto, para el equipo…')
              : isStaff
                ? t('feedback_thread.ph_reply', 'Escríbele a la persona. Le llega con un aviso…')
                : t('feedback_thread.ph_author', 'Responde al equipo…')
          }
          className="min-w-0 flex-1 resize-none self-center border-0 bg-transparent py-1.5 text-[14px] leading-[1.5] text-text outline-none placeholder:text-text-muted/60"
        />

        <div className="flex shrink-0 items-center gap-0.5 pb-0.5">
          {isStaff && !internal && (
            <TemplateMenu
              open={picking}
              onOpenChange={setPicking}
              templates={templates}
              reduce={!!reduce}
              onPick={(text) => { setBody(text); setPicking(false); areaRef.current?.focus() }}
            />
          )}

          <IconAction
            active={attaching}
            label={attaching
              ? t('feedback_thread.attach_close', 'Listo')
              : t('feedback_thread.attach', 'Adjuntar')}
            hint={attaching
              ? undefined
              : t('feedback_thread.attach_hint', 'Una captura vale más que tres párrafos explicando dónde falla')}
            onClick={() => setAttaching((v) => !v)}
          >
            {attaching ? <X className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />}
          </IconAction>

          {/* El globo cambia con el modo: el error caro de esta caja es mandarle
              a la persona lo que era una nota para el equipo, así que hasta el
              botón de enviar dice a dónde va lo que escribiste. */}
          <Tooltip
            anchor="element"
            maxWidth={220}
            shortcut="Ctrl+Enter"
            label={
              <span className="flex flex-col gap-0.5 text-center">
                <span className="font-semibold">
                  {internal
                    ? t('feedback_thread.save_note', 'Guardar nota')
                    : t('feedback_thread.send', 'Enviar')}
                </span>
                <span className="opacity-70">
                  {internal
                    ? t('feedback_thread.send_hint_note', 'Solo la ve el equipo. A la persona no le llega nada.')
                    : t('feedback_thread.send_hint_reply', 'Le llega a la persona con un aviso en su campana.')}
                </span>
              </span>
            }
          >
            <motion.button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              whileTap={reduce || !canSend ? undefined : { scale: 0.94 }}
              // `disabled:pointer-events-none` para que el globo salga también
              // con la caja vacía: es justo cuando hace falta saber a dónde iría.
              className="ml-0.5 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-white transition-opacity disabled:pointer-events-none disabled:opacity-35"
              style={{ background: tone, boxShadow: canSend ? `0 8px 20px -12px ${tone}` : undefined }}
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              <span className="hidden lg:inline">
                {internal
                  ? t('feedback_thread.save_note', 'Guardar nota')
                  : t('feedback_thread.send', 'Enviar')}
              </span>
            </motion.button>
          </Tooltip>
        </div>
      </div>
    </div>
    </>
  )
}

/**
 * Botón de acción de la barra: solo ícono. El nombre va en un globo propio y no
 * en el `title` del sistema — ese tarda un segundo largo, sale con la tipografía
 * del sistema operativo y en el móvil no existe.
 */
function IconAction({ active, label, hint, onClick, children }: {
  active?: boolean
  label: string
  /** Segunda línea: qué pasa al pulsarlo, cuando el nombre no basta. */
  hint?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip
      anchor="element"
      maxWidth={hint ? 210 : undefined}
      label={hint
        ? (
          <span className="flex flex-col gap-0.5 text-center">
            <span className="font-semibold">{label}</span>
            <span className="opacity-70">{hint}</span>
          </span>
        )
        : label}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
          active ? 'bg-subtle text-text' : 'text-text-muted hover:bg-subtle hover:text-text',
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}

/**
 * Las respuestas de siempre, a un clic pero sin ocupar sitio. El 80 % de lo que
 * se responde son estas tres, y escribirlas a mano cada vez es la razón por la
 * que las bandejas se quedan mudas; tenerlas desplegadas todo el rato era la
 * razón por la que no se veía la conversación.
 *
 * El desplegable sale por un portal al `body`, no dentro de la caja: la caja de
 * escribir recorta lo que se salga (`overflow-hidden`) y encima cuelga de varios
 * contenedores con `transform` de Motion, donde un `fixed` se ancla al padre
 * transformado en vez de a la ventana. Dentro, el menú simplemente no se vería.
 */
function TemplateMenu({ open, onOpenChange, templates, onPick, reduce }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  templates: { short: string; text: string }[]
  onPick: (text: string) => void
  reduce: boolean
}) {
  const { t } = useTranslation()
  const anchorRef = useRef<HTMLDivElement>(null)
  /** Esquina inferior derecha del botón, en coordenadas de ventana. */
  const [at, setAt] = useState<{ right: number; bottom: number } | null>(null)

  const place = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setAt({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.top })
  }, [])

  // Escape cierra: el menú tapa parte del hilo y hay que poder quitarlo sin ratón.
  // Y si la ventana cambia de tamaño, se recoloca en vez de quedarse a la deriva.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false) }
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
    }
  }, [open, onOpenChange, place])

  return (
    <div ref={anchorRef}>
      <IconAction
        active={open}
        label={t('feedback_thread.templates', 'Respuestas rápidas')}
        hint={t('feedback_thread.templates_hint', 'Las tres de siempre, listas para retocar antes de enviar')}
        onClick={() => { if (!open) place(); onOpenChange(!open) }}
      >
        <Sparkles className="h-4 w-4" />
      </IconAction>

      {createPortal(
        <AnimatePresence>
          {open && at && (
            <>
              {/* Clic fuera para cerrar, sin robarle el foco a lo que hay debajo. */}
              <button
                type="button"
                aria-label={t('common.close', 'Cerrar')}
                className="fixed inset-0 z-[9995] cursor-default"
                onClick={() => onOpenChange(false)}
              />
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                transition={{ duration: 0.18, ease: EASE }}
                style={{ right: at.right, bottom: at.bottom + 8 }}
                className="fixed z-[9996] w-[min(22rem,calc(100vw-2rem))] origin-bottom-right overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.55)]"
              >
                <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-subtle">
                  {t('feedback_thread.templates', 'Respuestas rápidas')}
                </p>
                {templates.map((tpl) => (
                  <button
                    key={tpl.short}
                    type="button"
                    onClick={() => onPick(tpl.text)}
                    className="block w-full rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-subtle"
                  >
                    <span className="block text-[12.5px] font-medium text-text">{tpl.short}</span>
                    <span className="block truncate text-[11px] text-text-muted">{tpl.text}</span>
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

function ModeTab({ active, group, tone, hint, onClick, children }: {
  active: boolean
  /** Ata el fondo que se desliza a ESTE hilo: ver el porqué abajo. */
  group: string
  /** Sin `tone` la pestaña activa va en neutro: es la opción de siempre. */
  tone?: string
  /** Quién va a leer lo que se escriba en este modo. */
  hint?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip anchor="element" maxWidth={230} label={hint} disabled={!hint}>
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors',
        active ? (tone ? '' : 'text-text') : 'text-text-muted hover:text-text',
      )}
      style={active && tone ? { color: tone } : undefined}
    >
      {active && (
        <motion.span
          // Único por hilo: con un `layoutId` compartido, al abrir otra opinión
          // el fondo de "Responder a la persona" salía volando desde la caja de
          // la anterior en lugar de estar ya puesto.
          layoutId={`composer-mode-${group}`}
          className={cn('absolute inset-0 rounded-lg', !tone && 'bg-subtle')}
          style={tone ? { background: `${tone}16` } : undefined}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        />
      )}
      <span className="relative inline-flex items-center gap-1.5">{children}</span>
    </button>
    </Tooltip>
  )
}
