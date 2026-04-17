// Build order extraction: walks the commands array once and emits a
// chronological list of production / tech / upgrade events per player, with
// cumulative supply produced and worker count at the time of the event.
//
// Caveats:
//   - "Supply" here is supply PRODUCED (not alive), seeded with the 4 starting
//     workers every BW player receives. BW's displayed supply decreases when
//     units die; we don't have that signal without an engine simulation, so
//     this is an approximation. Still close enough that the numbers match
//     typical build-order notation (e.g. "9 Pool" fires at supply 9).
//   - Worker count is total produced (seeded at 4), not alive. Same caveat.

import type { ParsedReplay, ReplayCommand } from '../types/replay';
import { cmdTechName, cmdUnit, cmdUpgradeName, isEffective, isType, TYPE_NAMES } from './commands';
import { unitMeta } from './units';

// Screp's IneffKind heuristic catches most spam, but consistently misses
// first-seconds mashing because there's no prior "effective" command to
// compare against. We layer an explicit production-budget filter on top of
// it. For every unit ID we know, we hardcode:
//   - trainFrames: nominal production time (rounded to nearest ~0.25s)
//   - sourceIDs: the structure(s) that produce this unit
//   - larvaBased: true for Zerg (each hatch provides 3 concurrent slots)
// At Train/UnitMorph time we compute minGap = trainFrames / max(1, effective
// production slots) and drop same-(player,unit) commands closer than that.
// Effective slots = sum of sourceID building counts this player has started,
// times 3 if larvaBased. Counts increment on Build/BuildingMorph so they
// grow as the game progresses. Every player is seeded with 1 town hall of
// each race (harmless cross-race seed since you can't train units whose
// source you don't have).
interface ProductionInfo {
  trainFrames: number;
  sourceIDs: number[];
  larvaBased?: boolean;
}

const PRODUCTION_SOURCE: Record<number, ProductionInfo> = {
  // --- Terran ---
  0x07: { trainFrames: 300, sourceIDs: [0x6a] },                         // SCV ← CC
  0x00: { trainFrames: 360, sourceIDs: [0x6f] },                         // Marine ← Rax
  0x22: { trainFrames: 360, sourceIDs: [0x6f] },                         // Medic
  0x20: { trainFrames: 360, sourceIDs: [0x6f] },                         // Firebat
  0x01: { trainFrames: 540, sourceIDs: [0x6f] },                         // Ghost
  0x02: { trainFrames: 360, sourceIDs: [0x71] },                         // Vulture ← Factory
  0x05: { trainFrames: 540, sourceIDs: [0x71] },                         // Siege Tank
  0x03: { trainFrames: 480, sourceIDs: [0x71] },                         // Goliath
  0x08: { trainFrames: 600, sourceIDs: [0x72] },                         // Wraith ← Starport
  0x0b: { trainFrames: 600, sourceIDs: [0x72] },                         // Dropship
  0x09: { trainFrames: 600, sourceIDs: [0x72] },                         // Science Vessel
  0x3a: { trainFrames: 600, sourceIDs: [0x72] },                         // Valkyrie
  0x0c: { trainFrames: 1200, sourceIDs: [0x72] },                        // Battlecruiser
  // --- Protoss ---
  0x40: { trainFrames: 300, sourceIDs: [0x9a] },                         // Probe ← Nexus
  0x41: { trainFrames: 480, sourceIDs: [0xa0] },                         // Zealot ← Gateway
  0x42: { trainFrames: 600, sourceIDs: [0xa0] },                         // Dragoon
  0x43: { trainFrames: 720, sourceIDs: [0xa0] },                         // High Templar
  0x3d: { trainFrames: 720, sourceIDs: [0xa0] },                         // Dark Templar
  0x45: { trainFrames: 720, sourceIDs: [0x9b] },                         // Shuttle ← Robo
  0x53: { trainFrames: 840, sourceIDs: [0x9b] },                         // Reaver
  0x54: { trainFrames: 480, sourceIDs: [0x9b] },                         // Observer
  0x46: { trainFrames: 960, sourceIDs: [0xa7] },                         // Scout ← Stargate
  0x3c: { trainFrames: 480, sourceIDs: [0xa7] },                         // Corsair
  0x47: { trainFrames: 960, sourceIDs: [0xa7] },                         // Arbiter
  0x48: { trainFrames: 1200, sourceIDs: [0xa7] },                        // Carrier
  // --- Zerg (larva-based, from Hatch/Lair/Hive) ---
  0x29: { trainFrames: 300, sourceIDs: [0x83, 0x84, 0x85], larvaBased: true }, // Drone
  0x2a: { trainFrames: 360, sourceIDs: [0x83, 0x84, 0x85], larvaBased: true }, // Overlord
  0x25: { trainFrames: 360, sourceIDs: [0x83, 0x84, 0x85], larvaBased: true }, // Zergling
  0x26: { trainFrames: 480, sourceIDs: [0x83, 0x84, 0x85], larvaBased: true }, // Hydralisk
  0x2b: { trainFrames: 720, sourceIDs: [0x83, 0x84, 0x85], larvaBased: true }, // Mutalisk
  0x2f: { trainFrames: 480, sourceIDs: [0x83, 0x84, 0x85], larvaBased: true }, // Scourge
  0x2d: { trainFrames: 720, sourceIDs: [0x83, 0x84, 0x85], larvaBased: true }, // Queen
  0x2e: { trainFrames: 720, sourceIDs: [0x83, 0x84, 0x85], larvaBased: true }, // Defiler
  0x27: { trainFrames: 840, sourceIDs: [0x83, 0x84, 0x85], larvaBased: true }, // Ultralisk
  // Zerg unit-morphs: 1:1 from a single unit, no production-count scaling.
  0x67: { trainFrames: 480, sourceIDs: [] },                             // Lurker
  0x2c: { trainFrames: 480, sourceIDs: [] },                             // Guardian
  0x3e: { trainFrames: 480, sourceIDs: [] },                             // Devourer
};

