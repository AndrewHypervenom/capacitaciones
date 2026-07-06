import { supabase } from '@/lib/supabase'
import { normalize } from '@/lib/normalize'

// La tabla help_chat_logs aún no está en los tipos generados de la BD; se
// accede sin tipar (cast) hasta regenerarlos. profiles/campaigns sí van tipados.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const logs = () => (supabase as any).from('help_chat_logs')

export type HelpLogSource = 'faq' | 'no_match' | 'ai'

export interface HelpLogInput {
  role: string | null
  campaignId: string | null
  lang: string
  page: string
  source: HelpLogSource
  faqId?: string | null
  question: string
  answer?: string | null
}

/**
 * Registra una interacción del chat en la BD (fire-and-forget). Nunca lanza:
 * si falla el registro, la experiencia del usuario no se afecta.
 */
export async function logHelpInteraction(entry: HelpLogInput): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    await logs().insert({
      user_id: session.user.id,
      role: entry.role,
      campaign_id: entry.campaignId,
      lang: entry.lang,
      page: entry.page,
      source: entry.source,
      faq_id: entry.faqId ?? null,
      question: entry.question.slice(0, 2000),
      answer: entry.answer?.slice(0, 8000) ?? null,
    })
  } catch {
    // Silencioso a propósito.
  }
}

// ─── Lectura (solo superadmin, por RLS) ──────────────────────────

export interface HelpLogRow {
  id: string
  created_at: string
  user_id: string | null
  role: string | null
  campaign_id: string | null
  lang: string | null
  page: string | null
  source: HelpLogSource
  faq_id: string | null
  question: string
  answer: string | null
  display_name: string | null
  campaign_name: string | null
}

export interface HelpKpis {
  total: number
  faq: number
  ai: number
  no_match: number
}

async function countBy(source?: HelpLogSource): Promise<number> {
  let q = logs().select('id', { count: 'exact', head: true })
  if (source) q = q.eq('source', source)
  const { count } = await q
  return count ?? 0
}

export async function fetchHelpKpis(): Promise<HelpKpis> {
  const [total, faq, ai, no_match] = await Promise.all([
    countBy(), countBy('faq'), countBy('ai'), countBy('no_match'),
  ])
  return { total, faq, ai, no_match }
}

export async function fetchHelpLogs(opts: {
  source?: HelpLogSource | 'all'
  search?: string
  limit?: number
}): Promise<HelpLogRow[]> {
  let q = logs()
    .select('id,created_at,user_id,role,campaign_id,lang,page,source,faq_id,question,answer')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 200)

  if (opts.source && opts.source !== 'all') q = q.eq('source', opts.source)
  if (opts.search?.trim()) q = q.ilike('question', `%${opts.search.trim()}%`)

  const { data, error } = await q
  if (error) throw error
  const rows = (data ?? []) as Omit<HelpLogRow, 'display_name' | 'campaign_name'>[]

  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[]
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
    display_name: r.user_id ? pMap.get(r.user_id) ?? null : null,
    campaign_name: r.campaign_id ? cMap.get(r.campaign_id) ?? null : null,
  }))
}

/** Preguntas sin respuesta más frecuentes (los "vacíos" de la base local). */
export async function fetchTopUnanswered(limit = 10): Promise<{ label: string; count: number }[]> {
  const { data } = await logs()
    .select('question')
    .eq('source', 'no_match')
    .order('created_at', { ascending: false })
    .limit(500)

  const counts = new Map<string, { label: string; count: number }>()
  for (const r of (data ?? []) as { question: string }[]) {
    const key = normalize(r.question)
    if (!key) continue
    const cur = counts.get(key)
    if (cur) cur.count++
    else counts.set(key, { label: r.question, count: 1 })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}
