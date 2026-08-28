import { supabase } from '@/lib/supabase'
import { rowText, rowList } from '@/lib/contentLang'

/**
 * Contexto de auditoría: convierte un `entity_id` suelto de la bitácora en algo
 * que se pueda leer — dónde vive (campaña › curso › módulo), qué contiene
 * (secciones, bloques, quizzes, niveles…) y qué se destruiría al eliminarlo.
 *
 * Todo se resuelve contra las tablas actuales; no requiere SQL nuevo. Si la
 * entidad ya no existe (borrado definitivo), se devuelve `exists: false` y la
 * vista cae a lo que quedó guardado en el propio evento.
 */

export interface PathPart {
  kind: 'campaign' | 'course' | 'module' | 'world'
  label: string
  href?: string
}

/** Métrica de contenido. `labelKey` se traduce en la vista. */
export interface StatItem {
  labelKey: string
  value: number | string
}

export interface ChildItem {
  id: string
  label: string
  /** Sub-etiqueta: estilo de sección, tipo de bloque, nº de niveles… */
  meta?: string
  /** Métricas cortas del hijo (bloques, quizzes…). */
  chips?: string[]
}

export interface ContentDetail {
  type: string
  id: string
  exists: boolean
  /** true si la fila existe pero está oculta por borrado suave (deleted_at). */
  deleted?: boolean
  title: string | null
  href: string | null
  path: PathPart[]
  stats: StatItem[]
  /** Título de la lista de hijos, ya como clave i18n. */
  childrenLabelKey?: string
  children: ChildItem[]
  /** Qué se pierde si se elimina definitivamente. */
  impact: StatItem[]
  /** Campos crudos de la fila (para el inspector completo). */
  raw?: Record<string, unknown> | null
}