const TOWN_HALL_IDS = [0x6a, 0x9a, 0x83];
const MIN_GAP_FRAMES = 12;  // ~0.5s floor — even a maxed-out economy can't produce same unit faster.

export interface BuildOrderEvent {
  frame: number;
  seconds: number;
  playerID: number;
  kind: 'train' | 'morph' | 'build' | 'buildingMorph' | 'tech' | 'upgrade' | 'cancel';
  name: string;                 // User-facing label (e.g. "Spawning Pool", "Stim Pack")
  unitID?: number;              // Present for train/morph/build/buildingMorph.
  supply: number;               // Supply produced by this player *before* this event
  workers: number;              // Worker-type units produced by this player *before* this event
}

// Every BW player starts with 4 workers (SCVs / Probes / Drones), which means
// the first build event observed should report supply 4, not 0. We seed the
// cumulative counters per non-observer player at game start.
const STARTING_WORKERS = 4;
const STARTING_SUPPLY = 4;

export function computeBuildOrder(replay: ParsedReplay): BuildOrderEvent[] {
  const cmds = replay.Commands?.Cmds;
  if (!cmds?.length) return [];

  const supplyByPID = new Map<number, number>();
  const workersByPID = new Map<number, number>();
  for (const p of replay.Header?.Players ?? []) {
    if (p.Observer) continue;
    supplyByPID.set(p.ID, STARTING_SUPPLY);
    workersByPID.set(p.ID, STARTING_WORKERS);
  }
  const out: BuildOrderEvent[] = [];

  const fps = 1000 / 42;

  // Per-player per-unit last-accepted-frame for the production-budget filter.
  // Keyed by `${pid}::${unitId}`.
  const lastAccepted = new Map<string, number>();
  // Per-player count of started production structures (Build or BuildingMorph
  // completion is ignored — queueing counts, which matches how players think
  // about builds in progress). Keyed by `${pid}::${buildingID}`.
  const buildingCounts = new Map<string, number>();
  const bumpBuilding = (pid: number, buildingID: number) => {
    const k = `${pid}::${buildingID}`;
    buildingCounts.set(k, (buildingCounts.get(k) ?? 0) + 1);
  };
  const getBuilding = (pid: number, buildingID: number) => buildingCounts.get(`${pid}::${buildingID}`) ?? 0;
  // Seed each player with 1 of every race's town hall. Cross-race seeds are
  // harmless: you can only train units whose sourceIDs you actually match.
  const seedPlayer = (pid: number) => {
    for (const id of TOWN_HALL_IDS) {
      const k = `${pid}::${id}`;
      if (!buildingCounts.has(k)) buildingCounts.set(k, 1);
    }
  };

  for (const c of cmds) {
    const tn = c.Type?.Name;
    if (!tn) continue;

    // Skip commands screp has flagged as ineffective (spam, repeats, queue
    // already full, etc.). Without this, mashing 'p' at game start produces
    // phantom probes that were never actually trained.
    if (!isEffective(c)) continue;

    const pid = c.PlayerID;
    seedPlayer(pid);

    // Production-budget filter for Train / UnitMorph. Drop commands that
    // fire faster than the known production rate for this unit.
    if (tn === TYPE_NAMES.train || tn === TYPE_NAMES.unitMorph) {
      const u = cmdUnit(c);
      if (u) {
        const info = PRODUCTION_SOURCE[u.ID];
        if (info) {
          let slots = 0;
          for (const sid of info.sourceIDs) slots += getBuilding(pid, sid);
          if (info.larvaBased) slots *= 3;
          const effective = Math.max(1, slots);
          const minGap = Math.max(MIN_GAP_FRAMES, Math.floor(info.trainFrames / effective));
          const key = `${pid}::${u.ID}`;
          const prev = lastAccepted.get(key);
          if (prev !== undefined && c.Frame - prev < minGap) continue;
          lastAccepted.set(key, c.Frame);
        }
      }
    }

    const frame = c.Frame;
    const seconds = frame / fps;
    const supply = supplyByPID.get(pid) ?? 0;
    const workers = workersByPID.get(pid) ?? 0;

    switch (tn) {
      case TYPE_NAMES.train: {
        const u = cmdUnit(c);
        const meta = u ? unitMeta(u.ID) : undefined;
        if (!meta) break;
        out.push({ frame, seconds, playerID: pid, kind: 'train', name: meta.name, unitID: u!.ID, supply, workers });
        const count = meta.perMorph ?? 1;
        supplyByPID.set(pid, supply + meta.supply * count);
        if (meta.isWorker) workersByPID.set(pid, workers + count);
        break;
      }
      case TYPE_NAMES.unitMorph: {
        const u = cmdUnit(c);
        const meta = u ? unitMeta(u.ID) : undefined;
        if (!meta) break;
        out.push({ frame, seconds, playerID: pid, kind: 'morph', name: meta.name, unitID: u!.ID, supply, workers });
        // Unit morphs (Zergling, Mutalisk, Lurker, etc.) pay the morph supply.
        const count = meta.perMorph ?? 1;
        supplyByPID.set(pid, supply + meta.supply * count);
        break;
      }
      case TYPE_NAMES.build: {
        const u = cmdUnit(c);
        const meta = u ? unitMeta(u.ID) : undefined;
        if (!meta) break;
        out.push({ frame, seconds, playerID: pid, kind: 'build', name: meta.name, unitID: u!.ID, supply, workers });
        if (meta.isBuilding) bumpBuilding(pid, u!.ID);
        break;
      }
      case TYPE_NAMES.buildingMorph: {
        const u = cmdUnit(c);
        const meta = u ? unitMeta(u.ID) : undefined;
        if (!meta) break;
        out.push({ frame, seconds, playerID: pid, kind: 'buildingMorph', name: meta.name, unitID: u!.ID, supply, workers });
        if (meta.isBuilding) bumpBuilding(pid, u!.ID);
        break;
      }
      case TYPE_NAMES.tech: {
        const name = cmdTechName(c);
        if (!name) break;
        out.push({ frame, seconds, playerID: pid, kind: 'tech', name, supply, workers });
        break;
      }
      case TYPE_NAMES.upgrade: {
        const name = cmdUpgradeName(c);
        if (!name) break;
        out.push({ frame, seconds, playerID: pid, kind: 'upgrade', name, supply, workers });
        break;
      }
      default:
        break;
    }
  }

  out.sort((a, b) => a.frame - b.frame);
  return out;
}

