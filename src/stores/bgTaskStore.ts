import { create } from 'zustand';

export type BgTaskStatus = 'running' | 'success' | 'error' | 'canceled';

/** Acción principal que se ofrece al terminar (p. ej. "Editar módulo", "Abrir curso"). */
export interface BgTaskAction {
  label: string;
  run: () => void;
}

export interface BgTask {
  id: string;
  title: string;
  detail?: string;
  status: BgTaskStatus;
  /** Si la tarea admite cancelación (tiene AbortController asociado). */
  cancelable: boolean;
  /** Cancelación solicitada; el proceso está cerrando/guardando lo parcial. */
  canceling: boolean;
  /** Éxito pero con contenido parcial/incompleto (p. ej. cancelado y guardado a medias). */
  incomplete?: boolean;
  /** Acción destacada disponible al terminar. */
  action?: BgTaskAction;
  /** No se serializa; sirve para abortar el trabajo en curso. */
  controller?: AbortController;
}

interface FinishOpts {
  detail?: string;
  action?: BgTaskAction;
  incomplete?: boolean;
}

interface BgTaskState {
  tasks: BgTask[];
  start: (title: string, detail?: string, opts?: { cancelable?: boolean }) => string;
  update: (id: string, patch: Partial<Pick<BgTask, 'title' | 'detail'>>) => void;
  succeed: (id: string, arg?: string | FinishOpts) => void;
  fail: (id: string, detail?: string) => void;
  /** Finaliza como cancelado (sin contenido guardado). */
  markCanceled: (id: string, arg?: string | FinishOpts) => void;
  /** Solicita cancelar: aborta el controller y marca la tarea como "cancelando". */
  requestCancel: (id: string) => void;
  dismiss: (id: string) => void;
}

let seq = 0;
// Cuánto queda visible el estado final antes de auto-ocultarse.
const SUCCESS_TTL = 8000;
const ERROR_TTL = 30000;
const CANCELED_TTL = 6000;

function normalize(arg?: string | FinishOpts): FinishOpts {
  if (typeof arg === 'string') return { detail: arg };
  return arg ?? {};
}

export const useBgTaskStore = create<BgTaskState>()((set, get) => {
  const finish = (id: string, status: BgTaskStatus, opts: FinishOpts) => {
    set({
      tasks: get().tasks.map((t) =>
        t.id === id
          ? {
              ...t,
              status,
              canceling: false,
              detail: opts.detail ?? t.detail,
              action: opts.action ?? t.action,
              incomplete: opts.incomplete ?? t.incomplete,
            }
          : t,
      ),
    });
    const ttl = status === 'error' ? ERROR_TTL : status === 'canceled' ? CANCELED_TTL : SUCCESS_TTL;
    setTimeout(() => get().dismiss(id), ttl);
  };

  return {
    tasks: [],
    start: (title, detail, opts) => {
      const id = `bgtask-${++seq}`;
      const controller = opts?.cancelable ? new AbortController() : undefined;
      set({
        tasks: [
          ...get().tasks,
          { id, title, detail, status: 'running', cancelable: !!controller, canceling: false, controller },
        ],
      });
      return id;
    },
    update: (id, patch) =>
      set({ tasks: get().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
    succeed: (id, arg) => finish(id, 'success', normalize(arg)),
    fail: (id, detail) => finish(id, 'error', { detail }),
    markCanceled: (id, arg) => finish(id, 'canceled', normalize(arg)),
    requestCancel: (id) => {
      const task = get().tasks.find((t) => t.id === id);
      if (!task || task.status !== 'running') return;
      task.controller?.abort();
      set({
        tasks: get().tasks.map((t) => (t.id === id ? { ...t, canceling: true } : t)),
      });
    },
    dismiss: (id) => set({ tasks: get().tasks.filter((t) => t.id !== id) }),
  };
});

/** Helpers para usar fuera de React (servicios), estilo `toast`. */
export const bgTask = {
  /** Inicia una tarea NO cancelable. Devuelve su id. */
  start: (title: string, detail?: string) => useBgTaskStore.getState().start(title, detail),
  /** Inicia una tarea cancelable. Devuelve su id y el AbortSignal a pasar al trabajo. */
  startCancelable: (title: string, detail?: string): { id: string; signal: AbortSignal } => {
    const id = useBgTaskStore.getState().start(title, detail, { cancelable: true });
    const signal = useBgTaskStore.getState().tasks.find((t) => t.id === id)!.controller!.signal;
    return { id, signal };
  },
  update: (id: string, patch: Partial<Pick<BgTask, 'title' | 'detail'>>) =>
    useBgTaskStore.getState().update(id, patch),
  succeed: (id: string, arg?: string | FinishOpts) => useBgTaskStore.getState().succeed(id, arg),
  fail: (id: string, detail?: string) => useBgTaskStore.getState().fail(id, detail),
  markCanceled: (id: string, arg?: string | FinishOpts) =>
    useBgTaskStore.getState().markCanceled(id, arg),
  /** ¿Se pidió cancelar esta tarea? (el AbortSignal ya fue abortado). */
  aborted: (id: string) => {
    const t = useBgTaskStore.getState().tasks.find((x) => x.id === id);
    return !!t?.controller?.signal.aborted;
  },
};
