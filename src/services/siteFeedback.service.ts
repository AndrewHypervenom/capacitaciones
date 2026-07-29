import { supabase } from '@/lib/supabase'

// La tabla site_feedback aún no está en los tipos generados de la BD; se accede
// sin tipar hasta regenerarlos. profiles/campaigns sí van tipados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = () => (supabase as any).from('site_feedback')

export type FeedbackKind = 'bug' | 'idea' | 'praise' | 'question'
export type FeedbackStatus = 'new' | 'in_review' | 'planned' | 'done' | 'archived'
export type ContactPref = 'email' | 'whatsapp' | 'call'

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
  'contact_ok,contact_email,contact_phone,contact_pref,contact_note,meta,status,staff_note,handled_by,handled_at'

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
 */
export async function submitSiteFeedback(input: SiteFeedbackInput): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('NOT_AUTHENTICATED')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role,campaign_id')
    .eq('id', session.user.id)
    .maybeSingle()

  const { error } = await table().insert({
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
  })
  if (error) throw error
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
