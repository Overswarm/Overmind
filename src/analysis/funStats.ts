// "Fun facts" aggregator for the Stats tab. Walks already-computed ReplayDigests
// that contain a `me` player and surfaces a set of bite-sized factoids:
// records (fastest win, longest game), career totals (time played, record),
// army counts grouped by your race, top opponents / maps, game-length mix per
// matchup, and your favorite opening per matchup.
//
// Everything in this file is a pure function over the digest list. The caller
// is responsible for filtering beforehand (my race / opponent race / map).

import type { ReplayDigest, PlayerDigest } from './aggregate';

export interface MeGame {
  digest: ReplayDigest;
  me: PlayerDigest;
  opp: PlayerDigest | null;   // first player on another team; may be null
}

export function selectMeGames(digests: ReplayDigest[]): MeGame[] {
  const out: MeGame[] = [];
  for (const d of digests) {
    const mePlayers = d.players.filter((p) => p.isMe);
    if (mePlayers.length === 0) continue;
    const me = mePlayers[0];
    const opp = d.players.find((p) => p.team !== me.team) ?? null;
    out.push({ digest: d, me, opp });
  }
  return out;
}

export interface RecordEntry {
  label: string;
  value: string;
  detail?: string;   // map / opponent / date
}

export interface OpponentRow {
  name: string;
  games: number;
  wins: number;
  losses: number;
  race: string;   // most-played race
}

export interface MapRow {
  name: string;
  games: number;
  wins: number;
  losses: number;
}

export interface LengthBucketRow {
  matchup: string;
  games: number;
  over15: number;
  over20: number;
  over30: number;
}

export interface OpeningRow {
  matchup: string;
  opening: string;
  count: number;
  games: number;
}

export interface FunStats {
  // Career totals
  games: number;
  wins: number;
  losses: number;
  unknown: number;
  totalSeconds: number;
  longestWinStreak: number;
  longestLossStreak: number;

  // Headline records
  records: RecordEntry[];

  // Per-race career: tanks/zealots/mutas/etc. Key is the me race for that game.
  byMyRace: Record<
    string,
    {
      games: number;
      wins: number;
      losses: number;
      unitsProduced: Record<string, number>;
      buildingsProduced: Record<string, number>;
      workers: number;
    }
  >;

  // Top N lists
  topOpponents: OpponentRow[];
  topMaps: MapRow[];

  // Distributions / habits
  lengthBuckets: LengthBucketRow[];
  openings: OpeningRow[];
}

