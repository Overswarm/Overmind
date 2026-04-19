// Coaching callout generator. Runs a set of heuristic detectors over a
// single replay digest and emits short, concrete mistake callouts aimed at
// ladder-level players looking to improve. Each callout is a plain object
// — the UI decides how to render severity, group by matchup, etc.
//
// The detectors are intentionally conservative: a callout fires only when
// the signal is strong (e.g. > 15s of supply blocks, > 30% idle on a pool
// that had meaningful capacity). False-positives are more damaging here
// than misses because the user treats each callout as an action item.
//
// Aggregation across a library is done by the caller — run `detectMistakes`
// per digest, then bucket by `id` or `kind`.

import type { BuildOrderEvent } from './buildOrder';
import type { ReplayDigest, PlayerDigest } from './aggregate';
import type { SupplyBlocks } from './supplyBlocks';
import type { ProductionIdle, PoolStats } from './productionIdle';

export type CalloutSeverity = 'info' | 'minor' | 'major';

export interface Callout {
  // Stable identifier so aggregation can bucket "the same mistake across
  // games" — e.g. "supplyBlock", "unusedPool:Starport", "lateExpo".
  id: string;
  kind:
    | 'supplyBlock'
    | 'productionIdle'
    | 'unusedPool'
    | 'lateExpo'
    | 'noExpo'
    | 'lateArmy'
    | 'lowWorkers';
  severity: CalloutSeverity;
  title: string;
  detail: string;
  // Optional frame to jump to in the timeline (e.g. start of the worst block).
  frame?: number;
}

export interface PlayerCoaching {
  playerID: number;
  name: string;
  race: string;
  callouts: Callout[];
}

// Matchup/race benchmarks. These are rough mid-ladder targets, not pro
// numbers — if your first expo beats them, we don't scold; if it's way
// behind, we flag. Seconds-into-game.
const EXPO_TARGET_SECONDS: Record<string, number> = {
  T: 4 * 60,
  P: 4.5 * 60,
  Z: 3 * 60,
};
const FIRST_ARMY_TARGET_SECONDS: Record<string, number> = {
  T: 3 * 60,
  P: 3 * 60,
  Z: 2.5 * 60,
};

// Thresholds for callout firing. Tuned so a clean game produces zero
// callouts and a common-mistake game produces 2-3.
const SUPPLY_BLOCK_MINOR_SEC = 15;
const SUPPLY_BLOCK_MAJOR_SEC = 45;
const IDLE_MINOR = 0.3;
const IDLE_MAJOR = 0.5;
// Minimum pool capacity (seconds) before we trust the idle signal. Buildings
// completed late in the game have tiny capacity windows; flagging 80% idle
// on a 90-second window would just be noise.
const IDLE_MIN_CAPACITY_SEC = 180;
const LATE_EXPO_MINOR_SEC = 60;
const LATE_EXPO_MAJOR_SEC = 180;
const LATE_ARMY_MINOR_SEC = 60;
const LATE_ARMY_MAJOR_SEC = 150;

const FRAMES_PER_SECOND = 1000 / 42;

export interface DetectContext {
  digest: ReplayDigest;
  events: BuildOrderEvent[];
  supplyBlocks: SupplyBlocks;
  productionIdle: ProductionIdle;
}

export function detectMistakes(ctx: DetectContext): PlayerCoaching[] {
  return ctx.digest.players.map((p) => ({
    playerID: p.playerID,
    name: p.name,
    race: p.race,
    callouts: detectForPlayer(ctx, p),
  }));
}

