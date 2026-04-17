// Supply-block detection. Walks the build-order events to model, per second,
// each player's supply USED (produced units × supply cost) and supply CAP
// (from completed halls, depots, pylons, overlords). An interval where used
// meets or exceeds cap for more than MIN_BLOCK_SECONDS is a "block".
//
// Caveats:
//   - We don't track unit deaths, so "used" is the total ever produced. This
//     over-estimates late-game supply load; blocks past the first army trade
//     can be false positives. Early-game, where supply blocks actually hurt,
//     the approximation is close.
//   - Supply providers come online after a fixed construction delay per type;
//     see PROVIDER_COMPLETION_FRAMES. Lair/Hive upgrades add 0 cap — only
//     the original Hatchery grants +1 — so we don't double-count the morph.
//   - Each player effectively starts at 9 cap: Protoss (Nexus=9), Terran
//     (CC=10, minus a worker buffer we ignore), Zerg (Hatchery=1 plus the
//     preplaced Overlord=8). Good enough for a block detector.

import type { BuildOrderEvent } from './buildOrder';
import { unitMeta } from './units';

export interface SupplyBlockInterval {
  playerID: number;
  startFrame: number;
  endFrame: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export interface SupplyBlocks {
  intervals: SupplyBlockInterval[];
  totalSecondsByPID: Map<number, number>;
}

const FRAMES_PER_SECOND = 1000 / 42;
const MIN_BLOCK_SECONDS = 3;

// Supply contributed by each provider (display units). Not all providers are
// additive with their predecessors — Lair/Hive upgrades in particular give 0
// extra because the underlying Hatchery already counts.
const PROVIDER_SUPPLY: Record<number, number> = {
  0x6a: 10,  // Command Center
  0x6d: 8,   // Supply Depot
  0x9a: 9,   // Nexus
  0x9c: 8,   // Pylon
  0x83: 1,   // Hatchery
  0x2a: 8,   // Overlord (morphs from a Drone; appears as a Train/Morph event)
};

// Construction / morph completion times in frames. Approximations good to
// ~1 second; BW's actual values vary but the block detector tolerates it.
const PROVIDER_COMPLETION_FRAMES: Record<number, number> = {
  0x6a: 1800, // CC:       ~75s
  0x6d: 960,  // Depot:    ~40s
  0x9a: 1800, // Nexus:    ~75s
  0x9c: 450,  // Pylon:    ~19s
  0x83: 1800, // Hatchery: ~75s
  0x2a: 600,  // Overlord: ~25s
};

export function computeSupplyBlocks(
  events: BuildOrderEvent[],
  playerIDs: number[],
  totalFrames: number,
): SupplyBlocks {
  // 1-second sampling matches the resolution of the timeline overlay and keeps
  // the detector cheap even on long games. Per-frame would be overkill.
  const stepFrames = Math.round(FRAMES_PER_SECOND);
  const samples = Math.max(1, Math.ceil(totalFrames / stepFrames) + 1);

  const used = new Map<number, Float32Array>();
  const cap = new Map<number, Float32Array>();
  for (const pid of playerIDs) {
    used.set(pid, new Float32Array(samples));
    const c = new Float32Array(samples);
    // Starting cap of 9 approximates every race's opening supply (see header).
    // Starting used of 4 covers the 4 workers every player spawns with.
    for (let i = 0; i < samples; i++) c[i] = 9;
    cap.set(pid, c);
    used.get(pid)!.fill(4);
  }

  // Each produced unit is charged to `used`. Each completed provider adds to
  // `cap`. Both mutate samples from their effective frame forward.
  const charge = (pid: number, delta: number, atFrame: number) => {
    const i0 = Math.min(samples - 1, Math.floor(atFrame / stepFrames));
    const arr = used.get(pid);
    if (!arr) return;
    for (let i = i0; i < samples; i++) arr[i] += delta;
  };
  const addProvider = (pid: number, unitID: number, startFrame: number) => {
    const supply = PROVIDER_SUPPLY[unitID];
    if (!supply) return;
    const doneFrame = startFrame + (PROVIDER_COMPLETION_FRAMES[unitID] ?? 0);
    const i0 = Math.min(samples - 1, Math.floor(doneFrame / stepFrames));
    const arr = cap.get(pid);
    if (!arr) return;
    for (let i = i0; i < samples; i++) arr[i] += supply;
  };

  for (const e of events) {
    if (e.unitID === undefined) continue;
    const meta = unitMeta(e.unitID);
    if (!meta) continue;
    if ((e.kind === 'build' || e.kind === 'buildingMorph')) {
      addProvider(e.playerID, e.unitID, e.frame);
    }
    if (e.kind === 'train' || e.kind === 'morph') {
      const count = meta.perMorph ?? 1;
      charge(e.playerID, meta.supply * count, e.frame);
      // Overlord morphs from a Drone → counts as 'morph', but also adds cap.
      if (e.unitID === 0x2a) addProvider(e.playerID, 0x2a, e.frame);
    }
  }

  const intervals: SupplyBlockInterval[] = [];
  for (const pid of playerIDs) {
    const usedArr = used.get(pid)!;
    const capArr = cap.get(pid)!;
    let inBlock = false;
    let startIdx = 0;
    for (let i = 0; i < samples; i++) {
      // Clamp: BW's actual cap is 200 per player; anything above is cosmetic.
      // A block is used >= cap with cap < 200 (200 = hard cap, not a block).
      const c = capArr[i];
      const blocked = c > 0 && c < 200 && usedArr[i] >= c;
      if (blocked && !inBlock) { inBlock = true; startIdx = i; }
      else if (!blocked && inBlock) {
        inBlock = false;
        pushInterval(pid, startIdx, i, stepFrames, intervals);
      }
    }
    if (inBlock) pushInterval(pid, startIdx, samples - 1, stepFrames, intervals);
  }

  const filtered = intervals.filter((iv) => iv.durationSeconds >= MIN_BLOCK_SECONDS);
  const totalSecondsByPID = new Map<number, number>();
  for (const pid of playerIDs) totalSecondsByPID.set(pid, 0);
  for (const iv of filtered) {
    totalSecondsByPID.set(iv.playerID, (totalSecondsByPID.get(iv.playerID) ?? 0) + iv.durationSeconds);
  }
  return { intervals: filtered, totalSecondsByPID };
}

function pushInterval(
  playerID: number,
  startIdx: number,
  endIdx: number,
  stepFrames: number,
  out: SupplyBlockInterval[],
): void {
  const startFrame = startIdx * stepFrames;
  const endFrame = endIdx * stepFrames;
  const startSeconds = startFrame / FRAMES_PER_SECOND;
  const endSeconds = endFrame / FRAMES_PER_SECOND;
  out.push({
    playerID,
    startFrame,
    endFrame,
    startSeconds,
    endSeconds,
    durationSeconds: Math.max(0, endSeconds - startSeconds),
  });
}
