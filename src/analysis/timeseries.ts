// Production-based time-series per player. Derived from the already-filtered
// build-order events (not raw commands) so the same spam-removal logic that
// fixes the build-order panel also applies here. These are "produced-so-far"
// quantities (monotonically non-decreasing) — deaths aren't tracked yet.
//
// APM / EAPM series are also computed here: they walk the raw command array
// (not the build-order filter) and report rolling-window actions-per-minute
// over a 30-second trailing window, sampled at the same x-axis ticks.

import type { ParsedReplay } from '../types/replay';
import type { BuildOrderEvent } from './buildOrder';
import { isEffective } from './commands';
import { unitMeta } from './units';

// Trailing window used for the rolling APM/EAPM time series. 30 seconds is
// short enough that fight spikes stay visible but long enough to smooth out
// the frame-by-frame noise that makes raw commands-per-second unreadable.
const APM_WINDOW_SECONDS = 30;

export interface PlayerSeries {
  playerID: number;
  name: string;
  // All arrays share the length of `timeSeconds` (the x axis).
  workersProduced: number[];
  supplyProduced: number[];
  armyValue: number[];          // Mineral + gas spent on non-building army units
  spent: number[];              // Cumulative mineral + gas committed to all units and buildings
  apm: number[];                // Rolling actions-per-minute (all commands)
  eapm: number[];               // Rolling effective-actions-per-minute (screp's isEffective filter)
}

export interface DualTrackSeries {
  timeSeconds: number[];        // Shared x axis
  players: PlayerSeries[];
}

export function computeTimeSeries(
  replay: ParsedReplay,
  events: BuildOrderEvent[],
  stepSeconds = 1,
): DualTrackSeries {
  const players = (replay.Header?.Players ?? []).filter((p) => !p.Observer);
  const totalFrames = replay.Header?.Frames ?? 0;
  const fps = 1000 / 42;
  const totalSeconds = totalFrames / fps;

  // Build x axis: 0, step, 2*step, ..., totalSeconds.
  const xs: number[] = [];
  for (let t = 0; t <= totalSeconds + 1e-6; t += stepSeconds) xs.push(Number(t.toFixed(3)));

  const seriesByPID = new Map<number, PlayerSeries>();
  for (const p of players) {
    seriesByPID.set(p.ID, {
      playerID: p.ID,
      name: p.Name,
      workersProduced: new Array(xs.length).fill(0),
      supplyProduced: new Array(xs.length).fill(0),
      armyValue: new Array(xs.length).fill(0),
      spent: new Array(xs.length).fill(0),
      apm: new Array(xs.length).fill(0),
      eapm: new Array(xs.length).fill(0),
    });
  }

  const cumWorkers = new Map<number, number>();
  const cumSupply = new Map<number, number>();
  const cumArmy = new Map<number, number>();
  const cumSpent = new Map<number, number>();

  for (const e of events) {
    const s = seriesByPID.get(e.playerID);
    if (!s) continue;
    const meta = e.unitID !== undefined ? unitMeta(e.unitID) : undefined;
    if (!meta) continue;
    const count = meta.perMorph ?? 1;

    const idx = Math.min(xs.length - 1, Math.floor(e.seconds / stepSeconds));

    // Spend applies to all productions: trains, morphs, and buildings. Tech
    // and upgrade costs aren't in the unit table, so they're excluded — fine
    // as a first approximation since most resources go to units/buildings.
    if (e.kind === 'train' || e.kind === 'morph' || e.kind === 'build' || e.kind === 'buildingMorph') {
      cumSpent.set(e.playerID, (cumSpent.get(e.playerID) ?? 0) + (meta.mineral + meta.gas) * count);
      s.spent[idx] = cumSpent.get(e.playerID)!;
    }

    if (e.kind !== 'train' && e.kind !== 'morph') continue;

    if (meta.isWorker) {
      cumWorkers.set(e.playerID, (cumWorkers.get(e.playerID) ?? 0) + count);
      s.workersProduced[idx] = cumWorkers.get(e.playerID)!;
    }
    cumSupply.set(e.playerID, (cumSupply.get(e.playerID) ?? 0) + meta.supply * count);
    s.supplyProduced[idx] = cumSupply.get(e.playerID)!;

    // Army value: mobile, non-worker combat units only. Explicitly excludes
    // defensive buildings like Photon Cannons, Sunkens, and Bunkers even if
    // future table edits flag them as army — those belong in "spent" instead.
    if (meta.isArmy && !meta.isBuilding && !meta.isWorker) {
      cumArmy.set(e.playerID, (cumArmy.get(e.playerID) ?? 0) + (meta.mineral + meta.gas) * count);
      s.armyValue[idx] = cumArmy.get(e.playerID)!;
    }
  }

  for (const s of seriesByPID.values()) {
    ffill(s.workersProduced);
    ffill(s.supplyProduced);
    ffill(s.armyValue);
    ffill(s.spent);
  }

  // APM / EAPM: scan the raw command array once, bucket per-player per-second
  // counts, then convert to rolling actions-per-minute at each x-axis tick.
  // Bucketing first (O(commands) + O(ticks)) is cheaper than scanning the
  // command list for every tick, even on 15+ minute replays with 20k+ cmds.
  const cmds = replay.Commands?.Cmds ?? [];
  const bucketsByPID = new Map<number, { all: Int32Array; eff: Int32Array }>();
  for (const p of players) {
    bucketsByPID.set(p.ID, {
      all: new Int32Array(xs.length),
      eff: new Int32Array(xs.length),
    });
  }
  for (const c of cmds) {
    const b = bucketsByPID.get(c.PlayerID);
    if (!b) continue;
    const sec = c.Frame / fps;
    const idx = Math.min(xs.length - 1, Math.floor(sec / stepSeconds));
    if (idx < 0) continue;
    b.all[idx]++;
    if (isEffective(c)) b.eff[idx]++;
  }

  const windowTicks = Math.max(1, Math.round(APM_WINDOW_SECONDS / stepSeconds));
  const perMinuteScale = 60 / APM_WINDOW_SECONDS;
  for (const p of players) {
    const s = seriesByPID.get(p.ID);
    const b = bucketsByPID.get(p.ID);
    if (!s || !b) continue;
    let sumAll = 0;
    let sumEff = 0;
    for (let i = 0; i < xs.length; i++) {
      sumAll += b.all[i];
      sumEff += b.eff[i];
      if (i >= windowTicks) {
        sumAll -= b.all[i - windowTicks];
        sumEff -= b.eff[i - windowTicks];
      }
      // Normalize short early windows so the first seconds of the replay
      // aren't an artificial spike or flatline — always report cmds/min for
      // the elapsed portion of the window.
      const spanTicks = Math.min(i + 1, windowTicks);
      const spanScale = 60 / (spanTicks * stepSeconds);
      s.apm[i] = i + 1 < windowTicks ? sumAll * spanScale : sumAll * perMinuteScale;
      s.eapm[i] = i + 1 < windowTicks ? sumEff * spanScale : sumEff * perMinuteScale;
    }
  }

  return {
    timeSeconds: xs,
    players: [...seriesByPID.values()],
  };
}

function ffill(arr: number[]): void {
  let last = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === 0 && i > 0) arr[i] = last;
    else last = arr[i];
  }
}
