// Opening classifier: maps each player's first ~3 minutes of build events
// onto a small table of well-known BW openings. The goal isn't to replace a
// coach — it's to give the user a one-line summary of what they're watching.
//
// Heuristics:
//   - We only look at `train`, `morph`, `build`, `buildingMorph` events.
//   - Each opening has a `match()` predicate that gets the player's events
//     (already sorted by frame, up to the cutoff) plus the player's race.
//   - The first opening that matches wins; otherwise we fall back to a coarse
//     label derived from the early tech path.

import type { BuildOrderEvent } from './buildOrder';
import type { ParsedReplay } from '../types/replay';
import { cleanBwString, raceLetter } from '../types/replay';

export interface OpeningLabel {
  playerID: number;
  playerName: string;
  race: string;      // 'Z' | 'P' | 'T' | '?'
  label: string;     // short tag, e.g. "9 Pool", "2 Hatch Muta"
  confidence: 'known' | 'inferred';
}

interface PlayerEvents {
  race: string;
  events: BuildOrderEvent[]; // already filtered to this player, sorted
}

type Matcher = (p: PlayerEvents) => boolean;

interface Opening {
  race: string;       // 'Z' | 'P' | 'T'
  label: string;
  match: Matcher;
}

// Helpers: first occurrence of a named building/unit, returning supply/seconds
// or null if the player never built it before the cutoff.
function first(events: BuildOrderEvent[], name: string): BuildOrderEvent | null {
  for (const e of events) if (e.name === name) return e;
  return null;
}
function countUntil(events: BuildOrderEvent[], name: string, sec: number): number {
  let n = 0;
  for (const e of events) if (e.seconds <= sec && e.name === name) n++;
  return n;
}

const OPENINGS: Opening[] = [
  // ---- Zerg ----
  {
    race: 'Z', label: '4 Pool',
    match: (p) => {
      const pool = first(p.events, 'Spawning Pool');
      return !!pool && pool.supply <= 5;
    },
  },
  {
    race: 'Z', label: '9 Pool',
    match: (p) => {
      const pool = first(p.events, 'Spawning Pool');
      return !!pool && pool.supply >= 7 && pool.supply <= 10 && pool.seconds <= 110;
    },
  },
  {
    race: 'Z', label: '12 Hatch',
    match: (p) => {
      const pool = first(p.events, 'Spawning Pool');
      const hatches = countUntil(p.events, 'Hatchery', 120);
      return !!pool && pool.supply >= 10 && hatches >= 1;
    },
  },
  {
    race: 'Z', label: '12 Pool',
    match: (p) => {
      const pool = first(p.events, 'Spawning Pool');
      return !!pool && pool.supply >= 10 && pool.supply <= 12 && pool.seconds <= 130;
    },
  },
  {
    race: 'Z', label: '2 Hatch Muta',
    match: (p) => {
      const spire = first(p.events, 'Spire');
      const hatches = countUntil(p.events, 'Hatchery', 240);
      return !!spire && spire.seconds <= 360 && hatches === 1;
    },
  },
  {
    race: 'Z', label: '3 Hatch Muta',
    match: (p) => {
      const spire = first(p.events, 'Spire');
      const hatches = countUntil(p.events, 'Hatchery', 300);
      return !!spire && spire.seconds <= 420 && hatches >= 2;
    },
  },
  {
    race: 'Z', label: 'Hydra bust',
    match: (p) => {
      const den = first(p.events, 'Hydralisk Den');
      return !!den && den.seconds <= 300;
    },
  },
  {
    race: 'Z', label: 'Lurker tech',
    match: (p) => !!first(p.events, 'Lurker'),
  },

  // ---- Protoss ----
  {
    race: 'P', label: 'Cannon rush',
    match: (p) => {
      const forge = first(p.events, 'Forge');
      const cannon = first(p.events, 'Photon Cannon');
      return !!forge && !!cannon && cannon.seconds <= 180;
    },
  },
  {
    race: 'P', label: 'Forge FE',
    match: (p) => {
      const forge = first(p.events, 'Forge');
      const nexus2 = countUntil(p.events, 'Nexus', 300);
      return !!forge && forge.seconds <= 180 && nexus2 >= 1;
    },
  },
  {
    race: 'P', label: 'Nexus first',
    match: (p) => {
      const gate = first(p.events, 'Gateway');
      const nexus2 = countUntil(p.events, 'Nexus', 240);
      return nexus2 >= 1 && (!gate || gate.seconds > 120);
    },
  },
  {
    race: 'P', label: '2 Gate Zealot',
    match: (p) => {
      const gates = countUntil(p.events, 'Gateway', 180);
      const core = first(p.events, 'Cybernetics Core');
      const zealots = countUntil(p.events, 'Zealot', 240);
      return gates >= 2 && zealots >= 3 && (!core || core.seconds > 200);
    },
  },
  {
    race: 'P', label: '1 Gate Core',
    match: (p) => {
      const gates = countUntil(p.events, 'Gateway', 180);
      const core = first(p.events, 'Cybernetics Core');
      return gates >= 1 && !!core && core.seconds <= 240;
    },
  },
  {
    race: 'P', label: 'DT rush',
    match: (p) => {
      const arch = first(p.events, 'Templar Archives');
      return !!arch && arch.seconds <= 420;
    },
  },
  {
    race: 'P', label: 'Reaver drop',
    match: (p) => {
      const robo = first(p.events, 'Robotics Facility');
      const shuttle = first(p.events, 'Shuttle');
      return !!robo && !!shuttle && shuttle.seconds <= 360;
    },
  },

  // ---- Terran ----
  {
    race: 'T', label: 'BBS (2 Rax proxy)',
    match: (p) => {
      const rax = countUntil(p.events, 'Barracks', 120);
      return rax >= 2;
    },
  },
  {
    race: 'T', label: '1 Rax FE',
    match: (p) => {
      const rax = first(p.events, 'Barracks');
      const cc = countUntil(p.events, 'Command Center', 300);
      return !!rax && cc >= 2;
    },
  },
  {
    race: 'T', label: '2 Rax Marine',
    match: (p) => {
      const rax = countUntil(p.events, 'Barracks', 240);
      const fact = first(p.events, 'Factory');
      return rax >= 2 && (!fact || fact.seconds > 240);
    },
  },
  {
    race: 'T', label: 'Siege Expand',
    match: (p) => {
      const fact = first(p.events, 'Factory');
      const tanks = countUntil(p.events, 'Siege Tank', 360);
      const cc = countUntil(p.events, 'Command Center', 420);
      return !!fact && tanks >= 1 && cc >= 2;
    },
  },
  {
    race: 'T', label: 'Mech (2 Fact)',
    match: (p) => {
      const facts = countUntil(p.events, 'Factory', 300);
      return facts >= 2;
    },
  },
  {
    race: 'T', label: 'Wraith rush',
    match: (p) => {
      const star = first(p.events, 'Starport');
      const wraith = first(p.events, 'Wraith');
      return !!star && !!wraith && wraith.seconds <= 420;
    },
  },
];

