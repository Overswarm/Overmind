import { useEffect, useMemo, useRef, useState } from 'react';
import type { AlignedData, Options } from 'uplot';
import type uPlot from 'uplot';
import { useAppStore } from '../../state/store';
import { useSettingsStore } from '../../state/settings';
import { cachedBuildOrder, cachedTimeSeries } from '../../analysis/cache';
import { cleanBwString, FRAMES_PER_SECOND, formatMMSS } from '../../types/replay';
import { UPlotChart } from '../UPlotChart';
import {
  PLAYER_SLOT_FALLBACKS,
  PLAYER_SLOT_VARS,
  playerSlotMap,
} from '../playerColor';

type Metric = 'workersProduced' | 'supplyProduced' | 'supplyCap' | 'armyValue' | 'spent' | 'apm' | 'eapm';

interface UpgradeTick {
  seconds: number;
  name: string;
  playerID: number;
  playerName: string;
  kind: 'tech' | 'upgrade';
}

const METRIC_LABELS: Record<Metric, string> = {
  workersProduced: 'Workers produced',
  supplyProduced: 'Supply produced',
  supplyCap: 'Supply cap',
  armyValue: 'Army value (min+gas)',
  spent: 'Total resources spent (min+gas)',
  apm: 'APM (rolling 30s)',
  eapm: 'EAPM (rolling 30s)',
};

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function slotColor(slot: number): string {
  return cssVar(
    PLAYER_SLOT_VARS[slot % PLAYER_SLOT_VARS.length],
    PLAYER_SLOT_FALLBACKS[slot % PLAYER_SLOT_FALLBACKS.length],
  );
}

