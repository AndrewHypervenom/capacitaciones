import { create } from 'zustand';

// ─────────────────────────────────────────────────────────────────────────────
// Cola de "+XP" para la capa de animación (XPGainLayer).
//
// Vive separada de progressStore a propósito: progressStore la alimenta, pero
// NADIE la necesita para calcular nada. Así el store de progreso no depende de la
// UI y esta cola se puede vaciar/ignorar sin efectos.
//
// Regla: solo se empuja aquí desde el mismo punto donde se acredita el XP de
// verdad (helper `boosted` en progressStore). Si un componente empuja a mano, la
// animación miente.
// ─────────────────────────────────────────────────────────────────────────────

/** De dónde salió el XP (define el ícono/texto de la burbuja). */
export type XPReason =
  | 'module'
  | 'quiz'
  | 'streak'
  | 'simulator'
  | 'certification'
  | 'world'
  | 'review'
  | 'review-course';

export interface XPGain {
  id: string;
  amount: number;
  /** Multiplicador vigente cuando se otorgó (1 = sin evento). */
  multiplier: number;
  reason: XPReason;
  at: number;
}

interface XPFeedState {
  gains: XPGain[];
  push: (g: Omit<XPGain, 'id' | 'at'>) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

let seq = 0;

export const useXPFeedStore = create<XPFeedState>((set) => ({
  gains: [],
  push: (g) =>
    set((s) => ({
      // Tope de 4 burbujas: en un quiz rápido llegan muchas seguidas y apilarlas
      // todas tapa la pantalla. Se descartan las más viejas.
      gains: [...s.gains, { ...g, id: `xp-${++seq}`, at: Date.now() }].slice(-4),
    })),
  dismiss: (id) => set((s) => ({ gains: s.gains.filter((g) => g.id !== id) })),
  clear: () => set({ gains: [] }),
}));

export function pushXPGain(gain: Omit<XPGain, 'id' | 'at'>): void {
  if (gain.amount <= 0) return;
  useXPFeedStore.getState().push(gain);
}