const CUTOFF_SECONDS = 300; // 5 minutes: long enough to classify, short enough to stay "opening"

export function classifyOpenings(replay: ParsedReplay, allEvents: BuildOrderEvent[]): OpeningLabel[] {
  const players = (replay.Header?.Players ?? []).filter((p) => !p.Observer);
  const out: OpeningLabel[] = [];

  for (const p of players) {
    const race = raceLetter(p.Race);
    const events = allEvents
      .filter((e) => e.playerID === p.ID && e.seconds <= CUTOFF_SECONDS)
      .sort((a, b) => a.frame - b.frame);

    const pe: PlayerEvents = { race, events };
    let label: string | null = null;
    for (const o of OPENINGS) {
      if (o.race !== race) continue;
      if (o.match(pe)) {
        label = o.label;
        break;
      }
    }

    out.push({
      playerID: p.ID,
      playerName: cleanBwString(p.Name),
      race,
      label: label ?? fallbackLabel(race, events),
      confidence: label ? 'known' : 'inferred',
    });
  }
  return out;
}

// If no named opening matches, emit a coarse tech path so the user isn't
// staring at "Unknown". Pick the first tech building of interest.
function fallbackLabel(race: string, events: BuildOrderEvent[]): string {
  const firstTechNames: Record<string, string[]> = {
    Z: ['Spawning Pool', 'Hydralisk Den', 'Spire', 'Lair'],
    P: ['Gateway', 'Cybernetics Core', 'Robotics Facility', 'Stargate'],
    T: ['Barracks', 'Factory', 'Starport', 'Academy'],
  };
  const watch = firstTechNames[race] ?? [];
  for (const e of events) {
    if (watch.includes(e.name)) return `${e.name} @ ${e.supply}`;
  }
  return 'Unknown opening';
}
