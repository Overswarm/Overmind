// Achievement definitions and library-wide evaluator. Walks the me-games in
// the library and reports which achievements have been earned, plus partial
// progress toward the tiered ones.
//
// Philosophy: achievements should either celebrate a *memory* ("you trained
// your first Reaver") or a *milestone* that's hard to fake ("won 50 games as
// Terran"). They are best-effort — e.g. unit totals come from the build-order
// event stream and therefore don't account for deaths. That's fine for unit
// recognition (did you ever build one?) and rough enough for scale tiers.
//
// Kept independent of the UI so both a page and an export can reuse it.

import type { ReplayDigest, PlayerDigest } from './aggregate';
import type { LibraryEntry } from '../storage/db';

export type AchievementCategory =
  | 'terran'
  | 'protoss'
  | 'zerg'
  | 'skill'
  | 'wins'
  | 'records'
  | 'library';

export interface Achievement {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  unlocked: boolean;
  // For tiered / counting achievements, show "x / target". Hidden when
  // `progress` is omitted (pure boolean unlocks).
  progress?: { current: number; target: number };
  // Representative game that earned (or is closest to earning) this
  // achievement. Useful for "neat, I remember that one" moments.
  gameHash?: string;
  gameMap?: string;
}

export interface AchievementsResult {
  achievements: Achievement[];
  unlockedCount: number;
  totalCount: number;
  // Count of eligible me-games that contributed to evaluation.
  meGames: number;
  // True when the user has no me-tag configured and we bailed early.
  needsIdentity: boolean;
}

interface Example {
  hash: string;
  map?: string;
}

interface MatchupGame {
  digest: ReplayDigest;
  me: PlayerDigest;
  opp: PlayerDigest | undefined;
}

// ---- Aggregated stats computed once and reused by every achievement check --

interface Stats {
  meGames: number;
  totalSeconds: number;           // across all me-games
  winsByRace: Record<string, number>;
  gamesByRace: Record<string, number>;
  matchupsPlayed: Set<string>;    // normalized as "min-max" e.g. "PvT" and "TvP" both map to "PvT"
  racesPlayedAsMe: Set<string>;
  maxApm: number;
  maxApmGame?: Example;
  maxEapm: number;
  maxEapmGame?: Example;
  longestGameSeconds: number;
  longestGame?: Example;
  quickestWinSeconds: number | null;
  quickestWinGame?: Example;
  winsUnder10Min: number;
  winsUnder5Min: number;
  // Whether each named unit has *ever* been trained by the user.
  unitsBuilt: Map<string, Example>; // unit name → first observed game
  // Max workers trained in a single me-game.
  maxWorkers: number;
  maxWorkersGame?: Example;
  // Max "produced supply used" in a single me-game. We derive this from the
  // supply timings (150 is the highest bucket we persist). Can't distinguish
  // 180 from 200 but still lets us tier "you pushed past 150".
  reached150Supply: number;
  reached150SupplyGame?: Example;
  maxTotalUnits: number;
  maxTotalUnitsGame?: Example;
  // Library-level counters (from entries, independent of me-games).
  librarySize: number;
  annotatedEntries: number;
  favoritedEntries: number;
}

// ---------------------------------------------------------------------------
// Top-level evaluator

export function computeAchievements(
  digests: ReplayDigest[],
  entries: LibraryEntry[],
): AchievementsResult {
  const meMatchups: MatchupGame[] = [];
  for (const d of digests) {
    const me = d.players.find((p) => p.isMe);
    if (!me) continue;
    const opp = d.players.find((p) => p.team !== me.team);
    meMatchups.push({ digest: d, me, opp });
  }

  if (entries.length === 0) {
    return { achievements: [], unlockedCount: 0, totalCount: 0, meGames: 0, needsIdentity: false };
  }
  if (meMatchups.length === 0 && digests.length > 0) {
    // Library has games but no me-tag — only library-scope achievements are
    // meaningful. Surface a hint in the UI via `needsIdentity`.
    return { achievements: [], unlockedCount: 0, totalCount: 0, meGames: 0, needsIdentity: true };
  }

  const stats = aggregate(meMatchups, entries);
  const achievements = ACHIEVEMENT_DEFS.map((def) => {
    const { unlocked, progress, example } = def.check(stats);
    return {
      id: def.id,
      title: def.title,
      description: def.description,
      category: def.category,
      unlocked,
      progress,
      gameHash: example?.hash,
      gameMap: example?.map,
    } satisfies Achievement;
  });
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  return {
    achievements,
    unlockedCount,
    totalCount: achievements.length,
    meGames: meMatchups.length,
    needsIdentity: false,
  };
}