export function countBuildOrderCancels(replay: ParsedReplay): number {
  const cmds = replay.Commands?.Cmds ?? [];
  let n = 0;
  for (const c of cmds) {
    if (isType(c as ReplayCommand, TYPE_NAMES.cancelTrain)) n++;
    if (isType(c as ReplayCommand, TYPE_NAMES.cancelConstruction)) n++;
    if (isType(c as ReplayCommand, TYPE_NAMES.cancelMorph)) n++;
  }
  return n;
}

// ---- export formats ---------------------------------------------------------

export function buildOrderToText(events: BuildOrderEvent[], playerNames: Record<number, string>): string {
  const lines: string[] = [];
  for (const e of events) {
    const mm = Math.floor(e.seconds / 60);
    const ss = Math.floor(e.seconds % 60).toString().padStart(2, '0');
    const who = playerNames[e.playerID] ?? `P${e.playerID}`;
    lines.push(`${mm}:${ss}\t${e.supply}\t${who}\t${e.kind}\t${e.name}`);
  }
  return lines.join('\n');
}

export function buildOrderToCsv(events: BuildOrderEvent[], playerNames: Record<number, string>): string {
  const rows: string[] = ['time,supply,workers,player,kind,name'];
  for (const e of events) {
    const mm = Math.floor(e.seconds / 60);
    const ss = Math.floor(e.seconds % 60).toString().padStart(2, '0');
    const who = csvSafe(playerNames[e.playerID] ?? `P${e.playerID}`);
    rows.push(`${mm}:${ss},${e.supply},${e.workers},${who},${e.kind},${csvSafe(e.name)}`);
  }
  return rows.join('\n');
}

export function buildOrderToJson(events: BuildOrderEvent[], playerNames: Record<number, string>): string {
  const out = events.map((e) => ({
    time: formatMMSS(e.seconds),
    frame: e.frame,
    supply: e.supply,
    workers: e.workers,
    player: playerNames[e.playerID] ?? `P${e.playerID}`,
    kind: e.kind,
    name: e.name,
  }));
  return JSON.stringify(out, null, 2);
}

function csvSafe(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatMMSS(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