/** Contexto ligero, el que se pinta en cada renglón del feed. */
export interface EntityContext {
  type: string
  id: string
  exists: boolean
  title: string | null
  href: string | null
  path: PathPart[]
  /** Resumen en una línea: "3 módulos · 12 secciones". */
  summary?: string
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Peso en bytes de un objeto, medido como su JSON (igual que hace el RPC). */
function jsonBytes(...parts: unknown[]): number {
  return parts.reduce<number>((n, p) => n + new Blob([JSON.stringify(p ?? null)]).size, 0)
}

/** Bytes en formato humano: 812 B · 24,3 kB · 1,2 MB. */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Tipos que sí tienen una fila propia que podamos leer. */
const RESOLVABLE = new Set([
  'campaigns', 'courses', 'modules', 'worlds', 'arena_quizzes',
  'scenarios', 'choice_scenarios', 'live_quizzes', 'guided_missions', 'profiles',
])

export function entityHref(type: string, id: string, extra?: { worldId?: string | null }): string | null {
  switch (type) {
    case 'courses': return `/admin/courses/${id}`
    case 'modules': return `/admin/modules/${id}`
    case 'worlds': return `/admin/worlds/${id}`
    case 'arena_quizzes': return extra?.worldId ? `/admin/worlds/${extra.worldId}` : '/admin/worlds'
    case 'scenarios': return `/admin/simulations/${id}`
    case 'choice_scenarios': return `/admin/simulations/choice/${id}`
    case 'profiles': return `/admin/users/${id}`
    case 'campaigns': return '/admin/campaigns'
    case 'live_quizzes': return '/admin/quiz'
    case 'guided_missions': return '/admin/missions'
    default: return null
  }
}

// ════════════════════════════════════════════════════════════════════════
// Contexto ligero en lote (para el feed)
// ════════════════════════════════════════════════════════════════════════

/**
 * Resuelve en lote el contexto de muchos eventos: una consulta por tipo, más
 * una para los nombres de campaña y otra para los títulos de curso. Devuelve un
 * mapa con clave `${type}:${id}`.
 */
export async function getEntityContexts(
  items: { type: string; id: string }[],
): Promise<Record<string, EntityContext>> {
  const byType = new Map<string, Set<string>>()
  for (const it of items) {
    if (!it.id || !RESOLVABLE.has(it.type)) continue
    if (!byType.has(it.type)) byType.set(it.type, new Set())
    byType.get(it.type)!.add(it.id)
  }
  if (byType.size === 0) return {}

  const ids = (t: string) => [...(byType.get(t) ?? [])]
  const has = (t: string) => (byType.get(t)?.size ?? 0) > 0

  const [campaignsRes, coursesRes, modulesRes, worldsRes, arenaRes, scenRes, choiceRes, quizRes, missionRes, profileRes] =
    await Promise.all([
      has('campaigns')
        ? supabase.from('campaigns').select('id, name').in('id', ids('campaigns'))
        : empty(),
      has('courses')
        ? supabase.from('courses').select('id, title_es, campaign_id, is_published').in('id', ids('courses'))
        : empty(),
      has('modules')
        ? supabase.from('modules').select('id, title_es, campaign_id, course_id, is_published').in('id', ids('modules'))
        : empty(),
      has('worlds')
        ? supabase.from('worlds').select('id, name, campaign_id, course_id').in('id', ids('worlds'))
        : empty(),
      has('arena_quizzes')
        ? supabase.from('arena_quizzes').select('id, title, campaign_id, world_id, steps').in('id', ids('arena_quizzes'))
        : empty(),
      has('scenarios')
        ? supabase.from('scenarios').select('id, title_es, campaign_id, course_id, is_published').in('id', ids('scenarios'))
        : empty(),
      has('choice_scenarios')
        ? supabase.from('choice_scenarios').select('id, title_es, campaign_id, course_id, is_published').in('id', ids('choice_scenarios'))
        : empty(),
      has('live_quizzes')
        ? supabase.from('live_quizzes').select('id, title, campaign_id, status, questions').in('id', ids('live_quizzes'))
        : empty(),
      has('guided_missions')
        ? supabase.from('guided_missions').select('id, title, campaign_id, steps').in('id', ids('guided_missions'))
        : empty(),
      has('profiles')
        ? supabase.from('profiles').select('id, display_name, role, campaign_id').in('id', ids('profiles'))
        : empty(),
    ])

  // Nombres de campaña y títulos de curso referenciados por lo anterior.
  const campaignIds = new Set<string>()
  const courseIds = new Set<string>()
  const collect = (rows: { campaign_id?: string | null; course_id?: string | null }[]) => {
    for (const r of rows) {
      if (r.campaign_id) campaignIds.add(r.campaign_id)
      if (r.course_id) courseIds.add(r.course_id)
    }
  }
  const rowsOf = <T,>(res: { data: unknown }) => (res.data ?? []) as T[]
  const courses = rowsOf<{ id: string; title_es: string; campaign_id: string; is_published: boolean }>(coursesRes)
  const modules = rowsOf<{ id: string; title_es: string; campaign_id: string; course_id: string | null; is_published: boolean }>(modulesRes)
  const worlds = rowsOf<{ id: string; name: string; campaign_id: string; course_id: string | null }>(worldsRes)
  const arenas = rowsOf<{ id: string; title: string; campaign_id: string | null; world_id: string | null; steps: unknown }>(arenaRes)
  const scenarios = rowsOf<{ id: string; title_es: string; campaign_id: string; course_id: string | null; is_published: boolean }>(scenRes)
  const choices = rowsOf<{ id: string; title_es: string; campaign_id: string; course_id: string | null; is_published: boolean }>(choiceRes)
  const quizzes = rowsOf<{ id: string; title: string; campaign_id: string; status: string; questions: unknown }>(quizRes)
  const missions = rowsOf<{ id: string; title: string; campaign_id: string | null; steps: unknown }>(missionRes)
  const profiles = rowsOf<{ id: string; display_name: string | null; role: string; campaign_id: string | null }>(profileRes)
  const campaigns = rowsOf<{ id: string; name: string }>(campaignsRes)

  collect(courses); collect(modules); collect(worlds); collect(arenas)
  collect(scenarios); collect(choices); collect(quizzes); collect(missions); collect(profiles)

  const missingCampaigns = [...campaignIds].filter((id) => !campaigns.some((c) => c.id === id))
  const missingCourses = [...courseIds].filter((id) => !courses.some((c) => c.id === id))
  const [extraCampaigns, extraCourses, worldsOfArenas] = await Promise.all([
    missingCampaigns.length ? supabase.from('campaigns').select('id, name').in('id', missingCampaigns) : empty(),
    missingCourses.length ? supabase.from('courses').select('id, title_es, campaign_id').in('id', missingCourses) : empty(),
    arenas.some((a) => a.world_id)
      ? supabase.from('worlds').select('id, name').in('id', arenas.map((a) => a.world_id).filter(Boolean) as string[])
      : empty(),
  ])

  const campaignName = new Map<string, string>([
    ...campaigns.map((c) => [c.id, c.name] as const),
    ...rowsOf<{ id: string; name: string }>(extraCampaigns).map((c) => [c.id, c.name] as const),
  ])
  const courseInfo = new Map<string, { title: string; campaign_id?: string }>([
    ...courses.map((c) => [c.id, { title: rowText(c), campaign_id: c.campaign_id }] as const),
    ...rowsOf<{ id: string; title_es: string; campaign_id: string }>(extraCourses).map(
      (c) => [c.id, { title: rowText(c), campaign_id: c.campaign_id }] as const,
    ),
  ])
  const worldName = new Map(rowsOf<{ id: string; name: string }>(worldsOfArenas).map((w) => [w.id, w.name]))

  const out: Record<string, EntityContext> = {}
  const put = (
    type: string, id: string, title: string | null,
    opts: { campaignId?: string | null; courseId?: string | null; worldId?: string | null; summary?: string } = {},
  ) => {
    const path: PathPart[] = []
    const campId = opts.campaignId ?? (opts.courseId ? courseInfo.get(opts.courseId)?.campaign_id : undefined)
    if (campId && campaignName.has(campId)) path.push({ kind: 'campaign', label: campaignName.get(campId)! })
    if (opts.courseId && courseInfo.has(opts.courseId)) {
      path.push({ kind: 'course', label: courseInfo.get(opts.courseId)!.title, href: `/admin/courses/${opts.courseId}` })
    }
    if (opts.worldId && worldName.has(opts.worldId)) {
      path.push({ kind: 'world', label: worldName.get(opts.worldId)!, href: `/admin/worlds/${opts.worldId}` })
    }
    out[`${type}:${id}`] = {
      type, id, exists: true, title,
      href: entityHref(type, id, { worldId: opts.worldId }),
      path, summary: opts.summary,
    }
  }

  for (const c of campaigns) put('campaigns', c.id, c.name)
  for (const c of courses) put('courses', c.id, rowText(c), { campaignId: c.campaign_id })
  for (const m of modules) put('modules', m.id, rowText(m), { campaignId: m.campaign_id, courseId: m.course_id })
  for (const w of worlds) put('worlds', w.id, w.name, { campaignId: w.campaign_id, courseId: w.course_id })
  for (const a of arenas) put('arena_quizzes', a.id, a.title, { campaignId: a.campaign_id, worldId: a.world_id, summary: `${arr(a.steps).length}` })
  for (const s of scenarios) put('scenarios', s.id, rowText(s), { campaignId: s.campaign_id, courseId: s.course_id })
  for (const s of choices) put('choice_scenarios', s.id, rowText(s), { campaignId: s.campaign_id, courseId: s.course_id })
  for (const q of quizzes) put('live_quizzes', q.id, q.title, { campaignId: q.campaign_id })
  for (const m of missions) put('guided_missions', m.id, m.title, { campaignId: m.campaign_id })
  for (const p of profiles) put('profiles', p.id, p.display_name ?? null, { campaignId: p.campaign_id })

  // Lo que se pidió y no volvió: ya no existe (borrado definitivo).
  for (const it of items) {
    const key = `${it.type}:${it.id}`
    if (!out[key] && it.id && RESOLVABLE.has(it.type)) {
      out[key] = { type: it.type, id: it.id, exists: false, title: null, href: null, path: [] }
    }
  }
  return out
}

function empty() {
  return Promise.resolve({ data: [] as unknown[], error: null })
}

// ════════════════════════════════════════════════════════════════════════
// Detalle profundo de una entidad (panel expandido y aprobaciones)
// ════════════════════════════════════════════════════════════════════════

/**
 * Todo lo que se puede saber de una entidad: ruta, métricas de contenido, la
 * lista de sus hijos y el impacto de eliminarla.
 */
export async function getContentDetail(type: string, id: string): Promise<ContentDetail> {
  const base: ContentDetail = {
    type, id, exists: false, title: null, href: entityHref(type, id),
    path: [], stats: [], children: [], impact: [], raw: null,
  }
  if (!id) return base

  const direct = await readDirect(type, id, base)
  if (direct.exists) return direct
  // Si no se pudo leer, casi siempre es porque está oculto por borrado suave:
  // las RLS filtran deleted_at incluso para el superadmin. La instantánea del
  // servidor (SECURITY DEFINER) sí lo ve.
  return (await readSnapshot(type, id, base)) ?? direct
}

/** Lectura normal, sujeta a RLS. */
async function readDirect(type: string, id: string, base: ContentDetail): Promise<ContentDetail> {
  try {
    switch (type) {
      case 'modules': return await moduleDetail(id, base)
      case 'courses': return await courseDetail(id, base)
      case 'campaigns': return await campaignDetail(id, base)
      case 'worlds': return await worldDetail(id, base)
      case 'arena_quizzes': return await arenaDetail(id, base)
      case 'scenarios': return await scenarioDetail(id, base, 'scenarios')
      case 'choice_scenarios': return await scenarioDetail(id, base, 'choice_scenarios')
      case 'live_quizzes': return await liveQuizDetail(id, base)
      case 'guided_missions': return await missionDetail(id, base)
      case 'profiles': return await profileDetail(id, base)
      default: return base
    }
  } catch (e) {
    console.error('audit content detail error:', e)
    return base
  }
}

/** Forma que devuelve el RPC get_entity_snapshot (ver SQL 2026-07-27). */
interface SnapshotJson {
  type: string
  id: string
  title: string | null
  deleted: boolean
  path: PathPart[]
  stats: StatItem[]
  children: ChildItem[]
  impact: StatItem[]
  row: Record<string, unknown> | null
}

/**
 * Instantánea del servidor: lee la fila y sus hijos ignorando el borrado suave.
 * Devuelve null si el RPC todavía no está creado o la entidad no existe.
 */
async function readSnapshot(type: string, id: string, base: ContentDetail): Promise<ContentDetail | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('get_entity_snapshot', {
      p_entity_type: type,
      p_entity_id: id,
    })
    if (error) {
      // 42883/PGRST202 = la función aún no existe: no es un fallo de la vista.
      if (error.code !== '42883' && error.code !== 'PGRST202') {
        console.error('entity snapshot error:', error)
      }
      return null
    }
    const snap = data as SnapshotJson | null
    if (!snap) return null
    return {
      ...base,
      exists: true,
      deleted: snap.deleted,
      title: snap.title ?? null,
      href: snap.deleted ? null : entityHref(type, id),
      path: snap.path ?? [],
      stats: snap.stats ?? [],
      children: snap.children ?? [],
      impact: snap.impact ?? [],
      childrenLabelKey: CHILDREN_LABEL[type],
      raw: snap.row ?? null,
    }
  } catch (e) {
    console.error('entity snapshot error:', e)
    return null
  }
}

