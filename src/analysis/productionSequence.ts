// Condensed per-player "opening shape" — the strategic buildings that
// define the build, pulled out of the full build-order stream. Leaves out
// Supply Depots, Pylons, Overlords, and static defense (Cannons, Bunkers,
// Sunkens, Creep Colonies), since those are reactive and don't pattern-
// match well. The result is a short chain like
//     Gateway@1:18 > Assimilator@1:35 > Cybernetics Core@2:02 > Gateway@2:45 > Robotics Facility@4:12
// that an LLM (or the Claude-export pipeline) can match against known
// openings without us hardcoding an opening taxonomy.

import type { BuildOrderEvent } from './buildOrder';

const INFRASTRUCTURE_NAMES = new Set<string>([
  // Terran infrastructure
  'Command Center', 'Barracks', 'Factory', 'Starport', 'Refinery',
  'Academy', 'Engineering Bay', 'Armory', 'Science Facility', 'Covert Ops',
  'Physics Lab', 'Machine Shop', 'Control Tower',
  // Protoss infrastructure
  'Nexus', 'Gateway', 'Robotics Facility', 'Stargate', 'Assimilator',
  'Cybernetics Core', 'Forge', 'Citadel of Adun', 'Templar Archives',
  'Robotics Support Bay', 'Observatory', 'Fleet Beacon', 'Arbiter Tribunal',
  // Zerg infrastructure
  'Hatchery', 'Lair', 'Hive', 'Extractor',
  'Spawning Pool', 'Evolution Chamber', 'Hydralisk Den',
  'Spire', 'Greater Spire', 'Queens Nest', 'Defiler Mound',
  'Ultralisk Cavern', 'Nydus Canal',
]);

export interface ProductionStep {
  name: string;
  seconds: number;
  kind: 'build' | 'buildingMorph';
}

export function computeProductionSequence(
  events: BuildOrderEvent[],
  playerID: number,
): ProductionStep[] {
  const out: ProductionStep[] = [];
  for (const e of events) {
    if (e.playerID !== playerID) continue;
    if (e.kind !== 'build' && e.kind !== 'buildingMorph') continue;
    if (!INFRASTRUCTURE_NAMES.has(e.name)) continue;
    out.push({ name: e.name, seconds: e.seconds, kind: e.kind });
  }
  return out;
}

// Format the sequence as a single compact line. `limit` caps how many steps
// are shown (earliest first); anything dropped is summarized as "(+N more)".
// `short` switches to common shorthand (Rax / Fact / Cyber / Hatch) to keep
// the line readable in dense exports.
export function formatProductionSequence(
  steps: ProductionStep[],
  opts: { limit?: number; short?: boolean } = {},
): string {
  const { limit = 20, short = true } = opts;
  const visible = steps.slice(0, limit);
  const parts = visible.map((s) => {
    const name = short ? (SHORT_NAMES[s.name] ?? s.name) : s.name;
    return `${name}@${fmt(s.seconds)}`;
  });
  if (steps.length > limit) parts.push(`(+${steps.length - limit} more)`);
  return parts.join(' > ');
}

const SHORT_NAMES: Record<string, string> = {
  'Command Center': 'CC',
  'Barracks': 'Rax',
  'Factory': 'Fact',
  'Starport': 'Starport',
  'Refinery': 'Refinery',
  'Academy': 'Academy',
  'Engineering Bay': 'EBay',
  'Armory': 'Armory',
  'Science Facility': 'SciFac',
  'Covert Ops': 'CovertOps',
  'Machine Shop': 'MachShop',
  'Control Tower': 'CtrlTower',
  'Nexus': 'Nexus',
  'Gateway': 'Gate',
  'Robotics Facility': 'Robo',
  'Stargate': 'Stargate',
  'Assimilator': 'Gas',
  'Cybernetics Core': 'Cyber',
  'Forge': 'Forge',
  'Citadel of Adun': 'Citadel',
  'Templar Archives': 'Archives',
  'Robotics Support Bay': 'RSB',
  'Observatory': 'Obs',
  'Fleet Beacon': 'Fleet',
  'Arbiter Tribunal': 'ArbTrib',
  'Hatchery': 'Hatch',
  'Lair': 'Lair',
  'Hive': 'Hive',
  'Extractor': 'Gas',
  'Spawning Pool': 'Pool',
  'Evolution Chamber': 'Evo',
  'Hydralisk Den': 'HydraDen',
  'Spire': 'Spire',
  'Greater Spire': 'GSpire',
  "Queens Nest": 'QNest',
  'Defiler Mound': 'Defiler',
  'Ultralisk Cavern': 'UltraCavern',
  'Nydus Canal': 'Nydus',
};

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
