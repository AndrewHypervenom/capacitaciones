import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface TestModeState {
  /** El superadmin está mirando también el entorno de pruebas. */
  enabled: boolean
  setEnabled: (v: boolean) => void
}

/**
 * Modo pruebas del panel (SOLO superadmin).
 *
 * Apagado (por defecto) el panel se comporta como si las campañas marcadas
 * `is_test` no existieran: no salen en selectores, ni en KPIs, ni en el
 * Panorama de Progreso, ni en los Excel. Encendido, el superadmin ve además lo
 * de prueba, siempre marcado con la insignia "Prueba" y con una franja arriba
 * para que nunca haya duda de dónde está parado.
 *
 * Se persiste para sobrevivir a recargas —probar implica recargar mucho—, pero
 * es solo una preferencia de UI: quién puede ENTRAR a una campaña de prueba lo
 * decide la asignación (campaña casa + campaign_collaborators) y la RLS.
 *
 * Para los capacitadores no aplica: un capacitador de prueba solo tiene
 * campañas de prueba y uno real solo tiene reales — mezclarlas está bloqueado
 * en `setUserCampaigns` y en los triggers de la base.
 */
export const useTestMode = create<TestModeState>()(
  persist(
    (set) => ({
      enabled: false,
      setEnabled: (v) => set({ enabled: v }),
    }),
    { name: 'test-mode' },
  ),
)

/** Lectura fuera de React (servicios). */
export function isTestModeOn(): boolean {
  return useTestMode.getState().enabled
}

/**
 * ¿Hay que esconder lo de prueba en esta pantalla?
 *
 * Solo el superadmin ve todas las campañas, así que solo a él hay que filtrarle
 * (a los demás ya los acota su conjunto de campañas accesibles).
 */
export function shouldHideTestData(isSuperAdmin: boolean): boolean {
  return isSuperAdmin && !isTestModeOn()
}
