// Production-building utilisation. For each production facility per player,
// estimate how much of its operating lifetime was spent producing vs idle.
// Uses the build-order event stream plus the PRODUCTION_TIMINGS table below
// (nominal train-frame costs) to derive busy-time. No simulation of queues
// is attempted — we treat production events as "takes T frames starting at
// this event's frame", which is close enough for coaching feedback.
//
// Capacity window: per player, we cap each pool's denominator at
// `min(gameEnd, lastProductionFrame + GRACE_FRAMES)`. Without this, the stretch
// between the decisive engagement and game-end (when the winner has clinched
// and the loser's buildings are moot) counts as idle, inflating reported idle
// past 50% even in well-played games. The grace period absorbs the last
// in-flight train cycle so a final unit isn't counted as idle. If the player
// produced nothing from any pool, we fall back to the full game length.
//
// Caveats:
//   - Zerg larvae work as 3 concurrent slots per Hatchery-lineage structure.
//     Lair/Hive morphs don't change total capacity (the base Hatchery is the
//     same slot), so we don't add them to the pool count. Real larva regen
//     is rate-limited (~340 frames per larva) so slots=3 over-estimates Zerg
//     capacity somewhat — the cap above partially compensates.
//   - Add-on buildings (Machine Shop, Control Tower) aren't modeled; Factory
//     still reports correctly but Siege Tank training would need a MS to be
//     legal. That's a correctness-of-order concern, not a utilization one.

import type { BuildOrderEvent } from './buildOrder';

const FRAMES_PER_SECOND = 1000 / 42;

// Production building metadata: display name, and whether it's a larva-style
// pool (3 concurrent slots per building) or single-slot.
interface PoolMeta {
  id: number;
  name: string;
  slots: number;
  includeIDs?: number[];  // Alternate IDs that count toward this pool (e.g. Lair/Hive under Hatchery).
}

export const PRODUCTION_POOLS: PoolMeta[] = [
  // Terran
  { id: 0x6f, name: 'Barracks', slots: 1 },
  { id: 0x71, name: 'Factory', slots: 1 },
  { id: 0x72, name: 'Starport', slots: 1 },
  { id: 0x6a, name: 'Command Center', slots: 1 },
  // Protoss
  { id: 0xa0, name: 'Gateway', slots: 1 },
  { id: 0x9b, name: 'Robotics Facility', slots: 1 },
  { id: 0xa7, name: 'Stargate', slots: 1 },
  { id: 0x9a, name: 'Nexus', slots: 1 },
  // Zerg — all three count as the same "larva pool".
  { id: 0x83, name: 'Hatcheries', slots: 3 },
];

// Per-unit production time in frames + source building ID. We already have a
// similar table in buildOrder.ts; duplicate the subset we need here so the
// analysis is self-contained. Numbers are rounded BW values.
interface UnitProd { trainFrames: number; sourceID: number; }

const UNIT_PROD: Record<number, UnitProd> = {
  // Terran
  0x07: { trainFrames: 300, sourceID: 0x6a }, // SCV
  0x00: { trainFrames: 360, sourceID: 0x6f }, // Marine
  0x20: { trainFrames: 360, sourceID: 0x6f }, // Firebat
  0x22: { trainFrames: 360, sourceID: 0x6f }, // Medic
  0x01: { trainFrames: 540, sourceID: 0x6f }, // Ghost
  0x02: { trainFrames: 360, sourceID: 0x71 }, // Vulture
  0x05: { trainFrames: 540, sourceID: 0x71 }, // Siege Tank
  0x03: { trainFrames: 480, sourceID: 0x71 }, // Goliath
  0x08: { trainFrames: 600, sourceID: 0x72 }, // Wraith
  0x0b: { trainFrames: 600, sourceID: 0x72 }, // Dropship
  0x09: { trainFrames: 600, sourceID: 0x72 }, // Science Vessel
  0x3a: { trainFrames: 600, sourceID: 0x72 }, // Valkyrie
  0x0c: { trainFrames: 1200, sourceID: 0x72 }, // Battlecruiser
  // Protoss
  0x40: { trainFrames: 300, sourceID: 0x9a }, // Probe
  0x41: { trainFrames: 480, sourceID: 0xa0 }, // Zealot
  0x42: { trainFrames: 600, sourceID: 0xa0 }, // Dragoon
  0x43: { trainFrames: 720, sourceID: 0xa0 }, // High Templar
  0x3d: { trainFrames: 720, sourceID: 0xa0 }, // Dark Templar
  0x45: { trainFrames: 720, sourceID: 0x9b }, // Shuttle
  0x53: { trainFrames: 840, sourceID: 0x9b }, // Reaver
  0x54: { trainFrames: 480, sourceID: 0x9b }, // Observer
  0x46: { trainFrames: 960, sourceID: 0xa7 }, // Scout
  0x3c: { trainFrames: 480, sourceID: 0xa7 }, // Corsair
  0x47: { trainFrames: 960, sourceID: 0xa7 }, // Arbiter
  0x48: { trainFrames: 1200, sourceID: 0xa7 }, // Carrier
  // Zerg (all from larva pool keyed under Hatchery)
  0x29: { trainFrames: 300, sourceID: 0x83 }, // Drone
  0x2a: { trainFrames: 600, sourceID: 0x83 }, // Overlord
  0x25: { trainFrames: 360, sourceID: 0x83 }, // Zergling
  0x26: { trainFrames: 480, sourceID: 0x83 }, // Hydralisk
  0x2b: { trainFrames: 720, sourceID: 0x83 }, // Mutalisk
  0x2f: { trainFrames: 480, sourceID: 0x83 }, // Scourge
  0x2d: { trainFrames: 720, sourceID: 0x83 }, // Queen
  0x2e: { trainFrames: 720, sourceID: 0x83 }, // Defiler
  0x27: { trainFrames: 840, sourceID: 0x83 }, // Ultralisk
};

