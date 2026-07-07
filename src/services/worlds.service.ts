import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'
import { getModuleContextText } from '@/services/ai.service'

// ─── Tipos ───────────────────────────────────────────────────────

export interface WorldRow {
  id: string
  campaign_id: string
  course_id: string | null
  name: string
  description: string | null
  color: string
  icon: string
  bg_type: string
  status: string
}

/** Un módulo que aún no tiene su quiz de arena generado (para el auto-sync en 2º plano). */
export interface PendingQuiz {
  moduleId: string
  levelId: string
  moduleTitle: string
}

export interface SyncResult {
  world: WorldRow
  /** Módulos con nivel recién creado (o sin quiz) que hay que generar con IA. */
  pending: PendingQuiz[]
}

// Estructura que devuelve la Edge Function generate-world.
interface GenQuizOption { text: string; correct: boolean; explanation?: string }
interface GenQuizStep { question: string; context?: string; options: GenQuizOption[] }
interface GeneratedQuiz { title: string; description?: string; icon?: string; steps: GenQuizStep[] }
interface GeneratedRegion {
  name: string; description?: string; icon?: string
  level?: { name?: string; description?: string; icon?: string }
  quiz?: GeneratedQuiz
}
interface GeneratedWorld {
  name: string; description?: string; icon?: string; bg_type?: string
  regions: GeneratedRegion[]
}

const VALID_BG = ['airline', 'bank', 'health', 'corporate', 'tech']
const normBg = (v?: string) => (v && VALID_BG.includes(v) ? v : 'corporate')

// ─── Edge Function ───────────────────────────────────────────────

