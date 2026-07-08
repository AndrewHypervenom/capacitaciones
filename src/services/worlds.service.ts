import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'
import { getModuleContextText } from '@/services/ai.service'
import { bgTask } from '@/stores/bgTaskStore'
import i18n from '@/i18n'

/**
 * Puntaje mínimo (%) por defecto para niveles/quizzes generados con IA. Sin un
 * umbral (null) el nivel deja pasar aunque el aprendiz responda todo mal.
 */
const DEFAULT_LEVEL_MIN_SCORE_PCT = 80

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

/** Una región recién creada cuyos niveles (2-3, quiz corto c/u) hay que generar con IA en 2º plano. */
export interface PendingRegion {
  regionId: string
  moduleId: string
  moduleTitle: string
}

export interface SyncResult {
  /** El mundo del curso, o null si no existía y no se pidió crearlo. */
  world: WorldRow | null
  /** Regiones nuevas (módulos recién sumados) que hay que poblar con IA. */
  pendingRegions: PendingRegion[]
}

// Estructuras que devuelve la Edge Function generate-world.
interface GenQuizOption { text: string; correct: boolean; explanation?: string }
interface GenQuizStep { question: string; context?: string; options: GenQuizOption[] }
interface GeneratedQuiz { title: string; description?: string; icon?: string; steps: GenQuizStep[] }
interface GeneratedLevel {
  name?: string; description?: string; icon?: string
  quiz?: GeneratedQuiz
}
interface GeneratedRegionLevels { levels?: GeneratedLevel[] }
interface GeneratedWorldOutlineRegion {
  name?: string; description?: string; icon?: string; subtopic?: string
}
interface GeneratedWorldOutline {
  name?: string; description?: string; icon?: string; bg_type?: string
  regions?: GeneratedWorldOutlineRegion[]
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
  world: WorldRow,
  gen: GeneratedQuiz,
): Promise<string> {
  const { data, error } = await supabase
    .from('arena_quizzes')
    .insert({
      campaign_id: world.campaign_id,
      world_id: world.id,
      title: gen.title || 'Reto',
      description: gen.description ?? null,
      theme_icon: gen.icon || '📋',
      theme_color: world.color,
      theme_type: normBg(world.bg_type),
      status: 'published',
      steps: toArenaSteps(gen),
      min_score_pct: DEFAULT_LEVEL_MIN_SCORE_PCT,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

// ─── Generación de los niveles de una región ─────────────────────

interface RegionSource {
  /** Título del subtema/módulo. */
  title: string
  subtitle?: string
  /** Contenido de referencia (texto del módulo o descripción del subtema). */
  moduleText: string
  levelCount?: number
}

/**
 * Opciones de generación flexible elegidas por el capacitador en Mundos.
 *  · levelCount        → niveles por región
 *  · questionsPerLevel → preguntas por nivel (undefined = la IA decide 2-3)
 */
export interface WorldGenOptions {
  levelCount?: number
  questionsPerLevel?: number
}

const clampInt = (v: number | undefined, min: number, max: number, fallback: number): number => {
  const n = Math.round(v ?? fallback)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

interface GeneratedLevelOutline { name?: string; description?: string; icon?: string; focus?: string }

/**
 * Generación flexible de una región: primero el esqueleto de N niveles
 * (level-outline, sin preguntas) y luego el quiz de cada nivel por separado
 * (quiz, con nº de preguntas pedido). Se hace nivel por nivel para no exceder el
 * límite de tokens en configuraciones grandes (p. ej. 10 niveles × 6 preguntas).
 */
export async function generateRegionLevelsFlexible(
  world: WorldRow,
  regionId: string,
  source: RegionSource,
  opts: WorldGenOptions = {},
): Promise<void> {
  const levelCount = clampInt(opts.levelCount, 1, 10, 3)
  const questionsPerLevel = opts.questionsPerLevel
    ? clampInt(opts.questionsPerLevel, 1, 10, 3)
    : undefined

  // 1. Esqueleto de niveles (barato, una sola llamada).
  const outline = (await postGenerateWorld({
    mode: 'level-outline',
    moduleTitle: source.title,
    moduleSubtitle: source.subtitle ?? '',
    moduleText: source.moduleText,
    levelCount,
  })) as { levels?: GeneratedLevelOutline[] }

  const skeletons = (outline.levels ?? []).slice(0, levelCount)

  // order_index global al mundo (ver nota en generateRegionLevels).
  const { data: regionRow } = await supabase
    .from('world_regions')
    .select('order_index')
    .eq('id', regionId)
    .single()
  const base = ((regionRow as { order_index?: number } | null)?.order_index ?? 0) * 100

  for (let i = 0; i < skeletons.length; i++) {
    const lv = skeletons[i]
    // 2. Quiz del nivel (una llamada por nivel, con el enfoque para no repetir).
    let quizId: string | null = null
    try {
      const quiz = (await postGenerateWorld({
        mode: 'quiz',
        moduleTitle: lv.name || source.title,
        moduleSubtitle: source.subtitle ?? '',
        moduleText: source.moduleText,
        focus: lv.focus ?? lv.description ?? '',
        questionCount: questionsPerLevel,
      })) as GeneratedQuiz
      if ((quiz.steps?.length ?? 0) > 0) quizId = await insertArenaQuiz(world, quiz)
    } catch (e) {
      console.error('Fallo generando el quiz de un nivel; queda sin quiz:', e)
    }
    await supabase.from('world_levels').insert({
      world_id: world.id,
      region_id: regionId,
      module_id: null,
      name: lv.name || `${source.title} · ${i + 1}`,
      description: lv.description ?? null,
      icon: (lv.icon && lv.icon.length <= 2) ? lv.icon : '⭐',
      order_index: base + i,
      quiz_id: quizId,
      min_score_pct: DEFAULT_LEVEL_MIN_SCORE_PCT,
    })
  }
}

/**
 * Genera con IA 3-5 niveles (cada uno con su quiz de arena) para una región y
 * los inserta. Los sub-niveles llevan `module_id = null`: el vínculo 1:1 con el
 * módulo lo conserva la región, no cada nivel.
 */
export async function generateRegionLevels(
  world: WorldRow,
  regionId: string,
  source: RegionSource,
): Promise<void> {
  const gen = (await postGenerateWorld({
    mode: 'region',
    moduleTitle: source.title,
    moduleSubtitle: source.subtitle ?? '',
    moduleText: source.moduleText,
    levelCount: source.levelCount,
  })) as GeneratedRegionLevels

  // El `order_index` de los niveles debe ser GLOBAL al mundo (no local a la
  // región), si no la lista ordenada por order_index intercala niveles de
  // distintas regiones y el mapa muestra la región 2 en el nivel 2, etc.
  // Base = order_index de la región × 100 (cada región tiene pocos niveles),
  // así los niveles quedan agrupados y ordenados por región. Determinista y
  // sin carreras cuando varias regiones se generan en paralelo.
  const { data: regionRow } = await supabase
    .from('world_regions')
    .select('order_index')
    .eq('id', regionId)
    .single()
  const base = ((regionRow as { order_index?: number } | null)?.order_index ?? 0) * 100

  const levels = gen.levels ?? []
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i]
    let quizId: string | null = null
    if (lv.quiz && (lv.quiz.steps?.length ?? 0) > 0) {
      quizId = await insertArenaQuiz(world, lv.quiz)
    }
    await supabase.from('world_levels').insert({
      world_id: world.id,
      region_id: regionId,
      module_id: null,
      name: lv.name || `${source.title} · ${i + 1}`,
      description: lv.description ?? null,
      icon: (lv.icon && lv.icon.length <= 2) ? lv.icon : '⭐',
      order_index: base + i,
      quiz_id: quizId,
      // Puntaje mínimo por defecto: sin esto el nivel deja pasar respondiendo
      // todo mal (null = sin umbral). El capacitador puede ajustarlo luego.
      min_score_pct: DEFAULT_LEVEL_MIN_SCORE_PCT,
    })
  }
}

/** Genera los niveles de una región espejo de un módulo, tomando su contenido. */
export async function generateModuleRegionLevels(
  world: WorldRow,
  regionId: string,
  moduleId: string,
  opts: WorldGenOptions = {},
): Promise<void> {
  const { data: mod } = await supabase
    .from('modules')
    .select('title_es, subtitle_es')
    .eq('id', moduleId)
    .single()
  const moduleText = await getModuleContextText(moduleId).catch(() => '')
  await generateRegionLevelsFlexible(world, regionId, {
    title: (mod as { title_es?: string })?.title_es ?? 'Módulo',
    subtitle: (mod as { subtitle_es?: string | null })?.subtitle_es ?? '',
    moduleText,
  }, opts)
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
  const existing = await getCourseWorld(course.id)
  if (existing) return existing

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

/** Lee el mundo espejo de un curso sin crearlo. Null si todavía no existe. */
export async function getCourseWorld(courseId: string): Promise<WorldRow | null> {
  const { data } = await supabase
    .from('worlds')
    .select('*')
    .eq('course_id', courseId)
    .maybeSingle()
  return (data as WorldRow | null) ?? null
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
 * Reconcilia el mundo de un curso con sus módulos: una región por módulo (espejo
 * de course_sort_order). Crea las regiones que faltan, reordena y borra (con sus
 * niveles) las de módulos que ya no están. NO genera los niveles/quizzes (eso va
 * en 2º plano); devuelve las regiones nuevas para que el llamador las complete.
 *
 * `createIfMissing` (default true): si es false y el curso aún no tiene mundo,
 * no crea nada y devuelve `{ world: null, pendingRegions: [] }`. Se usa al
 * agregar módulos, para no forzar un mundo en cursos que optaron por no tenerlo.
 */
export async function syncCourseWorldById(
  courseId: string,
  opts: { createIfMissing?: boolean } = {},
): Promise<SyncResult> {
  const createIfMissing = opts.createIfMissing ?? true

  const { data: course, error: cErr } = await supabase
    .from('courses')
    .select('id, campaign_id, title_es, description_es, color')
    .eq('id', courseId)
    .single()
  if (cErr) throw cErr

  let world = await getCourseWorld(courseId)
  if (!world) {
    if (!createIfMissing) return { world: null, pendingRegions: [] }
    world = await ensureCourseWorld(course as CourseLike)
  }

  const { data: modulesData } = await supabase
    .from('modules')
    .select('id, title_es, icon, course_sort_order')
    .eq('course_id', courseId)
    .order('course_sort_order')
  const modules = (modulesData ?? []) as Array<{ id: string; title_es: string; icon: string; course_sort_order: number }>

  const { data: regionsData } = await supabase
    .from('world_regions')
    .select('id, module_id, order_index, name')
    .eq('world_id', world.id)
  const regionByModule = new Map(
    ((regionsData ?? []) as Array<{ id: string; module_id: string | null; order_index: number; name: string }>)
      .filter((r) => r.module_id).map((r) => [r.module_id as string, r]),
  )

  // Regiones que ya tienen al menos un nivel. Las regiones vacías (creadas por
  // un sync que no llegó a generar niveles) se tratan como pendientes.
  const { data: levelsData } = await supabase
    .from('world_levels')
    .select('region_id')
    .eq('world_id', world.id)
  const regionsWithLevels = new Set(
    ((levelsData ?? []) as Array<{ region_id: string | null }>).map((l) => l.region_id).filter(Boolean),
  )

  const currentModuleIds = new Set(modules.map((m) => m.id))
  const pendingRegions: PendingRegion[] = []

  // Alta / actualización por módulo (respetando el orden del curso).
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i]
    const orderIndex = i
    const region = regionByModule.get(m.id)

    if (region) {
      if (region.order_index !== orderIndex || region.name !== m.title_es) {
        await supabase.from('world_regions')
          .update({ order_index: orderIndex, name: m.title_es })
          .eq('id', region.id)
      }
      // Región existente con niveles → se conserva tal cual; no se regenera.
      // Si quedó vacía (un sync anterior no generó sus niveles), va a pendientes.
      if (!regionsWithLevels.has(region.id)) {
        pendingRegions.push({ regionId: region.id, moduleId: m.id, moduleTitle: m.title_es })
      }
    } else {
      const { data: newRegion, error } = await supabase
        .from('world_regions')
        .insert({
          world_id: world.id,
          module_id: m.id,
          name: m.title_es,
          description: null,
          icon: (m.icon && m.icon.length <= 2) ? m.icon : '📍',
          order_index: orderIndex,
        })
        .select('id')
        .single()
      if (error) throw error
      pendingRegions.push({
        regionId: (newRegion as { id: string }).id,
        moduleId: m.id,
        moduleTitle: m.title_es,
      })
    }
  }

  // Baja: módulos que ya no están → borrar su región y todos sus niveles.
  const staleModuleIds = [...regionByModule.keys()].filter((mid) => !currentModuleIds.has(mid))
  if (staleModuleIds.length) {
    const staleRegionIds = staleModuleIds.map((mid) => regionByModule.get(mid)!.id)
    await supabase.from('world_levels').delete().in('region_id', staleRegionIds)
    await supabase.from('world_regions').delete().in('id', staleRegionIds)
  }

  return { world, pendingRegions }
}

/**
 * Genera con IA los niveles/quizzes de las regiones pendientes, reportando el
 * paso actual en el indicador global de procesos (bgTask): qué región va,
 * si terminó bien o qué falló. Único camino de generación por regiones.
 */
export async function generatePendingRegionLevels(
  world: WorldRow,
  pendingRegions: PendingRegion[],
): Promise<{ generated: number; failed: number }> {
  if (pendingRegions.length === 0) return { generated: 0, failed: 0 }
  const n = pendingRegions.length
  const taskId = bgTask.start(
    i18n.t('worldgen.course_title', { name: world.name }),
    i18n.t('worldgen.starting', { n }),
  )
  let generated = 0
  let failed = 0
  for (let i = 0; i < n; i++) {
    const r = pendingRegions[i]
    bgTask.update(taskId, {
      detail: i18n.t('worldgen.region_progress', { i: i + 1, n, title: r.moduleTitle }),
    })
    try {
      await generateModuleRegionLevels(world, r.regionId, r.moduleId)
      generated++
    } catch (e) {
      console.error('Fallo generando niveles de la región del módulo', r.moduleId, e)
      failed++
    }
  }
  if (failed === 0) bgTask.succeed(taskId, i18n.t('worldgen.done', { n: generated }))
  else if (generated === 0) bgTask.fail(taskId, i18n.t('worldgen.error'))
  else bgTask.fail(taskId, i18n.t('worldgen.partial', { ok: generated, fail: failed }))
  return { generated, failed }
}

/**
 * Sincroniza el mundo del curso (si existe) y genera con IA los niveles/quizzes
 * de las regiones nuevas o vacías. El progreso se ve en el indicador global.
 */
export async function syncCourseWorldAndGenerate(
  courseId: string,
): Promise<{ world: WorldRow | null; generated: number; failed: number }> {
  const { world, pendingRegions } = await syncCourseWorldById(courseId, { createIfMissing: false })
  if (!world || pendingRegions.length === 0) return { world, generated: 0, failed: 0 }
  const { generated, failed } = await generatePendingRegionLevels(world, pendingRegions)
  return { world, generated, failed }
}

// ─── Mundos standalone (con IA, sin curso) ───────────────────────

/** Crea la fila del mundo standalone (sin curso). */
async function insertStandaloneWorld(opts: {
  campaignId: string
  name: string
  description?: string | null
  icon?: string
  bgType?: string
}): Promise<WorldRow> {
  const { data, error } = await supabase
    .from('worlds')
    .insert({
      campaign_id: opts.campaignId,
      course_id: null,
      name: opts.name,
      description: opts.description ?? null,
      icon: opts.icon || '🌍',
      color: '#00C228',
      bg_type: normBg(opts.bgType),
      status: 'draft',
    })
    .select('*')
    .single()
  if (error) throw error
  return data as WorldRow
}

/**
 * Genera un mundo completo desde un tema libre: primero el esqueleto (mundo +
 * regiones), luego 3-5 niveles con quiz por cada región. Devuelve el id del mundo.
 */
export async function generateStandaloneWorldFromTopic(opts: {
  campaignId: string
  topic: string
  regionCount?: number
  bgType?: string
  levelCount?: number
  questionsPerLevel?: number
}): Promise<string> {
  const taskId = bgTask.start(
    i18n.t('worldgen.world_title', { name: opts.topic.slice(0, 40) }),
    i18n.t('worldgen.outline'),
  )
  try {
    const outline = (await postGenerateWorld({
      mode: 'world',
      topic: opts.topic,
      regionCount: opts.regionCount,
      bgType: opts.bgType,
    })) as GeneratedWorldOutline

    const world = await insertStandaloneWorld({
      campaignId: opts.campaignId,
      name: outline.name || opts.topic.slice(0, 60),
      description: outline.description ?? null,
      icon: outline.icon,
      bgType: outline.bg_type ?? opts.bgType,
    })

    const regions = outline.regions ?? []
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i]
      bgTask.update(taskId, {
        detail: i18n.t('worldgen.region_progress', {
          i: i + 1,
          n: regions.length,
          title: r.name || `Región ${i + 1}`,
        }),
      })
      const { data: region, error } = await supabase
        .from('world_regions')
        .insert({
          world_id: world.id,
          name: r.name || `Región ${i + 1}`,
          description: r.description ?? null,
          icon: (r.icon && r.icon.length <= 2) ? r.icon : '📍',
          order_index: i,
        })
        .select('id')
        .single()
      if (error) throw error
      try {
        await generateRegionLevelsFlexible(world, (region as { id: string }).id, {
          title: r.name || `Región ${i + 1}`,
          moduleText: r.subtopic || r.description || r.name || opts.topic,
        }, { levelCount: opts.levelCount, questionsPerLevel: opts.questionsPerLevel })
      } catch (e) {
        // Si falla una región, seguimos; queda sin niveles y se puede reintentar/editar.
        console.error('Fallo generando niveles de región standalone:', e)
      }
    }
    bgTask.succeed(taskId, i18n.t('worldgen.world_done', { n: regions.length }))
    return world.id
  } catch (e) {
    bgTask.fail(taskId, i18n.t('worldgen.world_error'))
    throw e
  }
}

