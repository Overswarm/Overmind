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

interface Entry {
  hash: string;
  buildOrder?: BuildOrderEvent[];
  timeSeries?: DualTrackSeries;
  swings?: SwingMarker[];
  heatmaps?: Map<HeatmapMode, HeatmapGrid>;
  hotkeys?: HotkeyStats;
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
  if (!e.swings) e.swings = computeSwingMarkers(cachedBuildOrder(hash, replay));
  return e.swings;
}

export function cachedHotkeyStats(hash: string, replay: ParsedReplay): HotkeyStats {
  const e = entryFor(hash);
  if (!e.hotkeys) e.hotkeys = computeHotkeyStats(replay);
  return e.hotkeys;
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
