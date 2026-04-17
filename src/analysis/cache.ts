// Shared per-replay derived-analysis cache. Several panels want the same
// build-order / timeseries output, and recomputing them on every render (or
// every scrub) is wasteful. Keyed by replay hash so the cache invalidates
// automatically when a different replay loads.

import type { ParsedReplay } from '../types/replay';
import { computeBuildOrder, type BuildOrderEvent } from './buildOrder';
import { computeTimeSeries, type DualTrackSeries } from './timeseries';
import { computeSwingMarkers, type SwingMarker } from './swings';
import { computeHeatmap, type HeatmapGrid, type HeatmapMode } from './heatmap';
import { computeHotkeyStats, type HotkeyStats } from './hotkeys';
import { computeSupplyBlocks, type SupplyBlocks } from './supplyBlocks';
import { computeProductionIdle, type ProductionIdle } from './productionIdle';

interface Entry {
  hash: string;
  buildOrder?: BuildOrderEvent[];
  timeSeries?: DualTrackSeries;
  swings?: SwingMarker[];
  heatmaps?: Map<HeatmapMode, HeatmapGrid>;
  hotkeys?: HotkeyStats;
  supplyBlocks?: SupplyBlocks;
  productionIdle?: ProductionIdle;
}

// LRU-1: BW replays are large and there's only one active one at a time, so a
// single-entry cache is sufficient and keeps memory bounded.
let current: Entry | null = null;

function entryFor(hash: string): Entry {
  if (current?.hash === hash) return current;
  current = { hash };
  return current;
}

export function cachedBuildOrder(hash: string, replay: ParsedReplay): BuildOrderEvent[] {
  const e = entryFor(hash);
  if (!e.buildOrder) e.buildOrder = computeBuildOrder(replay);
  return e.buildOrder;
}

export function cachedTimeSeries(hash: string, replay: ParsedReplay, stepSeconds = 1): DualTrackSeries {
  const e = entryFor(hash);
  if (!e.timeSeries) e.timeSeries = computeTimeSeries(replay, cachedBuildOrder(hash, replay), stepSeconds);
  return e.timeSeries;
}

export function cachedSwings(hash: string, replay: ParsedReplay): SwingMarker[] {
  const e = entryFor(hash);
  if (!e.swings) e.swings = computeSwingMarkers(cachedBuildOrder(hash, replay), replay);
  return e.swings;
}

export function cachedHotkeyStats(hash: string, replay: ParsedReplay): HotkeyStats {
  const e = entryFor(hash);
  if (!e.hotkeys) e.hotkeys = computeHotkeyStats(replay);
  return e.hotkeys;
}

export function cachedSupplyBlocks(hash: string, replay: ParsedReplay): SupplyBlocks {
  const e = entryFor(hash);
  if (!e.supplyBlocks) {
    const events = cachedBuildOrder(hash, replay);
    const pids = (replay.Header?.Players ?? []).filter((p) => !p.Observer).map((p) => p.ID);
    const total = replay.Header?.Frames ?? 0;
    e.supplyBlocks = computeSupplyBlocks(events, pids, total);
  }
  return e.supplyBlocks;
}

export function cachedProductionIdle(hash: string, replay: ParsedReplay): ProductionIdle {
  const e = entryFor(hash);
  if (!e.productionIdle) {
    const events = cachedBuildOrder(hash, replay);
    const pids = (replay.Header?.Players ?? []).filter((p) => !p.Observer).map((p) => p.ID);
    const total = replay.Header?.Frames ?? 0;
    e.productionIdle = computeProductionIdle(events, pids, total);
  }
  return e.productionIdle;
}

export function cachedHeatmap(hash: string, replay: ParsedReplay, mode: HeatmapMode): HeatmapGrid {
  const e = entryFor(hash);
  if (!e.heatmaps) e.heatmaps = new Map<HeatmapMode, HeatmapGrid>();
  let g = e.heatmaps.get(mode);
  if (!g) {
    g = computeHeatmap(replay, { mode });
    e.heatmaps.set(mode, g);
  }
  return g;
}
