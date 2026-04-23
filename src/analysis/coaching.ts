// Coaching callout generator. Runs a set of heuristic detectors over a
// single replay digest and emits short, concrete "Auto Coach Warnings" aimed
// at ladder-level players looking to improve. Each callout is a plain object
// — the UI decides how to render severity, group by matchup, etc.
//
// The detectors are intentionally conservative: a warning fires only when
// the signal is strong and build-agnostic (e.g. > 15s supply blocks, or
// "my expansion was two minutes behind my opponent's"). Production-idle
// heuristics used to live here but were removed because they fired on
// deliberate skipped production pools (e.g. a Terran mech build not using
// their Barracks).
//
// Aggregation across a library is done by the caller — run `detectMistakes`
// per digest, then bucket by `id` or `kind`.

import type { BuildOrderEvent } from './buildOrder';
import type { ReplayDigest, PlayerDigest } from './aggregate';
import type { SupplyBlocks } from './supplyBlocks';

export type CalloutSeverity = 'info' | 'minor' | 'major';

export interface Callout {
  // Stable identifier so aggregation can bucket "the same warning across
  // games" — e.g. "supplyBlock", "lateExpo", "lateThirdBase".
  id: string;
  kind:
    | 'supplyBlock'
    | 'lateExpo'
    | 'noExpo'
    | 'lateThirdBase'
    | 'lateArmy';
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

// Race-specific benchmarks for the "slow first army" warning. First-army is
// still useful as an absolute check because a first combat unit at 6:00 is
// always slow regardless of opponent. Expansion timing, by contrast, swings
// wildly with build order and is handled vs-opponent.
const FIRST_ARMY_TARGET_SECONDS: Record<string, number> = {
  T: 3 * 60,
  P: 3 * 60,
  Z: 2.5 * 60,
};

// Thresholds for callout firing. Tuned so a clean game produces zero
// callouts and a common-mistake game produces 2-3.
const SUPPLY_BLOCK_MINOR_SEC = 15;
const SUPPLY_BLOCK_MAJOR_SEC = 45;
// Expansion vs opponent: only flag if you were > 60s behind. < 60s is within
// the noise of normal macro-vs-pressure tradeoffs.
const LATE_EXPO_VS_OPP_MINOR_SEC = 60;
const LATE_EXPO_VS_OPP_MAJOR_SEC = 180;
const LATE_ARMY_MINOR_SEC = 60;
const LATE_ARMY_MAJOR_SEC = 150;
// Gap between the trigger base and the follow-up base. User request: "7 min
// pass with no third CC/Nexus after they build their second CC/Nexus" (and
// the Zerg equivalent from the 3rd hatch to the 5th).
const LATE_THIRD_BASE_GAP_SEC = 7 * 60;

const FRAMES_PER_SECOND = 1000 / 42;

// Town hall IDs per race, used to locate the Nth expansion event. Terran and
// Protoss start with 1 town hall (not emitted as an event), so the first
// build event of 0x6a/0x9a is the 2nd CC/Nexus. Zerg similarly starts with
// 1 hatchery, so the first build event of 0x83 is the 2nd hatchery.
const TOWN_HALL_ID: Record<string, number> = {
  T: 0x6a,
  P: 0x9a,
  Z: 0x83,
};

export interface DetectContext {
  digest: ReplayDigest;
  events: BuildOrderEvent[];
  supplyBlocks: SupplyBlocks;
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

  // --- late / no expansion (vs opponent) ------------------------------------
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
    // Compare this player's first expo to the earliest opponent expo. Ignore
    // team-mates. If no opponent ever expanded, there's nothing to compare to.
    const opponents = ctx.digest.players.filter((q) => q.team !== p.team);
    const oppExpos = opponents
      .map((q) => q.timings.firstExpansionSeconds)
      .filter((s): s is number => s != null);
    if (oppExpos.length > 0) {
      const earliest = Math.min(...oppExpos);
      const delta = expo - earliest;
      if (delta >= LATE_EXPO_VS_OPP_MINOR_SEC) {
        const severity: CalloutSeverity =
          delta >= LATE_EXPO_VS_OPP_MAJOR_SEC ? 'major' : 'minor';
        out.push({
          id: 'lateExpo',
          kind: 'lateExpo',
          severity,
          title: 'Late expansion vs opponent',
          detail: `Your expansion started ${formatDelta(delta)} behind your opponent's (you at ${formatClock(
            expo,
          )}, opponent at ${formatClock(earliest)}).`,
          frame: Math.round(expo * FRAMES_PER_SECOND),
        });
      }
    }
  }

  // --- late third base / fifth hatch ----------------------------------------
  const lateBase = detectLateThirdBase(ctx, p);
  if (lateBase) out.push(lateBase);

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

// Zerg starts with 1 hatchery and naturally runs on 3+ hatches; "late fifth
// hatch" means 7+ minutes pass between the 3rd and 5th hatchery. Terran and
// Protoss start with 1 town hall; "late third base" means 7+ minutes pass
// between the 2nd and 3rd CC/Nexus.
function detectLateThirdBase(ctx: DetectContext, p: PlayerDigest): Callout | null {
  const hallID = TOWN_HALL_ID[p.race];
  if (hallID == null) return null;

  const hallBuilds = ctx.events
    .filter(
      (e) =>
        e.playerID === p.playerID &&
        (e.kind === 'build' || e.kind === 'buildingMorph') &&
        e.unitID === hallID,
    )
    .sort((a, b) => a.frame - b.frame);

  const isZerg = p.race === 'Z';
  // Trigger: the build event that starts the 7-minute clock. For Z it's the
  // 3rd hatchery — index 1 in build events (since the starting hatch isn't
  // emitted). For T/P it's the 2nd CC/Nexus — index 0.
  const triggerIdx = isZerg ? 1 : 0;
  // Target: the build event that satisfies the expansion. For Z it's the 5th
  // hatchery — index 3. For T/P it's the 3rd CC/Nexus — index 1.
  const targetIdx = isZerg ? 3 : 1;

  if (hallBuilds.length <= triggerIdx) return null; // never even hit the trigger

  const triggerSec = hallBuilds[triggerIdx].seconds;
  const targetBuild = hallBuilds[targetIdx];
  const cutoffSec = triggerSec + LATE_THIRD_BASE_GAP_SEC;

  // If the game ended before the 7-minute cutoff, we don't have enough signal.
  if (ctx.digest.durationSeconds < cutoffSec) return null;

  // If the target expansion happened before the cutoff, no warning.
  if (targetBuild && targetBuild.seconds < cutoffSec) return null;

  const label = isZerg
    ? { title: 'Late fifth hatchery', ord: '3rd hatchery', next: '5th hatchery' }
    : p.race === 'T'
      ? { title: 'Late third CC', ord: '2nd CC', next: '3rd CC' }
      : { title: 'Late third Nexus', ord: '2nd Nexus', next: '3rd Nexus' };

  return {
    id: 'lateThirdBase',
    kind: 'lateThirdBase',
    severity: 'major',
    title: label.title,
    detail: `You spent 7 minutes or more after your ${label.ord} without making a ${label.next}.`,
    frame: hallBuilds[triggerIdx].frame,
  };
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

function formatDelta(seconds: number): string {
  if (seconds >= 120) {
    const minutes = seconds / 60;
    // 1.1 / 2.5 / 3 — one decimal unless it lands on a whole minute.
    const text = minutes.toFixed(1).replace(/\.0$/, '');
    return `${text} min`;
  }
  return `${Math.round(seconds)}s`;
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
