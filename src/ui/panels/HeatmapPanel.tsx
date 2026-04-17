import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { cleanBwString } from '../../types/replay';
import { cachedHeatmap } from '../../analysis/cache';
import type { HeatmapMode } from '../../analysis/heatmap';

const PLAYER_COLORS: Array<[number, number, number]> = [
  [56, 189, 248],   // player A: sky
  [249, 115, 22],   // player B: orange
  [168, 85, 247],
  [244, 114, 182],
];

const MODE_LABELS: Record<HeatmapMode, string> = {
  all: 'All',
  combat: 'Combat',
  build: 'Build',
};

export function HeatmapPanel() {
  const active = useAppStore((s) => s.active);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<HeatmapMode>('all');

  const { grid, players, startLocations, minerals, geysers } = useMemo(() => {
    if (!active) return { grid: null, players: [], startLocations: [], minerals: [], geysers: [] };
    const grid = cachedHeatmap(active.hash, active.replay, mode);
    const nonObs = (active.replay.Header?.Players ?? []).filter((p) => !p.Observer);
    const players = nonObs.map((p, i) => ({ id: p.ID, name: cleanBwString(p.Name), colorIdx: i }));
    // Pair each start location with the player that spawned there. PlayerDescs
    // is the source of truth for start-location ownership (keyed by PlayerID);
    // fall back to unowned if we can't match.
    const descs = active.replay.Computed?.PlayerDescs ?? [];
    const startLocations = descs
      .map((d) => {
        const sl = d.StartLocation;
        if (!sl) return null;
        const idx = nonObs.findIndex((p) => p.ID === d.PlayerID);
        return { X: sl.X, Y: sl.Y, colorIdx: idx >= 0 ? idx : -1 };
      })
      .filter((v): v is { X: number; Y: number; colorIdx: number } => v !== null);
    const minerals = (active.replay.MapData?.MineralFields ?? [])
      .map((m) => m.Point)
      .filter((p): p is { X: number; Y: number } => !!p && typeof p.X === 'number' && typeof p.Y === 'number');
    const geysers = (active.replay.MapData?.Geysers ?? [])
      .map((g) => g.Point)
      .filter((p): p is { X: number; Y: number } => !!p && typeof p.X === 'number' && typeof p.Y === 'number');
    return { grid, players, startLocations, minerals, geysers };
  }, [active, mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Maintain map aspect ratio. grid.cols/rows describe logical cells; we
    // render the canvas at its actual element size and scale up via nearest-
    // neighbor for the crisp cell look.
    const { cols, rows, byPlayer, maxPerPlayer, mapPixelsX, mapPixelsY } = grid;
    const aspect = mapPixelsX / mapPixelsY;
    const host = canvas.parentElement;
    const hostW = host?.clientWidth ?? 400;
    const hostH = host?.clientHeight ?? 400;
    let w = hostW;
    let h = hostW / aspect;
    if (h > hostH) {
      h = hostH;
      w = hostH * aspect;
    }
    canvas.width = Math.floor(w * devicePixelRatio);
    canvas.height = Math.floor(h * devicePixelRatio);
    canvas.style.width = `${Math.floor(w)}px`;
    canvas.style.height = `${Math.floor(h)}px`;

    // Dark background.
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Render each player's grid as a translucent additive overlay. Using an
    // ImageData of size cols x rows then drawImage-scaling gives a pixel-art
    // style that matches the coarse spatial resolution of the data.
    const img = ctx.createImageData(cols, rows);
    for (const { id, colorIdx } of players) {
      const g = byPlayer.get(id);
      if (!g) continue;
      const max = maxPerPlayer.get(id) ?? 1;
      const [r, gC, b] = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length];
      for (let i = 0; i < g.length; i++) {
        const v = g[i];
        if (v === 0) continue;
        const t = Math.min(1, Math.sqrt(v / max)); // sqrt softens hotspots.
        const off = i * 4;
        img.data[off] = Math.min(255, img.data[off] + r * t);
        img.data[off + 1] = Math.min(255, img.data[off + 1] + gC * t);
        img.data[off + 2] = Math.min(255, img.data[off + 2] + b * t);
        img.data[off + 3] = Math.min(255, img.data[off + 3] + Math.floor(200 * t));
      }
    }
    // Blit via an offscreen canvas so we can scale without smoothing.
    const off = document.createElement('canvas');
    off.width = cols;
    off.height = rows;
    off.getContext('2d')?.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

    const toCanvas = (pt: { X: number; Y: number }) => ({
      x: (pt.X / mapPixelsX) * canvas.width,
      y: (pt.Y / mapPixelsY) * canvas.height,
    });

    // Mineral fields: small cyan squares. Drawn before start rings so rings
    // sit on top if a base overlaps its minerals.
    ctx.fillStyle = 'rgba(125, 211, 252, 0.8)';
    for (const m of minerals) {
      const { x, y } = toCanvas(m);
      const s = 2 * devicePixelRatio;
      ctx.fillRect(x - s, y - s, s * 2, s * 2);
    }
    // Geysers: slightly larger green diamonds.
    ctx.fillStyle = 'rgba(74, 222, 128, 0.9)';
    for (const g of geysers) {
      const { x, y } = toCanvas(g);
      const s = 3 * devicePixelRatio;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.closePath();
      ctx.fill();
    }
    // Start locations: ring colored by the player spawning there so you can
    // see which side the hotspots belong to. Unowned fallback renders white.
    for (const sl of startLocations) {
      const { x, y } = toCanvas(sl);
      const color =
        sl.colorIdx >= 0
          ? PLAYER_COLORS[sl.colorIdx % PLAYER_COLORS.length]
          : [255, 255, 255];
      ctx.beginPath();
      ctx.arc(x, y, 7 * devicePixelRatio, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${color.join(',')},0.9)`;
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.stroke();
    }
  }, [grid, players, startLocations, minerals, geysers]);

  if (!active) return null;

  return (
    <div className="flex h-full flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Activity heatmap
        </div>
        <div className="flex gap-1">
          {(Object.keys(MODE_LABELS) as HeatmapMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                mode === m
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text-h)]'
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3 px-3 py-1 text-[10px] text-[var(--color-muted)]">
        {players.map((p) => (
          <div key={p.id} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{
                background: `rgb(${PLAYER_COLORS[p.colorIdx % PLAYER_COLORS.length].join(',')})`,
              }}
            />
            <span className="truncate text-[var(--color-text-h)]">{p.name}</span>
          </div>
        ))}
        <span className="ml-auto italic">
          {mode === 'all'
            ? 'all positional commands'
            : mode === 'combat'
              ? 'move / attack / right-click'
              : 'building placement only'}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
