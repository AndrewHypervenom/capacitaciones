import { supabase } from '@/lib/supabase'
import type { SimulatorAttempt } from '@/stores/progressStore'

export interface ProgressData {
  completedModules: string[]
  checkAnswers: Record<string, Record<number, number>>
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
    checkAnswers: (data.check_answers ?? {}) as unknown as Record<string, Record<number, number>>,
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
  const { error } = await supabase
    .from('user_progress')
    .upsert({
      user_id: userId,
      campaign_id: campaignId,
      completed_modules: progress.completedModules,
      check_answers: progress.checkAnswers,
      attempts: progress.attempts as unknown as import('@/types/database').Json,
      xp_total: progress.xp,
      streak_days: progress.streak,
      last_activity: progress.lastActivityDate,
      badges: progress.badges,
    }, { onConflict: 'user_id,campaign_id' })

  if (error) throw error
}
