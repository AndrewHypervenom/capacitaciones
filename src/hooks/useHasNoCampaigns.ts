import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

/**
 * ¿El capacitador se quedó sin ninguna campaña? Pasa cuando el superadmin se las
 * quita todas en /admin/users. Antes esto no podía ocurrir: authStore le
 * auto-asignaba una campaña cualquiera al entrar.
 *
 * Devuelve `null` mientras se resuelve, para no parpadear el aviso.
 *
 * Tener campaña casa ya implica tener campaña, así que solo se consulta la tabla
 * de colaboraciones cuando la casa está vacía. El superadmin ve todas las
 * campañas por definición y nunca se queda sin.
 */
export function useHasNoCampaigns(): boolean | null {
  const { campaignId, isCapacitador, isSuperAdmin, user } = useAuth()
  const [result, setResult] = useState<boolean | null>(null)

  useEffect(() => {
    if (isSuperAdmin || !isCapacitador) {
      setResult(false)
      return
    }
    if (campaignId) {
      setResult(false)
      return
    }
    if (!user?.id) return

    let alive = true
    supabase
      .from('campaign_collaborators')
      .select('campaign_id')
      .eq('user_id', user.id)
      .limit(1)
      .then(
        ({ data }) => { if (alive) setResult((data ?? []).length === 0) },
        // Si la consulta falla no bloqueamos el panel con un aviso posiblemente falso.
        () => { if (alive) setResult(false) },
      )
    return () => { alive = false }
  }, [campaignId, isCapacitador, isSuperAdmin, user?.id])

  return result
}
