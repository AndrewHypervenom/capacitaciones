import { supabase } from '@/lib/supabase'
import type { FeedbackShot, FeedbackStatus } from '@/services/siteFeedback.service'

/**
 * El hilo de una opinión: lo que respondió el equipo, lo que contestó de vuelta
 * quien opinó, las notas internas y cada cambio de estado. Es una tabla de
 * solo-añadir (ver 2026-08-07-opiniones-conversacion.sql): nada se edita ni se
 * borra, para que la trazabilidad valga como prueba de lo que pasó.
 */

// La tabla site_feedback_events aún no está en los tipos generados de la BD.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = () => (supabase as any).from('site_feedback_events')

/** `reply` lo ven ambos · `note` solo el staff · `status` lo escribe el trigger. */
export type FeedbackEventType = 'reply' | 'note' | 'status'

export interface FeedbackEvent {
  id: string
  feedback_id: string
  author_id: string | null
  author_role: string | null
  type: FeedbackEventType
  body: string | null
  from_status: FeedbackStatus | null
  to_status: FeedbackStatus | null
  shots: FeedbackShot[] | null
  created_at: string
  read_at: string | null
  /**
   * Nombre y foto de quien escribió, copiados en la fila por un trigger. No se
   * resuelven consultando profiles a propósito: quien opinó no tiene permiso
   * para leer el perfil del capacitador que le responde, y un hilo donde el otro
   * lado sale sin nombre no es una conversación.
   */
  author_name: string | null
  author_avatar: string | null
}

const COLUMNS =
  'id,feedback_id,author_id,author_name,author_avatar,author_role,type,body,' +
  'from_status,to_status,shots,created_at,read_at'

/**
 * El hilo completo, del primer mensaje al último. La RLS ya decide qué ve cada
 * quien: a quien opinó le esconde las notas internas del equipo, así que aquí no
 * hace falta filtrar nada por rol.
 */