/** Título de la lista de hijos por tipo (el RPC devuelve sólo los datos). */
const CHILDREN_LABEL: Record<string, string> = {
  modules: 'admin.audit.children_sections',
  courses: 'admin.audit.children_modules',
  campaigns: 'admin.audit.children_courses',
  worlds: 'admin.audit.children_regions',
  arena_quizzes: 'admin.audit.children_questions',
  live_quizzes: 'admin.audit.children_questions',
  guided_missions: 'admin.audit.children_steps',
}

/** Ruta campaña › curso a partir de ids sueltos. */
async function pathFor(campaignId?: string | null, courseId?: string | null): Promise<PathPart[]> {
  const path: PathPart[] = []
  const [camp, course] = await Promise.all([
    campaignId ? supabase.from('campaigns').select('name').eq('id', campaignId).maybeSingle() : null,
    courseId ? supabase.from('courses').select('title_es, campaign_id').eq('id', courseId).maybeSingle() : null,
  ])
  const campName = (camp?.data as { name?: string } | null)?.name
  if (campName) path.push({ kind: 'campaign', label: campName })
  const courseTitle = (course?.data as { title_es?: string } | null)?.title_es
  if (courseTitle && courseId) path.push({ kind: 'course', label: courseTitle, href: `/admin/courses/${courseId}` })
  return path
}