export function DualTrackPanel() {
  const active = useAppStore((s) => s.active);
  const currentFrame = useAppStore((s) => s.currentFrame);
  const setFrame = useAppStore((s) => s.setFrame);
  const setHoverFrame = useAppStore((s) => s.setHoverFrame);

  const [metric, setMetric] = useState<Metric>('supplyProduced');
  // Subscribing to theme forces the memo below to recompute colors on change.
  const theme = useSettingsStore((s) => s.theme);
  const identities = useSettingsStore((s) => s.identities);

  // uPlot instance + current playhead (in seconds). The draw hook reads from
  // `playheadRef` every paint, and we call `redraw` whenever currentFrame
  // changes so the overlay follows the main timeline during playback.
  const uplotRef = useRef<uPlot | null>(null);
  const playheadRef = useRef(0);
  playheadRef.current = currentFrame / FRAMES_PER_SECOND;

  const series = useMemo(() => {
    if (!active) return null;
    return cachedTimeSeries(active.hash, active.replay, 1);
  }, [active]);

  // Player slot map — identity-based pinning, falls through to replay order.
  const slots = useMemo(
    () => playerSlotMap(active?.replay.Header?.Players, identities),
    [active, identities],
  );

  // Tech and upgrade events to paint along the top of the chart. Kept in a
  // ref so the draw hook can read the latest list without rebuilding uPlot.
  const upgradeTicks = useMemo<UpgradeTick[]>(() => {
    if (!active) return [];
    const names: Record<number, string> = {};
    for (const p of active.replay.Header?.Players ?? []) names[p.ID] = cleanBwString(p.Name);
    return cachedBuildOrder(active.hash, active.replay)
      .filter((e) => e.kind === 'tech' || e.kind === 'upgrade')
      .map((e) => ({
        seconds: e.seconds,
        name: e.name,
        playerID: e.playerID,
        playerName: names[e.playerID] ?? `P${e.playerID}`,
        kind: e.kind as 'tech' | 'upgrade',
      }));
  }, [active]);
  const upgradeTicksRef = useRef<UpgradeTick[]>(upgradeTicks);
  upgradeTicksRef.current = upgradeTicks;
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  // Hover-snapping tooltip for tech/upgrade markers. Populated by the uPlot
  // cursor hook below; cleared when the cursor isn't near any tick.
  const [hoverTip, setHoverTip] = useState<{
    xPx: number;
    ticks: UpgradeTick[];
  } | null>(null);
  const chartWrapRef = useRef<HTMLDivElement>(null);

  const { data, options, atCursor } = useMemo(() => {
    if (!series) return { data: null as AlignedData | null, options: null as Options | null, atCursor: [] as { name: string; value: number; color: string }[] };
    const ys: number[][] = series.players.map((p) => p[metric]);
    const data: AlignedData = [series.timeSeconds, ...ys];
    // The panel renders its own cursor readout above the chart (see atCursor
    // below), so disable uPlot's built-in legend — it renders outside the
    // plot area and was getting clipped by the next grid row.
    const axisStroke = cssVar('--color-chart-axis', '#6b7280');
    const gridStroke = cssVar('--color-chart-grid', 'rgba(107,114,128,0.18)');
    const playheadStroke = cssVar('--color-accent', '#f97316');
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
              setHoverTip((prev) => (prev === null ? prev : null));
              return;
            }
            const t = self.data[0]?.[idx];
            if (typeof t === 'number') setHoverFrame(t * FRAMES_PER_SECOND);

            // Snap a tooltip to any tech/upgrade tick within HIT_PX of the
            // cursor. If multiple land in the window, show them stacked.
            const HIT_PX = 10;
            const cursorLeft = self.cursor.left ?? -1;
            if (cursorLeft < 0) {
              setHoverTip((prev) => (prev === null ? prev : null));
              return;
            }
            const near: UpgradeTick[] = [];
            for (const tk of upgradeTicksRef.current) {
              const xp = self.valToPos(tk.seconds, 'x');
              if (Math.abs(xp - cursorLeft) <= HIT_PX) near.push(tk);
            }
            if (near.length === 0) {
              setHoverTip((prev) => (prev === null ? prev : null));
              return;
            }
            const wrap = chartWrapRef.current;
            if (!wrap) return;
            const overRect = self.over.getBoundingClientRect();
            const wrapRect = wrap.getBoundingClientRect();
            // Centroid of the matched ticks so the bubble anchors between
            // clustered markers rather than flipping between them.
            const avgSec = near.reduce((s, tk) => s + tk.seconds, 0) / near.length;
            const xPx = overRect.left - wrapRect.left + self.valToPos(avgSec, 'x');
            setHoverTip((prev) => {
              if (
                prev &&
                prev.ticks.length === near.length &&
                Math.abs(prev.xPx - xPx) < 1 &&
                prev.ticks.every((pt, i) => pt.seconds === near[i].seconds && pt.name === near[i].name)
              ) {
                return prev;
              }
              return { xPx, ticks: near };
            });
          },
        ],
        // Paint the playhead + tech/upgrade overlay last so they draw on top
        // of the series. Read from refs every frame so updates don't require
        // rebuilding options (UPlotChart only consumes them at mount).
        draw: [
          (u) => {
            const ctx = u.ctx;
            const top = u.bbox.top;
            const height = u.bbox.height;

            // Tech / upgrade ticks: tiny colored triangle at the top of the
            // plot area, pointing down. Colored by the player's pinned slot.
            // Canvas is sized at devicePixelRatio, so scale the marker size
            // up accordingly — otherwise the triangles look tiny on retina.
            const ticks = upgradeTicksRef.current;
            const slotMap = slotsRef.current;
            if (ticks.length > 0) {
              const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
              const size = 5 * dpr;
              for (const t of ticks) {
                const slot = slotMap.get(t.playerID) ?? 0;
                const tx = Math.round(u.valToPos(t.seconds, 'x', true));
                ctx.save();
                ctx.fillStyle = slotColor(slot);
                ctx.globalAlpha = 0.9;
                ctx.beginPath();
                ctx.moveTo(tx - size, top);
                ctx.lineTo(tx + size, top);
                ctx.lineTo(tx, top + size * 1.6);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
              }
            }

            // Playhead line.
            const seconds = playheadRef.current;
            if (!Number.isFinite(seconds)) return;
            const x = Math.round(u.valToPos(seconds, 'x', true)) + 0.5;
            ctx.save();
            ctx.strokeStyle = playheadStroke;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, top + height);
            ctx.stroke();
            ctx.restore();
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
          stroke: slotColor(slots.get(p.playerID) ?? i),
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
      color: slotColor(slots.get(p.playerID) ?? i),
    }));
    return { data, options, atCursor };
    // `theme` is intentionally a dep so colors refresh when the user cycles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, metric, currentFrame, setFrame, setHoverFrame, theme, slots]);

  // Trigger a uPlot redraw each time the playhead moves so the draw hook
  // above re-paints. `redraw(false, false)` skips path/axis rebuild — it's
  // cheap enough to run every tick during playback.
  useEffect(() => {
    uplotRef.current?.redraw(false, false);
  }, [currentFrame]);

  if (!active) return null;

  return (
    <div className="theme-panel flex h-full flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
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
        <div ref={chartWrapRef} className="relative min-h-0 flex-1">
          {data && options && (
            <UPlotChart
              // Rebuild the plot when theme, replay, or slot mapping change.
              // Stroke colors are set at construction and setData doesn't
              // update them — remounting is the clean fix.
              key={`${theme}::${active.hash}::${Array.from(slots.entries()).map(([k, v]) => `${k}:${v}`).join('|')}`}
              data={data}
              options={options}
              className="h-full w-full"
              onInit={(u) => {
                uplotRef.current = u;
              }}
            />
          )}
          {hoverTip && (
            <div
              role="tooltip"
              className="pointer-events-none absolute top-1 z-20 -translate-x-1/2 whitespace-nowrap rounded border border-[var(--color-border)] bg-[var(--color-bg-panel)] px-2 py-1 text-[10px] leading-tight shadow-lg"
              style={{ left: `${hoverTip.xPx}px` }}
            >
              {hoverTip.ticks.map((tk, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: slotColor(slots.get(tk.playerID) ?? 0) }}
                  />
                  <span className="font-mono tabular-nums text-[var(--color-muted)]">
                    {formatMMSS(tk.seconds)}
                  </span>
                  <span className="text-[var(--color-text-h)]">{tk.name}</span>
                  <span className="text-[var(--color-muted)]">· {tk.playerName}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
