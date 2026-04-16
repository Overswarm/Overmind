// Minimal unit metadata for analysis: classification (worker/building/army),
// resource cost, and supply cost. Covers the units that actually appear in
// 1v1 / 2v2 melee builds; exotic campaign / hero units are intentionally left
// out. Lookup is by screp's `Unit.ID` (uint16).
//
// Numbers follow standard Brood War balance values. Costs for Zerg units that
// morph from another unit (e.g. Lurker from Hydralisk) are the *extra* mineral
// and gas spent on the morph, since the base unit was already paid for.

export type UnitRace = 'Terran' | 'Zerg' | 'Protoss' | 'Neutral';

export interface UnitMeta {
  id: number;
  name: string;
  race: UnitRace;
  mineral: number;
  gas: number;
  // Supply cost the unit consumes. Some Zerg hatches produce two units per
  // morph (Zerglings, Scourge) — we encode that in `perMorph`.
  supply: number;
  isWorker: boolean;
  isBuilding: boolean;
  isArmy: boolean;
  // For Zerg morph-at-once units (Zergling, Scourge), how many spawn per
  // single Train command. Cost fields are per-instance already.
  perMorph?: number;
}

// Hand-picked table. Adding more units is additive.
const TABLE: UnitMeta[] = [
  // ---- Terran ----
  u({ id: 0x07, name: 'SCV', race: 'Terran', mineral: 50, gas: 0, supply: 1, isWorker: true }),
  u({ id: 0x00, name: 'Marine', race: 'Terran', mineral: 50, gas: 0, supply: 1, isArmy: true }),
  u({ id: 0x20, name: 'Firebat', race: 'Terran', mineral: 50, gas: 25, supply: 1, isArmy: true }),
  u({ id: 0x22, name: 'Medic', race: 'Terran', mineral: 50, gas: 25, supply: 1, isArmy: true }),
  u({ id: 0x01, name: 'Ghost', race: 'Terran', mineral: 25, gas: 75, supply: 1, isArmy: true }),
  u({ id: 0x02, name: 'Vulture', race: 'Terran', mineral: 75, gas: 0, supply: 2, isArmy: true }),
  u({ id: 0x05, name: 'Siege Tank', race: 'Terran', mineral: 150, gas: 100, supply: 2, isArmy: true }),
  u({ id: 0x03, name: 'Goliath', race: 'Terran', mineral: 100, gas: 50, supply: 2, isArmy: true }),
  u({ id: 0x08, name: 'Wraith', race: 'Terran', mineral: 150, gas: 100, supply: 2, isArmy: true }),
  u({ id: 0x0b, name: 'Dropship', race: 'Terran', mineral: 100, gas: 100, supply: 2, isArmy: true }),
  u({ id: 0x09, name: 'Science Vessel', race: 'Terran', mineral: 100, gas: 225, supply: 2, isArmy: true }),
  u({ id: 0x3a, name: 'Valkyrie', race: 'Terran', mineral: 250, gas: 125, supply: 3, isArmy: true }),
  u({ id: 0x0c, name: 'Battlecruiser', race: 'Terran', mineral: 400, gas: 300, supply: 6, isArmy: true }),
  // Terran buildings
  b({ id: 0x6a, name: 'Command Center', race: 'Terran', mineral: 400 }),
  b({ id: 0x6d, name: 'Supply Depot', race: 'Terran', mineral: 100 }),
  b({ id: 0x6e, name: 'Refinery', race: 'Terran', mineral: 100 }),
  b({ id: 0x6f, name: 'Barracks', race: 'Terran', mineral: 150 }),
  b({ id: 0x70, name: 'Academy', race: 'Terran', mineral: 150 }),
  b({ id: 0x71, name: 'Factory', race: 'Terran', mineral: 200, gas: 100 }),
  b({ id: 0x72, name: 'Starport', race: 'Terran', mineral: 150, gas: 100 }),
  b({ id: 0x73, name: 'Control Tower', race: 'Terran', mineral: 50, gas: 50 }),
  b({ id: 0x74, name: 'Science Facility', race: 'Terran', mineral: 100, gas: 150 }),
  b({ id: 0x75, name: 'Covert Ops', race: 'Terran', mineral: 50, gas: 50 }),
  b({ id: 0x76, name: 'Physics Lab', race: 'Terran', mineral: 50, gas: 50 }),
  b({ id: 0x78, name: 'Machine Shop', race: 'Terran', mineral: 50, gas: 50 }),
  b({ id: 0x7a, name: 'Engineering Bay', race: 'Terran', mineral: 125 }),
  b({ id: 0x7b, name: 'Armory', race: 'Terran', mineral: 100, gas: 50 }),
  b({ id: 0x7c, name: 'Missile Turret', race: 'Terran', mineral: 75 }),
  b({ id: 0x7d, name: 'Bunker', race: 'Terran', mineral: 100 }),
  b({ id: 0x6b, name: 'ComSat', race: 'Terran', mineral: 50, gas: 50 }),
  b({ id: 0x6c, name: 'Nuclear Silo', race: 'Terran', mineral: 100, gas: 100 }),

  // ---- Zerg ----
  u({ id: 0x29, name: 'Drone', race: 'Zerg', mineral: 50, gas: 0, supply: 1, isWorker: true }),
  u({ id: 0x2a, name: 'Overlord', race: 'Zerg', mineral: 100, gas: 0, supply: 0 }),
  u({ id: 0x25, name: 'Zergling', race: 'Zerg', mineral: 50, gas: 0, supply: 1, isArmy: true, perMorph: 2 }),
  u({ id: 0x26, name: 'Hydralisk', race: 'Zerg', mineral: 75, gas: 25, supply: 1, isArmy: true }),
  u({ id: 0x67, name: 'Lurker', race: 'Zerg', mineral: 50, gas: 100, supply: 1, isArmy: true }),
  u({ id: 0x2b, name: 'Mutalisk', race: 'Zerg', mineral: 100, gas: 100, supply: 2, isArmy: true }),
  u({ id: 0x2f, name: 'Scourge', race: 'Zerg', mineral: 12, gas: 38, supply: 0.5, isArmy: true, perMorph: 2 }),
  u({ id: 0x2c, name: 'Guardian', race: 'Zerg', mineral: 50, gas: 100, supply: 2, isArmy: true }),
  u({ id: 0x3e, name: 'Devourer', race: 'Zerg', mineral: 150, gas: 50, supply: 2, isArmy: true }),
  u({ id: 0x2d, name: 'Queen', race: 'Zerg', mineral: 100, gas: 100, supply: 2, isArmy: true }),
  u({ id: 0x2e, name: 'Defiler', race: 'Zerg', mineral: 50, gas: 150, supply: 2, isArmy: true }),
  u({ id: 0x27, name: 'Ultralisk', race: 'Zerg', mineral: 200, gas: 200, supply: 4, isArmy: true }),
  // Zerg buildings
  b({ id: 0x83, name: 'Hatchery', race: 'Zerg', mineral: 300 }),
  b({ id: 0x84, name: 'Lair', race: 'Zerg', mineral: 150, gas: 100 }),
  b({ id: 0x85, name: 'Hive', race: 'Zerg', mineral: 200, gas: 150 }),
  b({ id: 0x8e, name: 'Spawning Pool', race: 'Zerg', mineral: 200 }),
  b({ id: 0x87, name: 'Hydralisk Den', race: 'Zerg', mineral: 100, gas: 50 }),
  b({ id: 0x88, name: 'Defiler Mound', race: 'Zerg', mineral: 100, gas: 100 }),
  b({ id: 0x89, name: 'Greater Spire', race: 'Zerg', mineral: 100, gas: 150 }),
  b({ id: 0x8a, name: 'Queens Nest', race: 'Zerg', mineral: 150, gas: 100 }),
  b({ id: 0x8b, name: 'Evolution Chamber', race: 'Zerg', mineral: 75 }),
  b({ id: 0x8c, name: 'Ultralisk Cavern', race: 'Zerg', mineral: 150, gas: 200 }),
  b({ id: 0x8d, name: 'Spire', race: 'Zerg', mineral: 200, gas: 150 }),
  b({ id: 0x8f, name: 'Creep Colony', race: 'Zerg', mineral: 75 }),
  b({ id: 0x90, name: 'Spore Colony', race: 'Zerg', mineral: 50 }),
  b({ id: 0x92, name: 'Sunken Colony', race: 'Zerg', mineral: 50 }),
  b({ id: 0x86, name: 'Nydus Canal', race: 'Zerg', mineral: 150 }),
  b({ id: 0x95, name: 'Extractor', race: 'Zerg', mineral: 50 }),

  // ---- Protoss ----
  u({ id: 0x40, name: 'Probe', race: 'Protoss', mineral: 50, gas: 0, supply: 1, isWorker: true }),
  u({ id: 0x41, name: 'Zealot', race: 'Protoss', mineral: 100, gas: 0, supply: 2, isArmy: true }),
  u({ id: 0x42, name: 'Dragoon', race: 'Protoss', mineral: 125, gas: 50, supply: 2, isArmy: true }),
  u({ id: 0x43, name: 'High Templar', race: 'Protoss', mineral: 50, gas: 150, supply: 2, isArmy: true }),
  u({ id: 0x3d, name: 'Dark Templar', race: 'Protoss', mineral: 125, gas: 100, supply: 2, isArmy: true }),
  u({ id: 0x44, name: 'Archon', race: 'Protoss', mineral: 0, gas: 0, supply: 4, isArmy: true }),
  u({ id: 0x3f, name: 'Dark Archon', race: 'Protoss', mineral: 0, gas: 0, supply: 4, isArmy: true }),
  u({ id: 0x45, name: 'Shuttle', race: 'Protoss', mineral: 200, gas: 0, supply: 2, isArmy: true }),
  u({ id: 0x53, name: 'Reaver', race: 'Protoss', mineral: 200, gas: 100, supply: 4, isArmy: true }),
  u({ id: 0x54, name: 'Observer', race: 'Protoss', mineral: 25, gas: 75, supply: 1, isArmy: true }),
  u({ id: 0x46, name: 'Scout', race: 'Protoss', mineral: 275, gas: 125, supply: 3, isArmy: true }),
  u({ id: 0x3c, name: 'Corsair', race: 'Protoss', mineral: 150, gas: 100, supply: 2, isArmy: true }),
  u({ id: 0x47, name: 'Arbiter', race: 'Protoss', mineral: 100, gas: 350, supply: 4, isArmy: true }),
  u({ id: 0x48, name: 'Carrier', race: 'Protoss', mineral: 350, gas: 250, supply: 6, isArmy: true }),
  // Protoss buildings
  b({ id: 0x9a, name: 'Nexus', race: 'Protoss', mineral: 400 }),
  b({ id: 0x9c, name: 'Pylon', race: 'Protoss', mineral: 100 }),
  b({ id: 0x9d, name: 'Assimilator', race: 'Protoss', mineral: 100 }),
  b({ id: 0xa0, name: 'Gateway', race: 'Protoss', mineral: 150 }),
  b({ id: 0xa4, name: 'Cybernetics Core', race: 'Protoss', mineral: 200 }),
  b({ id: 0xa6, name: 'Forge', race: 'Protoss', mineral: 150 }),
  b({ id: 0xa2, name: 'Photon Cannon', race: 'Protoss', mineral: 150 }),
  b({ id: 0xa3, name: 'Citadel of Adun', race: 'Protoss', mineral: 150, gas: 100 }),
  b({ id: 0xa5, name: 'Templar Archives', race: 'Protoss', mineral: 150, gas: 200 }),
  b({ id: 0x9b, name: 'Robotics Facility', race: 'Protoss', mineral: 200, gas: 200 }),
  b({ id: 0x9f, name: 'Observatory', race: 'Protoss', mineral: 50, gas: 100 }),
  b({ id: 0xab, name: 'Robotics Support Bay', race: 'Protoss', mineral: 150, gas: 100 }),
  b({ id: 0xa7, name: 'Stargate', race: 'Protoss', mineral: 150, gas: 150 }),
  b({ id: 0xa9, name: 'Fleet Beacon', race: 'Protoss', mineral: 300, gas: 200 }),
  b({ id: 0xaa, name: 'Arbiter Tribunal', race: 'Protoss', mineral: 200, gas: 150 }),
  b({ id: 0xac, name: 'Shield Battery', race: 'Protoss', mineral: 100 }),
];

const byId = new Map<number, UnitMeta>(TABLE.map((u) => [u.id, u]));

export function unitMeta(id: number | undefined): UnitMeta | undefined {
  if (id === undefined) return undefined;
  return byId.get(id);
}

export function unitName(id: number | undefined, fallback: string = `Unit#${id}`): string {
  return unitMeta(id)?.name ?? fallback;
}

// ---- helpers for TABLE definitions ----

function u(x: {
  id: number; name: string; race: UnitRace; mineral: number; gas: number; supply: number;
  isWorker?: boolean; isArmy?: boolean; perMorph?: number;
}): UnitMeta {
  return {
    id: x.id,
    name: x.name,
    race: x.race,
    mineral: x.mineral,
    gas: x.gas,
    supply: x.supply,
    isWorker: !!x.isWorker,
    isBuilding: false,
    isArmy: !!x.isArmy,
    perMorph: x.perMorph,
  };
}

function b(x: { id: number; name: string; race: UnitRace; mineral: number; gas?: number }): UnitMeta {
  return {
    id: x.id,
    name: x.name,
    race: x.race,
    mineral: x.mineral,
    gas: x.gas ?? 0,
    supply: 0,
    isWorker: false,
    isBuilding: true,
    isArmy: false,
  };
}
