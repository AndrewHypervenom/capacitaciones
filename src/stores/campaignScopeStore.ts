import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface CampaignScopeState {
  /** Campaña en la que el staff está trabajando ahora mismo en el panel. */
  activeCampaignId: string | null
  setActiveCampaignId: (id: string | null) => void
}

/**
 * Campaña en la que está parado el panel de gestión. Existe para que crear
 * contenido guarde en la campaña que se está mirando y no en la campaña "casa"
 * (profiles.campaign_id): un capacitador con varias campañas que entra a la
 * campaña B debe crear en B, aunque su casa sea A.
 *
 * Se persiste para sobrevivir a la navegación y a recargas — las pantallas de
 * creación se abren en rutas propias y perderían el contexto si no.
 *
 * Es solo una preferencia de UI: nunca es la autoridad de permisos. Quien crea
 * valida siempre contra getAccessibleCampaigns() y la RLS decide al final.
 */
export const useCampaignScope = create<CampaignScopeState>()(
  persist(
    (set) => ({
      activeCampaignId: null,
      setActiveCampaignId: (id) => set({ activeCampaignId: id }),
    }),
    { name: 'campaign-scope' },
  ),
)

/**
 * Campaña por defecto para crear contenido, en orden de confianza:
 * la de la URL, la del panel, y como último recurso la primera accesible.
 * Cualquier candidata que ya no esté accesible (le quitaron la campaña) se
 * descarta, así el select nunca arranca en una campaña que no puede usar.
 */
export function resolveCreationCampaignId(
  urlCampaignId: string | null,
  accessibleIds: string[],
): string {
  const scoped = useCampaignScope.getState().activeCampaignId
  for (const candidate of [urlCampaignId, scoped]) {
    if (candidate && accessibleIds.includes(candidate)) return candidate
  }
  return accessibleIds[0] ?? ''
}
