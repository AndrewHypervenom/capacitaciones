import { create } from 'zustand'

/**
 * Estado del panel de opiniones del sitio. Vive en un store (y no dentro del
 * widget) para que cualquier vista pueda abrirlo: el botón flotante, el enlace
 * del menú o el botón de "Mis sugerencias".
 *
 * Las respuestas a medio llenar SÍ viven dentro del widget: como está montado
 * en la raíz de la app, cerrar el panel no pierde lo que el usuario ya eligió.
 */
interface SiteFeedbackState {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

export const useSiteFeedbackStore = create<SiteFeedbackState>((set, get) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set({ isOpen: !get().isOpen }),
}))