function detectForPlayer(ctx: DetectContext, p: PlayerDigest): Callout[] {
  const out: Callout[] = [];

  // --- supply blocks ---------------------------------------------------------
  if (p.supplyBlockSeconds >= SUPPLY_BLOCK_MINOR_SEC) {
    const worst = ctx.supplyBlocks.intervals
      .filter((iv) => iv.playerID === p.playerID)
      .sort((a, b) => b.durationSeconds - a.durationSeconds)[0];
    const severity: CalloutSeverity =
      p.supplyBlockSeconds >= SUPPLY_BLOCK_MAJOR_SEC ? 'major' : 'minor';
    out.push({
      id: 'supplyBlock',
      kind: 'supplyBlock',
      severity,
      title: 'Supply blocked',
      detail: `${Math.round(p.supplyBlockSeconds)}s blocked across ${p.supplyBlockCount} interval${
        p.supplyBlockCount === 1 ? '' : 's'
      }${worst ? ` — worst at ${formatClock(worst.startSeconds)}` : ''}. Keep supply ahead of production.`,
      frame: worst?.startFrame,
    });
  }

  // --- production idle per pool ---------------------------------------------
  const pools = ctx.productionIdle.byPlayer.get(p.playerID) ?? [];
  for (const pool of pools) {
    if (pool.count === 0) continue;
    const capacitySec = pool.capacityFrames / FRAMES_PER_SECOND;
    if (pool.unitsProduced === 0 && capacitySec >= IDLE_MIN_CAPACITY_SEC) {
      out.push({
        id: `unusedPool:${pool.name}`,
        kind: 'unusedPool',
        severity: 'major',
        title: `${pool.name} produced nothing`,
        detail: `Built ${pool.count} ${pool.name}${pool.count === 1 ? '' : 's'} but never trained a unit from it. Commit to what you build.`,
      });
      continue;
    }
    if (capacitySec < IDLE_MIN_CAPACITY_SEC) continue;
    if (pool.idleRatio >= IDLE_MINOR) {
      const severity: CalloutSeverity =
        pool.idleRatio >= IDLE_MAJOR ? 'major' : 'minor';
      out.push({
        id: `productionIdle:${pool.name}`,
        kind: 'productionIdle',
        severity,
        title: `${pool.name} sat idle`,
        detail: `${Math.round(pool.idleRatio * 100)}% of ${pool.name} capacity was idle. Keep the queue loaded or stop making more.`,
      });
    }
  }

  // --- late / no expansion ---------------------------------------------------
  const expoTarget = EXPO_TARGET_SECONDS[p.race];
  if (expoTarget != null) {
    const expo = p.timings.firstExpansionSeconds;
    if (expo == null) {
      // No expo at all only matters in longer games — otherwise it may be a
      // successful rush. Flag only if the game lasted > 8 minutes.
      if (ctx.digest.durationSeconds > 8 * 60) {
        out.push({
          id: 'noExpo',
          kind: 'noExpo',
          severity: 'major',
          title: 'Never expanded',
          detail: `No second base in a ${formatClock(ctx.digest.durationSeconds)} game. One-base play caps your economy.`,
        });
      }
    } else {
      const delta = expo - expoTarget;
      if (delta >= LATE_EXPO_MINOR_SEC) {
        const severity: CalloutSeverity =
          delta >= LATE_EXPO_MAJOR_SEC ? 'major' : 'minor';
        out.push({
          id: 'lateExpo',
          kind: 'lateExpo',
          severity,
          title: 'Late expansion',
          detail: `First expo at ${formatClock(expo)} — ${Math.round(delta)}s behind the ${p.race} target (${formatClock(expoTarget)}).`,
          frame: Math.round(expo * FRAMES_PER_SECOND),
        });
      }
    }
  }

  // --- no / late first combat unit ------------------------------------------
  const armyTarget = FIRST_ARMY_TARGET_SECONDS[p.race];
  if (armyTarget != null) {
    const firstArmy = p.timings.firstCombatUnitSeconds;
    if (firstArmy != null) {
      const delta = firstArmy - armyTarget;
      if (delta >= LATE_ARMY_MINOR_SEC) {
        const severity: CalloutSeverity =
          delta >= LATE_ARMY_MAJOR_SEC ? 'major' : 'minor';
        out.push({
          id: 'lateArmy',
          kind: 'lateArmy',
          severity,
          title: 'Slow first army unit',
          detail: `First combat unit (${p.timings.firstCombatUnitName}) at ${formatClock(firstArmy)} — ${Math.round(delta)}s behind the ${p.race} target.`,
          frame: Math.round(firstArmy * FRAMES_PER_SECOND),
        });
      }
    }
  }

  // Sort by severity (major first) then stable by id for deterministic output.
  const rank: Record<CalloutSeverity, number> = { major: 0, minor: 1, info: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
  return out;
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

// ----------------------------------------------------------------------------
// Aggregation across a library of coached games

export interface CalloutBucket {
  id: string;
  kind: Callout['kind'];
  // Title copied from the most recent occurrence — enough for UI labels.
  title: string;
  // How many me-games this callout fired in.
  games: number;
  // Games where `me` was the player this callout was attached to.
  meGames: number;
  // Worst severity observed.
  worstSeverity: CalloutSeverity;
  // Most common detail text (from the most recent occurrence, for display).
  sampleDetail: string;
  // Per-game examples so the UI can link through.
  examples: Array<{ hash: string; mapName?: string; matchup: string; detail: string }>;
}

export function aggregateCallouts(
  items: Array<{ digest: ReplayDigest; coaching: PlayerCoaching[] }>,
): {
  // Callouts that fired on a "me" player. Ordered by frequency.
  me: CalloutBucket[];
  meGames: number;
} {
  const buckets = new Map<string, CalloutBucket>();
  const seenInGame = new Set<string>();
  let meGames = 0;

  for (const { digest, coaching } of items) {
    const mePlayers = new Set(
      digest.players.filter((p) => p.isMe).map((p) => p.playerID),
    );
    if (mePlayers.size === 0) continue;
    meGames += 1;
    seenInGame.clear();

    for (const pc of coaching) {
      const isMe = mePlayers.has(pc.playerID);
      if (!isMe) continue;
      for (const c of pc.callouts) {
        const existing =
          buckets.get(c.id) ??
          ({
            id: c.id,
            kind: c.kind,
            title: c.title,
            games: 0,
            meGames: 0,
            worstSeverity: 'info' as CalloutSeverity,
            sampleDetail: c.detail,
            examples: [],
          } satisfies CalloutBucket);
        // Only count each callout once per game (some detectors could fire
        // multiple times if we extend them per-pool later).
        if (!seenInGame.has(c.id)) {
          existing.games += 1;
          existing.meGames += 1;
          seenInGame.add(c.id);
        }
        if (severityRank(c.severity) < severityRank(existing.worstSeverity)) {
          existing.worstSeverity = c.severity;
        }
        existing.sampleDetail = c.detail;
        if (existing.examples.length < 5) {
          existing.examples.push({
            hash: digest.hash,
            mapName: digest.mapName,
            matchup: digest.matchup,
            detail: c.detail,
          });
        }
        buckets.set(c.id, existing);
      }
    }
  }

  const sorted = [...buckets.values()].sort((a, b) => {
    if (b.meGames !== a.meGames) return b.meGames - a.meGames;
    return severityRank(a.worstSeverity) - severityRank(b.worstSeverity);
  });
  return { me: sorted, meGames };
}

function severityRank(s: CalloutSeverity): number {
  return s === 'major' ? 0 : s === 'minor' ? 1 : 2;
}
