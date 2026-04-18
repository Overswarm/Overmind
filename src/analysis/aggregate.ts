// Library-wide aggregation. Walks the full library plus each cached parsed
// replay and produces cross-replay summary stats: matchup frequencies, per-
// race winrate, average APM / supply-blocks / production-idle. Designed to
// tolerate missing parsed caches (stat that requires a cached replay is
// simply skipped for that entry) so the view still populates while older
// replays are being re-parsed in the background.

import type { LibraryEntry } from '../storage/db';
import type { ParsedReplay } from '../types/replay';
import { cleanBwString, raceLetter } from '../types/replay';
import { computeBuildOrder } from './buildOrder';
import { computeSupplyBlocks } from './supplyBlocks';
import { computeProductionIdle } from './productionIdle';
import { unitMeta } from './units';

export interface ReplayDigest {
  hash: string;
  name: string;
  mapName?: string;
  matchup: string;             // e.g. "TvP"
  startTime?: string;
  durationSeconds: number;
  winnerTeam?: number;
  notes?: string;
  players: PlayerDigest[];
}

export interface PlayerDigest {
  playerID: number;
  name: string;
  race: string;                // "T" / "P" / "Z" / "?"
  team: number;
  apm: number;
  eapm: number;
  won: boolean | null;         // null when winnerTeam unknown
  // True when the player's name matches one of the user's configured
  // identities. Enables me-vs-opponent aggregates.
  isMe: boolean;
  supplyBlockSeconds: number;
  supplyBlockCount: number;
  productionIdleByPool: { name: string; count: number; idleRatio: number }[];
  // Unit counts aggregated by name: { "Marine": 60, "Siege Tank": 8 }.
  unitsProduced: Record<string, number>;
  // Buildings constructed, similarly aggregated.
  buildingsProduced: Record<string, number>;
}

export interface Aggregate {
  totalGames: number;
  matchupCounts: Record<string, number>;
  byRace: Record<string, { games: number; wins: number; losses: number; unknown: number }>;
  averageApmByRace: Record<string, number>;
  averageDurationSeconds: number;
  supplyBlockAverageSeconds: number;
  productionIdleAverageRatio: number;
  // Me-vs-opponent split. Only populated when at least one player in some
  // digest is flagged isMe; otherwise `me.games === 0`.
  me: MeAggregate;
}

export interface MeAggregate {
  // Games where at least one me-player was found (and not observing).
  games: number;
  wins: number;
  losses: number;
  unknown: number;
  // Per-race winrate as me (opponent's race): { "T": {games, wins, losses} }.
  // Key is the opponent's race; intended for 1v1. For team games we use the
  // first non-me player on the other team.
  byOpponentRace: Record<
    string,
    { games: number; wins: number; losses: number; unknown: number }
  >;
  // Average APM for me and for opponents (across all me-containing games).
  averageApmMe: number;
  averageApmOpp: number;
  // Average build rates: total units / buildings produced per game.
  averageUnitsMe: number;
  averageUnitsOpp: number;
}

