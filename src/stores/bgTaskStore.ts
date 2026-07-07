import { create } from 'zustand';

export type BgTaskStatus = 'running' | 'success' | 'error';

export interface BgTask {
  id: string;
  title: string;
  detail?: string;
  status: BgTaskStatus;
}

interface BgTaskState {
  tasks: BgTask[];
  start: (title: string, detail?: string) => string;
  update: (id: string, patch: Partial<Pick<BgTask, 'title' | 'detail'>>) => void;
  succeed: (id: string, detail?: string) => void;
  fail: (id: string, detail?: string) => void;
  dismiss: (id: string) => void;
}

let seq = 0;
// Cuánto queda visible el estado final antes de auto-ocultarse.
const SUCCESS_TTL = 8000;
const ERROR_TTL = 30000;

export const useBgTaskStore = create<BgTaskState>()((set, get) => {
  const finish = (id: string, status: 'success' | 'error', detail?: string) => {
    set({
      tasks: get().tasks.map((t) =>
        t.id === id ? { ...t, status, detail: detail ?? t.detail } : t,
      ),
    });
    setTimeout(() => get().dismiss(id), status === 'error' ? ERROR_TTL : SUCCESS_TTL);
  };

  return {
    tasks: [],
    start: (title, detail) => {
      const id = `bgtask-${++seq}`;
      set({ tasks: [...get().tasks, { id, title, detail, status: 'running' }] });
      return id;
    },
    update: (id, patch) =>
      set({ tasks: get().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
    succeed: (id, detail) => finish(id, 'success', detail),
    fail: (id, detail) => finish(id, 'error', detail),
    dismiss: (id) => set({ tasks: get().tasks.filter((t) => t.id !== id) }),
  };
});

/** Helpers para usar fuera de React (servicios), estilo `toast`. */
export const bgTask = {
  start: (title: string, detail?: string) => useBgTaskStore.getState().start(title, detail),
  update: (id: string, patch: Partial<Pick<BgTask, 'title' | 'detail'>>) =>
    useBgTaskStore.getState().update(id, patch),
  succeed: (id: string, detail?: string) => useBgTaskStore.getState().succeed(id, detail),
  fail: (id: string, detail?: string) => useBgTaskStore.getState().fail(id, detail),
};
