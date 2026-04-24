import { useEffect, useState } from 'react';
import { MetadataHeader } from './ui/MetadataHeader';
import { Timeline } from './ui/Timeline';
import { Library } from './ui/Library';
import { DropZone } from './ui/DropZone';
import { AnalysisView } from './ui/AnalysisView';
import { StatsView } from './ui/StatsView';
import { AchievementsView } from './ui/AchievementsView';
import { DualTrackPanel } from './ui/panels/DualTrackPanel';
import { BuildOrderPanel } from './ui/panels/BuildOrderPanel';
import { RosterPanel } from './ui/panels/RosterPanel';
import { ApmPanel } from './ui/panels/ApmPanel';
import { ChatPanel } from './ui/panels/ChatPanel';
import { HeatmapPanel } from './ui/panels/HeatmapPanel';
import { HotkeyPanel } from './ui/panels/HotkeyPanel';
import { MacroPanel } from './ui/panels/MacroPanel';
import { CoachPanel } from './ui/panels/CoachPanel';
import { NotesPanel } from './ui/panels/NotesPanel';
import { DebugPanel } from './ui/panels/DebugPanel';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { useAppStore } from './state/store';
import { useSettingsStore, THEMES, type Theme } from './state/settings';

type RightPanel = 'heatmap' | 'hotkeys' | 'macro' | 'coach' | 'notes' | 'debug' | null;
type View = 'replay' | 'analysis' | 'stats' | 'achievements';

// Long-form descriptions surfaced as custom hover tooltips below each header
// pill. Keys match the lowercase label the button shows; the panel above uses
// very short labels to stay compact, so the tooltip is where the "what does
// this do" explanation lives.
const RIGHT_PANEL_LABELS: Record<Exclude<RightPanel, null>, string> = {
  heatmap: 'Where each player spent attention on the map',
  hotkeys: 'Control-group usage and reliance',
  macro: 'Supply blocks and production-idle time',
  coach: 'Auto Coach warnings for macro mistakes',
  notes: 'Your private notes for this replay',
  debug: 'Raw screp output for this replay',
};

const VIEW_LABELS: Record<View, string> = {
  replay: 'Per-replay analysis (press 1)',
  analysis: 'Aggregate analysis across your library (press 2)',
  stats: 'Fun factoids and career records (press 3)',
  achievements: 'Library-wide achievements (press 4)',
};

function App() {
  const active = useAppStore((s) => s.active);
  const loading = useAppStore((s) => s.loading);
  const error = useAppStore((s) => s.error);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const cycleTheme = useSettingsStore((s) => s.cycleTheme);
  const [rightPanel, setRightPanel] = useState<RightPanel>('heatmap');
  const [view, setView] = useState<View>('replay');

  // Apply the current theme as a data-attribute on <html> so the per-theme
  // CSS variable blocks in index.css take effect globally.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Global keyboard shortcuts: 1/2/3 switch views, `t` cycles theme. We skip
  // any key event targeted at form inputs so the user can still type in the
  // notes textarea, identity input, etc. Timeline scrubbing owns Space and
  // the arrow keys; those are handled inside that component and don't
  // conflict with the keys we grab here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === '1') setView('replay');
      else if (e.key === '2') setView('analysis');
      else if (e.key === '3') setView('stats');
      else if (e.key === '4') setView('achievements');
      else if (e.key === 't' || e.key === 'T') cycleTheme();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cycleTheme]);

  return (
    <div className="grid h-screen w-screen grid-rows-[auto_1fr_auto] bg-[var(--color-bg)]">
      <header className="flex items-stretch border-b border-[var(--color-border)] bg-[var(--color-bg-elev)]">
        <div className="flex-1">
          <MetadataHeader />
        </div>
        {active && view === 'replay' && (
          <div className="flex items-stretch">
            {(['heatmap', 'hotkeys', 'macro', 'coach', 'notes', 'debug'] as const).map((key) => (
              <HeaderTab
                key={key}
                label={key}
                tooltip={RIGHT_PANEL_LABELS[key]}
                active={rightPanel === key}
                onClick={() => setRightPanel((cur) => (cur === key ? null : key))}
              />
            ))}
          </div>
        )}
        {/* Gap between the per-replay panel toggles (left group) and the
            app-level view controls (right group). Roughly one button wide so
            the two sets read as separate instead of one run of pills. */}
        {active && view === 'replay' && (
          <div className="w-12 shrink-0" aria-hidden />
        )}
        <div className="flex items-stretch">
          {(['replay', 'analysis', 'stats', 'achievements'] as const).map((v) => (
            <HeaderTab
              key={v}
              label={v}
              tooltip={VIEW_LABELS[v]}
              active={view === v}
              onClick={() => setView(v)}
              bold
            />
          ))}
        </div>
        <div className="ml-3 flex items-center pr-3">
          <label
            className="mr-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]"
            htmlFor="theme-select"
            title="App color theme (press T to cycle)"
          >
            Theme
          </label>
          <select
            id="theme-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-h)] focus:border-[var(--color-accent)] focus:outline-none"
          >
            {THEMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
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
            <ErrorBoundary label="Analysis view">
              <AnalysisView />
            </ErrorBoundary>
          ) : view === 'stats' ? (
            <ErrorBoundary label="Stats view">
              <StatsView />
            </ErrorBoundary>
          ) : view === 'achievements' ? (
            <ErrorBoundary label="Achievements view">
              <AchievementsView />
            </ErrorBoundary>
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
            <ErrorBoundary label="Replay view">
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
                {rightPanel === 'coach' && (
                  <div className="col-span-4 row-span-3">
                    <CoachPanel />
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
            </ErrorBoundary>
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

// Header pill with a custom hover tooltip below. Replaces the browser's
// native `title` attribute, which has a 1s+ delay and plain-text styling.
// Uses Tailwind's group-hover so the bubble is CSS-only — no JS state.
function HeaderTab({
  label,
  tooltip,
  active,
  onClick,
  bold,
}: {
  label: string;
  tooltip: string;
  active: boolean;
  onClick: () => void;
  bold?: boolean;
}) {
  return (
    <div className="group relative flex items-stretch">
      <button
        onClick={onClick}
        className={`border-l border-[var(--color-border)] px-3 text-[10px] uppercase tracking-wide ${
          bold ? 'font-semibold' : ''
        } ${
          active
            ? 'bg-[var(--color-accent)] text-white'
            : 'text-[var(--color-muted)] hover:text-[var(--color-text-h)]'
        }`}
      >
        {label}
      </button>
      <div
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-2 py-1 text-[10px] font-normal normal-case tracking-normal text-[var(--color-text-h)] shadow-lg group-hover:block"
      >
        {tooltip}
      </div>
    </div>
  );
}

export default App;
