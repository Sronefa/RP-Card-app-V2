/** Small shared UI pieces. */
import { useEffect, useLayoutEffect, useRef } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent-strong text-white hover:bg-accent",
  secondary: "border border-border bg-surface-raised text-ink hover:border-ink-muted",
  ghost: "text-ink-muted hover:text-ink hover:bg-surface-raised",
  danger: "border border-red-500/40 text-red-300 hover:bg-red-500/10",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function TextInput({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-h-10 w-full rounded-lg border border-border bg-surface-sunken px-3 text-ink outline-none placeholder:text-ink-muted/60 focus:border-accent ${className}`}
      {...props}
    />
  );
}

/** Textarea that grows with its content. */
export function AutoTextarea({ className = "", value, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      rows={3}
      className={`w-full resize-none rounded-lg border border-border bg-surface-sunken px-3 py-2 leading-relaxed text-ink outline-none placeholder:text-ink-muted/60 focus:border-accent ${className}`}
      {...props}
    />
  );
}

/** Modal dialog: a bottom sheet on phones, centred on larger screens. */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="pb-safe max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface-raised p-4 md:max-w-lg md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}
