// React's only supported error boundary API is a class component with
// componentDidCatch / getDerivedStateFromError. We wrap the major view
// branches (replay grid, analysis, stats) so a crash in one doesn't take
// the whole app down — the user can still switch tabs or load a different
// replay. We also stash the error's message + stack in state so the inline
// fallback can show something useful, and log to the console for debugging.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  label: string;                      // "replay view", "stats", etc.
  onReset?: () => void;               // optional reset hook (clear selection, etc.)
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[overmind] ${this.props.label} crashed:`, error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full items-start justify-center p-6">
        <div className="theme-panel max-w-lg rounded-lg border border-red-500/40 bg-[var(--color-bg-panel)] p-4 text-sm">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-400">
            {this.props.label} failed to render
          </div>
          <div className="mb-3 font-mono text-xs text-[var(--color-text-h)]">
            {error.message || String(error)}
          </div>
          <div className="mb-3 text-[11px] text-[var(--color-muted)]">
            This shouldn't happen. Try reloading, or switch tabs and come back.
            If it keeps happening, copy the console stack trace and file an issue.
          </div>
          <button
            onClick={this.reset}
            className="rounded bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-white hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
