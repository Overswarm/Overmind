// Per-map detail page — opened from AnalysisView when a single map is
// selected via the Map filter. Shows matchup distribution on this map,
// win/loss split, APM, and for each race the most common opening
// buildings (first building constructed per replay). Purely read-only: no
// parsing triggered here; operates on the digests already computed.

import { useMemo } from 'react';
import { formatMMSS } from '../types/replay';
import type { ReplayDigest } from '../analysis/aggregate';

export function MapDetail({
  mapName,
  digests,
  onBack,
}: {
  mapName: string;
  digests: ReplayDigest[];
  onBack: () => void;
}) {
  const stats = useMemo(() => {
    const matchups: Record<string, number> = {};
    const byRace: Record<string, { games: number; wins: number; losses: number; unknown: number; apm: number[] }> = {};
    let dur = 0;
    // Player position distribution: raw start-location buckets are not
    // available from the digest, so we approximate with team balance.
    let team1Wins = 0, team2Wins = 0, teamGames = 0;

    for (const d of digests) {
      matchups[d.matchup] = (matchups[d.matchup] ?? 0) + 1;
      dur += d.durationSeconds;
      for (const p of d.players) {
        byRace[p.race] ??= { games: 0, wins: 0, losses: 0, unknown: 0, apm: [] };
        byRace[p.race].games += 1;
        byRace[p.race].apm.push(p.apm);
        if (p.won === true) byRace[p.race].wins += 1;
        else if (p.won === false) byRace[p.race].losses += 1;
        else byRace[p.race].unknown += 1;
      }
      if (d.winnerTeam != null) {
        teamGames += 1;
        if (d.winnerTeam === 1) team1Wins += 1;
        else if (d.winnerTeam === 2) team2Wins += 1;
      }
    }
    return {
      matchups,
      byRace,
      avgDur: digests.length > 0 ? dur / digests.length : 0,
      teamBalance: { team1Wins, team2Wins, teamGames },
    };
  }, [digests]);

  // Most-frequently-built tech structures per race. Anything with ≥3 entries
  // counts as a signature tech; the fraction shown is "% of your {race} games
  // that ever built this".
  const techByRace = useMemo(() => {
    const byRace: Record<string, { counts: Record<string, number>; games: number }> = {};
    for (const d of digests) {
      for (const p of d.players) {
        byRace[p.race] ??= { counts: {}, games: 0 };
        byRace[p.race].games += 1;
        for (const b of Object.keys(p.buildingsProduced)) {
          byRace[p.race].counts[b] = (byRace[p.race].counts[b] ?? 0) + 1;
        }
      }
    }
    const out: Record<string, { name: string; count: number; games: number }[]> = {};
    for (const [r, v] of Object.entries(byRace)) {
      out[r] = Object.entries(v.counts)
        .map(([name, count]) => ({ name, count, games: v.games }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }
    return out;
  }, [digests]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4 text-sm text-[var(--color-text-h)]">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text-h)]"
        >
          ← Back to analysis
        </button>
        <div className="text-lg font-semibold">{mapName}</div>
        <div className="text-xs text-[var(--color-muted)]">
          {digests.length} game{digests.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="Games" value={`${digests.length}`} />
        <Card label="Avg duration" value={formatMMSS(stats.avgDur)} />
        <Card
          label="Team 1 winrate"
          value={
            stats.teamBalance.teamGames > 0
              ? `${Math.round((stats.teamBalance.team1Wins / stats.teamBalance.teamGames) * 100)}%`
              : '—'
          }
          sub={`${stats.teamBalance.team1Wins}-${stats.teamBalance.team2Wins}`}
        />
        <Card
          label="Matchups"
          value={`${Object.keys(stats.matchups).length}`}
          sub="distinct"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Matchup distribution
          </div>
          <DistributionList rows={Object.entries(stats.matchups).map(([k, v]) => ({ k, v }))} />
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            By race on this map
          </div>
          <div className="grid grid-cols-[auto_auto_auto_auto_auto] gap-x-4 gap-y-1 font-mono tabular-nums text-xs">
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Race</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Games</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">W-L-?</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Winrate</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Avg APM</div>
            {Object.entries(stats.byRace).map(([r, v]) => {
              const decided = v.wins + v.losses;
              const wr = decided > 0 ? Math.round((v.wins / decided) * 100) : null;
              const apmAvg = v.apm.length > 0 ? v.apm.reduce((a, b) => a + b, 0) / v.apm.length : 0;
              return (
                <div key={r} className="contents">
                  <div className="font-semibold">{r}</div>
                  <div>{v.games}</div>
                  <div>{v.wins}-{v.losses}-{v.unknown}</div>
                  <div>{wr != null ? `${wr}%` : '—'}</div>
                  <div>{Math.round(apmAvg)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Common tech per race (% of games that built it)
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {Object.entries(techByRace).map(([race, rows]) => (
            <div key={race}>
              <div className="mb-1 font-mono text-xs text-[var(--color-text-h)]">{race}</div>
              <div className="flex flex-col gap-1">
                {rows.map((row) => {
                  const pct = row.games > 0 ? Math.round((row.count / row.games) * 100) : 0;
                  return (
                    <div key={row.name} className="flex items-center gap-2 font-mono tabular-nums text-[11px]">
                      <span className="w-32 truncate text-[var(--color-muted)]" title={row.name}>
                        {row.name}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded bg-[var(--color-bg-elev)]">
                        <div
                          className="h-full"
                          style={{ width: `${pct}%`, background: 'var(--color-accent)' }}
                        />
                      </div>
                      <span className="w-10 text-right">{pct}%</span>
                    </div>
                  );
                })}
                {rows.length === 0 && (
                  <div className="text-[10px] text-[var(--color-muted)]">No data.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
        <div className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Games on {mapName}
        </div>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-bg-elev)]">
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                <th className="px-3 py-1">Matchup</th>
                <th className="px-3 py-1">Players</th>
                <th className="px-3 py-1 text-right">Dur.</th>
                <th className="px-3 py-1 text-right">Winner</th>
              </tr>
            </thead>
            <tbody>
              {digests.map((d) => {
                const winners = d.winnerTeam != null
                  ? d.players.filter((p) => p.team === d.winnerTeam).map((p) => p.name).join(', ')
                  : '';
                return (
                  <tr key={d.hash} className="border-t border-[var(--color-border)]">
                    <td className="px-3 py-1 font-mono">{d.matchup}</td>
                    <td className="px-3 py-1 text-[var(--color-muted)]">
                      {d.players.map((p) => `${p.name} (${p.race})`).join(' vs ')}
                    </td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums">{formatMMSS(d.durationSeconds)}</td>
                    <td className="px-3 py-1 text-right">
                      {winners || <span className="text-[var(--color-muted)]">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className="mt-1 font-mono text-2xl tabular-nums text-[var(--color-text-h)]">{value}</div>
      {sub && <div className="text-[10px] text-[var(--color-muted)]">{sub}</div>}
    </div>
  );
}

function DistributionList({ rows }: { rows: { k: string; v: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  const sorted = [...rows].sort((a, b) => b.v - a.v);
  return (
    <div className="flex flex-col gap-1">
      {sorted.map((r) => (
        <div key={r.k} className="flex items-center gap-2 font-mono tabular-nums">
          <span className="w-12 font-semibold">{r.k}</span>
          <div className="h-2 flex-1 overflow-hidden rounded bg-[var(--color-bg-elev)]">
            <div
              className="h-full"
              style={{ width: `${(r.v / max) * 100}%`, background: 'var(--color-accent)' }}
            />
          </div>
          <span className="w-8 text-right text-[var(--color-muted)]">{r.v}</span>
        </div>
      ))}
    </div>
  );
}
