import { supabase } from '@/lib/supabase'
import { notifyStaffSiteFeedback } from '@/services/notifications.service'

// La tabla site_feedback aún no está en los tipos generados de la BD; se accede
// sin tipar hasta regenerarlos. profiles/campaigns sí van tipados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = () => (supabase as any).from('site_feedback')

/**
 * Una captura adjunta a una opinión. Se guarda el `path` además de la `url`
 * porque borrar el archivo del bucket necesita la ruta, no el enlace público.
 */
export interface FeedbackShot {
  path: string
  url: string
  name: string
  size: number
  w: number
  h: number
  /** ISO de cuándo se adjuntó: distingue lo original de lo añadido después. */
  at: string
}

export type FeedbackKind = 'bug' | 'idea' | 'praise' | 'question'
export type FeedbackStatus = 'new' | 'in_review' | 'planned' | 'done' | 'archived'
/**
 * Por dónde prefiere que lo busquen. `whatsapp` ya no se ofrece —la empresa se
 * habla por Teams— pero se conserva en el tipo: hay opiniones viejas guardadas
 * con ese valor y deben seguir leyéndose tal como se enviaron.
 */
export type ContactPref = 'email' | 'teams' | 'call' | 'whatsapp'

export interface SiteFeedbackInput {
  kind: FeedbackKind
  mood: number | null
  ease: number | null
  areas: string[]
  /** Respuestas de las preguntas extra que dependen del tipo (clave → valor). */
  answers: Record<string, string>
  message: string
  contactOk: boolean
  contactEmail?: string | null
  contactPhone?: string | null
  contactPref?: ContactPref | null
  contactNote?: string | null
  lang: string
  page: string
  pageLabel: string
  /** Capturas ya subidas al bucket (ver `uploadFeedbackShot`). */
  shots?: FeedbackShot[]
}

export interface SiteFeedbackRow {
  id: string
  created_at: string
  user_id: string
  role: string | null
  campaign_id: string | null
  lang: string | null
  page: string | null
  page_label: string | null
  kind: FeedbackKind
  mood: number | null
  ease: number | null
  areas: string[] | null
  answers: Record<string, string> | null
  message: string | null
  contact_ok: boolean
  contact_email: string | null
  contact_phone: string | null
  contact_pref: ContactPref | null
  contact_note: string | null
  meta: Record<string, unknown> | null
  shots: FeedbackShot[] | null
  status: FeedbackStatus
  staff_note: string | null
  handled_by: string | null
  handled_at: string | null
  /** Resueltos aparte (la tabla no está en los tipos, no hay embed tipado). */
  display_name?: string | null
  campaign_name?: string | null
  handled_by_name?: string | null
}

const COLUMNS =
  'id,created_at,user_id,role,campaign_id,lang,page,page_label,kind,mood,ease,areas,answers,message,' +
  'contact_ok,contact_email,contact_phone,contact_pref,contact_note,meta,shots,status,staff_note,handled_by,handled_at'

/** Contexto técnico del navegador: sirve para reproducir un error reportado. */
function browserMeta(): Record<string, unknown> {
  if (typeof window === 'undefined') return {}
  return {
    ua: navigator.userAgent.slice(0, 400),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: window.devicePixelRatio,
    theme: document.documentElement.dataset.theme ?? null,
    ts: new Date().toISOString(),
  }
}

/**
 * Guarda una opinión. Lanza si falla: a diferencia del registro del chat, aquí
 * el usuario espera confirmación y merece enterarse si no se guardó.
 *
 * Guardada la fila, avisa al staff (superadmin + capacitadores de la campaña)
 * sin esperar la respuesta: el aviso es un extra, no parte del envío.
 */
export async function submitSiteFeedback(input: SiteFeedbackInput): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('NOT_AUTHENTICATED')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role,campaign_id')
    .eq('id', session.user.id)
    .maybeSingle()

  const { data, error } = await table().insert({
    user_id: session.user.id,
    role: profile?.role ?? null,
    campaign_id: profile?.campaign_id ?? null,
    lang: input.lang,
    page: input.page.slice(0, 300),
    page_label: input.pageLabel.slice(0, 200),
    kind: input.kind,
    mood: input.mood,
    ease: input.ease,
    areas: input.areas,
    answers: input.answers,
    message: input.message.trim().slice(0, 4000) || null,
    contact_ok: input.contactOk,
    contact_email: input.contactOk ? input.contactEmail?.trim() || null : null,
    contact_phone: input.contactOk ? input.contactPhone?.trim() || null : null,
    contact_pref: input.contactOk ? input.contactPref ?? null : null,
    contact_note: input.contactOk ? input.contactNote?.trim().slice(0, 500) || null : null,
    meta: browserMeta(),
    shots: input.shots ?? [],
  }).select('id').single()
  if (error) throw error

  // Aviso al staff en vivo (campana + tarjeta). Fire-and-forget y a prueba de
  // fallos: la opinión ya está guardada, y quien opinó no tiene por qué
  // enterarse de si el aviso llegó o no.
  const id = (data as { id?: string } | null)?.id
  if (id) void notifyStaffSiteFeedback(id)
}

