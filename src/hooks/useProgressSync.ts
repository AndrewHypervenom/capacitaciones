import { useEffect, useRef, useState } from 'react'
import { useProgressStore } from '@/stores/progressStore'
import { upsertProgress } from '@/services/progress.service'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'

/**
 * Sincroniza el progreso local (localStorage) hacia `user_progress` en Supabase.
 * Esto habilita que la certificación server-side y el panel del capacitador
 * vean los módulos completados. Se monta una vez (en AppShell) para aprendices.
 *
 * Es unidireccional (local → BD) y con rebote: el localStorage sigue siendo la
 * fuente de verdad de la UI; la BD es el espejo auditable.
 */
export function useProgressSync() {
  const { user, campaignId: profileCampaignId, isSuperAdmin } = useAuth()
  const completedModules = useProgressStore((s) => s.completedModules)
  const xp = useProgressStore((s) => s.xp)
  const streak = useProgressStore((s) => s.streak)
  const lastActivityDate = useProgressStore((s) => s.lastActivityDate)
  const badges = useProgressStore((s) => s.badges)
  const checkAnswers = useProgressStore((s) => s.checkAnswers)
  const attempts = useProgressStore((s) => s.attempts)
  const quizCorrectCount = useProgressStore((s) => s.quizCorrectCount)

  // Staff sin campaña propia (superadmin): espeja contra la primera campaña
  // activa para que la certificación server-side también le funcione al probar.
  const [fallbackCampaignId, setFallbackCampaignId] = useState<string | null>(null)
  useEffect(() => {
    if (profileCampaignId || !isSuperAdmin) return
    supabase
      .from('campaigns')
      .select('id')
      .eq('is_active', true)
      .order('created_at')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setFallbackCampaignId(data?.id ?? null))
  }, [profileCampaignId, isSuperAdmin])

  const campaignId = profileCampaignId ?? fallbackCampaignId

  const lastPayload = useRef<string>('')

  useEffect(() => {
    if (!user?.id || !campaignId) return
    const payload = JSON.stringify({ completedModules, xp, streak, lastActivityDate, badges })
    if (payload === lastPayload.current) return

    const timer = setTimeout(() => {
      lastPayload.current = payload
      void upsertProgress(user.id, campaignId, {
        completedModules,
        checkAnswers,
        attempts,
        xp,
        streak,
        lastActivityDate,
        badges,
        quizCorrectCount,
      }).catch(() => {
        // Silencioso: no bloquear la UI si falla el espejo a BD.
        lastPayload.current = ''
      })
    }, 1200)

    return () => clearTimeout(timer)
  }, [
    user?.id,
    campaignId,
    completedModules,
    xp,
    streak,
    lastActivityDate,
    badges,
    checkAnswers,
    attempts,
    quizCorrectCount,
  ])
}
