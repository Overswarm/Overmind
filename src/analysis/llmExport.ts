// Multi-replay export for Claude coaching review. The output is Markdown —
// easy for humans to eyeball before pasting, and parsed natively by any
// recent Claude model.
//
// Structure is tiered by cost so the early sections are the most
// information-dense:
//
//   1. Preamble: canonical instruction prompt so pasting with no prompt
//      still produces a useful review.
//   2. Library aggregates: totals, average macro timings by race, me-vs-
//      opponent split, common Auto Coach warnings.
//   3. Rollups: matchup × map × spawn and matchup-only summaries.
//   4. Per-replay digest: one compact block per game with production
//      sequence, key timings, coach warnings, and short-loss flag.

import { formatMMSS } from '../types/replay';
import type {
  ReplayDigest,
  Aggregate,
  AverageTimings,
  MeRollupRow,
} from './aggregate';
import { rollupByMatchup, rollupByMatchupMap, SHORT_LOSS_SECONDS } from './aggregate';
import { formatProductionSequence } from './productionSequence';
import { formatTiming } from './timings';
import type { PlayerCoaching } from './coaching';

export interface ExportOptions {
  // Replace player names with stable aliases ("me", "opp-1", etc.) so the
  // file is safe to share broadly.
  anonymize?: boolean;
}

export interface ExportInput {
  digests: ReplayDigest[];
  aggregate: Aggregate;
  rollups: MeRollupRow[];
  // Keyed by replay hash → player coaching entries. Optional: when missing
  // we simply omit the warnings block per replay.
  coachingByHash?: Map<string, PlayerCoaching[]>;
}

