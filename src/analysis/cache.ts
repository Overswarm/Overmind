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
import { digestReplay, type ReplayDigest } from './aggregate';
import { detectMistakes, type PlayerCoaching } from './coaching';
import type { LibraryEntry } from '../storage/db';

interface Entry {
  hash: string;
  buildOrder?: BuildOrderEvent[];
  timeSeries?: DualTrackSeries;
  swings?: SwingMarker[];
  heatmaps?: Map<HeatmapMode, HeatmapGrid>;
  hotkeys?: HotkeyStats;
  supplyBlocks?: SupplyBlocks;
  productionIdle?: ProductionIdle;
  digest?: ReplayDigest;
  digestIdentityKey?: string;
  coaching?: PlayerCoaching[];
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

// Build a ReplayDigest for the currently-loaded replay without requiring a
// full LibraryEntry lookup. The panels only need the digest's in-memory shape
// (players, durations, timings); a partial entry is sufficient. `identities`
// is included in the cache key so toggling me-tags re-digests.
export function cachedDigest(
  hash: string,
  replay: ParsedReplay,
  name: string,
  identities: string[] = [],
  entryOverrides?: Partial<LibraryEntry>,
): ReplayDigest {
  const e = entryFor(hash);
  const key = identities.map((s) => s.trim().toLowerCase()).sort().join('|');
  if (!e.digest || e.digestIdentityKey !== key) {
    const stub: LibraryEntry = {
      hash,
      name,
      size: 0,
      addedAt: 0,
      ...entryOverrides,
    };
    e.digest = digestReplay(stub, replay, identities);
    e.digestIdentityKey = key;
    // Coaching depends on the digest — invalidate so it re-runs.
    e.coaching = undefined;
  }
  return e.digest;
}

export function cachedCoaching(
  hash: string,
  replay: ParsedReplay,
  name: string,
  identities: string[] = [],
  entryOverrides?: Partial<LibraryEntry>,
): PlayerCoaching[] {
  const e = entryFor(hash);
  const digest = cachedDigest(hash, replay, name, identities, entryOverrides);
  if (!e.coaching) {
    e.coaching = detectMistakes({
      digest,
      events: cachedBuildOrder(hash, replay),
      supplyBlocks: cachedSupplyBlocks(hash, replay),
      productionIdle: cachedProductionIdle(hash, replay),
    });
  }
  return e.coaching;
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
