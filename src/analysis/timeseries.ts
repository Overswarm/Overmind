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

// Resource estimation. BW replays are command streams — there is no
// authoritative mineral / gas series. These curves are a simulation:
//   balance(t) = start + Σ income(w, t) − Σ spend(e, t)
// where income uses nominal BW mining rates and a worker-allocation model that
// saturates gas (3 per extractor) first, then minerals (up to 16 per base).
// Over-saturation, unit deaths, cancels, and worker losses are not modeled,
// so the estimate drifts optimistic on games with heavy combat. The numbers
// are still useful for spotting sustained floats ("you sat on 1500 minerals
// for a minute") — which was the motivating coaching ask.
const MINERAL_RATE_PER_WORKER_PER_SEC = 0.8;   // ~48 minerals/min, avg close+far
const GAS_RATE_PER_WORKER_PER_SEC = 1.67;      // ~100 gas/min per gas worker
const GAS_WORKERS_PER_EXTRACTOR = 3;
const MINERAL_WORKERS_PER_BASE = 16;
const STARTING_MINERALS = 50;
const STARTING_GAS = 0;
const STARTING_WORKERS = 4;
const STARTING_BASES = 1;
const WORKER_TRAIN_FRAMES = 300;               // ~12.6s for SCV/Probe/Drone
// How long a gas extractor / town hall takes to come online. Matches
// CAP_PROVIDER_COMPLETION_FRAMES for the town halls.
const GAS_BUILDING_COMPLETION_FRAMES = 600;    // ~25s

const GAS_BUILDING_IDS = new Set<number>([0x6e, 0x95, 0x9d]);
// Brand-new town halls only — Lair (0x84) and Hive (0x85) morph an existing
// Hatchery, so they don't add another mineral line.
const NEW_TOWN_HALL_IDS = new Set<number>([0x6a, 0x9a, 0x83]);

// Supply cap from each provider (display units). Lair/Hive aren't here: the
// base Hatchery already counts and those morphs don't add more.
const CAP_PROVIDER_SUPPLY: Record<number, number> = {
  0x6a: 10, // Command Center
  0x6d: 8,  // Supply Depot
  0x9a: 9,  // Nexus
  0x9c: 8,  // Pylon
  0x83: 1,  // Hatchery
  0x2a: 8,  // Overlord (morphs from a Drone → shows up as a Train/Morph event)
};

// Construction / morph completion times in frames. Approximations good to
// ~1 second.
const CAP_PROVIDER_COMPLETION_FRAMES: Record<number, number> = {
  0x6a: 1800,
  0x6d: 960,
  0x9a: 1800,
  0x9c: 450,
  0x83: 1800,
  0x2a: 600,
};

// Everyone effectively starts at 9: Terran/Protoss from their CC/Nexus, Zerg
// from 1 (Hatch) + 8 (preplaced Overlord). Close enough for a chart.
const STARTING_SUPPLY_CAP = 9;

export interface PlayerSeries {
  playerID: number;
  name: string;
  // All arrays share the length of `timeSeconds` (the x axis).
  workersProduced: number[];
  supplyProduced: number[];
  supplyCap: number[];          // Supply cap from completed halls / depots / pylons / overlords / hatches
  armyValue: number[];          // Mineral + gas spent on non-building army units
  spent: number[];              // Cumulative mineral + gas committed to all units and buildings
  apm: number[];                // Rolling actions-per-minute (all commands)
  eapm: number[];               // Rolling effective-actions-per-minute (screp's isEffective filter)
  // Estimated live resource balance (see "Resource estimation" header comment).
  minerals: number[];
  gas: number[];
  // Per-minute mining rate at each tick (mineral/gas workers × nominal rate).
  mineralIncome: number[];
  gasIncome: number[];
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
      supplyCap: new Array(xs.length).fill(STARTING_SUPPLY_CAP),
      armyValue: new Array(xs.length).fill(0),
      spent: new Array(xs.length).fill(0),
      apm: new Array(xs.length).fill(0),
      eapm: new Array(xs.length).fill(0),
      minerals: new Array(xs.length).fill(0),
      gas: new Array(xs.length).fill(0),
      mineralIncome: new Array(xs.length).fill(0),
      gasIncome: new Array(xs.length).fill(0),
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

  // Supply cap: walk events a second time and bump cap at each provider's
  // completion frame. Done separately from the main loop so completion-offset
  // writes don't interleave with per-event production writes.
  for (const e of events) {
    if (e.unitID === undefined) continue;
    const cap = CAP_PROVIDER_SUPPLY[e.unitID];
    if (!cap) continue;
    const isBuilding = e.kind === 'build' || e.kind === 'buildingMorph';
    const isOverlord = (e.kind === 'train' || e.kind === 'morph') && e.unitID === 0x2a;
    if (!isBuilding && !isOverlord) continue;
    const s = seriesByPID.get(e.playerID);
    if (!s) continue;
    const completionFrame = e.frame + (CAP_PROVIDER_COMPLETION_FRAMES[e.unitID] ?? 0);
    const completionSec = completionFrame / fps;
    if (completionSec > totalSeconds) continue;
    const idx = Math.min(xs.length - 1, Math.floor(completionSec / stepSeconds));
    for (let i = idx; i < xs.length; i++) s.supplyCap[i] += cap;
  }

