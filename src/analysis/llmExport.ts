// LLM-friendly multi-replay export. Dense but structured markdown: easy to
// grep, easy for a language model to parse, and compact enough that a
// reasonable library (dozens of replays) fits in a single context window.
//
// Each replay block is self-contained — no cross-references — so the LLM
// can answer questions like "which matchups do I win more tanks in?" by
// scanning sequentially. Top-of-file includes aggregate counts so quick
// questions can be answered without reading every replay.

import { formatMMSS } from '../types/replay';
import type { ReplayDigest, Aggregate } from './aggregate';

export function renderLibraryExport(digests: ReplayDigest[], agg: Aggregate): string {
  const lines: string[] = [];
  lines.push('# Overmind Library Export');
  lines.push('');
  lines.push(`Exported: ${new Date().toISOString()}`);
  lines.push(`Replays: ${digests.length}`);
  lines.push('');
  lines.push('## Aggregate');
  lines.push('');
  lines.push(`Average duration: ${formatMMSS(agg.averageDurationSeconds)}`);
  lines.push(`Average supply-block seconds per player: ${agg.supplyBlockAverageSeconds.toFixed(1)}`);
  lines.push(`Average production idle ratio per building pool: ${(agg.productionIdleAverageRatio * 100).toFixed(0)}%`);
  lines.push('');
  lines.push('### Matchups');
  for (const [m, n] of Object.entries(agg.matchupCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${m}: ${n}`);
  }
  lines.push('');
  lines.push('### By race');
  for (const [r, v] of Object.entries(agg.byRace)) {
    const winrate = v.wins + v.losses > 0 ? Math.round((v.wins / (v.wins + v.losses)) * 100) : null;
    const apm = Math.round(agg.averageApmByRace[r] ?? 0);
    lines.push(
      `- ${r}: ${v.games} games, ${v.wins}W ${v.losses}L ${v.unknown}?` +
        (winrate != null ? `, winrate ${winrate}%` : '') +
        `, avg APM ${apm}`,
    );
  }
  lines.push('');
  lines.push('## Replays');
  lines.push('');

  for (const d of digests) {
    lines.push('---');
    lines.push(`### ${d.mapName || d.name} · ${d.matchup} · ${formatMMSS(d.durationSeconds)}`);
    if (d.startTime) lines.push(`Date: ${d.startTime}`);
    if (d.winnerTeam != null) {
      const winners = d.players.filter((p) => p.team === d.winnerTeam).map((p) => p.name);
      lines.push(`Winner team: ${d.winnerTeam} (${winners.join(', ')})`);
    } else {
      lines.push(`Winner team: unknown`);
    }
    for (const p of d.players) {
      lines.push(
        `Player ${p.name} [team ${p.team}, ${p.race}] APM ${p.apm} EAPM ${p.eapm}` +
          (p.won === true ? ' WIN' : p.won === false ? ' LOSS' : ''),
      );
    }
    lines.push('');

    for (const p of d.players) {
      lines.push(`#### ${p.name} (${p.race})`);
      const units = Object.entries(p.unitsProduced)
        .sort((a, b) => b[1] - a[1])
        .map(([n, c]) => `${n} ${c}`)
        .join(', ');
      if (units) lines.push(`Units: ${units}`);
      const buildings = Object.entries(p.buildingsProduced)
        .sort((a, b) => b[1] - a[1])
        .map(([n, c]) => `${n} ${c}`)
        .join(', ');
      if (buildings) lines.push(`Buildings: ${buildings}`);
      lines.push(
        `Supply blocks: ${formatMMSS(p.supplyBlockSeconds)} over ${p.supplyBlockCount} interval(s)`,
      );
      if (p.productionIdleByPool.length > 0) {
        const idle = p.productionIdleByPool
          .map((pl) => `${pl.name}×${pl.count} ${Math.round(pl.idleRatio * 100)}%`)
          .join(', ');
        lines.push(`Production idle: ${idle}`);
      }
      lines.push('');
    }

    if (d.notes?.trim()) {
      lines.push('#### Notes');
      lines.push(d.notes.trim());
      lines.push('');
    }
  }

  return lines.join('\n');
}
