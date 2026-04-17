// 2D heat grid of where each player's commands happened on the map. Many BW
// commands (Right Click, Build, Targeted Order, Attack Move) carry a Pos
// { X, Y } in the replay; aggregating these gives a rough "where did this
// player spend attention" map.
//
// Caveats:
//   - We don't distinguish command types here (yet). It's all positional
//     activity. A dedicated "build footprint" view would need to filter by
//     Build / BuildingMorph.
//   - Scouting right-clicks on the enemy base inflate those cells, which is
//     informative but not the same as "units were here".

import type { ParsedReplay, ReplayCommand } from '../types/replay';
import { isEffective, TYPE_NAMES } from './commands';

export interface HeatmapGrid {
  cols: number;
  rows: number;
  mapPixelsX: number;    // Map extent in BW pixel units.
  mapPixelsY: number;
  // Flat row-major arrays of counts per player.
  byPlayer: Map<number, Float32Array>;
  maxPerPlayer: Map<number, number>;
}

export type HeatmapMode = 'all' | 'build' | 'combat';

export interface HeatmapOptions {
  mode?: HeatmapMode;
  // Grid resolution in cells per axis. BW maps go up to 256 tiles wide;
  // 64 cells makes each cell ~4 tiles square on a typical 128-tile map.
  resolution?: number;
}

const COMBAT_TYPE_NAMES = new Set<string>([
  'Right Click',
  'Targeted Order',
  'Attack Move',
  'Move',
]);

const BUILD_TYPE_NAMES = new Set<string>([
  TYPE_NAMES.build,
  TYPE_NAMES.buildingMorph,
]);

// BW's replay format stores positions in different units per command. Most
// positional commands (Right Click, Targeted Order, minimap pings, etc.)
// record pixel coordinates (0 .. mapTiles*32). The Build command, however,
// records tile coordinates (0 .. mapTiles) because buildings snap to tile
// boundaries. screp reads both as raw uint16 without conversion, so we
// re-scale build positions up here; otherwise they collapse into the top-left
// corner of the heatmap.
const TILE_COORD_TYPE_NAMES = new Set<string>([TYPE_NAMES.build]);
const PIXELS_PER_TILE = 32;

function getPos(cmd: ReplayCommand): { X: number; Y: number } | undefined {
  const p = cmd.Pos as { X?: number; Y?: number } | undefined;
  if (!p || typeof p.X !== 'number' || typeof p.Y !== 'number') return undefined;
  const inTiles = TILE_COORD_TYPE_NAMES.has(cmd.Type?.Name ?? '');
  const scale = inTiles ? PIXELS_PER_TILE : 1;
  return { X: p.X * scale, Y: p.Y * scale };
}

export function computeHeatmap(replay: ParsedReplay, opts: HeatmapOptions = {}): HeatmapGrid {
  const { mode = 'all', resolution = 64 } = opts;
  const cols = resolution;
  const rows = resolution;

  // Map dimensions in BW pixels: MapWidth/Height are tile counts (32 px/tile).
  const mapPixelsX = Math.max(1, (replay.Header?.MapWidth ?? 128) * 32);
  const mapPixelsY = Math.max(1, (replay.Header?.MapHeight ?? 128) * 32);

  const byPlayer = new Map<number, Float32Array>();
  const maxPerPlayer = new Map<number, number>();

  const cmds = replay.Commands?.Cmds ?? [];
  for (const c of cmds) {
    if (!isEffective(c)) continue;
    const tn = c.Type?.Name;
    if (!tn) continue;
    if (mode === 'build' && !BUILD_TYPE_NAMES.has(tn)) continue;
    if (mode === 'combat' && !COMBAT_TYPE_NAMES.has(tn)) continue;

    const pos = getPos(c);
    if (!pos) continue;

    const col = clamp(Math.floor((pos.X / mapPixelsX) * cols), 0, cols - 1);
    const row = clamp(Math.floor((pos.Y / mapPixelsY) * rows), 0, rows - 1);
    const idx = row * cols + col;

    let grid = byPlayer.get(c.PlayerID);
    if (!grid) {
      grid = new Float32Array(cols * rows);
      byPlayer.set(c.PlayerID, grid);
    }
    grid[idx] += 1;
    const cur = maxPerPlayer.get(c.PlayerID) ?? 0;
    if (grid[idx] > cur) maxPerPlayer.set(c.PlayerID, grid[idx]);
  }

  return { cols, rows, mapPixelsX, mapPixelsY, byPlayer, maxPerPlayer };
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}