/** Cuenta filas sin traerlas. */
async function count(table: string, column: string, value: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: n } = await (supabase.from(table as any) as any)
    .select('*', { count: 'exact', head: true })
    .eq(column, value)
  return n ?? 0
}

/** Etiqueta corta de una sección según su estilo/contenido. */
function sectionMeta(s: { section_style: string | null; media_type: string | null }): string {
  if (s.section_style === 'game-sort') return 'game-sort'
  if (s.section_style === 'game-classify') return 'game-classify'
  if (s.section_style === 'video-interactive') return 'video-interactive'
  if (s.media_type) return s.media_type
  return s.section_style ?? 'default'
}

async function moduleDetail(id: string, base: ContentDetail): Promise<ContentDetail> {
  const { data: mod } = await supabase
    .from('modules')
    .select('id, title_es, slug, icon, duration_min, campaign_id, course_id, is_published, sound_theme, created_at, updated_at')
    .eq('id', id).maybeSingle()
  if (!mod) return base

  const { data: sections } = await supabase
    .from('module_sections')
    .select('id, heading_es, sort_order, section_style, media_type, media_url, body_es, blocks_data, video_markers')
    .eq('module_id', id).order('sort_order')
  const secs = (sections ?? []) as {
    id: string; heading_es: string; sort_order: number
    section_style: string | null; media_type: string | null; media_url: string | null
    body_es: string[] | null; blocks_data: unknown; video_markers: unknown
  }[]

  const { data: quizzes } = secs.length
    ? await supabase.from('section_quizzes').select('id, section_id').in('section_id', secs.map((s) => s.id))
    : { data: [] as { id: string; section_id: string }[] }
  const quizBySection = new Map<string, number>()
  for (const q of (quizzes ?? []) as { section_id: string }[]) {
    quizBySection.set(q.section_id, (quizBySection.get(q.section_id) ?? 0) + 1)
  }

  let blocks = 0, games = 0, media = 0, words = 0, markers = 0
  const blockKinds = new Map<string, number>()
  for (const s of secs) {
    const bd = arr((s.blocks_data as { blocks?: unknown } | null)?.blocks ?? s.blocks_data)
    blocks += bd.length
    for (const b of bd) {
      const kind = String((b as { type?: string })?.type ?? 'texto')
      blockKinds.set(kind, (blockKinds.get(kind) ?? 0) + 1)
    }
    if (s.section_style?.startsWith('game-')) games += 1
    if (s.media_url || s.media_type) media += 1
    markers += arr((s.video_markers as { markers?: unknown } | null)?.markers ?? s.video_markers).length
    for (const p of rowList(s, 'body')) words += String(p).trim().split(/\s+/).filter(Boolean).length
  }

  const timeRows = await count('module_time', 'module_id', id)
  const levelsUsing = await count('world_levels', 'module_id', id)

  return {
    ...base,
    exists: true,
    title: rowText(mod),
    path: await pathFor(mod.campaign_id, mod.course_id),
    stats: [
      { labelKey: 'admin.audit.stat_sections', value: secs.length },
      { labelKey: 'admin.audit.stat_blocks', value: blocks },
      { labelKey: 'admin.audit.stat_quizzes', value: (quizzes ?? []).length },
      { labelKey: 'admin.audit.stat_games', value: games },
      { labelKey: 'admin.audit.stat_media', value: media },
      { labelKey: 'admin.audit.stat_markers', value: markers },
      { labelKey: 'admin.audit.stat_words', value: words },
      { labelKey: 'admin.audit.stat_duration', value: `${mod.duration_min} min` },
      { labelKey: 'admin.audit.stat_published', value: mod.is_published ? 'yes' : 'no' },
      { labelKey: 'admin.audit.stat_size', value: fmtBytes(jsonBytes(mod, secs, quizzes ?? [])) },
    ],
    childrenLabelKey: 'admin.audit.children_sections',
    children: secs.map((s, i) => ({
      id: s.id,
      label: `${i + 1}. ${rowText(s, 'heading') || '—'}`,
      meta: sectionMeta(s),
      chips: [
        ...(quizBySection.get(s.id) ? [`${quizBySection.get(s.id)} quiz`] : []),
        ...(arr((s.blocks_data as { blocks?: unknown } | null)?.blocks ?? s.blocks_data).length
          ? [`${arr((s.blocks_data as { blocks?: unknown } | null)?.blocks ?? s.blocks_data).length} bloques`] : []),
      ],
    })),
    impact: [
      { labelKey: 'admin.audit.stat_sections', value: secs.length },
      { labelKey: 'admin.audit.stat_quizzes', value: (quizzes ?? []).length },
      { labelKey: 'admin.audit.impact_time_records', value: timeRows },
      { labelKey: 'admin.audit.impact_world_levels', value: levelsUsing },
    ],
    raw: mod as unknown as Record<string, unknown>,
  }
}