// Matchup-agnostic key for a single player line (race + whether we have a
// parsed replay). Useful for summary tables.
export function digestReplay(
  entry: LibraryEntry,
  replay: ParsedReplay,
  identities: string[] = [],
): ReplayDigest {
  const identitySet = new Set(identities.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const h = replay.Header;
  const c = replay.Computed;
  const nonObs = (h?.Players ?? []).filter((p) => !p.Observer);

  const matchup = deriveMatchup(nonObs);
  const fps = 1000 / 42;
  const durationSeconds = (h?.Frames ?? 0) / fps;

  // Shared analyses: build order, supply blocks, production idle.
  const events = computeBuildOrder(replay);
  const pids = nonObs.map((p) => p.ID);
  const supplyBlocks = computeSupplyBlocks(events, pids, h?.Frames ?? 0);
  const production = computeProductionIdle(events, pids, h?.Frames ?? 0);

  const players: PlayerDigest[] = nonObs.map((p) => {
    const desc = c?.PlayerDescs?.find((d) => d.PlayerID === p.ID);
    const won = c?.WinnerTeam != null ? p.Team === c.WinnerTeam : null;

    // Tally build-order events into units and buildings produced.
    const unitsProduced: Record<string, number> = {};
    const buildingsProduced: Record<string, number> = {};
    for (const e of events) {
      if (e.playerID !== p.ID) continue;
      if (e.unitID === undefined) continue;
      const meta = unitMeta(e.unitID);
      if (!meta) continue;
      const count = meta.perMorph ?? 1;
      if (meta.isBuilding) {
        buildingsProduced[meta.name] = (buildingsProduced[meta.name] ?? 0) + count;
      } else if (e.kind === 'train' || e.kind === 'morph') {
        unitsProduced[meta.name] = (unitsProduced[meta.name] ?? 0) + count;
      }
    }

    const blocks = supplyBlocks.intervals.filter((iv) => iv.playerID === p.ID);
    const pools = production.byPlayer.get(p.ID) ?? [];

    const cleanedName = cleanBwString(p.Name);
    const isMe = identitySet.has(cleanedName.trim().toLowerCase());

    return {
      playerID: p.ID,
      name: cleanedName,
      race: raceLetter(p.Race),
      team: p.Team,
      apm: Math.round(desc?.APM ?? 0),
      eapm: Math.round(desc?.EAPM ?? 0),
      won,
      isMe,
      supplyBlockSeconds: supplyBlocks.totalSecondsByPID.get(p.ID) ?? 0,
      supplyBlockCount: blocks.length,
      productionIdleByPool: pools
        .filter((pl) => pl.count > 0)
        .map((pl) => ({ name: pl.name, count: pl.count, idleRatio: pl.idleRatio })),
      unitsProduced,
      buildingsProduced,
    };
  });

  return {
    hash: entry.hash,
    name: entry.name,
    mapName: entry.mapName || cleanBwString(replay.MapData?.Name || h?.Map || ''),
    matchup,
    startTime: entry.startTime,
    durationSeconds,
    winnerTeam: c?.WinnerTeam,
    notes: entry.notes,
    players,
  };
}

export function aggregateDigests(digests: ReplayDigest[]): Aggregate {
  const matchupCounts: Record<string, number> = {};
  const byRace: Record<string, { games: number; wins: number; losses: number; unknown: number }> = {};
  const apmByRace: Record<string, { sum: number; n: number }> = {};
  let sumDuration = 0;
  let sumSupplyBlockSec = 0;
  let sbN = 0;
  let sumIdleRatio = 0;
  let idleN = 0;

  // Me-vs-opponent accumulators.
  const me: MeAggregate = {
    games: 0,
    wins: 0,
    losses: 0,
    unknown: 0,
    byOpponentRace: {},
    averageApmMe: 0,
    averageApmOpp: 0,
    averageUnitsMe: 0,
    averageUnitsOpp: 0,
  };
  let meApmSum = 0, meApmN = 0, oppApmSum = 0, oppApmN = 0;
  let meUnitsSum = 0, oppUnitsSum = 0;

  for (const d of digests) {
    matchupCounts[d.matchup] = (matchupCounts[d.matchup] ?? 0) + 1;
    sumDuration += d.durationSeconds;
    for (const p of d.players) {
      byRace[p.race] ??= { games: 0, wins: 0, losses: 0, unknown: 0 };
      byRace[p.race].games += 1;
      if (p.won === true) byRace[p.race].wins += 1;
      else if (p.won === false) byRace[p.race].losses += 1;
      else byRace[p.race].unknown += 1;
      apmByRace[p.race] ??= { sum: 0, n: 0 };
      apmByRace[p.race].sum += p.apm;
      apmByRace[p.race].n += 1;
      sumSupplyBlockSec += p.supplyBlockSeconds;
      sbN += 1;
      for (const pool of p.productionIdleByPool) {
        sumIdleRatio += pool.idleRatio;
        idleN += 1;
      }
    }

    // Me side of this game: treat as "me" if any me-flagged player is present.
    // If multiple me-players (team game), take the first as the representative.
    const mePlayers = d.players.filter((p) => p.isMe);
    if (mePlayers.length > 0) {
      const meRep = mePlayers[0];
      const oppPlayers = d.players.filter((p) => p.team !== meRep.team);
      if (oppPlayers.length > 0) {
        me.games += 1;
        if (meRep.won === true) me.wins += 1;
        else if (meRep.won === false) me.losses += 1;
        else me.unknown += 1;

        const oppRep = oppPlayers[0];
        const key = oppRep.race;
        me.byOpponentRace[key] ??= { games: 0, wins: 0, losses: 0, unknown: 0 };
        me.byOpponentRace[key].games += 1;
        if (meRep.won === true) me.byOpponentRace[key].wins += 1;
        else if (meRep.won === false) me.byOpponentRace[key].losses += 1;
        else me.byOpponentRace[key].unknown += 1;

        for (const p of mePlayers) { meApmSum += p.apm; meApmN += 1; }
        for (const p of oppPlayers) { oppApmSum += p.apm; oppApmN += 1; }

        const sumUnits = (d2: typeof meRep) =>
          Object.values(d2.unitsProduced).reduce((a, b) => a + b, 0);
        meUnitsSum += sumUnits(meRep);
        oppUnitsSum += sumUnits(oppRep);
      }
    }
  }

  const averageApmByRace: Record<string, number> = {};
  for (const [r, v] of Object.entries(apmByRace)) {
    averageApmByRace[r] = v.n > 0 ? v.sum / v.n : 0;
  }

  me.averageApmMe = meApmN > 0 ? meApmSum / meApmN : 0;
  me.averageApmOpp = oppApmN > 0 ? oppApmSum / oppApmN : 0;
  me.averageUnitsMe = me.games > 0 ? meUnitsSum / me.games : 0;
  me.averageUnitsOpp = me.games > 0 ? oppUnitsSum / me.games : 0;

  return {
    totalGames: digests.length,
    matchupCounts,
    byRace,
    averageApmByRace,
    averageDurationSeconds: digests.length > 0 ? sumDuration / digests.length : 0,
    supplyBlockAverageSeconds: sbN > 0 ? sumSupplyBlockSec / sbN : 0,
    productionIdleAverageRatio: idleN > 0 ? sumIdleRatio / idleN : 0,
    me,
  };
}

function deriveMatchup(players: Array<{ Team: number; Race?: { Letter?: number; ShortName?: string } }>): string {
  if (!players.length) return '??';
  const parts: string[] = [];
  let prevTeam = players[0].Team;
  players.forEach((p, i) => {
    if (i > 0 && p.Team !== prevTeam) parts.push('v');
    parts.push(raceLetter(p.Race));
    prevTeam = p.Team;
  });
  return parts.join('');
}
