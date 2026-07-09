import { create } from 'zustand';
import type { SimState } from '@/lib/simulator';

/** Contexto de la corrida: de qué curso viene y a dónde volver. */
export interface SimContext {
  courseId: string | null;
  campaignId: string | null;
  returnTo: string | null;
}

interface SimStoreState {
  active: SimState | null;
  lastResult: SimState | null;
  context: SimContext | null;
  setActive: (s: SimState | null) => void;
  setLastResult: (s: SimState | null) => void;
  setContext: (c: SimContext | null) => void;
}

export const useSimStore = create<SimStoreState>((set) => ({
  active: null,
  lastResult: null,
  context: null,
  setActive: (s) => set({ active: s }),
  setLastResult: (s) => set({ lastResult: s }),
  setContext: (c) => set({ context: c }),
}));
