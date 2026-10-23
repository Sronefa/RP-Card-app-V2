import { create } from "zustand";

interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

interface ToastState {
  toasts: Toast[];
  push: (text: string, tone?: Toast["tone"]) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(text, tone = "info") {
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => get().dismiss(id), tone === "error" ? 8000 : 5000);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = (text: string, tone?: Toast["tone"]) => useToasts.getState().push(text, tone);

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto max-w-md rounded-lg border px-4 py-2 text-left text-sm shadow-lg ${
            t.tone === "error" ? "border-red-500/40 bg-red-950 text-red-100" : "border-border bg-surface-raised text-ink"
          }`}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
