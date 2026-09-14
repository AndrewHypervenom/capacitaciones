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
 * campañas por definición y nunca se queda sin, y Recursos Humanos no trabaja
 * por campañas en absoluto: a ninguno de los dos se le bloquea nunca.
 */
export function useHasNoCampaigns(): boolean | null {
  const { campaignId, isCapacitador, isSuperAdmin, isRh, user } = useAuth()
  const [result, setResult] = useState<boolean | null>(null)

  useEffect(() => {
    // Recursos Humanos NO tiene campaña ni la necesita: su alcance es la gente
    // de toda la organización. Sin esta salida vería la pantalla de bloqueo
    // "no tienes campañas" desde el primer día, que es el error más fácil de
    // cometer al añadir el rol.
    if (isSuperAdmin || isRh || !isCapacitador) {
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
  }, [campaignId, isCapacitador, isSuperAdmin, isRh, user?.id])

  return result
}
