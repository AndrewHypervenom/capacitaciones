import { supabase } from '@/lib/supabase'
import type { SimulatorAttempt } from '@/stores/progressStore'

export interface ProgressData {
  /** UUIDs de módulo (`user_progress.completed_module_ids`). Clave buena. */
  completedModuleIds: string[]
  /** @deprecated slugs (`completed_modules`); espejo legado, ver el plan de migración. */
  completedModules: string[]
  checkAnswers: Record<string, Record<string, number>>
  attempts: SimulatorAttempt[]
  xp: number
  streak: number
  lastActivityDate: string | null
  badges: string[]
  quizCorrectCount: number
}

/**
 * Lee el espejo de progreso de la BD. NO usa `.single()`: la tabla no tiene
 * índice único sobre (user_id, campaign_id) y pueden existir filas duplicadas
 * (ver nota en `upsertProgress`); con `.single()` reventaba y el aprendiz se
 * quedaba sin hidratar → 0%. Toma la fila más reciente.
 */
export async function getProgress(userId: string, campaignId: string): Promise<ProgressData | null> {
  const { data: rows, error } = await supabase
    .from('user_progress')
    .select('*')
    .eq('user_id', userId)
    .eq('campaign_id', campaignId)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) throw error
  const data = rows && rows.length > 0 ? rows[0] : null
  if (!data) return null

  return {
    completedModuleIds: (data as { completed_module_ids?: string[] }).completed_module_ids ?? [],
    completedModules: data.completed_modules ?? [],
    checkAnswers: (data.check_answers ?? {}) as unknown as Record<string, Record<string, number>>,
    attempts: (data.attempts ?? []) as unknown as SimulatorAttempt[],
    xp: data.xp_total ?? 0,
    streak: data.streak_days ?? 0,
    lastActivityDate: data.last_activity ?? null,
    badges: data.badges ?? [],
    quizCorrectCount: 0,
  }
}

/** XP, racha e insignias de una persona, agregados sobre TODAS sus campañas. */
export interface GamificationSummary {
  xp: number
  streak: number
  badges: string[]
  lastActivityDate: string | null
}

/**
 * Resumen de gamificación de un usuario leyendo el espejo en BD. Sirve para
 * mostrar los logros de OTRA persona (perfil consultado por staff), donde el
 * store local —que es la fuente de verdad de la sesión propia— no aplica.
 *
 * Un usuario multi-campaña tiene una fila por campaña: se unen las insignias,
 * se suma el XP y se toma la racha mayor. Si la RLS no autoriza la lectura,
 * devuelve null y la vista simplemente no pinta la sección.
 */
export async function getUserGamification(userId: string): Promise<GamificationSummary | null> {
  const { data, error } = await supabase
    .from('user_progress')
    .select('xp_total, streak_days, badges, last_activity')
    .eq('user_id', userId)
  if (error || !data || data.length === 0) return null

  const badges = new Set<string>()
  let xp = 0
  let streak = 0
  let last: string | null = null
  for (const row of data) {
    for (const b of row.badges ?? []) badges.add(b)
    xp += row.xp_total ?? 0
    streak = Math.max(streak, row.streak_days ?? 0)
    if (row.last_activity && (!last || row.last_activity > last)) last = row.last_activity
  }
  return { xp, streak, badges: [...badges], lastActivityDate: last }
}

export async function upsertProgress(
  userId: string,
  campaignId: string,
  progress: ProgressData,
) {
  // IMPORTANTE: NO escribir `attempts` ni `check_answers` aquí.
  // La columna `user_progress.attempts` es propiedad exclusiva de
  // `saveActivityAttempt` (intentos de quizzes/juegos). El store local guarda en
  // su propio `attempts` los intentos del SIMULADOR, que no tienen nada que ver;
  // si los mandáramos aquí, este upsert (que corre en segundo plano desde
  // useProgressSync) SOBRESCRIBIRÍA y borraría los intentos de actividades → el
  // candado del módulo se quedaba en "0 hechas". El localStorage es la fuente de
  // verdad de la UI y nadie lee de vuelta estas columnas (getProgress no se usa),
  // así que solo espejamos lo agregado (módulos completados, xp, racha, insignias).
  //
  // NO usar .upsert({ onConflict: 'user_id,campaign_id' }): la tabla no tiene
  // índice único sobre (user_id, campaign_id) — pueden existir filas duplicadas —
  // y el upsert falla siempre con "no unique constraint matching ON CONFLICT",
  // dejando completed_modules vacío en BD (la certificación veía 0 módulos).
  // Igual que saveActivityAttempt: select → update por id de la fila más
  // reciente, o insert si no existe.
  const { data: rows, error: fetchError } = await supabase
    .from('user_progress')
    .select('id, completed_modules, completed_module_ids, badges')
    .eq('user_id', userId)
    .eq('campaign_id', campaignId)
    .order('updated_at', { ascending: false })
  if (fetchError) throw fetchError

  const current = rows && rows.length > 0 ? rows[0] : null

  if (current) {
    // Unión con lo ya guardado: si el aprendiz limpió localStorage o cambió de
    // equipo, el espejo nunca debe BORRAR módulos ya acreditados en BD.
    const completed = [...new Set([...(current.completed_modules ?? []), ...progress.completedModules])]
    const completedIds = [
      ...new Set([
        ...((current as { completed_module_ids?: string[] }).completed_module_ids ?? []),
        ...progress.completedModuleIds,
      ]),
    ]
    const badges = [...new Set([...(current.badges ?? []), ...progress.badges])]
    const { error } = await supabase
      .from('user_progress')
      .update({
        completed_modules: completed,
        completed_module_ids: completedIds,
        xp_total: progress.xp,
        streak_days: progress.streak,
        last_activity: progress.lastActivityDate,
        badges,
        updated_at: new Date().toISOString(),
      })
      .eq('id', current.id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('user_progress')
      .insert({
        user_id: userId,
        campaign_id: campaignId,
        completed_modules: progress.completedModules,
        completed_module_ids: progress.completedModuleIds,
        xp_total: progress.xp,
        streak_days: progress.streak,
        last_activity: progress.lastActivityDate,
        badges: progress.badges,
      })
    if (error) throw error
  }
}