async function courseDetail(id: string, base: ContentDetail): Promise<ContentDetail> {
  const { data: course } = await supabase
    .from('courses')
    .select('id, title_es, slug, campaign_id, is_published, visibility, level, category, is_shareable, created_at, updated_at')
    .eq('id', id).maybeSingle()
  if (!course) return base

  const [{ data: mods }, assignments, certs, publications, { data: worlds }, sims, choiceSims] = await Promise.all([
    supabase.from('modules').select('id, title_es, is_published, duration_min, course_sort_order').eq('course_id', id).order('course_sort_order'),
    count('course_assignments', 'course_id', id),
    count('certifications', 'course_id', id),
    count('course_campaigns', 'course_id', id),
    supabase.from('worlds').select('id, name').eq('course_id', id),
    count('scenarios', 'course_id', id),
    count('choice_scenarios', 'course_id', id),
  ])
  const modules = (mods ?? []) as { id: string; title_es: string; is_published: boolean; duration_min: number }[]

  // Secciones de todos sus módulos: el "peso" real del curso.
  const { data: secs } = modules.length
    ? await supabase.from('module_sections').select('id, module_id').in('module_id', modules.map((m) => m.id))
    : { data: [] as { id: string }[] }

  return {
    ...base,
    exists: true,
    title: rowText(course),
    path: await pathFor(course.campaign_id, null),
    stats: [
      { labelKey: 'admin.audit.stat_modules', value: modules.length },
      { labelKey: 'admin.audit.stat_sections', value: (secs ?? []).length },
      { labelKey: 'admin.audit.stat_enrolled', value: assignments },
      { labelKey: 'admin.audit.stat_certs', value: certs },
      { labelKey: 'admin.audit.stat_worlds', value: (worlds ?? []).length },
      { labelKey: 'admin.audit.stat_sims', value: sims + choiceSims },
      { labelKey: 'admin.audit.stat_duration', value: `${modules.reduce((n, m) => n + num(m.duration_min), 0)} min` },
      { labelKey: 'admin.audit.stat_published', value: course.is_published ? 'yes' : 'no' },
    ],
    childrenLabelKey: 'admin.audit.children_modules',
    children: modules.map((m, i) => ({
      id: m.id,
      label: `${i + 1}. ${rowText(m)}`,
      meta: m.is_published ? 'publicado' : 'borrador',
      chips: [`${m.duration_min} min`],
    })),
    impact: [
      { labelKey: 'admin.audit.stat_modules', value: modules.length },
      { labelKey: 'admin.audit.stat_enrolled', value: assignments },
      { labelKey: 'admin.audit.stat_certs', value: certs },
      { labelKey: 'admin.audit.impact_publications', value: publications },
    ],
    raw: course as unknown as Record<string, unknown>,
  }
}

