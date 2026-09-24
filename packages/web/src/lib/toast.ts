import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => number;
  dismiss: (id: number) => void;
}

const MAX_TOASTS = 3;
const DISMISS_AFTER_MS: Record<ToastTone, number> = { success: 4500, info: 5000, error: 8000 };
let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }].slice(-MAX_TOASTS) }));
    setTimeout(() => get().dismiss(id), DISMISS_AFTER_MS[toast.tone]);
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helpers — usable from React Query callbacks outside components. */
export const toast = {
  success: (title: string, description?: string) => useToastStore.getState().push({ tone: 'success', title, description }),
  error: (title: string, description?: string) => useToastStore.getState().push({ tone: 'error', title, description }),
  info: (title: string, description?: string) => useToastStore.getState().push({ tone: 'info', title, description }),
};

/**
 * Mutation `meta` contract (see main.tsx MutationCache):
 * - `successMessage`: toast shown when the mutation succeeds. A function
 *   receives `(data, variables)`.
 * - `errorMessage`: toast title shown when it fails (the API's message is
 *   the description). Omit it for forms that already show inline errors.
 */
// A type alias (not an interface) so it satisfies React Query's
// `Record<string, unknown>` constraint on `mutationMeta`.
export type ToastMeta = {
  successMessage?: string | ((data: any, variables: any) => string | null | undefined);
  errorMessage?: string;
};

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: ToastMeta;
  }
}
