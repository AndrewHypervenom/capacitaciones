import { useEffect, useRef, useState } from 'react'
import { useProgressStore } from '@/stores/progressStore'
import { getProgress, upsertProgress } from '@/services/progress.service'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'

/**
 * Sincroniza el progreso local (localStorage) hacia `user_progress` en Supabase.
 * Esto habilita que la certificación server-side y el panel del capacitador
 * vean los módulos completados. Se monta una vez (en AppShell) para aprendices.
 *
 * Al montar hidrata UNA VEZ en sentido contrario (BD → local, unión aditiva).
 * Sin eso, el localStorage era la única fuente de la UI: si se perdía (otro
 * navegador/equipo, limpieza de caché, recarga tras un despliegue o tras un
 * cambio de configuración del curso), el aprendiz veía 0% y tenía que volver a
 * "marcar como completado" módulos que la BD ya tenía acreditados.
 *
 * Después de esa hidratación el flujo sigue siendo local → BD con rebote: el
 * localStorage manda en la UI y la BD es el espejo auditable.
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

  // Hidratación inicial BD → local (una por usuario+campaña). Hasta que termine
  // no se espeja de vuelta, para no escribir un estado "vacío" antes de leer.
  const [hydratedKey, setHydratedKey] = useState<string | null>(null)
  const syncKey = user?.id && campaignId ? `${user.id}:${campaignId}` : null
  useEffect(() => {
    if (!user?.id || !campaignId) return
    const key = `${user.id}:${campaignId}`
    let active = true
    getProgress(user.id, campaignId)
      .then((data) => {
        if (!active || !data) return
        useProgressStore.getState().hydrateFromServer(data)
      })
      .catch(() => {
        // Silencioso: si falla, la UI sigue con lo local (comportamiento previo).
      })
      .finally(() => {
        if (active) setHydratedKey(key)
      })
    return () => {
      active = false
    }
  }, [user?.id, campaignId])

  useEffect(() => {
    if (!user?.id || !campaignId || hydratedKey !== syncKey) return
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
    hydratedKey,
    syncKey,
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