async function postGenerateWorld(body: Record<string, unknown>): Promise<unknown> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No autenticado')

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-world`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    },
  )
  const result = await res.json()
  if (!res.ok || result.error) throw new Error(result.error ?? 'Error generando con IA')
  return result.data
}

/** Convierte un quiz generado por IA en el `steps` (JSON) de arena_quizzes, con ids. */
function toArenaSteps(gen: GeneratedQuiz): Json {
  return (gen.steps ?? []).map((s) => ({
    id: crypto.randomUUID(),
    question: s.question ?? '',
    context: s.context ?? '',
    options: (s.options ?? []).map((o) => ({
      id: crypto.randomUUID(),
      text: o.text ?? '',
      correct: !!o.correct,
      explanation: o.explanation ?? '',
    })),
  })) as unknown as Json
}

/** Inserta un arena_quiz publicado a partir de un quiz generado. Devuelve su id. */
async function insertArenaQuiz(
  campaignId: string,
  themeColor: string,
  themeType: string,
  gen: GeneratedQuiz,
): Promise<string> {
  const { data, error } = await supabase
    .from('arena_quizzes')
    .insert({
      campaign_id: campaignId,
      title: gen.title || 'Reto',
      description: gen.description ?? null,
      theme_icon: gen.icon || '📋',
      theme_color: themeColor,
      theme_type: normBg(themeType),
      status: 'published',
      steps: toArenaSteps(gen),
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

// ─── Mundo de un curso ───────────────────────────────────────────

export interface CourseLike {
  id: string
  campaign_id: string
  title_es: string
  description_es: string | null
  color: string
}

/**
 * Devuelve el mundo vinculado al curso; lo crea si no existe. Idempotente
 * (índice único parcial worlds_course_id_uidx garantiza uno solo por curso).
 */
export async function ensureCourseWorld(course: CourseLike): Promise<WorldRow> {
  const { data: existing } = await supabase
    .from('worlds')
    .select('*')
    .eq('course_id', course.id)
    .maybeSingle()
  if (existing) return existing as WorldRow

  const { data, error } = await supabase
    .from('worlds')
    .insert({
      campaign_id: course.campaign_id,
      course_id: course.id,
      name: course.title_es,
      description: course.description_es,
      color: course.color || '#00C228',
      icon: '🌍',
      bg_type: 'corporate',
      status: 'draft',
    })
    .select('*')
    .single()
  // Carrera: otro proceso lo creó en paralelo → lo leemos.
  if (error?.code === '23505') {
    const { data: race } = await supabase
      .from('worlds').select('*').eq('course_id', course.id).single()
    return race as WorldRow
  }
  if (error) throw error
  return data as WorldRow
}

/** Publica o despublica el mundo espejo de un curso (para atarlo a la publicación del curso). */
export async function setCourseWorldPublished(courseId: string, published: boolean): Promise<void> {
  const { error } = await supabase
    .from('worlds')
    .update({ status: published ? 'published' : 'draft' })
    .eq('course_id', courseId)
  if (error) throw error
}

/**
 * Reconcilia el mundo de un curso con sus módulos: una región + un nivel por
 * módulo (espejo de course_sort_order), crea los que faltan, reordena y borra
 * los que ya no están. NO genera quizzes (eso va en 2º plano); devuelve los
 * módulos cuyo nivel quedó sin quiz para que el llamador los complete con IA.
 */
export async function syncCourseWorldById(courseId: string): Promise<SyncResult> {
  const { data: course, error: cErr } = await supabase
    .from('courses')
    .select('id, campaign_id, title_es, description_es, color')
    .eq('id', courseId)
    .single()
  if (cErr) throw cErr

  const world = await ensureCourseWorld(course as CourseLike)

  const { data: modulesData } = await supabase
    .from('modules')
    .select('id, title_es, icon, course_sort_order')
    .eq('course_id', courseId)
    .order('course_sort_order')
  const modules = (modulesData ?? []) as Array<{ id: string; title_es: string; icon: string; course_sort_order: number }>

  const [{ data: regionsData }, { data: levelsData }] = await Promise.all([
    supabase.from('world_regions').select('id, module_id, order_index, name').eq('world_id', world.id),
    supabase.from('world_levels').select('id, module_id, region_id, quiz_id, order_index').eq('world_id', world.id),
  ])
  const regionByModule = new Map(
    ((regionsData ?? []) as Array<{ id: string; module_id: string | null; order_index: number; name: string }>)
      .filter((r) => r.module_id).map((r) => [r.module_id as string, r]),
  )
  const levelByModule = new Map(
    ((levelsData ?? []) as Array<{ id: string; module_id: string | null; region_id: string; quiz_id: string | null; order_index: number }>)
      .filter((l) => l.module_id).map((l) => [l.module_id as string, l]),
  )

  const currentModuleIds = new Set(modules.map((m) => m.id))
  const pending: PendingQuiz[] = []

  // Alta / actualización por módulo (respetando el orden del curso).
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i]
    const orderIndex = i
    let region = regionByModule.get(m.id)

    if (region) {
      if (region.order_index !== orderIndex || region.name !== m.title_es) {
        await supabase.from('world_regions')
          .update({ order_index: orderIndex, name: m.title_es })
          .eq('id', region.id)
      }
    } else {
      const { data: newRegion, error } = await supabase
        .from('world_regions')
        .insert({
          world_id: world.id,
          module_id: m.id,
          name: m.title_es,
          description: null,
          icon: '📍',
          order_index: orderIndex,
        })
        .select('id, module_id, order_index, name')
        .single()
      if (error) throw error
      region = newRegion as { id: string; module_id: string | null; order_index: number; name: string }
    }

    let level = levelByModule.get(m.id)
    if (!level) {
      const { data: newLevel, error } = await supabase
        .from('world_levels')
        .insert({
          world_id: world.id,
          region_id: region.id,
          module_id: m.id,
          name: m.title_es,
          description: null,
          icon: (m.icon && m.icon.length <= 2) ? m.icon : '⭐',
          order_index: orderIndex,
          quiz_id: null,
        })
        .select('id, module_id, region_id, quiz_id, order_index')
        .single()
      if (error) throw error
      level = newLevel as { id: string; module_id: string | null; region_id: string; quiz_id: string | null; order_index: number }
    } else if (level.order_index !== orderIndex) {
      await supabase.from('world_levels').update({ order_index: orderIndex }).eq('id', level.id)
    }

    if (!level.quiz_id) {
      pending.push({ moduleId: m.id, levelId: level.id, moduleTitle: m.title_es })
    }
  }

  // Baja: módulos que ya no están en el curso → borrar su nivel y región.
  const staleModuleIds = [...regionByModule.keys()].filter((mid) => !currentModuleIds.has(mid))
  if (staleModuleIds.length) {
    const staleRegionIds = staleModuleIds.map((mid) => regionByModule.get(mid)!.id)
    await supabase.from('world_levels').delete().in('module_id', staleModuleIds)
    await supabase.from('world_regions').delete().in('id', staleRegionIds)
  }

  return { world, pending }
}

/**
 * Genera con IA el quiz de arena de un módulo y lo engancha a su nivel.
 * Pensado para correr en 2º plano tras la sincronización.
 */
export async function generateAndAttachModuleQuiz(
  world: WorldRow,
  moduleId: string,
  levelId: string,
): Promise<void> {
  const { data: mod } = await supabase
    .from('modules')
    .select('title_es, subtitle_es')
    .eq('id', moduleId)
    .single()
  const moduleText = await getModuleContextText(moduleId).catch(() => '')

  const gen = (await postGenerateWorld({
    mode: 'quiz',
    moduleTitle: (mod as { title_es?: string })?.title_es ?? '',
    moduleSubtitle: (mod as { subtitle_es?: string | null })?.subtitle_es ?? '',
    moduleText,
  })) as GeneratedQuiz

  const quizId = await insertArenaQuiz(world.campaign_id, world.color, world.bg_type, gen)
  const { error } = await supabase.from('world_levels').update({ quiz_id: quizId }).eq('id', levelId)
  if (error) throw error
}

// ─── Mundos standalone (con IA, sin curso) ───────────────────────

/** Genera un mundo completo desde un tema libre (regiones + niveles + quizzes). */
export async function generateStandaloneWorldFromTopic(opts: {
  campaignId: string
  topic: string
  regionCount?: number
  bgType?: string
}): Promise<string> {
  const gen = (await postGenerateWorld({
    mode: 'world',
    topic: opts.topic,
    regionCount: opts.regionCount,
    bgType: opts.bgType,
  })) as GeneratedWorld

  const bg = normBg(gen.bg_type ?? opts.bgType)
  const { data: world, error } = await supabase
    .from('worlds')
    .insert({
      campaign_id: opts.campaignId,
      course_id: null,
      name: gen.name || opts.topic.slice(0, 60),
      description: gen.description ?? null,
      icon: gen.icon || '🌍',
      color: '#00C228',
      bg_type: bg,
      status: 'draft',
    })
    .select('*')
    .single()
  if (error) throw error
  const w = world as WorldRow

  for (let i = 0; i < (gen.regions ?? []).length; i++) {
    const r = gen.regions[i]
    const { data: region, error: rErr } = await supabase
      .from('world_regions')
      .insert({ world_id: w.id, name: r.name, description: r.description ?? null, icon: r.icon || '📍', order_index: i })
      .select('id')
      .single()
    if (rErr) throw rErr

    let quizId: string | null = null
    if (r.quiz && (r.quiz.steps?.length ?? 0) > 0) {
      quizId = await insertArenaQuiz(w.campaign_id, w.color, bg, r.quiz)
    }
    await supabase.from('world_levels').insert({
      world_id: w.id,
      region_id: (region as { id: string }).id,
      name: r.level?.name || r.name,
      description: r.level?.description ?? null,
      icon: r.level?.icon || '⭐',
      order_index: i,
      quiz_id: quizId,
    })
  }
  return w.id
}

/** Genera un mundo a partir de módulos existentes: una región+nivel+quiz por módulo. */
export async function generateStandaloneWorldFromModules(opts: {
  campaignId: string
  name: string
  moduleIds: string[]
}): Promise<string> {
  const { data: world, error } = await supabase
    .from('worlds')
    .insert({
      campaign_id: opts.campaignId,
      course_id: null,
      name: opts.name,
      icon: '🌍',
      color: '#00C228',
      bg_type: 'corporate',
      status: 'draft',
    })
    .select('*')
    .single()
  if (error) throw error
  const w = world as WorldRow

  for (let i = 0; i < opts.moduleIds.length; i++) {
    const moduleId = opts.moduleIds[i]
    const { data: mod } = await supabase
      .from('modules').select('title_es, subtitle_es, icon').eq('id', moduleId).single()
    const title = (mod as { title_es?: string })?.title_es ?? 'Módulo'
    const icon = (mod as { icon?: string })?.icon
    const moduleText = await getModuleContextText(moduleId).catch(() => '')

    const { data: region, error: rErr } = await supabase
      .from('world_regions')
      .insert({ world_id: w.id, module_id: moduleId, name: title, icon: '📍', order_index: i })
      .select('id')
      .single()
    if (rErr) throw rErr

    let quizId: string | null = null
    try {
      const gen = (await postGenerateWorld({
        mode: 'quiz', moduleTitle: title, moduleSubtitle: (mod as { subtitle_es?: string | null })?.subtitle_es ?? '', moduleText,
      })) as GeneratedQuiz
      quizId = await insertArenaQuiz(w.campaign_id, w.color, w.bg_type, gen)
    } catch {
      // Si falla el quiz de un módulo, seguimos; el nivel queda sin quiz.
    }

    await supabase.from('world_levels').insert({
      world_id: w.id,
      region_id: (region as { id: string }).id,
      module_id: moduleId,
      name: title,
      icon: (icon && icon.length <= 2) ? icon : '⭐',
      order_index: i,
      quiz_id: quizId,
    })
  }
  return w.id
}
