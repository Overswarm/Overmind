// Recurring-opponent dossier. When the user has configured their own
// identities, we scan every me-containing digest, extract the non-me
// opposing player, and group by cleaned name. Anyone appearing ≥2 times
// gets a card with record vs me, their avg APM, race preferences, maps
// played on, and the top buildings / units they produce.
//
// Intentionally static: no live updates, no chart — just a clear dossier
// for scouting.

import { useMemo, useState } from 'react';
import type { ReplayDigest, PlayerDigest } from '../analysis/aggregate';
import { formatMMSS } from '../types/replay';
import { formatTiming } from '../analysis/timings';

interface OpponentSummary {
  name: string;
  games: number;
  wins: number;        // me's wins (= opponent losses)
  losses: number;      // me's losses
  unknown: number;
  races: Record<string, number>;
  apmSum: number;
  apmN: number;
  maps: Record<string, number>;
  unitsProduced: Record<string, number>;
  buildingsProduced: Record<string, number>;
  firstExpSum: number; firstExpN: number;
  firstTechSum: number; firstTechN: number;
  // References back to the digests, so "open the replay" and the "recent
  // games" list work without re-scanning.
  appearances: Array<{ digest: ReplayDigest; opp: PlayerDigest; me: PlayerDigest }>;
}

export function OpponentProfile({ digests }: { digests: ReplayDigest[] }) {
  const opponents = useMemo(() => buildDossiers(digests), [digests]);
  const [openName, setOpenName] = useState<string | null>(null);

  if (opponents.length === 0) {
    return null;
  }

  const sorted = [...opponents].sort((a, b) => b.games - a.games);

  return (
    <div className="theme-panel rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Recurring opponents ({sorted.length})
        </div>
        <div className="text-[10px] text-[var(--color-muted)]">
          Click a name for the full dossier
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((o) => {
          const topRace = Object.entries(o.races).sort((a, b) => b[1] - a[1])[0];
          const decided = o.wins + o.losses;
          const wr = decided > 0 ? Math.round((o.wins / decided) * 100) : null;
          const isOpen = openName === o.name;
          return (
            <div
              key={o.name}
              className={`rounded border border-[var(--color-border)] ${isOpen ? 'col-span-full' : ''}`}
            >
              <button
                onClick={() => setOpenName((cur) => (cur === o.name ? null : o.name))}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--color-bg-elev)]"
              >
                <div className="flex items-baseline gap-2 truncate">
                  <span className="truncate font-semibold text-[var(--color-text-h)]" title={o.name}>
                    {o.name}
                  </span>
                  <span className="rounded bg-[var(--color-bg-elev)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted)]">
                    {topRace ? `${topRace[0]}` : '?'}
                  </span>
                </div>
                <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums">
                  <span title="Your record against them">
                    <span style={{ color: 'var(--color-win)' }}>{o.wins}</span>
                    -
                    <span style={{ color: 'var(--color-loss)' }}>{o.losses}</span>
                    {o.unknown > 0 && <span className="text-[var(--color-muted)]">-{o.unknown}</span>}
                  </span>
                  <span className="text-[var(--color-muted)]">
                    {wr != null ? `${wr}%` : '—'}
                  </span>
                  <span className="text-[var(--color-muted)]">
                    APM {o.apmN > 0 ? Math.round(o.apmSum / o.apmN) : '—'}
                  </span>
                </div>
              </button>
              {isOpen && <OpponentDetail o={o} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OpponentDetail({ o }: { o: OpponentSummary }) {
  const topUnits = Object.entries(o.unitsProduced)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const topBuildings = Object.entries(o.buildingsProduced)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const topMaps = Object.entries(o.maps).sort((a, b) => b[1] - a[1]);
  const avgExp = o.firstExpN > 0 ? o.firstExpSum / o.firstExpN : null;
  const avgTech = o.firstTechN > 0 ? o.firstTechSum / o.firstTechN : null;

  return (
    <div className="border-t border-[var(--color-border)] px-3 py-2 text-xs">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Race mix
          </div>
          <div className="flex flex-wrap gap-1 font-mono">
            {Object.entries(o.races).map(([race, n]) => (
              <span key={race} className="rounded bg-[var(--color-bg-elev)] px-1.5 py-0.5">
                {race}: {n}
              </span>
            ))}
          </div>
          <div className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Macro habits
          </div>
          <div className="font-mono text-[11px] tabular-nums text-[var(--color-muted)]">
            <div>Expo: <span className="text-[var(--color-text-h)]">{formatTiming(avgExp)}</span></div>
            <div>Tech: <span className="text-[var(--color-text-h)]">{formatTiming(avgTech)}</span></div>
          </div>
        </div>

        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Top buildings
          </div>
          <div className="flex flex-col gap-0.5 font-mono text-[11px] tabular-nums">
            {topBuildings.map(([name, n]) => (
              <div key={name} className="flex justify-between gap-2">
                <span className="truncate text-[var(--color-muted)]" title={name}>{name}</span>
                <span>{n}</span>
              </div>
            ))}
            {topBuildings.length === 0 && <div className="text-[var(--color-muted)]">No data.</div>}
          </div>
        </div>

        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Top units
          </div>
          <div className="flex flex-col gap-0.5 font-mono text-[11px] tabular-nums">
            {topUnits.map(([name, n]) => (
              <div key={name} className="flex justify-between gap-2">
                <span className="truncate text-[var(--color-muted)]" title={name}>{name}</span>
                <span>{n}</span>
              </div>
            ))}
            {topUnits.length === 0 && <div className="text-[var(--color-muted)]">No data.</div>}
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-[var(--color-border)] pt-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Maps played ({topMaps.length})
        </div>
        <div className="flex flex-wrap gap-1 font-mono text-[11px]">
          {topMaps.map(([m, n]) => (
            <span key={m} className="rounded bg-[var(--color-bg-elev)] px-1.5 py-0.5">
              {m} ({n})
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 border-t border-[var(--color-border)] pt-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Games ({o.appearances.length})
        </div>
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                <th className="px-2 py-0.5">Map</th>
                <th className="px-2 py-0.5">Race</th>
                <th className="px-2 py-0.5 text-right">Dur.</th>
                <th className="px-2 py-0.5 text-right">Result</th>
              </tr>
            </thead>
            <tbody>
              {o.appearances.map(({ digest, opp, me }) => (
                <tr key={digest.hash} className="border-t border-[var(--color-border)]">
                  <td className="max-w-[180px] truncate px-2 py-0.5" title={digest.mapName}>
                    {digest.mapName ?? digest.name}
                  </td>
                  <td className="px-2 py-0.5 font-mono">{opp.race}</td>
                  <td className="px-2 py-0.5 text-right font-mono tabular-nums">
                    {formatMMSS(digest.durationSeconds)}
                  </td>
                  <td className="px-2 py-0.5 text-right font-mono">
                    {me.won === true ? (
                      <span style={{ color: 'var(--color-win)' }}>W</span>
                    ) : me.won === false ? (
                      <span style={{ color: 'var(--color-loss)' }}>L</span>
                    ) : (
                      <span className="text-[var(--color-muted)]">?</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function buildDossiers(digests: ReplayDigest[]): OpponentSummary[] {
  const bag = new Map<string, OpponentSummary>();
  for (const d of digests) {
    const mePlayers = d.players.filter((p) => p.isMe);
    if (mePlayers.length === 0) continue;
    const me = mePlayers[0];
    // Every non-me player on the opposing team is logged as one opponent
    // appearance. In 1v1 that's a single entry; in 2v2 each enemy gets a
    // separate dossier.
    for (const p of d.players) {
      if (p.isMe) continue;
      if (p.team === me.team) continue;
      const key = p.name.trim();
      if (!key) continue;

      const existing = bag.get(key.toLowerCase());
      const s: OpponentSummary =
        existing ??
        {
          name: key,
          games: 0,
          wins: 0,
          losses: 0,
          unknown: 0,
          races: {},
          apmSum: 0,
          apmN: 0,
          maps: {},
          unitsProduced: {},
          buildingsProduced: {},
          firstExpSum: 0, firstExpN: 0,
          firstTechSum: 0, firstTechN: 0,
          appearances: [],
        };
      s.games += 1;
      if (me.won === true) s.wins += 1;
      else if (me.won === false) s.losses += 1;
      else s.unknown += 1;
      s.races[p.race] = (s.races[p.race] ?? 0) + 1;
      s.apmSum += p.apm;
      s.apmN += 1;
      const mapKey = d.mapName ?? '(unknown map)';
      s.maps[mapKey] = (s.maps[mapKey] ?? 0) + 1;
      for (const [u, n] of Object.entries(p.unitsProduced)) {
        s.unitsProduced[u] = (s.unitsProduced[u] ?? 0) + n;
      }
      for (const [b, n] of Object.entries(p.buildingsProduced)) {
        s.buildingsProduced[b] = (s.buildingsProduced[b] ?? 0) + n;
      }
      if (p.timings.firstExpansionSeconds != null) {
        s.firstExpSum += p.timings.firstExpansionSeconds;
        s.firstExpN += 1;
      }
      if (p.timings.firstTechBuildingSeconds != null) {
        s.firstTechSum += p.timings.firstTechBuildingSeconds;
        s.firstTechN += 1;
      }
      s.appearances.push({ digest: d, opp: p, me });
      bag.set(key.toLowerCase(), s);
    }
  }
  // Only expose opponents we've actually played more than once.
  return [...bag.values()].filter((o) => o.games >= 2);
}
