// "Swing markers" are moments worth scrubbing to: expansions, first-of-tech
// buildings, key unit reveals, and first-scout events. Without death / damage
// data we can't detect army trades, so these are strategic markers rather
// than combat ones.
//
// A marker is a (frame, playerID, label) triple. The timeline renders these as
// small ticks, color-matched to the player.

import type { ParsedReplay } from '../types/replay';
import type { BuildOrderEvent } from './buildOrder';
import { computeScouts } from './scouting';

export interface SwingMarker {
  frame: number;
  seconds: number;
  playerID: number;
  label: string;
  kind: 'expansion' | 'tech' | 'unit' | 'scout';
}

// First-of-kind tech buildings worth marking. Keyed by unit name from units.ts.
const TECH_FIRSTS = new Set<string>([
  // Zerg
  'Lair', 'Hive', 'Spawning Pool', 'Hydralisk Den', 'Spire', 'Greater Spire',
  'Queens Nest', 'Defiler Mound', 'Ultralisk Cavern',
  // Protoss
  'Cybernetics Core', 'Citadel of Adun', 'Templar Archives', 'Robotics Facility',
  'Observatory', 'Robotics Support Bay', 'Stargate', 'Fleet Beacon',
  'Arbiter Tribunal',
  // Terran
  'Academy', 'Factory', 'Starport', 'Science Facility', 'Armory', 'Covert Ops',
  'Machine Shop', 'Control Tower',
]);

// First-of-kind army unit reveals that are strategically meaningful.
const UNIT_FIRSTS = new Set<string>([
  'Mutalisk', 'Lurker', 'Guardian', 'Devourer', 'Queen', 'Defiler', 'Ultralisk',
  'Dark Templar', 'High Templar', 'Reaver', 'Observer', 'Arbiter', 'Carrier', 'Scout', 'Corsair',
  'Siege Tank', 'Vulture', 'Wraith', 'Dropship', 'Science Vessel', 'Valkyrie', 'Battlecruiser', 'Firebat',
]);

// Expansion buildings per race (second and later count as expansions).
const EXPANSION_NAMES = new Set(['Hatchery', 'Nexus', 'Command Center']);

export function computeSwingMarkers(events: BuildOrderEvent[], replay?: ParsedReplay): SwingMarker[] {
  const out: SwingMarker[] = [];
  const seenTech = new Set<string>();       // key: `${pid}::${name}`
  const seenUnit = new Set<string>();
  const expansionCount = new Map<number, number>();

  if (replay) {
    for (const s of computeScouts(replay)) {
      out.push({
        frame: s.frame,
        seconds: s.seconds,
        playerID: s.playerID,
        label: s.label,
        kind: 'scout',
      });
    }
  }

  for (const e of events) {
    const techKey = `${e.playerID}::${e.name}`;

    if (EXPANSION_NAMES.has(e.name) && (e.kind === 'build' || e.kind === 'buildingMorph')) {
      const n = (expansionCount.get(e.playerID) ?? 0) + 1;
      expansionCount.set(e.playerID, n);
      if (n >= 2) {
        out.push({
          frame: e.frame, seconds: e.seconds, playerID: e.playerID,
          label: `Base ${n}`, kind: 'expansion',
        });
      }
      continue;
    }

    if (TECH_FIRSTS.has(e.name) && !seenTech.has(techKey)) {
      seenTech.add(techKey);
      out.push({
        frame: e.frame, seconds: e.seconds, playerID: e.playerID,
        label: e.name, kind: 'tech',
      });
      continue;
    }

    if (UNIT_FIRSTS.has(e.name) && !seenUnit.has(techKey)) {
      seenUnit.add(techKey);
      out.push({
        frame: e.frame, seconds: e.seconds, playerID: e.playerID,
        label: `1st ${e.name}`, kind: 'unit',
      });
    }
  }

  return out;
}