/* ══════════════════════ Capturas de pantalla ══════════════════════ */

export const SHOTS_BUCKET = 'feedback-shots'
/** Tope por opinión: suficiente para explicar un error, no para un álbum. */
export const MAX_SHOTS = 5
/** Peso máximo del archivo original que aceptamos leer (antes de comprimir). */
export const MAX_SHOT_BYTES = 12 * 1024 * 1024
/** Lado mayor tras comprimir: legible a pantalla completa sin pesar de más. */
const SHOT_MAX_PX = 1800
const SHOT_QUALITY = 0.82

export function isAcceptedShot(file: File): boolean {
  return file.type.startsWith('image/') && file.size <= MAX_SHOT_BYTES
}

/**
 * Reescala a 1800px de lado mayor y recomprime a JPEG. Una captura de un
 * portátil moderno son 3–8 MB en PNG; así viaja en menos de 300 KB sin que se
 * deje de leer el texto de la pantalla, que es justo lo que hay que ver.
 * Devuelve también el tamaño final para poder pintar el hueco sin saltos.
 */
async function prepareShot(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, SHOT_MAX_PX / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) { bitmap.close?.(); return { blob: file, w: bitmap.width, h: bitmap.height } }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', SHOT_QUALITY))
  // Si comprimir no ayuda (capturas diminutas), nos quedamos con el original.
  return { blob: blob && blob.size < file.size ? blob : file, w, h }
}

/**
 * Sube una captura al bucket y devuelve su ficha. La carpeta es
 * `<uid>/<folder>/...`: el primer segmento es el dueño, que es lo que miran las
 * políticas del Storage, y el segundo agrupa las de una misma opinión.
 */