async function campaignDetail(id: string, base: ContentDetail): Promise<ContentDetail> {
  const { data: camp } = await supabase
    .from('campaigns').select('id, name, slug, description, is_active, created_at').eq('id', id).maybeSingle()
  if (!camp) return base

  const [{ data: courses }, mods, worldsN, people, collabs] = await Promise.all([
    supabase.from('courses').select('id, title_es, is_published').eq('campaign_id', id).order('sort_order'),
    count('modules', 'campaign_id', id),
    count('worlds', 'campaign_id', id),
    count('profiles', 'campaign_id', id),
    count('campaign_collaborators', 'campaign_id', id),
  ])
  const list = (courses ?? []) as { id: string; title_es: string; is_published: boolean }[]

  return {
    ...base,
    exists: true,
    title: camp.name,
    stats: [
      { labelKey: 'admin.audit.stat_courses', value: list.length },
      { labelKey: 'admin.audit.stat_modules', value: mods },
      { labelKey: 'admin.audit.stat_worlds', value: worldsN },
      { labelKey: 'admin.audit.stat_people', value: people },
      { labelKey: 'admin.audit.stat_collaborators', value: collabs },
      { labelKey: 'admin.audit.stat_active', value: camp.is_active ? 'yes' : 'no' },
    ],
    childrenLabelKey: 'admin.audit.children_courses',
    children: list.map((c) => ({ id: c.id, label: rowText(c), meta: c.is_published ? 'publicado' : 'borrador' })),
    impact: [
      { labelKey: 'admin.audit.stat_courses', value: list.length },
      { labelKey: 'admin.audit.stat_modules', value: mods },
      { labelKey: 'admin.audit.stat_worlds', value: worldsN },
      { labelKey: 'admin.audit.stat_people', value: people },
    ],
    raw: camp as unknown as Record<string, unknown>,
  }
}

