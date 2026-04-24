// Spawn position classification. BW's four-spawn maps split a 1v1 into
// "close spawns" (neighbors along one edge of the map) and "cross spawns"
// (diagonal corners). The distinction is strategically huge — push rushes
// are viable on close, tougher on cross — and Overmind couldn't surface it
// because screp only hands us raw start-location pixels. This module maps
// those pixels to quadrants and derives the pairing.
//
// For 2-spawn maps the pairing is always the same position pair, so we
// emit `simple: 'unknown'` and leave it for the UI to hide the label.

import type { ParsedReplay } from '../types/replay';

export type SpawnQuadrant = 'TL' | 'TR' | 'BL' | 'BR';
export type SpawnPairing = 'cross' | 'horizontal' | 'vertical' | 'same' | 'unknown';
// Coarse summary used for library rollups — every non-cross adjacency is
// "close" because the strategic difference is cross vs. not-cross.
export type SpawnSimple = 'close' | 'cross' | 'unknown';

export interface SpawnInfo {
  byPlayer: Map<number, SpawnQuadrant>;
  pairing: SpawnPairing;
  simple: SpawnSimple;
}

export function computeSpawnInfo(replay: ParsedReplay): SpawnInfo {
  const h = replay.Header;
  const c = replay.Computed;
  const mapW = Math.max(1, (h?.MapWidth ?? 128) * 32);
  const mapH = Math.max(1, (h?.MapHeight ?? 128) * 32);
  const byPlayer = new Map<number, SpawnQuadrant>();
  const players = (h?.Players ?? []).filter((p) => !p.Observer);
  for (const p of players) {
    const d = c?.PlayerDescs?.find((q) => q.PlayerID === p.ID);
    const sl = d?.StartLocation;
    if (!sl || typeof sl.X !== 'number' || typeof sl.Y !== 'number') continue;
    const left = sl.X < mapW / 2;
    const top = sl.Y < mapH / 2;
    const q: SpawnQuadrant = (top ? (left ? 'TL' : 'TR') : (left ? 'BL' : 'BR'));
    byPlayer.set(p.ID, q);
  }

  if (players.length !== 2 || byPlayer.size !== 2) {
    return { byPlayer, pairing: 'unknown', simple: 'unknown' };
  }
  const a = byPlayer.get(players[0].ID)!;
  const b = byPlayer.get(players[1].ID)!;
  if (a === b) return { byPlayer, pairing: 'same', simple: 'unknown' };
  const sameSideV = a[0] === b[0]; // both T or both B
  const sameSideH = a[1] === b[1]; // both L or both R
  let pairing: SpawnPairing;
  if (sameSideV && sameSideH) pairing = 'same';
  else if (sameSideV) pairing = 'horizontal';
  else if (sameSideH) pairing = 'vertical';
  else pairing = 'cross';
  const simple: SpawnSimple = pairing === 'cross' ? 'cross' : 'close';
  return { byPlayer, pairing, simple };
}
