// First-contact detection. We can't see unit positions directly — only
// command positions — so we proxy engagement as: the first "Attack Move" or
// "Targeted Order" issued by any player whose target position lands near any
// opposing player's known structure. Structures are tracked via Build /
// BuildingMorph commands (tile units, scaled to pixels).
//
// Caveats:
//   - Proxies "first aggression" rather than literal first unit-on-unit
//     contact. A probe running into a mineral line with Right Click won't
//     register since Right Click is excluded; an Attack-Move with units will.
//   - The radius is tighter than the scouting radius so a lurking scout
//     doesn't trigger; it should be combat intent directed at infrastructure.

import type { ParsedReplay, ReplayCommand } from '../types/replay';
import { isEffective, TYPE_NAMES } from './commands';

const PIXELS_PER_TILE = 32;
// 10 tiles ≈ half a main-base footprint. Tight enough that a drive-by flyby
// close to the mid-map doesn't register, wide enough to catch an Attack-Move
// aimed at the edge of the opponent's perimeter.
const CONTACT_RADIUS_PIXELS = 10 * PIXELS_PER_TILE;

const AGGRESSIVE_TYPE_NAMES = new Set<string>(['Attack Move', 'Targeted Order']);

export interface FirstContact {
  frame: number;
  seconds: number;
  aggressorID: number;
  defenderID: number;
}

export function computeFirstContact(replay: ParsedReplay): FirstContact | null {
  const cmds = replay.Commands?.Cmds ?? [];
  if (!cmds.length) return null;

  // Structures built so far, per player. Build positions come on the wire in
  // tile coordinates; scale to pixel space to match attack command positions.
  const structuresByPID = new Map<number, Array<{ x: number; y: number }>>();
  const fps = 1000 / 42;

  for (const c of cmds) {
    if (!isEffective(c)) continue;
    const tn = c.Type?.Name;
    if (!tn) continue;

    if (tn === TYPE_NAMES.build || tn === TYPE_NAMES.buildingMorph) {
      const pos = getPos(c);
      if (!pos) continue;
      const list = structuresByPID.get(c.PlayerID) ?? [];
      list.push({ x: pos.X * PIXELS_PER_TILE, y: pos.Y * PIXELS_PER_TILE });
      structuresByPID.set(c.PlayerID, list);
      continue;
    }

    if (!AGGRESSIVE_TYPE_NAMES.has(tn)) continue;
    const pos = getPos(c);
    if (!pos) continue;

    for (const [otherPID, structures] of structuresByPID) {
      if (otherPID === c.PlayerID) continue;
      for (const s of structures) {
        const dx = pos.X - s.x;
        const dy = pos.Y - s.y;
        if (dx * dx + dy * dy <= CONTACT_RADIUS_PIXELS * CONTACT_RADIUS_PIXELS) {
          return {
            frame: c.Frame,
            seconds: c.Frame / fps,
            aggressorID: c.PlayerID,
            defenderID: otherPID,
          };
        }
      }
    }
  }

  return null;
}

function getPos(cmd: ReplayCommand): { X: number; Y: number } | undefined {
  const p = cmd.Pos as { X?: number; Y?: number } | undefined;
  if (!p || typeof p.X !== 'number' || typeof p.Y !== 'number') return undefined;
  return { X: p.X, Y: p.Y };
}
