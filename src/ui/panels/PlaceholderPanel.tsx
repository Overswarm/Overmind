export function PlaceholderPanel({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="theme-panel flex h-full flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
      <div className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {title}
      </div>
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-[var(--color-muted)]">
        {hint}
      </div>
    </div>
  );
}
