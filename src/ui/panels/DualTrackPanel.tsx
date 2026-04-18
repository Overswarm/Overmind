import { useMemo, useState } from 'react';
import type { AlignedData, Options } from 'uplot';
import { useAppStore } from '../../state/store';
import { useSettingsStore } from '../../state/settings';
import { cachedTimeSeries } from '../../analysis/cache';
import { cleanBwString, FRAMES_PER_SECOND, formatMMSS } from '../../types/replay';
import { UPlotChart } from '../UPlotChart';

type Metric = 'workersProduced' | 'supplyProduced' | 'supplyCap' | 'armyValue' | 'spent' | 'apm' | 'eapm';

const METRIC_LABELS: Record<Metric, string> = {
  workersProduced: 'Workers produced',
  supplyProduced: 'Supply produced',
  supplyCap: 'Supply cap',
  armyValue: 'Army value (min+gas)',
  spent: 'Total resources spent (min+gas)',
  apm: 'APM (rolling 30s)',
  eapm: 'EAPM (rolling 30s)',
};

// Player strokes resolved from the active theme at render-time. uPlot draws
// on a canvas, so it needs literal color strings — `var(...)` won't resolve.
const PLAYER_STROKE_VARS = [
  '--color-player-a',
  '--color-player-b',
  '--color-player-c',
  '--color-player-d',
] as const;
const PLAYER_STROKE_FALLBACKS = ['#38bdf8', '#f97316', '#a855f7', '#f472b6'];

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function DualTrackPanel() {
  const active = useAppStore((s) => s.active);
  const currentFrame = useAppStore((s) => s.currentFrame);
  const setFrame = useAppStore((s) => s.setFrame);
  const setHoverFrame = useAppStore((s) => s.setHoverFrame);

  const [metric, setMetric] = useState<Metric>('supplyProduced');
  // Subscribing to theme forces the memo below to recompute colors on change.
  const theme = useSettingsStore((s) => s.theme);

  const series = useMemo(() => {
    if (!active) return null;
    return cachedTimeSeries(active.hash, active.replay, 1);
  }, [active]);

  const { data, options, atCursor } = useMemo(() => {
    if (!series) return { data: null as AlignedData | null, options: null as Options | null, atCursor: [] as { name: string; value: number; color: string }[] };
    const ys: number[][] = series.players.map((p) => p[metric]);
    const data: AlignedData = [series.timeSeconds, ...ys];
    // The panel renders its own cursor readout above the chart (see atCursor
    // below), so disable uPlot's built-in legend — it renders outside the
    // plot area and was getting clipped by the next grid row.
    const axisStroke = cssVar('--color-chart-axis', '#6b7280');
    const gridStroke = cssVar('--color-chart-grid', 'rgba(107,114,128,0.18)');
    const options: Options = {
      width: 600,
      height: 260,
      padding: [8, 8, 24, 40],
      legend: { show: false },
      cursor: {
        // Clicks jump the main timeline to the cursor position; moves publish
        // a hoverFrame so other panels can highlight the same moment.
        bind: {
          mouseup: (self, _target, handler) => (ev: MouseEvent) => {
            const x = self.posToVal(ev.offsetX, 'x');
            if (Number.isFinite(x)) setFrame(x * FRAMES_PER_SECOND);
            return handler(ev);
          },
          mouseleave: (_self, _target, handler) => (ev: MouseEvent) => {
            setHoverFrame(null);
            return handler(ev);
          },
        },
      },
      hooks: {
        setCursor: [
          (self) => {
            const idx = self.cursor.idx;
            if (idx == null) {
              setHoverFrame(null);
              return;
            }
            const t = self.data[0]?.[idx];
            if (typeof t === 'number') setHoverFrame(t * FRAMES_PER_SECOND);
          },
        ],
      },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke },
          values: (_u, ticks) => ticks.map((t) => formatMMSS(t)),
        },
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke },
        },
      ],
      series: [
        { label: 'time' },
        ...series.players.map((p, i) => ({
          label: cleanBwString(p.name),
          stroke: cssVar(PLAYER_STROKE_VARS[i % PLAYER_STROKE_VARS.length], PLAYER_STROKE_FALLBACKS[i % PLAYER_STROKE_FALLBACKS.length]),
          width: 1.5,
          points: { show: false },
        })),
      ],
    };

    const t = currentFrame / FRAMES_PER_SECOND;
    const idx = Math.max(0, Math.min(series.timeSeconds.length - 1, Math.floor(t)));
    const atCursor = series.players.map((p, i) => ({
      name: cleanBwString(p.name),
      // APM/EAPM are rolling rates — round to integer for a clean cursor read.
      // Everything else is already an integer count.
      value: metric === 'apm' || metric === 'eapm'
        ? Math.round(p[metric][idx] ?? 0)
        : p[metric][idx] ?? 0,
      color: cssVar(PLAYER_STROKE_VARS[i % PLAYER_STROKE_VARS.length], PLAYER_STROKE_FALLBACKS[i % PLAYER_STROKE_FALLBACKS.length]),
    }));
    return { data, options, atCursor };
    // `theme` is intentionally a dep so colors refresh when the user cycles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, metric, currentFrame, setFrame, setHoverFrame, theme]);

  if (!active) return null;

  return (
    <div className="flex h-full flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Dual-track timeline
        </div>
        <div className="flex gap-1">
          {(Object.keys(METRIC_LABELS) as Metric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                metric === m
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text-h)]'
              }`}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex gap-4 px-3 py-2 text-xs">
          {atCursor.map((row) => (
            <div key={row.name} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: row.color }} />
              <span className="text-[var(--color-text-h)]">{row.name}</span>
              <span className="font-mono tabular-nums text-[var(--color-muted)]">{row.value.toLocaleString()}</span>
            </div>
          ))}
          {atCursor.length >= 2 && (
            <div className="ml-auto text-[var(--color-muted)]">
              Δ {(atCursor[0].value - atCursor[1].value).toLocaleString()}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1">
          {data && options && (
            <UPlotChart
              key={theme}
              data={data}
              options={options}
              className="h-full w-full"
            />
          )}
        </div>
      </div>
    </div>
  );
}