export function renderLibraryExport(
  input: ExportInput,
  opts: ExportOptions = {},
): string {
  const { digests, aggregate: agg, rollups, coachingByHash } = input;
  const aliases = opts.anonymize ? buildAliases(digests) : null;
  const name = (orig: string | undefined): string => {
    if (!orig) return 'unknown';
    if (!aliases) return orig;
    return aliases.get(orig.trim().toLowerCase()) ?? 'player';
  };

  const lines: string[] = [];

  // -- 1. Preamble ---------------------------------------------------------
  lines.push('# Overmind Library Export — Coaching Review');
  lines.push('');
  lines.push(
    'You are a StarCraft: Brood War coach reviewing this player\'s replay ' +
      'library via Overmind, a local-first replay analyzer. The export below ' +
      'bundles library-wide aggregates, matchup/map/spawn rollups, Auto ' +
      'Coach warnings, and per-replay digests.',
  );
  lines.push('');
  lines.push(
    'Look for patterns the player cannot see from a single replay:',
  );
  lines.push('');
  lines.push('- Win rates by matchup, map, spawn pairing (close vs cross), race combo');
  lines.push('- Maps where the player loses quickly — the `shortLosses` column flags games lost before 5 minutes, a proxy for cheese/rush exposure');
  lines.push('- Opening production sequences that correlate with wins or losses (e.g. "Barracks > Factory > Starport" vs "Barracks > Factory > Factory")');
  lines.push('- Recurring Auto Coach warnings (supply blocks, mineral/gas floats, late expansion vs. opponent, late 3rd base/5th hatch)');
  lines.push('- Macro timing drift vs. the library averages');
  lines.push('');
  lines.push(
    'Numbers labeled "(est.)" are heuristics off the command stream — most ' +
      'notably mineral/gas balances, production-idle ratios, and resource ' +
      'floats. Treat them as directional. BW replays do not record unit ' +
      'deaths, so army losses and worker attrition are invisible; army-value ' +
      'and spent curves are cumulative inputs, not net worth.',
  );
  lines.push('');
  lines.push(
    'When you respond, lead with the 3 highest-confidence observations — ' +
      'things with a clear signal across multiple games and a specific, ' +
      'actionable fix. Cite exact games by map + matchup + date so the ' +
      'player can rewatch them. Follow with secondary leaks in order of ' +
      'impact. End with one concrete practice drill the player should run ' +
      'before their next session.',
  );
  lines.push('');
  lines.push(`_Exported: ${new Date().toISOString()} · Replays: ${digests.length}_`);
  if (opts.anonymize) {
    lines.push('');
    lines.push('_Player names have been anonymized. "me" is the user\'s identity; opponents are `opp-N`._');
  }
  lines.push('');

  // -- 2. Library aggregates ----------------------------------------------
  lines.push('## Library aggregates');
  lines.push('');
  lines.push(`- Average game duration: ${formatMMSS(agg.averageDurationSeconds)}`);
  lines.push(
    `- Average supply-block time per player: ${formatMMSS(agg.supplyBlockAverageSeconds)}`,
  );
  lines.push(
    `- Average production-idle ratio: ${(agg.productionIdleAverageRatio * 100).toFixed(0)}%`,
  );
  lines.push('');
  lines.push('### Matchup counts');
  lines.push('');
  lines.push('| Matchup | Games |');
  lines.push('|---------|-------|');
  for (const [m, n] of Object.entries(agg.matchupCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${m} | ${n} |`);
  }
  lines.push('');
  lines.push('### Per-race summary');
  lines.push('');
  lines.push('| Race | Games | Wins | Losses | ? | Winrate | Avg APM |');
  lines.push('|------|-------|------|--------|---|---------|---------|');
  for (const [r, v] of Object.entries(agg.byRace)) {
    const decided = v.wins + v.losses;
    const wr = decided > 0 ? `${Math.round((v.wins / decided) * 100)}%` : '—';
    const apm = Math.round(agg.averageApmByRace[r] ?? 0);
    lines.push(`| ${r} | ${v.games} | ${v.wins} | ${v.losses} | ${v.unknown} | ${wr} | ${apm} |`);
  }
  lines.push('');
  lines.push('### Average macro timings by race');
  lines.push('');
  lines.push('| Race | Gas | Expo | Tech | First army | Supply 100 | Supply 150 |');
  lines.push('|------|-----|------|------|-----------|-----------|-----------|');
  for (const [r, t] of Object.entries(agg.timingsByRace)) {
    lines.push(
      `| ${r} | ${formatTiming(t.firstGasSeconds)} | ${formatTiming(t.firstExpansionSeconds)} | ${formatTiming(t.firstTechBuildingSeconds)} | ${formatTiming(t.firstCombatUnitSeconds)} | ${formatTiming(t.supply100Seconds)} | ${formatTiming(t.supply150Seconds)} |`,
    );
  }
  lines.push('');

  // Me aggregates.
  if (agg.me.games > 0) {
    const decided = agg.me.wins + agg.me.losses;
    const wr = decided > 0 ? Math.round((agg.me.wins / decided) * 100) : null;
    lines.push('### As "me"');
    lines.push('');
    lines.push(
      `- ${agg.me.games} games · ${agg.me.wins}W ${agg.me.losses}L${agg.me.unknown ? ` ${agg.me.unknown}?` : ''}${
        wr != null ? ` · ${wr}% winrate` : ''
      }`,
    );
    lines.push(
      `- Avg APM: me **${Math.round(agg.me.averageApmMe)}** vs opp ${Math.round(agg.me.averageApmOpp)}`,
    );
    lines.push(
      `- Avg units produced: me ${Math.round(agg.me.averageUnitsMe)} vs opp ${Math.round(agg.me.averageUnitsOpp)}`,
    );
    lines.push('');
    lines.push('| Opp race | Games | Wins | Losses | ? | Winrate |');
    lines.push('|----------|-------|------|--------|---|---------|');
    for (const [r, v] of Object.entries(agg.me.byOpponentRace).sort((a, b) => b[1].games - a[1].games)) {
      const d = v.wins + v.losses;
      const vw = d > 0 ? `${Math.round((v.wins / d) * 100)}%` : '—';
      lines.push(`| ${r} | ${v.games} | ${v.wins} | ${v.losses} | ${v.unknown} | ${vw} |`);
    }
    lines.push('');
    lines.push('#### Me timings vs. opponent (averages)');
    lines.push('');
    lines.push('| Event | Me | Opp |');
    lines.push('|-------|----|-----|');
    const rows: Array<[string, keyof AverageTimings]> = [
      ['First gas', 'firstGasSeconds'],
      ['First expo', 'firstExpansionSeconds'],
      ['First tech building', 'firstTechBuildingSeconds'],
      ['First army unit', 'firstCombatUnitSeconds'],
      ['Supply 50', 'supply50Seconds'],
      ['Supply 100', 'supply100Seconds'],
      ['Supply 150', 'supply150Seconds'],
    ];
    for (const [label, key] of rows) {
      lines.push(
        `| ${label} | ${formatTiming(agg.me.timingsMe[key])} | ${formatTiming(agg.me.timingsOpp[key])} |`,
      );
    }
    lines.push('');
  }

  // -- 3. Rollups ---------------------------------------------------------
  if (rollups.length > 0) {
    lines.push('## Me rollups');
    lines.push('');

    const byMatchup = rollupByMatchup(rollups);
    if (byMatchup.length > 0) {
      lines.push('### By matchup');
      lines.push('');
      lines.push('| Matchup | Games | W | L | ? | Winrate | Avg dur | Avg APM me | Avg APM opp | Short losses | Avg supply block |');
      lines.push('|---------|-------|---|---|---|---------|---------|-----------|-------------|--------------|------------------|');
      for (const r of byMatchup) {
        const d = r.wins + r.losses;
        const wr = d > 0 ? `${Math.round((r.wins / d) * 100)}%` : '—';
        lines.push(
          `| ${r.matchup} | ${r.games} | ${r.wins} | ${r.losses} | ${r.unknown} | ${wr} | ${formatMMSS(r.avgDurationSeconds)} | ${Math.round(r.avgMyApm)} | ${Math.round(r.avgOppApm)} | ${r.shortLosses} | ${formatMMSS(r.avgSupplyBlockSeconds)} |`,
        );
      }
      lines.push('');
    }

    const byMatchupMap = rollupByMatchupMap(rollups);
    if (byMatchupMap.length > 0) {
      lines.push('### By matchup × map');
      lines.push('');
      lines.push('| Matchup | Map | Games | W | L | Winrate | Avg dur | Short losses |');
      lines.push('|---------|-----|-------|---|---|---------|---------|--------------|');
      for (const r of byMatchupMap) {
        const d = r.wins + r.losses;
        const wr = d > 0 ? `${Math.round((r.wins / d) * 100)}%` : '—';
        lines.push(
          `| ${r.matchup} | ${r.map} | ${r.games} | ${r.wins} | ${r.losses} | ${wr} | ${formatMMSS(r.avgDurationSeconds)} | ${r.shortLosses} |`,
        );
      }
      lines.push('');
    }

    lines.push('### By matchup × map × spawn');
    lines.push('');
    lines.push('| Matchup | Map | Spawn | Games | W | L | Winrate | Avg dur | Short losses |');
    lines.push('|---------|-----|-------|-------|---|---|---------|---------|--------------|');
    for (const r of rollups) {
      const d = r.wins + r.losses;
      const wr = d > 0 ? `${Math.round((r.wins / d) * 100)}%` : '—';
      lines.push(
        `| ${r.matchup} | ${r.map} | ${r.spawnSimple} | ${r.games} | ${r.wins} | ${r.losses} | ${wr} | ${formatMMSS(r.avgDurationSeconds)} | ${r.shortLosses} |`,
      );
    }
    lines.push('');
  }

  // Cross-replay coach warnings — what fires most often, across me-games.
  if (coachingByHash && coachingByHash.size > 0) {
    const buckets = new Map<
      string,
      { title: string; meGames: number; majorCount: number; sampleDetail: string }
    >();
    let meGameCount = 0;
    for (const d of digests) {
      const mePIDs = new Set(d.players.filter((p) => p.isMe).map((p) => p.playerID));
      if (mePIDs.size === 0) continue;
      meGameCount += 1;
      const coaching = coachingByHash.get(d.hash);
      if (!coaching) continue;
      const seen = new Set<string>();
      for (const pc of coaching) {
        if (!mePIDs.has(pc.playerID)) continue;
        for (const c of pc.callouts) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          const b = buckets.get(c.id) ?? {
            title: c.title,
            meGames: 0,
            majorCount: 0,
            sampleDetail: c.detail,
          };
          b.meGames += 1;
          if (c.severity === 'major') b.majorCount += 1;
          b.sampleDetail = c.detail;
          buckets.set(c.id, b);
        }
      }
    }
    if (buckets.size > 0 && meGameCount > 0) {
      lines.push('### Recurring coach warnings (me)');
      lines.push('');
      lines.push(`Across ${meGameCount} me-games:`);
      lines.push('');
      lines.push('| Warning | Games | % | Major | Sample detail |');
      lines.push('|---------|-------|---|-------|---------------|');
      const sorted = [...buckets.entries()].sort((a, b) => b[1].meGames - a[1].meGames);
      for (const [id, b] of sorted) {
        const pct = Math.round((b.meGames / meGameCount) * 100);
        lines.push(`| \`${id}\` · ${b.title} | ${b.meGames} | ${pct}% | ${b.majorCount} | ${escapeMd(b.sampleDetail)} |`);
      }
      lines.push('');
    }
  }

  // -- 4. Per-replay digest ----------------------------------------------
  lines.push('## Replays');
  lines.push('');
  for (const d of digests) {
    const meRep = d.players.find((p) => p.isMe);
    const oppRep = meRep ? d.players.find((p) => p.team !== meRep.team) : null;
    const winnerNames = d.winnerTeam != null
      ? d.players.filter((p) => p.team === d.winnerTeam).map((p) => name(p.name)).join(' & ')
      : null;

    lines.push(
      `### ${d.mapName || d.name} · ${d.matchup} · ${formatMMSS(d.durationSeconds)} · spawn: ${d.spawnSimple}`,
    );
    if (d.startTime) lines.push(`Date: ${d.startTime}`);
    lines.push(
      `Outcome: ${winnerNames ? `${winnerNames} won` : 'unknown'}${meRep?.shortLoss ? ' · **short loss (< 5 min)**' : ''}`,
    );

    // Per-player lines. If we have a me-player, lead with me then opp.
    const orderedPlayers = meRep
      ? [meRep, ...d.players.filter((p) => p !== meRep)]
      : d.players;
    for (const p of orderedPlayers) {
      const label = p.isMe ? 'me' : oppRep && p === oppRep ? 'opp' : `player`;
      const outcome = p.won === true ? 'W' : p.won === false ? 'L' : '?';
      const leave = p.leaveSeconds != null ? ` · left ${formatMMSS(p.leaveSeconds)}` : '';
      lines.push(
        `- **${label}** ${name(p.name)} [${p.race}, team ${p.team}, spawn ${p.spawnQuadrant ?? '?'}] · ${outcome} · APM ${p.apm}/EAPM ${p.eapm}${leave}`,
      );
    }

    for (const p of orderedPlayers) {
      const prodLine = formatProductionSequence(p.productionSequence, { limit: 18 });
      const who = p.isMe ? 'me' : oppRep && p === oppRep ? 'opp' : name(p.name);
      lines.push(`  - Production (${who}): ${prodLine || '—'}`);
      const t = p.timings;
      lines.push(
        `  - Timings (${who}): gas ${formatTiming(t.firstGasSeconds)} · expo ${formatTiming(t.firstExpansionSeconds)} · tech ${formatTiming(t.firstTechBuildingSeconds)}${
          t.firstTechName ? ` (${t.firstTechName})` : ''
        } · 1st army ${formatTiming(t.firstCombatUnitSeconds)}${
          t.firstCombatUnitName ? ` (${t.firstCombatUnitName})` : ''
        } · s100 ${formatTiming(t.supply100Seconds)} · s150 ${formatTiming(t.supply150Seconds)}`,
      );
      if (p.supplyBlockSeconds > 0 || p.supplyBlockCount > 0) {
        lines.push(
          `  - Supply block (${who}): ${formatMMSS(p.supplyBlockSeconds)} across ${p.supplyBlockCount} interval(s)`,
        );
      }
      const units = Object.entries(p.unitsProduced)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([n, c]) => `${n} ${c}`)
        .join(', ');
      if (units) lines.push(`  - Top units (${who}): ${units}`);
    }

    // Coach warnings for this replay.
    const coaching = coachingByHash?.get(d.hash);
    if (coaching && coaching.length > 0) {
      const lines2: string[] = [];
      for (const pc of coaching) {
        const who = meRep?.playerID === pc.playerID ? 'me' : oppRep?.playerID === pc.playerID ? 'opp' : name(pc.name);
        if (pc.callouts.length === 0) continue;
        lines2.push(
          `  - Warnings (${who}): ${pc.callouts
            .map((c) => `${c.id}[${c.severity}] ${escapeMd(c.detail)}`)
            .join(' | ')}`,
        );
      }
      if (lines2.length > 0) lines.push(...lines2);
    }

    if (d.notes?.trim()) {
      lines.push(`  - Notes: ${escapeMd(d.notes.trim())}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// Pick stable aliases: the isMe player becomes "me" (team shared with the
// first me-player becomes "me-2"). Every other player is "opp-1"..."opp-N"
// in name-order so the same opponent keeps the same alias across replays.
function buildAliases(digests: ReplayDigest[]): Map<string, string> {
  const out = new Map<string, string>();
  const meNames = new Set<string>();
  const oppNames = new Set<string>();
  for (const d of digests) {
    const mePlayers = d.players.filter((p) => p.isMe);
    if (mePlayers.length === 0) {
      for (const p of d.players) oppNames.add(p.name.trim().toLowerCase());
      continue;
    }
    for (const m of mePlayers) meNames.add(m.name.trim().toLowerCase());
    const meTeams = new Set(mePlayers.map((p) => p.team));
    for (const p of d.players) {
      const key = p.name.trim().toLowerCase();
      if (meNames.has(key)) continue;
      if (meTeams.has(p.team)) meNames.add(key); // teammates also "me-side"
      else oppNames.add(key);
    }
  }
  const meSorted = [...meNames].sort();
  const oppSorted = [...oppNames].sort();
  meSorted.forEach((n, i) => out.set(n, meSorted.length === 1 ? 'me' : `me-${i + 1}`));
  oppSorted.forEach((n, i) => out.set(n, `opp-${i + 1}`));
  return out;
}

function escapeMd(s: string): string {
  // Markdown pipes break tables; strip them. Newlines too — the detail
  // strings should fit on one line.
  return s.replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ');
}

// Re-export to keep external references stable.
export { SHORT_LOSS_SECONDS };
