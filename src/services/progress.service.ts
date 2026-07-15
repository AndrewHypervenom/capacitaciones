import { supabase } from '@/lib/supabase'
import type { SimulatorAttempt } from '@/stores/progressStore'

export interface ProgressData {
  completedModules: string[]
  checkAnswers: Record<string, Record<string, number>>
  attempts: SimulatorAttempt[]
  xp: number
  streak: number
  lastActivityDate: string | null
  badges: string[]
  quizCorrectCount: number
}

export async function getProgress(userId: string, campaignId: string): Promise<ProgressData | null> {
  const { data, error } = await supabase
    .from('user_progress')
    .select('*')
    .eq('user_id', userId)
    .eq('campaign_id', campaignId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // no rows
    throw error
  }

  return {
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
    .select('id, completed_modules, badges')
    .eq('user_id', userId)
    .eq('campaign_id', campaignId)
    .order('updated_at', { ascending: false })
  if (fetchError) throw fetchError

  const current = rows && rows.length > 0 ? rows[0] : null

  if (current) {
    // Unión con lo ya guardado: si el aprendiz limpió localStorage o cambió de
    // equipo, el espejo nunca debe BORRAR módulos ya acreditados en BD.
    const completed = [...new Set([...(current.completed_modules ?? []), ...progress.completedModules])]
    const badges = [...new Set([...(current.badges ?? []), ...progress.badges])]
    const { error } = await supabase
      .from('user_progress')
      .update({
        completed_modules: completed,
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
        xp_total: progress.xp,
        streak_days: progress.streak,
        last_activity: progress.lastActivityDate,
        badges: progress.badges,
      })
    if (error) throw error
  }
}