export function computeFunStats(digests: ReplayDigest[]): FunStats {
  const games = selectMeGames(digests);

  const stats: FunStats = {
    games: games.length,
    wins: 0,
    losses: 0,
    unknown: 0,
    totalSeconds: 0,
    longestWinStreak: 0,
    longestLossStreak: 0,
    records: [],
    byMyRace: {},
    topOpponents: [],
    topMaps: [],
    lengthBuckets: [],
    openings: [],
  };

  if (games.length === 0) return stats;

  // --- career totals ---------------------------------------------------------
  for (const { digest, me } of games) {
    stats.totalSeconds += digest.durationSeconds;
    if (me.won === true) stats.wins += 1;
    else if (me.won === false) stats.losses += 1;
    else stats.unknown += 1;
  }

  // Streaks across games ordered by startTime (falling back to input order).
  const orderedByDate = [...games]
    .map((g, i) => ({ g, t: g.digest.startTime ? Date.parse(g.digest.startTime) || i : i }))
    .sort((a, b) => a.t - b.t)
    .map((x) => x.g);
  let winStreak = 0, lossStreak = 0;
  for (const { me } of orderedByDate) {
    if (me.won === true) {
      winStreak += 1;
      lossStreak = 0;
    } else if (me.won === false) {
      lossStreak += 1;
      winStreak = 0;
    } else {
      winStreak = 0;
      lossStreak = 0;
    }
    if (winStreak > stats.longestWinStreak) stats.longestWinStreak = winStreak;
    if (lossStreak > stats.longestLossStreak) stats.longestLossStreak = lossStreak;
  }

  // --- records ---------------------------------------------------------------
  const wins = games.filter((g) => g.me.won === true);
  const losses = games.filter((g) => g.me.won === false);
  const fastestWin = minBy(wins, (g) => g.digest.durationSeconds);
  const fastestLoss = minBy(losses, (g) => g.digest.durationSeconds);
  const longest = maxBy(games, (g) => g.digest.durationSeconds);
  const shortest = minBy(games, (g) => g.digest.durationSeconds);
  const highestApm = maxBy(games, (g) => g.me.apm);
  const worstBlock = maxBy(games, (g) => g.me.supplyBlockSeconds);
  const cleanestMacro = minBy(
    games.filter((g) => g.digest.durationSeconds >= 10 * 60),
    (g) => g.me.supplyBlockSeconds,
  );
  const mostUnitsGame = maxBy(games, (g) =>
    Object.values(g.me.unitsProduced).reduce((a, b) => a + b, 0),
  );

  const record = (label: string, g: MeGame | null, value: string): RecordEntry | null => {
    if (!g) return null;
    const when = g.digest.startTime ? g.digest.startTime.slice(0, 10) : '';
    const oppName = g.opp?.name ?? 'unknown';
    const oppRace = g.opp?.race ?? '?';
    const map = g.digest.mapName ?? g.digest.name;
    return {
      label,
      value,
      detail: `vs ${oppName} (${oppRace}) · ${map}${when ? ` · ${when}` : ''}`,
    };
  };

  const maybePush = (r: RecordEntry | null) => { if (r) stats.records.push(r); };
  maybePush(record('Fastest win', fastestWin, formatMMSS(fastestWin?.digest.durationSeconds ?? 0)));
  maybePush(record('Fastest loss', fastestLoss, formatMMSS(fastestLoss?.digest.durationSeconds ?? 0)));
  maybePush(record('Longest game', longest, formatMMSS(longest?.digest.durationSeconds ?? 0)));
  maybePush(record('Shortest game', shortest, formatMMSS(shortest?.digest.durationSeconds ?? 0)));
  maybePush(record('Highest APM', highestApm, `${highestApm?.me.apm ?? 0} APM`));
  maybePush(record('Most supply-blocked', worstBlock, formatMMSS(worstBlock?.me.supplyBlockSeconds ?? 0) + ' blocked'));
  maybePush(record('Cleanest macro (10m+)', cleanestMacro, formatMMSS(cleanestMacro?.me.supplyBlockSeconds ?? 0) + ' blocked'));
  maybePush(record('Most units in one game', mostUnitsGame,
    `${Object.values(mostUnitsGame?.me.unitsProduced ?? {}).reduce((a, b) => a + b, 0)} units`));

  // --- per-my-race totals ----------------------------------------------------
  for (const { me } of games) {
    const slot = (stats.byMyRace[me.race] ??= {
      games: 0,
      wins: 0,
      losses: 0,
      unitsProduced: {},
      buildingsProduced: {},
      workers: 0,
    });
    slot.games += 1;
    if (me.won === true) slot.wins += 1;
    else if (me.won === false) slot.losses += 1;
    for (const [u, n] of Object.entries(me.unitsProduced)) {
      slot.unitsProduced[u] = (slot.unitsProduced[u] ?? 0) + n;
      if (WORKER_NAMES.has(u)) slot.workers += n;
    }
    for (const [b, n] of Object.entries(me.buildingsProduced)) {
      slot.buildingsProduced[b] = (slot.buildingsProduced[b] ?? 0) + n;
    }
  }

  // --- top opponents ---------------------------------------------------------
  const oppMap = new Map<string, OpponentRow & { raceCounts: Record<string, number> }>();
  for (const { me, opp } of games) {
    if (!opp) continue;
    const key = opp.name.trim().toLowerCase();
    if (!key) continue;
    const existing = oppMap.get(key) ?? {
      name: opp.name,
      games: 0,
      wins: 0,
      losses: 0,
      race: opp.race,
      raceCounts: {},
    };
    existing.games += 1;
    if (me.won === true) existing.wins += 1;
    else if (me.won === false) existing.losses += 1;
    existing.raceCounts[opp.race] = (existing.raceCounts[opp.race] ?? 0) + 1;
    oppMap.set(key, existing);
  }
  stats.topOpponents = [...oppMap.values()]
    .map((o) => ({
      ...o,
      race: Object.entries(o.raceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? o.race,
    }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 10);

  // --- top maps --------------------------------------------------------------
  const mapMap = new Map<string, MapRow>();
  for (const { digest, me } of games) {
    const name = digest.mapName ?? '(unknown map)';
    const existing = mapMap.get(name) ?? { name, games: 0, wins: 0, losses: 0 };
    existing.games += 1;
    if (me.won === true) existing.wins += 1;
    else if (me.won === false) existing.losses += 1;
    mapMap.set(name, existing);
  }
  stats.topMaps = [...mapMap.values()].sort((a, b) => b.games - a.games).slice(0, 10);

  // --- game-length buckets per matchup --------------------------------------
  const lenMap = new Map<string, LengthBucketRow>();
  for (const { digest } of games) {
    const m = digest.matchup;
    const row = lenMap.get(m) ?? { matchup: m, games: 0, over15: 0, over20: 0, over30: 0 };
    row.games += 1;
    if (digest.durationSeconds >= 15 * 60) row.over15 += 1;
    if (digest.durationSeconds >= 20 * 60) row.over20 += 1;
    if (digest.durationSeconds >= 30 * 60) row.over30 += 1;
    lenMap.set(m, row);
  }
  stats.lengthBuckets = [...lenMap.values()].sort((a, b) => b.games - a.games);

  // --- favorite opening (first tech building) per matchup --------------------
  // For each matchup, count the most frequent firstTechName me picked.
  const openingMap = new Map<string, Map<string, number>>();
  const matchupGames = new Map<string, number>();
  for (const { digest, me } of games) {
    const m = digest.matchup;
    matchupGames.set(m, (matchupGames.get(m) ?? 0) + 1);
    const name = me.timings.firstTechName;
    if (!name) continue;
    const inner = openingMap.get(m) ?? new Map<string, number>();
    inner.set(name, (inner.get(name) ?? 0) + 1);
    openingMap.set(m, inner);
  }
  for (const [m, inner] of openingMap) {
    const sorted = [...inner.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) continue;
    stats.openings.push({
      matchup: m,
      opening: sorted[0][0],
      count: sorted[0][1],
      games: matchupGames.get(m) ?? 0,
    });
  }
  stats.openings.sort((a, b) => b.games - a.games);

  return stats;
}

// --- helpers -----------------------------------------------------------------

// Worker unit names so we can expose a "workers trained" total per race.
const WORKER_NAMES = new Set(['SCV', 'Probe', 'Drone']);

function minBy<T>(arr: T[], f: (x: T) => number): T | null {
  if (arr.length === 0) return null;
  let best = arr[0];
  let bestVal = f(best);
  for (let i = 1; i < arr.length; i++) {
    const v = f(arr[i]);
    if (v < bestVal) { best = arr[i]; bestVal = v; }
  }
  return best;
}

function maxBy<T>(arr: T[], f: (x: T) => number): T | null {
  if (arr.length === 0) return null;
  let best = arr[0];
  let bestVal = f(best);
  for (let i = 1; i < arr.length; i++) {
    const v = f(arr[i]);
    if (v > bestVal) { best = arr[i]; bestVal = v; }
  }
  return best;
}

function formatMMSS(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function formatHoursMinutes(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