async function worldDetail(id: string, base: ContentDetail): Promise<ContentDetail> {
  const { data: world } = await supabase
    .from('worlds').select('id, name, description, campaign_id, course_id, status, created_at, updated_at')
    .eq('id', id).maybeSingle()
  if (!world) return base

  const [{ data: regions }, { data: levels }, quizN] = await Promise.all([
    supabase.from('world_regions').select('id, name, order_index').eq('world_id', id).order('order_index'),
    supabase.from('world_levels').select('id, name, region_id, quiz_id').eq('world_id', id),
    count('arena_quizzes', 'world_id', id),
  ])
  const regs = (regions ?? []) as { id: string; name: string }[]
  const lvls = (levels ?? []) as { id: string; region_id: string; quiz_id: string | null }[]
  const byRegion = new Map<string, number>()
  for (const l of lvls) byRegion.set(l.region_id, (byRegion.get(l.region_id) ?? 0) + 1)

  return {
    ...base,
    exists: true,
    title: world.name,
    path: await pathFor(world.campaign_id, world.course_id),
    stats: [
      { labelKey: 'admin.audit.stat_regions', value: regs.length },
      { labelKey: 'admin.audit.stat_levels', value: lvls.length },
      { labelKey: 'admin.audit.stat_arena', value: quizN },
      { labelKey: 'admin.audit.stat_status', value: String(world.status ?? '—') },
    ],
    childrenLabelKey: 'admin.audit.children_regions',
    children: regs.map((r, i) => ({
      id: r.id, label: `${i + 1}. ${r.name}`,
      chips: [`${byRegion.get(r.id) ?? 0} niveles`],
    })),
    impact: [
      { labelKey: 'admin.audit.stat_regions', value: regs.length },
      { labelKey: 'admin.audit.stat_levels', value: lvls.length },
      { labelKey: 'admin.audit.stat_arena', value: quizN },
    ],
    raw: world as unknown as Record<string, unknown>,
  }
}

async function arenaDetail(id: string, base: ContentDetail): Promise<ContentDetail> {
  const { data: quiz } = await supabase
    .from('arena_quizzes').select('id, title, description, campaign_id, world_id, status, steps, section_size, min_score_pct')
    .eq('id', id).maybeSingle()
  if (!quiz) return base
  const steps = arr(quiz.steps) as { question?: string; question_es?: string; options?: unknown[] }[]
  const path = await pathFor(quiz.campaign_id, null)
  if (quiz.world_id) {
    const { data: w } = await supabase.from('worlds').select('name').eq('id', quiz.world_id).maybeSingle()
    if (w?.name) path.push({ kind: 'world', label: w.name, href: `/admin/worlds/${quiz.world_id}` })
  }
  return {
    ...base,
    exists: true,
    title: quiz.title,
    href: entityHref('arena_quizzes', id, { worldId: quiz.world_id }),
    path,
    stats: [
      { labelKey: 'admin.audit.stat_questions', value: steps.length },
      { labelKey: 'admin.audit.stat_section_size', value: num(quiz.section_size) || '—' },
      { labelKey: 'admin.audit.stat_min_score', value: quiz.min_score_pct != null ? `${quiz.min_score_pct}%` : '—' },
      { labelKey: 'admin.audit.stat_status', value: String(quiz.status ?? '—') },
    ],
    childrenLabelKey: 'admin.audit.children_questions',
    children: steps.slice(0, 60).map((s, i) => ({
      id: String(i),
      label: `${i + 1}. ${rowText(s, 'question') || s.question || '—'}`,
      chips: Array.isArray(s.options) ? [`${s.options.length} opciones`] : [],
    })),
    impact: [{ labelKey: 'admin.audit.stat_questions', value: steps.length }],
    raw: { ...quiz, steps: undefined } as unknown as Record<string, unknown>,
  }
}

async function scenarioDetail(
  id: string, base: ContentDetail, table: 'scenarios' | 'choice_scenarios',
): Promise<ContentDetail> {
  const columns = table === 'scenarios'
    ? 'id, title_es, slug, campaign_id, course_id, is_published, difficulty, pass_score, max_turns, nodes, counts_for_cert'
    : 'id, title_es, slug, campaign_id, course_id, is_published, level, pass_score, nodes'
  // El select se arma en runtime, así que el tipado genérico de supabase-js no
  // puede inferirlo: normalizamos a Record y validamos abajo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from(table) as any).select(columns).eq('id', id).maybeSingle() as
    { data: Record<string, unknown> | null }
  if (!data) return base
  const row = data as unknown as {
    title_es: string; campaign_id: string; course_id: string | null
    is_published: boolean; pass_score: number; nodes: unknown; difficulty?: number; level?: string
  }
  const nodes = row.nodes && typeof row.nodes === 'object' && !Array.isArray(row.nodes)
    ? Object.entries(row.nodes as Record<string, unknown>)
    : arr(row.nodes).map((n, i) => [String(i), n] as [string, unknown])

  return {
    ...base,
    exists: true,
    title: rowText(row),
    href: entityHref(table, id),
    path: await pathFor(row.campaign_id, row.course_id),
    stats: [
      { labelKey: 'admin.audit.stat_nodes', value: nodes.length },
      { labelKey: 'admin.audit.stat_pass_score', value: `${row.pass_score ?? 0}%` },
      { labelKey: 'admin.audit.stat_level', value: String(row.level ?? row.difficulty ?? '—') },
      { labelKey: 'admin.audit.stat_published', value: row.is_published ? 'yes' : 'no' },
    ],
    childrenLabelKey: 'admin.audit.children_nodes',
    children: nodes.slice(0, 60).map(([key, n]) => {
      const node = (n ?? {}) as { title?: string; prompt?: string; text?: string; message?: string; options?: unknown[] }
      return {
        id: key,
        label: node.title || node.prompt || node.text || node.message || key,
        meta: key,
        chips: Array.isArray(node.options) ? [`${node.options.length} opciones`] : [],
      }
    }),
    impact: [{ labelKey: 'admin.audit.stat_nodes', value: nodes.length }],
    raw: { ...(data as Record<string, unknown>), nodes: undefined },
  }
}