export async function fetchFeedbackThread(feedbackId: string): Promise<FeedbackEvent[]> {
  const { data, error } = await table()
    .select(COLUMNS)
    .eq('feedback_id', feedbackId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as FeedbackEvent[]
}

/**
 * Alguien del equipo que ya metió mano en este hilo. Es el dato que evita el
 * error caro de esta bandeja: dos personas respondiéndole a la misma persona sin
 * saber la una de la otra.
 */
export interface ThreadStaffer {
  id: string
  name: string | null
  avatar: string | null
  /** Lo último que escribió aquí (respuesta o nota). */
  at: string
  /** Solo ha dejado notas internas: todavía no le ha hablado a la persona. */
  onlyNotes: boolean
}

/** Resumen de un hilo, para pintar la lista sin abrir cada opinión. */
export interface ThreadSummary {
  /** Mensajes visibles (respuestas de ambos lados), sin contar notas ni estados. */
  replies: number
  notes: number
  /** Última actividad del hilo (o null si nadie ha escrito nada todavía). */
  lastAt: string | null
  lastType: FeedbackEventType | null
  /** El último mensaje lo escribió quien opinó → la pelota está del lado del equipo. */
  awaitingStaff: boolean
  /** El equipo ya respondió al menos una vez. */
  answered: boolean
  /** Mensajes que el que mira todavía no ha leído. */
  unread: number
  /** Quiénes del equipo han escrito aquí, del más reciente al más antiguo. */
  staff: ThreadStaffer[]
  /** Quién del equipo dio la ÚLTIMA respuesta hacia afuera (null si nadie). */
  lastReplyBy: ThreadStaffer | null
  /** Quien mira ya le respondió a la persona en este hilo. */
  mine: boolean
}

/**
 * Un resumen en blanco NUEVO cada vez. No vale un objeto compartido: `staff` es
 * un array y un `{ ...EMPTY_SUMMARY }` copiaría la referencia — el primer hilo
 * que empujara un compañero se lo encontrarían todos los demás.
 */
export function emptySummary(): ThreadSummary {
  return {
    replies: 0, notes: 0, lastAt: null, lastType: null,
    awaitingStaff: false, answered: false, unread: 0,
    staff: [], lastReplyBy: null, mine: false,
  }
}

/** Solo para LEER (fallback de un id sin hilo). Para mutar, `emptySummary()`. */
export const EMPTY_SUMMARY: ThreadSummary = Object.freeze(emptySummary())

/**
 * Resúmenes de varios hilos de un tirón. Una sola consulta para toda la bandeja:
 * el volumen es de cientos de filas, y agregar en el cliente ahorra una RPC más
 * que mantener.
 *
 * `ownerOf` dice de quién es cada opinión: es lo que distingue "lo escribió la
 * persona" de "lo escribió el equipo" sin tener que preguntar el rol de cada
 * autor.
 */
export async function fetchThreadSummaries(
  ownerOf: Map<string, string>,
  viewerId: string | null,
): Promise<Map<string, ThreadSummary>> {
  const ids = [...ownerOf.keys()]
  const out = new Map<string, ThreadSummary>()
  if (ids.length === 0) return out

  const { data, error } = await table()
    .select('feedback_id,author_id,author_name,author_avatar,type,created_at,read_at')
    .in('feedback_id', ids)
    .order('created_at', { ascending: true })
  if (error) throw error

  for (const e of (data ?? []) as FeedbackEvent[]) {
    const owner = ownerOf.get(e.feedback_id)
    const s = out.get(e.feedback_id) ?? emptySummary()
    const fromOwner = e.author_id === owner

    if (e.type === 'note') s.notes++
    if (e.type === 'reply') {
      s.replies++
      s.awaitingStaff = fromOwner
      if (!fromOwner) s.answered = true
      // Sin leer = lo escribió el OTRO lado y nadie lo ha abierto. Se mide por
      // lado, no por autor: para el equipo, la respuesta de un compañero no es
      // un pendiente; para la persona, tampoco lo es su propio mensaje.
      const viewerIsOwner = owner === viewerId
      if (!e.read_at && fromOwner !== viewerIsOwner) s.unread++
    }

    // Quién del equipo puso mano aquí. Todo lo que no escribió el dueño de la
    // opinión es del equipo — no hace falta preguntar por el rol de nadie.
    if (!fromOwner && e.author_id && e.type !== 'status') {
      trackStaffer(s, e)
      if (e.type === 'reply') {
        s.lastReplyBy = { ...stafferOf(e), onlyNotes: false }
        if (e.author_id === viewerId) s.mine = true
      }
    }

    s.lastAt = e.created_at
    s.lastType = e.type
    out.set(e.feedback_id, s)
  }

  // El más reciente primero: en la lista solo caben dos o tres caras, y las que
  // importan son las de quien acaba de tocar el hilo.
  for (const s of out.values()) s.staff.sort((a, b) => b.at.localeCompare(a.at))

  return out
}

function stafferOf(e: FeedbackEvent): ThreadStaffer {
  return {
    id: e.author_id as string,
    name: e.author_name,
    avatar: e.author_avatar,
    at: e.created_at,
    onlyNotes: e.type === 'note',
  }
}

/** Apunta a esta persona del equipo en el resumen (o refresca lo que ya tenía). */
function trackStaffer(s: ThreadSummary, e: FeedbackEvent) {
  const cur = s.staff.find((x) => x.id === e.author_id)
  if (!cur) { s.staff.push(stafferOf(e)); return }
  cur.at = e.created_at
  cur.name = e.author_name ?? cur.name
  cur.avatar = e.author_avatar ?? cur.avatar
  // Una sola respuesta hacia afuera basta para que deje de ser "solo notas".
  if (e.type === 'reply') cur.onlyNotes = false
}

/**
 * Escribe en el hilo. `internal` marca la nota que solo ve el equipo — la RLS
 * rechaza que quien opinó la escriba, así que la interfaz ni la ofrece.
 *
 * El autor (nombre, foto y rol) NO se manda: lo estampa un trigger contra el
 * perfil real, para que nadie firme con un nombre que no es el suyo.
 *
 * Avisa a la otra parte sin esperar la respuesta: el mensaje ya está guardado y
 * el aviso es un extra, igual que en el envío de la opinión.
 */
export async function postFeedbackMessage(params: {
  feedbackId: string
  body: string
  shots?: FeedbackShot[]
  internal?: boolean
}): Promise<FeedbackEvent> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('NOT_AUTHENTICATED')

  const { data, error } = await table()
    .insert({
      feedback_id: params.feedbackId,
      author_id: session.user.id,
      type: params.internal ? 'note' : 'reply',
      body: params.body.trim().slice(0, 4000),
      shots: params.shots ?? [],
    })
    .select(COLUMNS)
    .single()
  if (error) throw error

  const event = data as FeedbackEvent
  if (event.type === 'reply') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (supabase as any)
      .rpc('notify_site_feedback_reply', { p_event_id: event.id })
      .then(undefined, () => {})
  }

  return event
}

/** Da por leído lo que te escribió la otra parte en este hilo. */
export async function markFeedbackThreadRead(feedbackId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('mark_site_feedback_read', { p_id: feedbackId })
  if (error) throw error
}

/**
 * Escucha mensajes nuevos en los hilos. Sin `feedbackId` escucha TODOS los que la
 * RLS deja ver a quien mira —la bandeja del equipo y "Mis sugerencias" se enteran
 * de una respuesta sin recargar—; con él, solo ese hilo.
 *
 * La RLS se aplica también en Realtime, así que aquí no se filtra por rol: al
 * autor no le llegan las notas internas del equipo porque la política se las
 * esconde igual que en la consulta.
 *
 * Devuelve la función para darse de baja. Requiere que la tabla esté en la
 * publicación `supabase_realtime` (ver el SQL de avisos de respuesta).
 */
export function subscribeFeedbackEvents(
  onInsert: (event: FeedbackEvent) => void,
  opts: { feedbackId?: string } = {},
): () => void {
  // Nombre único por suscripción: dos pantallas montadas a la vez (la bandeja y
  // el hilo abierto) no pueden pelearse por el mismo canal.
  const suffix = Math.random().toString(36).slice(2, 8)
  const channel = supabase
    .channel(`sfe:${opts.feedbackId ?? 'all'}:${suffix}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'site_feedback_events',
        ...(opts.feedbackId ? { filter: `feedback_id=eq.${opts.feedbackId}` } : {}),
      },
      (payload) => onInsert(payload.new as FeedbackEvent),
    )
    .subscribe()

  return () => { void supabase.removeChannel(channel) }
}
