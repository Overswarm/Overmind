// Scouting detection. For each player, find the first moment they issue a
// positional command (Right Click, Move, Targeted Order, Attack Move) that
// lands inside an opponent's main-base footprint, and emit that as a marker
// so the timeline can surface "first scout at 1:42" alongside tech and
// expansion ticks.
//
// Caveats:
//   - Commands carry the click/move point, not the unit that executes it.
//     Someone sending an overlord's move-destination into the opponent's
//     base still counts as a scout, which is fine since it matches intent.
//   - We use start locations from Computed.PlayerDescs (populated by
//     rep.Compute()) in BW pixel units. Build commands are excluded here
//     because they use tile units on the wire and have different semantics.

import type { ParsedReplay, ReplayCommand } from '../types/replay';
import { isEffective } from './commands';

export interface ScoutMarker {
  frame: number;
  seconds: number;
  playerID: number;          // The scout (the one issuing the command)
  targetPlayerID: number;    // Whose base was scouted
  label: string;             // e.g. "Scouts P2" — short enough for a marker title
}

// Radius (in BW pixels) around the opponent's start location that counts as
// "inside their base". A main base is ~10 tiles across; 12 gives a small
// buffer around the ramp so a probe parked just outside still registers.
const SCOUT_RADIUS_PIXELS = 12 * 32;

// Only positional commands that reflect where a player is directing
// attention. Chat pings would also mean "I looked there" but the intent
// (scouting) is weaker than an actual unit move.
const SCOUTING_TYPE_NAMES = new Set<string>([
  'Right Click',
  'Move',
  'Targeted Order',
  'Attack Move',
]);

export function computeScouts(replay: ParsedReplay): ScoutMarker[] {
  const players = (replay.Header?.Players ?? []).filter((p) => !p.Observer);
  const descs = replay.Computed?.PlayerDescs ?? [];
  const startByPID = new Map<number, { x: number; y: number; name: string }>();
  const nameByPID = new Map<number, string>();
  for (const p of players) nameByPID.set(p.ID, p.Name);
  for (const d of descs) {
    const sl = d.StartLocation;
    if (!sl || typeof sl.X !== 'number' || typeof sl.Y !== 'number') continue;
    const name = nameByPID.get(d.PlayerID);
    if (!name) continue;
    startByPID.set(d.PlayerID, { x: sl.X, y: sl.Y, name });
  }

  // Fewer than two known start locations means we can't usefully define
  // "enemy base". Bail out quietly rather than emit misleading markers.
  if (startByPID.size < 2) return [];

  const seen = new Set<string>();  // `${scoutPID}->${targetPID}`
  const fps = 1000 / 42;
  const out: ScoutMarker[] = [];

  for (const c of replay.Commands?.Cmds ?? []) {
    if (!isEffective(c)) continue;
    const tn = c.Type?.Name;
    if (!tn || !SCOUTING_TYPE_NAMES.has(tn)) continue;
    const pos = getPos(c);
    if (!pos) continue;
    const scout = c.PlayerID;
    const scoutStart = startByPID.get(scout);
    if (!scoutStart) continue;

    for (const [targetPID, target] of startByPID) {
      if (targetPID === scout) continue;
      const key = `${scout}->${targetPID}`;
      if (seen.has(key)) continue;
      const dx = pos.X - target.x;
      const dy = pos.Y - target.y;
      if (dx * dx + dy * dy > SCOUT_RADIUS_PIXELS * SCOUT_RADIUS_PIXELS) continue;
      seen.add(key);
      const targetLabel = shortName(target.name) || `P${targetPID}`;
      out.push({
        frame: c.Frame,
        seconds: c.Frame / fps,
        playerID: scout,
        targetPlayerID: targetPID,
        label: `Scouts ${targetLabel}`,
      });
    }
  }

  out.sort((a, b) => a.frame - b.frame);
  return out;
}

function getPos(cmd: ReplayCommand): { X: number; Y: number } | undefined {
  const p = cmd.Pos as { X?: number; Y?: number } | undefined;
  if (!p || typeof p.X !== 'number' || typeof p.Y !== 'number') return undefined;
  return { X: p.X, Y: p.Y };
}

function shortName(name: string): string {
  // Trim BW color codes the cheap way and cap length so labels fit in a
  // swing-marker tooltip.
  const cleaned = name.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return cleaned.length > 12 ? cleaned.slice(0, 12) + '…' : cleaned;
}
