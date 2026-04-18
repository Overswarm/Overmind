import { useEffect, useState } from 'react';
import { MetadataHeader } from './ui/MetadataHeader';
import { Timeline } from './ui/Timeline';
import { Library } from './ui/Library';
import { DropZone } from './ui/DropZone';
import { AnalysisView } from './ui/AnalysisView';
import { StatsView } from './ui/StatsView';
import { DualTrackPanel } from './ui/panels/DualTrackPanel';
import { BuildOrderPanel } from './ui/panels/BuildOrderPanel';
import { RosterPanel } from './ui/panels/RosterPanel';
import { ApmPanel } from './ui/panels/ApmPanel';
import { ChatPanel } from './ui/panels/ChatPanel';
import { HeatmapPanel } from './ui/panels/HeatmapPanel';
import { HotkeyPanel } from './ui/panels/HotkeyPanel';
import { MacroPanel } from './ui/panels/MacroPanel';
import { NotesPanel } from './ui/panels/NotesPanel';
import { DebugPanel } from './ui/panels/DebugPanel';
import { useAppStore } from './state/store';
import { useSettingsStore } from './state/settings';

type RightPanel = 'heatmap' | 'hotkeys' | 'macro' | 'notes' | 'debug' | null;
type View = 'replay' | 'analysis' | 'stats';

function App() {
  const active = useAppStore((s) => s.active);
  const loading = useAppStore((s) => s.loading);
  const error = useAppStore((s) => s.error);
  const theme = useSettingsStore((s) => s.theme);
  const cycleTheme = useSettingsStore((s) => s.cycleTheme);
  const [rightPanel, setRightPanel] = useState<RightPanel>('heatmap');
  const [view, setView] = useState<View>('replay');

  // Apply the current theme as a data-attribute on <html> so the per-theme
  // CSS variable blocks in index.css take effect globally.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className="grid h-screen w-screen grid-rows-[auto_1fr_auto] bg-[var(--color-bg)]">
      <header className="flex items-stretch border-b border-[var(--color-border)] bg-[var(--color-bg-elev)]">
        <div className="flex-1">
          <MetadataHeader />
        </div>
        {active && view === 'replay' && (
          <div className="flex items-stretch">
            {(['heatmap', 'hotkeys', 'macro', 'notes', 'debug'] as const).map((key) => (
              <button
                key={key}
                onClick={() => setRightPanel((cur) => (cur === key ? null : key))}
                className={`border-l border-[var(--color-border)] px-3 text-[10px] uppercase tracking-wide ${
                  rightPanel === key
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-text-h)]'
                }`}
                title={
                  key === 'heatmap'
                    ? 'Toggle activity heatmap'
                    : key === 'hotkeys'
                      ? 'Toggle control-group analytics'
                      : key === 'macro'
                        ? 'Toggle supply-block & production-idle analysis'
                        : key === 'notes'
                          ? 'Toggle per-replay notes'
                          : 'Toggle raw screp output'
                }
              >
                {key}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-stretch">
          {(['replay', 'analysis', 'stats'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`border-l border-[var(--color-border)] px-3 text-[10px] font-semibold uppercase tracking-wide ${
                view === v
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text-h)]'
              }`}
              title={
                v === 'replay'
                  ? 'Per-replay analysis'
                  : v === 'analysis'
                    ? 'Aggregate analysis across your library'
                    : 'Fun factoids and career records'
              }
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={cycleTheme}
          className="border-l border-[var(--color-border)] px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)] hover:text-[var(--color-text-h)]"
          title={`Theme: ${theme}. Click to cycle (default → terran → protoss → zerg)`}
        >
          {theme}
        </button>
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
          {view === 'analysis' ? (
            <AnalysisView />
          ) : view === 'stats' ? (
            <StatsView />
          ) : !active ? (
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
              <div className={rightPanel ? 'col-span-8 row-span-3' : 'col-span-12 row-span-3'}>
                <DualTrackPanel />
              </div>
              {rightPanel === 'heatmap' && (
                <div className="col-span-4 row-span-3">
                  <HeatmapPanel />
                </div>
              )}
              {rightPanel === 'hotkeys' && (
                <div className="col-span-4 row-span-3">
                  <HotkeyPanel />
                </div>
              )}
              {rightPanel === 'macro' && (
                <div className="col-span-4 row-span-3">
                  <MacroPanel />
                </div>
              )}
              {rightPanel === 'notes' && (
                <div className="col-span-4 row-span-3">
                  <NotesPanel />
                </div>
              )}
              {rightPanel === 'debug' && (
                <div className="col-span-4 row-span-3">
                  <DebugPanel />
                </div>
              )}
              <div className="col-span-5 row-span-3">
                <BuildOrderPanel />
              </div>
              <div className="col-span-3 row-span-3">
                <RosterPanel />
              </div>
              <div className="col-span-2 row-span-3">
                <ApmPanel />
              </div>
              <div className="col-span-2 row-span-3">
                <ChatPanel />
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg-elev)]">
        {view === 'replay' && <Timeline />}
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