// ---------------------------------------------------------------------------
// Aggregation pass

function aggregate(games: MatchupGame[], entries: LibraryEntry[]): Stats {
  const s: Stats = {
    meGames: games.length,
    totalSeconds: 0,
    winsByRace: {},
    gamesByRace: {},
    matchupsPlayed: new Set(),
    racesPlayedAsMe: new Set(),
    maxApm: 0,
    maxEapm: 0,
    longestGameSeconds: 0,
    quickestWinSeconds: null,
    winsUnder10Min: 0,
    winsUnder5Min: 0,
    unitsBuilt: new Map(),
    maxWorkers: 0,
    reached150Supply: 0,
    maxTotalUnits: 0,
    librarySize: entries.length,
    annotatedEntries: entries.filter((e) => e.notes && e.notes.trim().length > 0).length,
    favoritedEntries: entries.filter((e) => !!e.favorite).length,
  };

  for (const g of games) {
    const { digest: d, me, opp } = g;
    const ex: Example = { hash: d.hash, map: d.mapName };
    s.totalSeconds += d.durationSeconds;
    s.racesPlayedAsMe.add(me.race);
    s.gamesByRace[me.race] = (s.gamesByRace[me.race] ?? 0) + 1;
    if (me.won === true) {
      s.winsByRace[me.race] = (s.winsByRace[me.race] ?? 0) + 1;
      if (d.durationSeconds < 10 * 60) s.winsUnder10Min += 1;
      if (d.durationSeconds < 5 * 60) s.winsUnder5Min += 1;
      if (s.quickestWinSeconds == null || d.durationSeconds < s.quickestWinSeconds) {
        s.quickestWinSeconds = d.durationSeconds;
        s.quickestWinGame = ex;
      }
    }
    if (opp) {
      // Normalize matchup so "PvT" and "TvP" collapse to a single key.
      const mu = [me.race, opp.race].sort().join('v');
      s.matchupsPlayed.add(mu);
    }
    if (me.apm > s.maxApm) {
      s.maxApm = me.apm;
      s.maxApmGame = ex;
    }
    if (me.eapm > s.maxEapm) {
      s.maxEapm = me.eapm;
      s.maxEapmGame = ex;
    }
    if (d.durationSeconds > s.longestGameSeconds) {
      s.longestGameSeconds = d.durationSeconds;
      s.longestGame = ex;
    }
    // Count workers (sum of unitsProduced for worker-typed units). The digest
    // doesn't expose the worker class directly, but the three names are known.
    const workers =
      (me.unitsProduced['SCV'] ?? 0) +
      (me.unitsProduced['Probe'] ?? 0) +
      (me.unitsProduced['Drone'] ?? 0);
    if (workers > s.maxWorkers) {
      s.maxWorkers = workers;
      s.maxWorkersGame = ex;
    }
    // Supply milestone: highest bucket we crossed in this game.
    if (me.timings.supply150Seconds != null && me.timings.supply150Seconds > 0) {
      if (s.reached150Supply === 0) {
        s.reached150SupplyGame = ex;
      }
      s.reached150Supply += 1;
    }
    const totalUnits = Object.values(me.unitsProduced).reduce((a, b) => a + b, 0);
    if (totalUnits > s.maxTotalUnits) {
      s.maxTotalUnits = totalUnits;
      s.maxTotalUnitsGame = ex;
    }
    for (const [name, count] of Object.entries(me.unitsProduced)) {
      if (count > 0 && !s.unitsBuilt.has(name)) s.unitsBuilt.set(name, ex);
    }
    // Archons don't appear as unitsProduced — they're a Dark Archon / Archon
    // merge action, not a train event. If the user ever merged, the component
    // HTs/DTs would have been trained, so we leave Archon out of unit checks.
  }
  return s;
}

// ---------------------------------------------------------------------------
// Achievement definitions

type CheckResult = { unlocked: boolean; progress?: { current: number; target: number }; example?: Example };
type AchievementDef = {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  check: (s: Stats) => CheckResult;
};

// Helper: "did you ever train this unit" check.
const unitCheck = (name: string): ((s: Stats) => CheckResult) => (s) => {
  const ex = s.unitsBuilt.get(name);
  return { unlocked: !!ex, example: ex };
};

