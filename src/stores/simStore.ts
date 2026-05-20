import { create } from 'zustand';
import type { SimState } from '@/lib/simulator';

interface SimStoreState {
  active: SimState | null;
  lastResult: SimState | null;
  setActive: (s: SimState | null) => void;
  setLastResult: (s: SimState | null) => void;
}

export const useSimStore = create<SimStoreState>((set) => ({
  active: null,
  lastResult: null,
  setActive: (s) => set({ active: s }),
  setLastResult: (s) => set({ lastResult: s }),
}));
