import { useState } from 'react';
import { MetadataHeader } from './ui/MetadataHeader';
import { Timeline } from './ui/Timeline';
import { Library } from './ui/Library';
import { DropZone } from './ui/DropZone';
import { DualTrackPanel } from './ui/panels/DualTrackPanel';
import { BuildOrderPanel } from './ui/panels/BuildOrderPanel';
import { ApmPanel } from './ui/panels/ApmPanel';
import { ChatPanel } from './ui/panels/ChatPanel';
import { DebugPanel } from './ui/panels/DebugPanel';
import { useAppStore } from './state/store';

function App() {
  const active = useAppStore((s) => s.active);
  const loading = useAppStore((s) => s.loading);
  const error = useAppStore((s) => s.error);
  const [showDebug, setShowDebug] = useState(false);

  return (
    <div className="grid h-screen w-screen grid-rows-[auto_1fr_auto] bg-[var(--color-bg)]">
      <header className="flex items-stretch border-b border-[var(--color-border)] bg-[var(--color-bg-elev)]">
        <div className="flex-1">
          <MetadataHeader />
        </div>
        {active && (
          <button
            onClick={() => setShowDebug((v) => !v)}
            className="border-l border-[var(--color-border)] px-3 text-[10px] uppercase tracking-wide text-[var(--color-muted)] hover:text-[var(--color-text-h)]"
            title="Toggle raw screp output panel"
          >
            Debug
          </button>
        )}
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
              <div className={showDebug ? 'col-span-8 row-span-3' : 'col-span-12 row-span-3'}>
                <DualTrackPanel />
              </div>
              {showDebug && (
                <div className="col-span-4 row-span-3">
                  <DebugPanel />
                </div>
              )}
              <div className="col-span-5 row-span-3">
                <BuildOrderPanel />
              </div>
              <div className="col-span-4 row-span-3">
                <ApmPanel />
              </div>
              <div className="col-span-3 row-span-3">
                <ChatPanel />
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