// Helper: tiered numeric threshold. `value(s)` returns a current count. When
// below target, returns locked + progress. When at or past, returns unlocked.
const tierCheck = (
  value: (s: Stats) => number,
  target: number,
  exampleFrom?: (s: Stats) => Example | undefined,
): ((s: Stats) => CheckResult) => (s) => {
  const current = value(s);
  return {
    unlocked: current >= target,
    progress: { current: Math.min(current, target), target },
    example: exampleFrom?.(s),
  };
};

const ACHIEVEMENT_DEFS: AchievementDef[] = [
  // ---- Terran unit memories ----
  { id: 't.scv', title: 'SCV good to go', description: 'Trained an SCV', category: 'terran', check: unitCheck('SCV') },
  { id: 't.marine', title: 'Marine drill', description: 'Trained a Marine', category: 'terran', check: unitCheck('Marine') },
  { id: 't.firebat', title: 'Hot & heavy', description: 'Trained a Firebat', category: 'terran', check: unitCheck('Firebat') },
  { id: 't.medic', title: 'Emergency care', description: 'Trained a Medic', category: 'terran', check: unitCheck('Medic') },
  { id: 't.ghost', title: 'Spooky stuff', description: 'Trained a Ghost', category: 'terran', check: unitCheck('Ghost') },
  { id: 't.vulture', title: 'Mines in the hills', description: 'Trained a Vulture', category: 'terran', check: unitCheck('Vulture') },
  { id: 't.tank', title: 'Heavy metal', description: 'Trained a Siege Tank', category: 'terran', check: unitCheck('Siege Tank') },
  { id: 't.goliath', title: 'Dual purpose', description: 'Trained a Goliath', category: 'terran', check: unitCheck('Goliath') },
  { id: 't.wraith', title: 'Sky raider', description: 'Trained a Wraith', category: 'terran', check: unitCheck('Wraith') },
  { id: 't.dropship', title: 'Who needs walls', description: 'Trained a Dropship', category: 'terran', check: unitCheck('Dropship') },
  { id: 't.vessel', title: 'EMP magician', description: 'Trained a Science Vessel', category: 'terran', check: unitCheck('Science Vessel') },
  { id: 't.valkyrie', title: 'Firework display', description: 'Trained a Valkyrie', category: 'terran', check: unitCheck('Valkyrie') },
  { id: 't.bc', title: 'Yamato cannon!', description: 'Trained a Battlecruiser', category: 'terran', check: unitCheck('Battlecruiser') },

  // ---- Protoss unit memories ----
  { id: 'p.probe', title: 'En taro Adun', description: 'Trained a Probe', category: 'protoss', check: unitCheck('Probe') },
  { id: 'p.zealot', title: 'My life for Aiur', description: 'Trained a Zealot', category: 'protoss', check: unitCheck('Zealot') },
  { id: 'p.dragoon', title: 'Electric sheep', description: 'Trained a Dragoon', category: 'protoss', check: unitCheck('Dragoon') },
  { id: 'p.ht', title: 'Storm warning', description: 'Trained a High Templar', category: 'protoss', check: unitCheck('High Templar') },
  { id: 'p.dt', title: 'From the shadows', description: 'Trained a Dark Templar', category: 'protoss', check: unitCheck('Dark Templar') },
  { id: 'p.shuttle', title: 'Taxi service', description: 'Trained a Shuttle', category: 'protoss', check: unitCheck('Shuttle') },
  { id: 'p.reaver', title: 'Scarab drop', description: 'Trained a Reaver', category: 'protoss', check: unitCheck('Reaver') },
  { id: 'p.obs', title: 'Invisible eyes', description: 'Trained an Observer', category: 'protoss', check: unitCheck('Observer') },
  { id: 'p.scout', title: 'Overpriced wings', description: 'Trained a Scout', category: 'protoss', check: unitCheck('Scout') },
  { id: 'p.corsair', title: 'Disruption web', description: 'Trained a Corsair', category: 'protoss', check: unitCheck('Corsair') },
  { id: 'p.arbiter', title: 'Stasis incoming', description: 'Trained an Arbiter', category: 'protoss', check: unitCheck('Arbiter') },
  { id: 'p.carrier', title: 'Interceptor cloud', description: 'Trained a Carrier', category: 'protoss', check: unitCheck('Carrier') },

  // ---- Zerg unit memories ----
  { id: 'z.drone', title: 'Swarm starts small', description: 'Trained a Drone', category: 'zerg', check: unitCheck('Drone') },
  { id: 'z.overlord', title: 'Supply provided', description: 'Trained an Overlord', category: 'zerg', check: unitCheck('Overlord') },
  { id: 'z.zergling', title: 'Speedlings go!', description: 'Trained a Zergling', category: 'zerg', check: unitCheck('Zergling') },
  { id: 'z.hydra', title: 'Spine of the swarm', description: 'Trained a Hydralisk', category: 'zerg', check: unitCheck('Hydralisk') },
  { id: 'z.lurker', title: 'Burrowed menace', description: 'Trained a Lurker', category: 'zerg', check: unitCheck('Lurker') },
  { id: 'z.muta', title: 'Magic boxes', description: 'Trained a Mutalisk', category: 'zerg', check: unitCheck('Mutalisk') },
  { id: 'z.scourge', title: 'Kamikaze run', description: 'Trained a Scourge', category: 'zerg', check: unitCheck('Scourge') },
  { id: 'z.queen', title: 'Broodlings incoming', description: 'Trained a Queen', category: 'zerg', check: unitCheck('Queen') },
  { id: 'z.defiler', title: 'Plague upon thee', description: 'Trained a Defiler', category: 'zerg', check: unitCheck('Defiler') },
  { id: 'z.ultra', title: 'Ultralisk charge', description: 'Trained an Ultralisk', category: 'zerg', check: unitCheck('Ultralisk') },

  // ---- Skill / APM ----
  {
    id: 'apm.150', title: 'Fast fingers',
    description: 'Finished a game at 150+ APM',
    category: 'skill',
    check: tierCheck((s) => s.maxApm, 150, (s) => s.maxApmGame),
  },
  {
    id: 'apm.200', title: 'Korean hands',
    description: 'Finished a game at 200+ APM',
    category: 'skill',
    check: tierCheck((s) => s.maxApm, 200, (s) => s.maxApmGame),
  },
  {
    id: 'apm.300', title: 'Pro APM',
    description: 'Finished a game at 300+ APM',
    category: 'skill',
    check: tierCheck((s) => s.maxApm, 300, (s) => s.maxApmGame),
  },
  {
    id: 'eapm.150', title: 'Effective (150 EAPM)',
    description: 'Averaged 150+ EAPM in a game (every action counted)',
    category: 'skill',
    check: tierCheck((s) => s.maxEapm, 150, (s) => s.maxEapmGame),
  },
  {
    id: 'eapm.200', title: 'Laser focused',
    description: 'Averaged 200+ EAPM in a game',
    category: 'skill',
    check: tierCheck((s) => s.maxEapm, 200, (s) => s.maxEapmGame),
  },

  // ---- Wins per race, tiered ----
  ...winsTier('T', 'Terran', 'wins'),
  ...winsTier('P', 'Protoss', 'wins'),
  ...winsTier('Z', 'Zerg', 'wins'),

  // ---- Records ----
  {
    id: 'rec.hourgame', title: 'The long war',
    description: 'Played a game longer than 60 minutes',
    category: 'records',
    check: (s) => ({
      unlocked: s.longestGameSeconds >= 60 * 60,
      progress: { current: Math.min(s.longestGameSeconds, 60 * 60), target: 60 * 60 },
      example: s.longestGame,
    }),
  },
  {
    id: 'rec.longgame', title: 'Marathon',
    description: 'Played a game longer than 30 minutes',
    category: 'records',
    check: (s) => ({
      unlocked: s.longestGameSeconds >= 30 * 60,
      example: s.longestGame,
    }),
  },
  {
    id: 'rec.fastwin', title: 'Blink and you miss it',
    description: 'Won a game in under 5 minutes',
    category: 'records',
    check: (s) => ({
      unlocked: s.quickestWinSeconds != null && s.quickestWinSeconds < 5 * 60,
      example: s.quickestWinGame,
    }),
  },
  {
    id: 'rec.tenfast', title: 'All gas, no brakes',
    description: 'Won 10 games in under 10 minutes each',
    category: 'records',
    check: (s) => ({
      unlocked: s.winsUnder10Min >= 10,
      progress: { current: Math.min(s.winsUnder10Min, 10), target: 10 },
      example: s.quickestWinGame,
    }),
  },
  {
    id: 'rec.supply150', title: 'Supply maxed',
    description: 'Pushed past 150 produced supply in a game',
    category: 'records',
    check: (s) => ({
      unlocked: s.reached150Supply > 0,
      example: s.reached150SupplyGame,
    }),
  },
  {
    id: 'rec.workers', title: 'Economy engine',
    description: 'Trained 60+ workers in a single game',
    category: 'records',
    check: (s) => ({
      unlocked: s.maxWorkers >= 60,
      progress: { current: Math.min(s.maxWorkers, 60), target: 60 },
      example: s.maxWorkersGame,
    }),
  },
  {
    id: 'rec.bigarmy', title: 'Endless army',
    description: 'Produced 150+ units in a single game',
    category: 'records',
    check: (s) => ({
      unlocked: s.maxTotalUnits >= 150,
      progress: { current: Math.min(s.maxTotalUnits, 150), target: 150 },
      example: s.maxTotalUnitsGame,
    }),
  },
  {
    id: 'rec.polyglot', title: 'Polyglot',
    description: 'Played a game as each of the three races',
    category: 'records',
    check: (s) => ({
      unlocked: s.racesPlayedAsMe.size >= 3,
      progress: { current: Math.min(s.racesPlayedAsMe.size, 3), target: 3 },
    }),
  },
  {
    id: 'rec.wellrounded', title: 'Well rounded',
    description: 'Played every 1v1 matchup at least once',
    category: 'records',
    check: (s) => {
      // Six possible mirror + cross matchups with race codes T/P/Z: TvT, PvP, ZvZ,
      // and the three cross pairs collapsed into alphabetically-sorted keys (PvT,
      // PvZ, TvZ).
      const required = ['PvP', 'PvT', 'PvZ', 'TvT', 'TvZ', 'ZvZ'];
      const have = required.filter((k) => s.matchupsPlayed.has(k)).length;
      return {
        unlocked: have >= required.length,
        progress: { current: have, target: required.length },
      };
    },
  },

  // ---- Library ----
  {
    id: 'lib.10', title: 'Collector',
    description: 'Library has 10+ replays',
    category: 'library',
    check: tierCheck((s) => s.librarySize, 10),
  },
  {
    id: 'lib.50', title: 'Hoarder',
    description: 'Library has 50+ replays',
    category: 'library',
    check: tierCheck((s) => s.librarySize, 50),
  },
  {
    id: 'lib.100', title: 'Archivist',
    description: 'Library has 100+ replays',
    category: 'library',
    check: tierCheck((s) => s.librarySize, 100),
  },
  {
    id: 'lib.notes', title: 'Take notes',
    description: 'Annotated 5+ replays',
    category: 'library',
    check: tierCheck((s) => s.annotatedEntries, 5),
  },
  {
    id: 'lib.favs', title: 'Greatest hits',
    description: 'Pinned 5+ replays as favorites',
    category: 'library',
    check: tierCheck((s) => s.favoritedEntries, 5),
  },
  {
    id: 'lib.10hr', title: 'Time well spent',
    description: 'Logged 10+ hours of your own games',
    category: 'library',
    check: (s) => ({
      unlocked: s.totalSeconds >= 10 * 60 * 60,
      progress: { current: Math.min(s.totalSeconds, 10 * 60 * 60), target: 10 * 60 * 60 },
    }),
  },
  {
    id: 'lib.50hr', title: 'Lifer',
    description: 'Logged 50+ hours of your own games',
    category: 'library',
    check: (s) => ({
      unlocked: s.totalSeconds >= 50 * 60 * 60,
      progress: { current: Math.min(s.totalSeconds, 50 * 60 * 60), target: 50 * 60 * 60 },
    }),
  },
];

function winsTier(
  race: string,
  raceLabel: string,
  category: AchievementCategory,
): AchievementDef[] {
  const tiers: Array<{ n: number; title: string }> = [
    { n: 10, title: `10 wins as ${raceLabel}` },
    { n: 25, title: `25 wins as ${raceLabel}` },
    { n: 50, title: `50 wins as ${raceLabel}` },
    { n: 100, title: `100 wins as ${raceLabel}` },
  ];
  return tiers.map((t) => ({
    id: `wins.${race}.${t.n}`,
    title: t.title,
    description: `Won ${t.n} games as ${raceLabel}`,
    category,
    check: (s) => {
      const current = s.winsByRace[race] ?? 0;
      return {
        unlocked: current >= t.n,
        progress: { current: Math.min(current, t.n), target: t.n },
      };
    },
  }));
}
