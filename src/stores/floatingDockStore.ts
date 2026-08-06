import { create } from 'zustand'

/**
 * Estado del rincón flotante (chat de ayuda + opiniones + "volver arriba").
 *
 * Antes cada botón se pintaba por su cuenta con su propio `fixed bottom-*`, así
 * que entre los tres ocupaban una columna de ~13rem sobre el contenido y
 * terminaban tapando botones reales de la pantalla. Ahora hay UN solo botón que
 * se despliega, y desde aquí se controla:
 *
 *  • `side`: de qué lado vive. Quien lo tenga encima de algo que necesita puede
 *    mandarlo al otro borde y queda así para siempre (localStorage).
 *  • `hidden`: escondido a petición del usuario. Queda una pestañita en el borde
 *    para traerlo de vuelta: se oculta, no se pierde.
 *  • `helpMounted`: el chat de ayuda no está montado en todas las vistas
 *    (AppShell y AdminRouter sí, /world o /arena no). El dock solo ofrece el
 *    chat donde de verdad hay panel que abrir.
 *
 * Los paneles (ayuda y opiniones) leen `side` para abrirse del mismo lado que
 * el botón que los invoca.
 */

export type DockSide = 'left' | 'right'

const SIDE_KEY = 'dock_side'
const HIDDEN_KEY = 'dock_hidden'

function readSide(): DockSide {
  try {
    return localStorage.getItem(SIDE_KEY) === 'left' ? 'left' : 'right'
  } catch {
    return 'right'
  }
}

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch { /* modo privado: la preferencia dura lo que la sesión */ }
}

interface FloatingDockState {
  side: DockSide
  hidden: boolean
  helpMounted: boolean
  setSide: (side: DockSide) => void
  toggleSide: () => void
  setHidden: (hidden: boolean) => void
  setHelpMounted: (mounted: boolean) => void
}

export const useFloatingDockStore = create<FloatingDockState>((set, get) => ({
  side: readSide(),
  hidden: readHidden(),
  helpMounted: false,
  setSide: (side) => {
    persist(SIDE_KEY, side)
    set({ side })
  },
  toggleSide: () => get().setSide(get().side === 'right' ? 'left' : 'right'),
  setHidden: (hidden) => {
    persist(HIDDEN_KEY, hidden ? '1' : '0')
    set({ hidden })
  },
  setHelpMounted: (helpMounted) => set({ helpMounted }),
}))
