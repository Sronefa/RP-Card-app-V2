interface PlaceholderProps {
  title: string;
  phase: number;
  children: React.ReactNode;
}

/** Empty state shown for sections that later phases will build out. */
export function Placeholder({ title, phase, children }: PlaceholderProps) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3 p-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-ink-muted">{children}</p>
      <span className="w-fit rounded-full border border-border px-3 py-1 text-xs text-ink-muted">
        Coming in phase {phase}
      </span>
    </div>
  );
}