/** Genera un mundo a partir de módulos existentes: una región (3-5 niveles) por módulo. */
export async function generateStandaloneWorldFromModules(opts: {
  campaignId: string
  name: string
  moduleIds: string[]
  levelCount?: number
  questionsPerLevel?: number
}): Promise<string> {
  const taskId = bgTask.start(
    i18n.t('worldgen.world_title', { name: opts.name }),
    i18n.t('worldgen.starting', { n: opts.moduleIds.length }),
  )
  try {
    const world = await insertStandaloneWorld({
      campaignId: opts.campaignId,
      name: opts.name,
      bgType: 'corporate',
    })

    for (let i = 0; i < opts.moduleIds.length; i++) {
      const moduleId = opts.moduleIds[i]
      const { data: mod } = await supabase
        .from('modules').select('title_es, icon').eq('id', moduleId).single()
      const title = (mod as { title_es?: string })?.title_es ?? 'Módulo'
      const icon = (mod as { icon?: string })?.icon
      bgTask.update(taskId, {
        detail: i18n.t('worldgen.region_progress', { i: i + 1, n: opts.moduleIds.length, title }),
      })

      const { data: region, error } = await supabase
        .from('world_regions')
        .insert({
          world_id: world.id,
          module_id: moduleId,
          name: title,
          icon: (icon && icon.length <= 2) ? icon : '📍',
          order_index: i,
        })
        .select('id')
        .single()
      if (error) throw error
      try {
        await generateModuleRegionLevels(world, (region as { id: string }).id, moduleId, {
          levelCount: opts.levelCount, questionsPerLevel: opts.questionsPerLevel,
        })
      } catch (e) {
        console.error('Fallo generando niveles de región (módulo):', moduleId, e)
      }
    }
    bgTask.succeed(taskId, i18n.t('worldgen.world_done', { n: opts.moduleIds.length }))
    return world.id
  } catch (e) {
    bgTask.fail(taskId, i18n.t('worldgen.world_error'))
    throw e
  }
}