  for (const s of seriesByPID.values()) {
    ffill(s.workersProduced);
    ffill(s.supplyProduced);
    ffill(s.armyValue);
    ffill(s.spent);
    // supplyCap is already monotonic via direct writes, no ffill needed.
  }

  // ---- Resource estimation (minerals / gas / income) -----------------------
  // For each player, bucket worker-ready events, spend events, and gas/base
  // completions into the x-axis grid, then walk once to simulate balances.
  // We prefer to saturate gas (3 per extractor) before putting workers on
  // minerals, matching how most players run their economy once gas goes down.
  for (const p of players) {
    const s = seriesByPID.get(p.ID);
    if (!s) continue;
    const isZerg = (p.Race?.ShortName ?? '').toLowerCase().startsWith('z');

    const workerReady = new Int32Array(xs.length);
    const mineralSpend = new Float64Array(xs.length);
    const gasSpend = new Float64Array(xs.length);
    const gasOnline = new Int32Array(xs.length);
    const basesOnline = new Int32Array(xs.length);

    for (const e of events) {
      if (e.playerID !== p.ID) continue;
      const meta = e.unitID !== undefined ? unitMeta(e.unitID) : undefined;
      if (!meta) continue;
      const count = meta.perMorph ?? 1;
      const evIdx = Math.min(xs.length - 1, Math.floor(e.seconds / stepSeconds));
      if (e.kind === 'train' || e.kind === 'morph' || e.kind === 'build' || e.kind === 'buildingMorph') {
        mineralSpend[evIdx] += meta.mineral * count;
        gasSpend[evIdx] += meta.gas * count;
      }
      if ((e.kind === 'train' || e.kind === 'morph') && meta.isWorker) {
        // Workers only start mining once training completes; bump at that tick.
        const readySec = e.seconds + WORKER_TRAIN_FRAMES / fps;
        const ri = Math.min(xs.length - 1, Math.floor(readySec / stepSeconds));
        if (ri >= 0) workerReady[ri] += count;
      }
      if ((e.kind === 'build' || e.kind === 'buildingMorph') && e.unitID !== undefined) {
        // Zerg buildings morph from a Drone, so the drone is consumed the
        // moment the build order fires. Decrement workers immediately.
        if (isZerg && e.kind === 'build') {
          workerReady[evIdx] -= 1;
        }
        if (GAS_BUILDING_IDS.has(e.unitID)) {
          const readySec = e.seconds + GAS_BUILDING_COMPLETION_FRAMES / fps;
          const ri = Math.min(xs.length - 1, Math.floor(readySec / stepSeconds));
          if (ri >= 0 && readySec <= totalSeconds) gasOnline[ri] += 1;
        }
        if (NEW_TOWN_HALL_IDS.has(e.unitID)) {
          const readySec = e.seconds + (CAP_PROVIDER_COMPLETION_FRAMES[e.unitID] ?? 1800) / fps;
          const ri = Math.min(xs.length - 1, Math.floor(readySec / stepSeconds));
          if (ri >= 0 && readySec <= totalSeconds) basesOnline[ri] += 1;
        }
      }
    }

    let minerals = STARTING_MINERALS;
    let gas = STARTING_GAS;
    let workers = STARTING_WORKERS;
    let bases = STARTING_BASES;
    let extractors = 0;

    for (let i = 0; i < xs.length; i++) {
      workers += workerReady[i];
      if (workers < 0) workers = 0;
      bases += basesOnline[i];
      extractors += gasOnline[i];

      // Allocate: saturate gas first (up to 3 per extractor), then minerals
      // up to 16 per base. Anything beyond that is modeled as unproductive
      // (over-saturated minerals or unassigned workers).
      const gasCap = extractors * GAS_WORKERS_PER_EXTRACTOR;
      const gasW = Math.min(gasCap, workers);
      const mineralW = Math.min(Math.max(0, workers - gasW), bases * MINERAL_WORKERS_PER_BASE);

      const mineralIncomePerSec = mineralW * MINERAL_RATE_PER_WORKER_PER_SEC;
      const gasIncomePerSec = gasW * GAS_RATE_PER_WORKER_PER_SEC;

      minerals += mineralIncomePerSec * stepSeconds - mineralSpend[i];
      gas += gasIncomePerSec * stepSeconds - gasSpend[i];
      // Spends that outpace income in the same tick shouldn't push the
      // simulated balance negative — in-game, the player had to wait for the
      // next tick's income to afford it. Clamp at 0 to avoid scary dips.
      if (minerals < 0) minerals = 0;
      if (gas < 0) gas = 0;

      s.minerals[i] = Math.round(minerals);
      s.gas[i] = Math.round(gas);
      s.mineralIncome[i] = Math.round(mineralIncomePerSec * 60);
      s.gasIncome[i] = Math.round(gasIncomePerSec * 60);
    }
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
