// Key-timing extraction. Given the build-order events for a single player,
// report the canonical macro timings players care about when reviewing:
//
//   - first gas structure
//   - first expansion (second town hall)
//   - first tier-2 tech structure
//   - first combat unit trained
//   - when cumulative produced supply crossed 100
//
// All values are seconds-into-game; a null means the event never happened
// in this replay (e.g. a rush that ends before expanding). These are raw,
// un-smoothed events — no guessing, no heuristics beyond a fixed list of
// what counts as "tech".

import type { BuildOrderEvent } from './buildOrder';
import { unitMeta } from './units';

// Town halls per race.
const TOWN_HALL_IDS = new Set<number>([0x6a /* CC */, 0x9a /* Nexus */, 0x83 /* Hatchery */]);
// Gas-extraction structures per race.
const GAS_IDS = new Set<number>([0x6e /* Refinery */, 0x9d /* Assimilator */, 0x95 /* Extractor */]);
// "Tier-2 tech" — anything past the minimal production+supply+gas core that
// indicates a tech commitment. Town halls, gas, supply, and the single basic
// production building each race starts with are excluded.
const TECH_BUILDING_IDS = new Set<number>([
  // Terran
  0x70 /* Academy */,
  0x71 /* Factory */,
  0x72 /* Starport */,
  0x74 /* Science Facility */,
  0x7a /* Engineering Bay */,
  0x7b /* Armory */,
  // Protoss
  0xa4 /* Cybernetics Core */,
  0xa3 /* Citadel of Adun */,
  0xa6 /* Forge */,
  0x9b /* Robotics Facility */,
  0xa7 /* Stargate */,
  0xa5 /* Templar Archives */,
  0x9f /* Observatory */,
  0xab /* Robotics Support Bay */,
  0xa9 /* Fleet Beacon */,
  // Zerg
  0x8e /* Spawning Pool */,
  0x87 /* Hydralisk Den */,
  0x88 /* Defiler Mound */,
  0x8a /* Queens Nest */,
  0x8b /* Evolution Chamber */,
  0x8c /* Ultralisk Cavern */,
  0x8d /* Spire */,
  0x89 /* Greater Spire */,
  0x84 /* Lair */,
  0x85 /* Hive */,
]);


export interface PlayerTimings {
  firstGasSeconds: number | null;
  firstExpansionSeconds: number | null;
  firstTechBuildingSeconds: number | null;
  firstTechName: string | null;
  firstCombatUnitSeconds: number | null;
  firstCombatUnitName: string | null;
  supply50Seconds: number | null;
  supply100Seconds: number | null;
  supply150Seconds: number | null;
}

export function emptyTimings(): PlayerTimings {
  return {
    firstGasSeconds: null,
    firstExpansionSeconds: null,
    firstTechBuildingSeconds: null,
    firstTechName: null,
    firstCombatUnitSeconds: null,
    firstCombatUnitName: null,
    supply50Seconds: null,
    supply100Seconds: null,
    supply150Seconds: null,
  };
}

export function computeTimings(events: BuildOrderEvent[], playerID: number): PlayerTimings {
  const t = emptyTimings();
  // The player is seeded with one town hall via the build-order accumulator,
  // but that isn't emitted as an event. So the first town-hall *event* for
  // the player is their expansion (the second hall).
  let seenTownHall = false;
  let cumulativeSupply = 0;

  for (const e of events) {
    if (e.playerID !== playerID) continue;

    if (e.unitID !== undefined) {
      if (t.firstGasSeconds == null && GAS_IDS.has(e.unitID)) {
        t.firstGasSeconds = e.seconds;
      }
      if (TOWN_HALL_IDS.has(e.unitID)) {
        // Zerg hatches double as production — still counts as an expansion.
        if (seenTownHall && t.firstExpansionSeconds == null) {
          t.firstExpansionSeconds = e.seconds;
        }
        seenTownHall = true;
      }
      if (t.firstTechBuildingSeconds == null && TECH_BUILDING_IDS.has(e.unitID)) {
        t.firstTechBuildingSeconds = e.seconds;
        t.firstTechName = e.name;
      }
      if (t.firstCombatUnitSeconds == null && (e.kind === 'train' || e.kind === 'morph')) {
        const meta = unitMeta(e.unitID);
        if (meta?.isArmy) {
          t.firstCombatUnitSeconds = e.seconds;
          t.firstCombatUnitName = meta.name;
        }
      }
    }

    // e.supply is the cumulative produced supply *before* this event fired.
    // Use the post-event supply to catch crossings on the event itself.
    // BuildOrderEvent doesn't carry a post-event supply, so we approximate by
    // tracking supply as (prev event's supply) — which means the threshold
    // fires on the first event where supply is already ≥ threshold.
    cumulativeSupply = e.supply;
    if (t.supply50Seconds == null && cumulativeSupply >= 50) t.supply50Seconds = e.seconds;
    if (t.supply100Seconds == null && cumulativeSupply >= 100) t.supply100Seconds = e.seconds;
    if (t.supply150Seconds == null && cumulativeSupply >= 150) t.supply150Seconds = e.seconds;
  }

  return t;
}

// Helpers used by aggregate / UI: average a list of nullable timings,
// ignoring nulls. Returns null if no sample had a value.
export function averageTiming(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// Pretty-format a timing as "M:SS" or "—".
export function formatTiming(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
