import { supabase } from '@/lib/supabase'
import { worldStage, countPracticeDone } from '@/lib/courseJourney'
import type { JourneyStageInput } from '@/lib/courseJourney'

/**
 * Las etapas NO-módulos de varios cursos a la vez, para una sola persona.
 *
 * La página de un curso lee esto con detalle (necesita saber qué escenario está
 * abierto, cuántos niveles lleva el mundo, si el examen está desbloqueado). El
 * catálogo necesita lo mismo pero de veinte cursos, y hacerlo curso por curso
 * serían cientos de consultas: aquí va TODO en ocho, con `in (...)`.
 *
 * Lo que no puede saber en lote es el desbloqueo (depende de las reglas de cada
 * curso y del avance módulo a módulo), así que no lo devuelve: `unlocked` es
 * opcional en `buildCourseJourney` justamente por esto.
 */
export interface CourseJourneyExtras {
  practice: JourneyStageInput
  world: JourneyStageInput
  exam: JourneyStageInput
}

export const EMPTY_EXTRAS: CourseJourneyExtras = {
  practice: { total: 0, done: 0 },
  world: { total: 0, done: 0 },
  exam: { total: 0, done: 0 },
}

interface ScenarioRow { slug: string; course_id: string | null; pass_score: number | null }

export async function getCourseJourneyExtras(
  courseIds: string[],
  userId: string,
): Promise<Record<string, CourseJourneyExtras>> {
  const out: Record<string, CourseJourneyExtras> = {}
  const ids = [...new Set(courseIds.filter(Boolean))]
  if (ids.length === 0 || !userId) return out

  const scenarioQuery = (table: 'scenarios' | 'choice_scenarios') =>
    supabase
      .from(table)
      .select('slug,course_id,pass_score')
      .in('course_id', ids)
      .eq('is_published', true)
      // Una práctica en la papelera no es un pendiente: el aprendiz ya no la ve
      // en el curso y no debería estar frenándole el porcentaje.
      .is('deleted_at', null)

  const [callRes, choiceRes, worldRes, attemptRes, examRes, examAttemptRes] = await Promise.all([
    scenarioQuery('scenarios'),
    scenarioQuery('choice_scenarios'),
    supabase.from('worlds').select('id,course_id').in('course_id', ids).eq('status', 'published'),
    supabase
      .from('simulator_attempts')
      .select('scenario_slug,score')
      .eq('user_id', userId)
      .in('course_id', ids),
    supabase.from('course_exams').select('course_id,pass_score').in('course_id', ids).eq('is_published', true),
    supabase
      .from('exam_attempts')
      .select('course_id,passed,score_pct')
      .eq('user_id', userId)
      .in('course_id', ids)
      .eq('status', 'submitted'),
  ])

  // ── Prácticas ────────────────────────────────────────────────────────────
  const bestBySlug: Record<string, number> = {}
  for (const a of (attemptRes.data ?? []) as Array<{ scenario_slug: string | null; score: number | null }>) {
    if (!a.scenario_slug) continue
    bestBySlug[a.scenario_slug] = Math.max(bestBySlug[a.scenario_slug] ?? 0, a.score ?? 0)
  }
  const scenariosByCourse = new Map<string, Array<{ slug: string; passScore: number }>>()
  for (const row of [...(callRes.data ?? []), ...(choiceRes.data ?? [])] as ScenarioRow[]) {
    if (!row.course_id) continue
    const arr = scenariosByCourse.get(row.course_id) ?? []
    arr.push({ slug: row.slug, passScore: row.pass_score ?? 70 })
    scenariosByCourse.set(row.course_id, arr)
  }

  // ── Mundos ───────────────────────────────────────────────────────────────
  const worlds = (worldRes.data ?? []) as Array<{ id: string; course_id: string | null }>
  const worldIds = worlds.map((w) => w.id)
  const levelsByWorld = new Map<string, number>()
  const doneByWorld = new Map<string, number>()
  if (worldIds.length > 0) {
    const [levelRes, progressRes] = await Promise.all([
      supabase.from('world_levels').select('id,world_id').in('world_id', worldIds),
      supabase
        .from('world_progress')
        .select('world_id,level_id')
        .eq('user_id', userId)
        .eq('completed', true)
        .in('world_id', worldIds),
    ])
    for (const l of (levelRes.data ?? []) as Array<{ world_id: string }>) {
      levelsByWorld.set(l.world_id, (levelsByWorld.get(l.world_id) ?? 0) + 1)
    }
    // Por nivel único: un nivel repetido no puede contar dos veces.
    const seen = new Set<string>()
    for (const p of (progressRes.data ?? []) as Array<{ world_id: string; level_id: string }>) {
      const key = `${p.world_id}|${p.level_id}`
      if (seen.has(key)) continue
      seen.add(key)
      doneByWorld.set(p.world_id, (doneByWorld.get(p.world_id) ?? 0) + 1)
    }
  }

  // ── Examen final ─────────────────────────────────────────────────────────
  const examByCourse = new Map<string, number>()
  for (const e of (examRes.data ?? []) as Array<{ course_id: string; pass_score: number | null }>) {
    examByCourse.set(e.course_id, e.pass_score ?? 80)
  }
  const examBestByCourse = new Map<string, number>()
  for (const a of (examAttemptRes.data ?? []) as Array<{ course_id: string; passed: boolean | null; score_pct: number | null }>) {
    // `passed` lo decide el servidor al calificar; el puntaje es el respaldo
    // para exámenes viejos donde la bandera quedó nula.
    const score = a.passed ? 100 : (a.score_pct ?? 0)
    examBestByCourse.set(a.course_id, Math.max(examBestByCourse.get(a.course_id) ?? 0, score))
  }

  for (const courseId of ids) {
    const scenarios = scenariosByCourse.get(courseId) ?? []
    const world = worlds.find((w) => w.course_id === courseId)
    const examMin = examByCourse.get(courseId)
    out[courseId] = {
      practice: { total: scenarios.length, done: countPracticeDone(scenarios, bestBySlug) },
      world: world
        ? worldStage(levelsByWorld.get(world.id) ?? 0, doneByWorld.get(world.id) ?? 0)
        : { total: 0, done: 0 },
      exam:
        examMin === undefined
          ? { total: 0, done: 0 }
          : { total: 1, done: (examBestByCourse.get(courseId) ?? 0) >= examMin ? 1 : 0 },
    }
  }
  return out
}
