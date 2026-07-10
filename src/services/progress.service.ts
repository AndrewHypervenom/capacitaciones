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
  const { error } = await supabase
    .from('user_progress')
    .upsert({
      user_id: userId,
      campaign_id: campaignId,
      completed_modules: progress.completedModules,
      xp_total: progress.xp,
      streak_days: progress.streak,
      last_activity: progress.lastActivityDate,
      badges: progress.badges,
    }, { onConflict: 'user_id,campaign_id' })

  if (error) throw error
}