async function liveQuizDetail(id: string, base: ContentDetail): Promise<ContentDetail> {
  const { data: quiz } = await supabase
    .from('live_quizzes').select('id, title, campaign_id, status, pin, questions, created_at, pin_expires_at')
    .eq('id', id).maybeSingle()
  if (!quiz) return base
  const questions = arr(quiz.questions) as { question?: string; text?: string; options?: unknown[] }[]
  const answers = await count('live_quiz_answers', 'quiz_id', id)
  return {
    ...base,
    exists: true,
    title: quiz.title,
    path: await pathFor(quiz.campaign_id, null),
    stats: [
      { labelKey: 'admin.audit.stat_questions', value: questions.length },
      { labelKey: 'admin.audit.stat_answers', value: answers },
      { labelKey: 'admin.audit.stat_status', value: String(quiz.status) },
    ],
    childrenLabelKey: 'admin.audit.children_questions',
    children: questions.slice(0, 60).map((q, i) => ({
      id: String(i),
      label: `${i + 1}. ${q.question ?? q.text ?? '—'}`,
      chips: Array.isArray(q.options) ? [`${q.options.length} opciones`] : [],
    })),
    impact: [{ labelKey: 'admin.audit.stat_answers', value: answers }],
    raw: { ...quiz, questions: undefined } as unknown as Record<string, unknown>,
  }
}

async function missionDetail(id: string, base: ContentDetail): Promise<ContentDetail> {
  const { data: m } = await supabase
    .from('guided_missions').select('id, title, description, campaign_id, category, status, steps').eq('id', id).maybeSingle()
  if (!m) return base
  const steps = arr(m.steps) as { title?: string; label?: string }[]
  return {
    ...base,
    exists: true,
    title: m.title,
    path: await pathFor(m.campaign_id, null),
    stats: [
      { labelKey: 'admin.audit.stat_steps', value: steps.length },
      { labelKey: 'admin.audit.stat_status', value: String(m.status ?? '—') },
    ],
    childrenLabelKey: 'admin.audit.children_steps',
    children: steps.slice(0, 60).map((s, i) => ({ id: String(i), label: `${i + 1}. ${s.title ?? s.label ?? '—'}` })),
    impact: [{ labelKey: 'admin.audit.stat_steps', value: steps.length }],
    raw: { ...m, steps: undefined } as unknown as Record<string, unknown>,
  }
}

async function profileDetail(id: string, base: ContentDetail): Promise<ContentDetail> {
  const { data: p } = await supabase
    .from('profiles').select('id, display_name, role, campaign_id, created_at').eq('id', id).maybeSingle()
  if (!p) return base
  const [enrolled, certs] = await Promise.all([
    count('course_assignments', 'user_id', id),
    count('certifications', 'user_id', id),
  ])
  return {
    ...base,
    exists: true,
    title: p.display_name ?? null,
    path: await pathFor(p.campaign_id, null),
    stats: [
      { labelKey: 'admin.audit.stat_role', value: String(p.role) },
      { labelKey: 'admin.audit.stat_enrolled_courses', value: enrolled },
      { labelKey: 'admin.audit.stat_certs', value: certs },
    ],
    children: [],
    impact: [
      { labelKey: 'admin.audit.stat_enrolled_courses', value: enrolled },
      { labelKey: 'admin.audit.stat_certs', value: certs },
    ],
    raw: p as unknown as Record<string, unknown>,
  }
}
