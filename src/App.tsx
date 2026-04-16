import { MetadataHeader } from './ui/MetadataHeader';
import { Timeline } from './ui/Timeline';
import { Library } from './ui/Library';
import { DropZone } from './ui/DropZone';
import { PlaceholderPanel } from './ui/panels/PlaceholderPanel';
import { useAppStore } from './state/store';

function App() {
  const active = useAppStore((s) => s.active);
  const loading = useAppStore((s) => s.loading);
  const error = useAppStore((s) => s.error);

  return (
    <div className="grid h-screen w-screen grid-rows-[auto_1fr_auto] bg-[var(--color-bg)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-elev)]">
        <MetadataHeader />
      </header>

      <main className="grid min-h-0 grid-cols-[280px_1fr]">
        <aside className="flex min-h-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-elev)]">
          <div className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Library
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Library />
          </div>
        </aside>

        <section className="min-h-0 overflow-auto p-4">
          {!active ? (
            <div className="mx-auto max-w-2xl">
              <DropZone />
              {error && (
                <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                  {error}
                </div>
              )}
            </div>
          ) : (
            <div className="grid h-full grid-cols-12 grid-rows-6 gap-3">
              <div className="col-span-8 row-span-3">
                <PlaceholderPanel title="Dual-track timeline graph" hint="Workers, army value, and income — coming in Phase 1." />
              </div>
              <div className="col-span-4 row-span-3">
                <PlaceholderPanel title="Live roster" hint="Units & buildings at current timestamp — Phase 2." />
              </div>
              <div className="col-span-5 row-span-3">
                <PlaceholderPanel title="Build order" hint="Chronological construction & training — Phase 1." />
              </div>
              <div className="col-span-4 row-span-3">
                <PlaceholderPanel title="APM / EAPM" hint="Raw vs effective actions, redundancy % — Phase 2." />
              </div>
              <div className="col-span-3 row-span-3">
                <PlaceholderPanel title="Chat log" hint="In-game chat timeline — Phase 1." />
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg-elev)]">
        <Timeline />
      </footer>

      {loading.busy && (
        <div className="pointer-events-none fixed right-4 top-4 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 py-2 text-xs text-[var(--color-text-h)] shadow-lg">
          {loading.message || 'Working…'}
        </div>
      )}
    </div>
  );
}

export default App;
