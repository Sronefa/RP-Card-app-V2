import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error?: Error;
  componentStack?: string;
}

/** Shows what went wrong instead of a blank page, with a way back. */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? undefined });
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}\n${error.stack ?? ""}\n${componentStack ?? ""}`.trim();
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-3 p-6">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-ink-muted">This part of the app crashed. Your saved cards are safe. Please send the details below.</p>
        <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-surface-sunken p-3 text-xs whitespace-pre-wrap select-text">
          {details}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            className="min-h-10 rounded-lg border border-border px-3 text-sm"
            onClick={() => void navigator.clipboard?.writeText(details)}
          >
            Copy details
          </button>
          <button
            type="button"
            className="min-h-10 rounded-lg bg-accent-strong px-3 text-sm text-white"
            onClick={() => {
              this.setState({ error: undefined, componentStack: undefined });
              this.props.onReset?.();
            }}
          >
            Go back
          </button>
        </div>
      </div>
    );
  }
}
