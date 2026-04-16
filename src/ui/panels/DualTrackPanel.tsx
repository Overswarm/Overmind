import { useMemo, useState } from 'react';
import type { AlignedData, Options } from 'uplot';
import { useAppStore } from '../../state/store';
import { computeTimeSeries } from '../../analysis/timeseries';
import { cleanBwString, FRAMES_PER_SECOND, formatMMSS } from '../../types/replay';
import { UPlotChart } from '../UPlotChart';

type Metric = 'workersProduced' | 'supplyProduced' | 'armyValue';

const METRIC_LABELS: Record<Metric, string> = {
  workersProduced: 'Workers produced',
  supplyProduced: 'Supply produced',
  armyValue: 'Army value (min+gas)',
};

// Two colors in sequence, matched to the metadata header dots.
const PLAYER_STROKES = ['#38bdf8', '#f97316', '#a855f7', '#f472b6'];

export function DualTrackPanel() {
  const active = useAppStore((s) => s.active);
  const currentFrame = useAppStore((s) => s.currentFrame);
  const setFrame = useAppStore((s) => s.setFrame);

  const [metric, setMetric] = useState<Metric>('supplyProduced');

  const series = useMemo(() => {
    if (!active) return null;
    return computeTimeSeries(active.replay, 1);
  }, [active]);

  const { data, options, atCursor } = useMemo(() => {
    if (!series) return { data: null as AlignedData | null, options: null as Options | null, atCursor: [] as { name: string; value: number; color: string }[] };
    const ys: number[][] = series.players.map((p) => p[metric]);
    const data: AlignedData = [series.timeSeconds, ...ys];
    const options: Options = {
      width: 600,
      height: 260,
      padding: [8, 8, 24, 40],
      cursor: {
        // Syncing horizontal cursor across panels could come later; for now,
        // clicking jumps the main timeline to the cursor's x position.
        bind: {
          mouseup: (self, _target, handler) => (ev: MouseEvent) => {
            const x = self.posToVal(ev.offsetX, 'x');
            if (Number.isFinite(x)) setFrame(x * FRAMES_PER_SECOND);
            return handler(ev);
          },
        },
      },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: '#6b7280',
          grid: { stroke: 'rgba(107,114,128,0.15)' },
          values: (_u, ticks) => ticks.map((t) => formatMMSS(t)),
        },
        {
          stroke: '#6b7280',
          grid: { stroke: 'rgba(107,114,128,0.15)' },
        },
      ],
      series: [
        { label: 'time' },
        ...series.players.map((p, i) => ({
          label: cleanBwString(p.name),
          stroke: PLAYER_STROKES[i % PLAYER_STROKES.length],
          width: 1.5,
          points: { show: false },
        })),
      ],
    };

    const t = currentFrame / FRAMES_PER_SECOND;
    const idx = Math.max(0, Math.min(series.timeSeconds.length - 1, Math.floor(t)));
    const atCursor = series.players.map((p, i) => ({
      name: cleanBwString(p.name),
      value: p[metric][idx] ?? 0,
      color: PLAYER_STROKES[i % PLAYER_STROKES.length],
    }));
    return { data, options, atCursor };
  }, [series, metric, currentFrame, setFrame]);

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
          {data && options && <UPlotChart data={data} options={options} className="h-full w-full" />}
        </div>
      </div>
    </div>
  );
}
