import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info' | 'badge';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  icon?: string;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = `toast-${++seq}`;
    set({ toasts: [...get().toasts, { ...toast, id }] });
    const duration = toast.duration ?? (toast.kind === 'error' ? 5000 : 3500);
    setTimeout(() => get().dismiss(id), duration);
    return id;
  },
  dismiss: (id) =>
    set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

// Convenience helpers
export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'success', title, description }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'error', title, description }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'info', title, description }),
  badge: (title: string, description?: string, icon?: string) =>
    useToastStore.getState().push({ kind: 'badge', title, description, icon }),
};
