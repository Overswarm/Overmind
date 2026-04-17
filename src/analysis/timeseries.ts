// Production-based time-series per player. Derived from the already-filtered
// build-order events (not raw commands) so the same spam-removal logic that
// fixes the build-order panel also applies here. These are "produced-so-far"
// quantities (monotonically non-decreasing) — deaths aren't tracked yet.

import type { ParsedReplay } from '../types/replay';
import type { BuildOrderEvent } from './buildOrder';
import { unitMeta } from './units';

export interface PlayerSeries {
  playerID: number;
  name: string;
  // All arrays share the length of `timeSeconds` (the x axis).
  workersProduced: number[];
  supplyProduced: number[];
  armyValue: number[];          // Mineral + gas spent on non-building army units
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
    });
  }

  const cumWorkers = new Map<number, number>();
  const cumSupply = new Map<number, number>();
  const cumArmy = new Map<number, number>();

  for (const e of events) {
    if (e.kind !== 'train' && e.kind !== 'morph') continue;
    const s = seriesByPID.get(e.playerID);
    if (!s) continue;
    const meta = e.unitID !== undefined ? unitMeta(e.unitID) : undefined;
    if (!meta) continue;
    const count = meta.perMorph ?? 1;

    const idx = Math.min(xs.length - 1, Math.floor(e.seconds / stepSeconds));

    if (meta.isWorker) {
      cumWorkers.set(e.playerID, (cumWorkers.get(e.playerID) ?? 0) + count);
      s.workersProduced[idx] = cumWorkers.get(e.playerID)!;
    }
    cumSupply.set(e.playerID, (cumSupply.get(e.playerID) ?? 0) + meta.supply * count);
    s.supplyProduced[idx] = cumSupply.get(e.playerID)!;

    if (meta.isArmy) {
      cumArmy.set(e.playerID, (cumArmy.get(e.playerID) ?? 0) + (meta.mineral + meta.gas) * count);
      s.armyValue[idx] = cumArmy.get(e.playerID)!;
    }
  }

  for (const s of seriesByPID.values()) {
    ffill(s.workersProduced);
    ffill(s.supplyProduced);
    ffill(s.armyValue);
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
