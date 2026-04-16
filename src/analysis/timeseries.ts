// Production-based time-series per player. Derived purely from commands, so
// these are "produced-so-far" quantities (monotonically non-decreasing) —
// deaths aren't tracked yet. Used by the dual-track chart.
//
// We sample at a fixed cadence (default: 1 second) and forward-fill cumulative
// counts from the most recent Train/UnitMorph/Build command.

import type { ParsedReplay } from '../types/replay';
import { cmdUnit, isEffective, TYPE_NAMES } from './commands';
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

export function computeTimeSeries(replay: ParsedReplay, stepSeconds = 1): DualTrackSeries {
  const players = (replay.Header?.Players ?? []).filter((p) => !p.Observer);
  const totalFrames = replay.Header?.Frames ?? 0;
  const fps = 1000 / 42;
  const totalSeconds = totalFrames / fps;

  // Build x axis: 0, step, 2*step, ..., totalSeconds.
  const xs: number[] = [];
  for (let t = 0; t <= totalSeconds + 1e-6; t += stepSeconds) xs.push(Number(t.toFixed(3)));

  // Prepare per-player accumulators.
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

  // Walk commands, writing cumulative values into the sample closest to each
  // event's timestamp (nearest-sample on the floor). We then forward-fill.
  const cmds = replay.Commands?.Cmds ?? [];
  const cumWorkers = new Map<number, number>();
  const cumSupply = new Map<number, number>();
  const cumArmy = new Map<number, number>();

  for (const c of cmds) {
    const tn = c.Type?.Name;
    if (!tn) continue;
    if (tn !== TYPE_NAMES.train && tn !== TYPE_NAMES.unitMorph) continue;
    if (!isEffective(c)) continue;

    const pid = c.PlayerID;
    const s = seriesByPID.get(pid);
    if (!s) continue;
    const u = cmdUnit(c);
    const meta = u ? unitMeta(u.ID) : undefined;
    if (!meta) continue;
    const count = meta.perMorph ?? 1;

    const t = c.Frame / fps;
    const idx = Math.min(xs.length - 1, Math.floor(t / stepSeconds));

    if (meta.isWorker) {
      cumWorkers.set(pid, (cumWorkers.get(pid) ?? 0) + count);
      s.workersProduced[idx] = cumWorkers.get(pid)!;
    }
    cumSupply.set(pid, (cumSupply.get(pid) ?? 0) + meta.supply * count);
    s.supplyProduced[idx] = cumSupply.get(pid)!;

    if (meta.isArmy) {
      cumArmy.set(pid, (cumArmy.get(pid) ?? 0) + (meta.mineral + meta.gas) * count);
      s.armyValue[idx] = cumArmy.get(pid)!;
    }
  }

  // Forward-fill so gaps between events show the last known cumulative value.
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
