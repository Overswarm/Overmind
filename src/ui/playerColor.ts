// Resolves which CSS color slot each player should use. Without pinning,
// players take slots in replay order (P1 → a, P2 → b). With identities set,
// whichever player matches one of the user's me-tags is moved to slot a so
// "you" stay blue across replays even when sides swap.

import { cleanBwString, type ReplayPlayer } from '../types/replay';

export const PLAYER_SLOT_VARS = [
  '--color-player-a',
  '--color-player-b',
  '--color-player-c',
  '--color-player-d',
] as const;

export const PLAYER_SLOT_FALLBACKS = ['#38bdf8', '#f97316', '#a855f7', '#f472b6'] as const;

export function playerColorVar(slot: number): string {
  const v = PLAYER_SLOT_VARS[slot % PLAYER_SLOT_VARS.length];
  return `var(${v})`;
}

export function playerColorFallback(slot: number): string {
  return PLAYER_SLOT_FALLBACKS[slot % PLAYER_SLOT_FALLBACKS.length];
}

function eqCI(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Return a playerID → slot-index map. Non-observers only. If any identity
// matches a player, that player is promoted to slot 0; everyone else keeps
// their relative order after that. No identity match ⇒ replay order.
export function playerSlotMap(
  players: ReplayPlayer[] | undefined,
  identities: string[] = [],
): Map<number, number> {
  const out = new Map<number, number>();
  const nonObs = (players ?? []).filter((p) => !p.Observer);
  const mePID = identities.length
    ? nonObs.find((p) =>
        identities.some((i) => eqCI(i, cleanBwString(p.Name))),
      )?.ID
    : undefined;
  if (mePID == null) {
    nonObs.forEach((p, i) => out.set(p.ID, i));
    return out;
  }
  const me = nonObs.find((p) => p.ID === mePID)!;
  const rest = nonObs.filter((p) => p.ID !== mePID);
  [me, ...rest].forEach((p, i) => out.set(p.ID, i));
  return out;
}