// How long each pool takes to come online after the Build command fires. This
// is the construction time — production can't start until it's done.
const POOL_READY_FRAMES: Record<number, number> = {
  0x6f: 960,  // Barracks  ~40s
  0x71: 1200, // Factory   ~50s
  0x72: 1200, // Starport  ~50s
  0x6a: 1800, // CC        ~75s
  0xa0: 960,  // Gateway   ~40s
  0x9b: 1200, // Robo      ~50s
  0xa7: 1200, // Stargate  ~50s
  0x9a: 1800, // Nexus     ~75s
  0x83: 1800, // Hatchery  ~75s
};

// Grace window after the last train/morph event before we consider the player
// to have stopped producing. Absorbs the in-flight train cycle (longest unit
// takes ~1200 frames) and gives the benefit of the doubt for a few late
// commands. Not tuned heavily; the exact value affects absolute idle numbers
// only slightly since the big gain comes from cutting post-game-decided tail.
const CAPACITY_GRACE_FRAMES = 1400;

export interface PoolStats {
  id: number;
  name: string;
  count: number;            // Production buildings of this pool the player has built
  capacityFrames: number;   // Sum over buildings of (capacityEnd - completion) × slots
  busyFrames: number;       // Sum of per-event trainFrames (capped at capacity)
  idleFrames: number;       // capacity - busy, clamped to ≥0
  idleRatio: number;        // idleFrames / capacityFrames (0 if capacity=0)
  unitsProduced: number;    // Count of train/morph events sourced here
}

export interface ProductionIdle {
  byPlayer: Map<number, PoolStats[]>;
  // End-of-production frame per player (min(gameEnd, lastProd + grace)). Surfaced
  // so coaching panels can say "you stopped producing at X:XX" if useful.
  capacityEndByPlayer: Map<number, number>;
}

export function computeProductionIdle(
  events: BuildOrderEvent[],
  playerIDs: number[],
  totalFrames: number,
): ProductionIdle {
  const byPlayer = new Map<number, PoolStats[]>();
  const capacityEndByPlayer = new Map<number, number>();

  for (const pid of playerIDs) {
    // Find the player's last production event across all pools. Anything past
    // this point + grace is late-game slack and doesn't reflect coaching intent.
    let lastProdFrame = -1;
    for (const e of events) {
      if (e.playerID !== pid) continue;
      if (e.kind !== 'train' && e.kind !== 'morph') continue;
      if (e.unitID === undefined) continue;
      if (!UNIT_PROD[e.unitID]) continue;
      if (e.frame > lastProdFrame) lastProdFrame = e.frame;
    }
    const capacityEnd =
      lastProdFrame >= 0
        ? Math.min(totalFrames, lastProdFrame + CAPACITY_GRACE_FRAMES)
        : totalFrames;
    capacityEndByPlayer.set(pid, capacityEnd);

    const stats: PoolStats[] = [];
    for (const pool of PRODUCTION_POOLS) {
      // Find every building this player constructed that maps to this pool.
      const buildings: number[] = []; // completion frames
      for (const e of events) {
        if (e.playerID !== pid) continue;
        if (e.kind !== 'build' && e.kind !== 'buildingMorph') continue;
        if (e.unitID !== pool.id && !pool.includeIDs?.includes(e.unitID ?? -1)) continue;
        const ready = e.frame + (POOL_READY_FRAMES[pool.id] ?? 0);
        if (ready < totalFrames) buildings.push(ready);
      }

      // Capacity: sum over buildings of (capacityEnd - completion) × slots,
      // floored at 0 so buildings completed after the cap contribute nothing.
      // Zerg's larva pool uses slots=3. Everything else is 1.
      let capacityFrames = 0;
      for (const c of buildings) {
        const window = Math.max(0, capacityEnd - c);
        capacityFrames += window * pool.slots;
      }

      // Busy: sum of trainFrames for every unit produced from this pool.
      let busyFrames = 0;
      let unitsProduced = 0;
      for (const e of events) {
        if (e.playerID !== pid) continue;
        if (e.kind !== 'train' && e.kind !== 'morph') continue;
        if (e.unitID === undefined) continue;
        const prod = UNIT_PROD[e.unitID];
        if (!prod || prod.sourceID !== pool.id) continue;
        busyFrames += prod.trainFrames;
        unitsProduced += 1;
      }
      // Cap busy at capacity — parallel production means units don't strictly
      // serialize, and a noisy trainFrames estimate can exceed the available
      // pool-frames if we get unlucky. Clamp so idle never goes negative.
      const cappedBusy = Math.min(busyFrames, capacityFrames);

      stats.push({
        id: pool.id,
        name: pool.name,
        count: buildings.length,
        capacityFrames,
        busyFrames: cappedBusy,
        idleFrames: Math.max(0, capacityFrames - cappedBusy),
        idleRatio: capacityFrames > 0 ? Math.max(0, 1 - cappedBusy / capacityFrames) : 0,
        unitsProduced,
      });
    }
    byPlayer.set(pid, stats);
  }
  return { byPlayer, capacityEndByPlayer };
}

export function framesToSeconds(frames: number): number {
  return frames / FRAMES_PER_SECOND;
}