export async function uploadFeedbackShot(folder: string, file: File): Promise<FeedbackShot> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('NOT_AUTHENTICATED')

  const { blob, w, h } = await prepareShot(file)
  const ext = blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'png').toLowerCase()
  const path = `${session.user.id}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await supabase.storage.from(SHOTS_BUCKET).upload(path, blob, {
    contentType: blob.type || file.type,
    cacheControl: '31536000', // el nombre es único: la imagen nunca cambia
    upsert: false,
  })
  if (error) throw error

  return {
    path,
    url: supabase.storage.from(SHOTS_BUCKET).getPublicUrl(path).data.publicUrl,
    name: file.name.slice(0, 120),
    size: blob.size,
    w,
    h,
    at: new Date().toISOString(),
  }
}

/** Borra el archivo del bucket. Se usa al quitar una captura antes de enviar. */
export async function removeShotFile(path: string): Promise<void> {
  await supabase.storage.from(SHOTS_BUCKET).remove([path])
}

/**
 * Añade capturas a una opinión YA enviada (desde "Mis sugerencias"). Va por RPC
 * y no por UPDATE directo a propósito: abrir el UPDATE de la fila al autor le
 * dejaría cambiar también su estado o la nota interna del staff.
 */
export async function addShotsToFeedback(id: string, shots: FeedbackShot[]): Promise<FeedbackShot[]> {
  const { data, error } = await supabase.rpc('add_site_feedback_shots' as never, {
    p_id: id,
    p_shots: shots,
  } as never)
  if (error) throw error
  return (data ?? []) as unknown as FeedbackShot[]
}

/** Quita una captura de una opinión enviada (y su archivo del bucket). */
export async function removeShotFromFeedback(id: string, path: string): Promise<FeedbackShot[]> {
  const { data, error } = await supabase.rpc('remove_site_feedback_shot' as never, {
    p_id: id,
    p_path: path,
  } as never)
  if (error) throw error
  await removeShotFile(path)
  return (data ?? []) as unknown as FeedbackShot[]
}

/** Lo que YO he enviado (vista permanente del aprendiz). */
export async function getMySiteFeedback(): Promise<SiteFeedbackRow[]> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return []
  const { data, error } = await table()
    .select(COLUMNS)
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return (data ?? []) as SiteFeedbackRow[]
}

export interface FeedbackFilters {
  status?: FeedbackStatus | 'all' | 'open'
  kind?: FeedbackKind | 'all'
  contactOnly?: boolean
  search?: string
  limit?: number
}

/**
 * Bandeja del staff. La RLS ya acota lo que cada quien puede ver (su campaña o
 * todo si es superadmin), así que aquí solo aplicamos los filtros de la vista.
 */
export async function fetchSiteFeedback(f: FeedbackFilters = {}): Promise<SiteFeedbackRow[]> {
  let q = table()
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(f.limit ?? 300)

  if (f.status === 'open') q = q.in('status', ['new', 'in_review'])
  else if (f.status && f.status !== 'all') q = q.eq('status', f.status)
  if (f.kind && f.kind !== 'all') q = q.eq('kind', f.kind)
  if (f.contactOnly) q = q.eq('contact_ok', true)
  if (f.search?.trim()) q = q.ilike('message', `%${f.search.trim()}%`)

  const { data, error } = await q
  if (error) throw error
  return hydrateNames((data ?? []) as SiteFeedbackRow[])
}

/** Añade nombres de persona y campaña a las filas (dos consultas, no N). */
async function hydrateNames(rows: SiteFeedbackRow[]): Promise<SiteFeedbackRow[]> {
  if (rows.length === 0) return rows
  const userIds = [...new Set(rows.flatMap((r) => [r.user_id, r.handled_by]).filter(Boolean))] as string[]
  const campIds = [...new Set(rows.map((r) => r.campaign_id).filter(Boolean))] as string[]

  const [profs, camps] = await Promise.all([
    userIds.length
      ? supabase.from('profiles').select('id,display_name').in('id', userIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    campIds.length
      ? supabase.from('campaigns').select('id,name').in('id', campIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])

  const pMap = new Map((profs.data ?? []).map((p) => [p.id, p.display_name]))
  const cMap = new Map((camps.data ?? []).map((c) => [c.id, c.name]))

  return rows.map((r) => ({
    ...r,
    display_name: pMap.get(r.user_id) ?? null,
    campaign_name: r.campaign_id ? cMap.get(r.campaign_id) ?? null : null,
    handled_by_name: r.handled_by ? pMap.get(r.handled_by) ?? null : null,
  }))
}

export interface FeedbackStats {
  total: number
  open: number
  contactPending: number
  avgMood: number | null
  byKind: Record<FeedbackKind, number>
}

/**
 * Resumen de la bandeja. Se calcula en el cliente sobre las filas visibles: el
 * volumen esperado (cientos, no millones) no justifica una RPC más que mantener.
 */
export function computeStats(rows: SiteFeedbackRow[]): FeedbackStats {
  const byKind: Record<FeedbackKind, number> = { bug: 0, idea: 0, praise: 0, question: 0 }
  let moodSum = 0
  let moodCount = 0
  let open = 0
  let contactPending = 0

  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
    if (typeof r.mood === 'number') { moodSum += r.mood; moodCount++ }
    if (r.status === 'new' || r.status === 'in_review') {
      open++
      if (r.contact_ok) contactPending++
    }
  }

  return {
    total: rows.length,
    open,
    contactPending,
    avgMood: moodCount ? Math.round((moodSum / moodCount) * 10) / 10 : null,
    byKind,
  }
}

/**
 * Borra una opinión definitivamente. Solo el superadmin puede (lo impone la RLS,
 * no la interfaz): archivar es la vía normal, esto es para basura y pruebas.
 */
export async function deleteSiteFeedback(id: string, shots?: FeedbackShot[] | null): Promise<void> {
  // Sin política de DELETE la RLS no da error: filtra la fila y devuelve 0
  // borradas. Por eso pedimos el id de vuelta y tratamos el vacío como fallo.
  const { data, error } = await table().delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('DELETE_NOT_ALLOWED')
  // Los archivos no se van con la fila: si quedan, son basura invisible que
  // nadie volverá a borrar. Que falle esto no invalida el borrado.
  if (shots?.length) {
    await supabase.storage.from(SHOTS_BUCKET).remove(shots.map((s) => s.path)).catch(() => {})
  }
}

export async function updateSiteFeedback(
  id: string,
  patch: { status?: FeedbackStatus; staff_note?: string | null },
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  const { error } = await table()
    .update({
      ...patch,
      handled_by: session?.user.id ?? null,
      handled_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}
