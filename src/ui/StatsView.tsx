// Fun-stats tab. Loads the library, digests each replay, keeps only games
// where a "me" identity played, and renders bite-sized factoids:
// records, career totals, per-race army counts, top opponents/maps,
// game-length distributions, and favorite openings per matchup.
//
// Gated on having at least one identity configured — without one we'd be
// counting units from random Terrans, so we nudge the user to add a name.

import { useEffect, useMemo, useState } from 'react';
import { getCachedReplay, listLibrary, type LibraryEntry } from '../storage/db';
import { digestReplay, type ReplayDigest } from '../analysis/aggregate';
import { computeFunStats, formatHoursMinutes, type FunStats } from '../analysis/funStats';
import { useSettingsStore } from '../state/settings';

export function StatsView() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [digests, setDigests] = useState<ReplayDigest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMyRace, setFilterMyRace] = useState<string | null>(null);
  const [filterOppRace, setFilterOppRace] = useState<string | null>(null);
  const [filterMap, setFilterMap] = useState<string | null>(null);

  const identities = useSettingsStore((s) => s.identities);
  const addIdentity = useSettingsStore((s) => s.addIdentity);
  const removeIdentity = useSettingsStore((s) => s.removeIdentity);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const lib = await listLibrary();
      if (cancelled) return;
      setEntries(lib);
      const out: ReplayDigest[] = [];
      for (const e of lib) {
        try {
          const parsed = await getCachedReplay(e.hash);
          if (!parsed) continue;
          out.push(digestReplay(e, parsed, identities));
        } catch (err) {
          console.warn('[stats] failed to digest', e.hash, err);
        }
      }
      if (cancelled) return;
      setDigests(out);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [identities]);

  // Only include games where "me" actually played; this is the whole point
  // of the tab (otherwise "total tanks" counts everyone's tanks).
  const meGames = useMemo(
    () => digests.filter((d) => d.players.some((p) => p.isMe)),
    [digests],
  );

  const filtered = useMemo(() => {
    return meGames.filter((d) => {
      const me = d.players.find((p) => p.isMe);
      if (!me) return false;
      const opp = d.players.find((p) => p.team !== me.team);
      if (filterMyRace && me.race !== filterMyRace) return false;
      if (filterOppRace && (opp?.race ?? '?') !== filterOppRace) return false;
      if (filterMap && (d.mapName ?? '').toLowerCase() !== filterMap.toLowerCase()) return false;
      return true;
    });
  }, [meGames, filterMyRace, filterOppRace, filterMap]);

  const stats = useMemo(() => computeFunStats(filtered), [filtered]);

  const myRaces = useMemo(() => {
    const r = new Set<string>();
    for (const d of meGames) {
      const me = d.players.find((p) => p.isMe);
      if (me) r.add(me.race);
    }
    return [...r].sort();
  }, [meGames]);
  const oppRaces = useMemo(() => {
    const r = new Set<string>();
    for (const d of meGames) {
      const me = d.players.find((p) => p.isMe);
      if (!me) continue;
      const opp = d.players.find((p) => p.team !== me.team);
      r.add(opp?.race ?? '?');
    }
    return [...r].sort();
  }, [meGames]);
  const maps = useMemo(() => {
    const m = new Set<string>();
    for (const d of meGames) if (d.mapName) m.add(d.mapName);
    return [...m].sort();
  }, [meGames]);

  if (identities.length === 0) {
    return (
      <div className="flex h-full flex-col gap-3 overflow-auto p-4 text-sm text-[var(--color-text-h)]">
        <div className="text-lg font-semibold">Fun stats</div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4 text-xs text-[var(--color-muted)]">
          Add your in-game name below to start tracking records, career totals,
          and per-matchup habits. Without a name we'd count every Terran's tanks,
          every Protoss's probes, etc.
        </div>
        <IdentityBar
          identities={identities}
          onAdd={addIdentity}
          onRemove={removeIdentity}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4 text-sm text-[var(--color-text-h)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-lg font-semibold">Fun stats</div>
        <div className="text-xs text-[var(--color-muted)]">
          {loading
            ? 'Loading…'
            : `${filtered.length} of ${meGames.length} your games · ${entries.length} total in library`}
        </div>
      </div>

      <IdentityBar
        identities={identities}
        onAdd={addIdentity}
        onRemove={removeIdentity}
      />

      <FilterBar label="My race" options={myRaces} value={filterMyRace} onChange={setFilterMyRace} />
      <FilterBar label="Opp race" options={oppRaces} value={filterOppRace} onChange={setFilterOppRace} />
      <FilterBar label="Map" options={maps} value={filterMap} onChange={setFilterMap} />

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-4 text-xs text-[var(--color-muted)]">
          {meGames.length === 0
            ? 'No replays with your name yet. Import some games or check that your identity tag matches how your name appears in-game.'
            : 'No games match those filters.'}
        </div>
      ) : (
        <>
          <CareerCard stats={stats} />
          <RecordsCard stats={stats} />
          <ByRaceSection stats={stats} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TopOpponentsCard stats={stats} />
            <TopMapsCard stats={stats} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <LengthBucketsCard stats={stats} />
            <OpeningsCard stats={stats} />
          </div>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sections

function CareerCard({ stats }: { stats: FunStats }) {
  const decided = stats.wins + stats.losses;
  const wr = decided > 0 ? Math.round((stats.wins / decided) * 100) : null;
  return (
    <div className="rounded-lg border border-[var(--color-accent)]/40 bg-[color-mix(in_oklab,var(--color-accent)_6%,var(--color-bg-panel))] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
        Career
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-6">
        <Stat label="Games" value={`${stats.games}`} />
        <Stat
          label="Record"
          value={`${stats.wins}-${stats.losses}${stats.unknown > 0 ? `-${stats.unknown}` : ''}`}
        />
        <Stat label="Winrate" value={wr != null ? `${wr}%` : '—'} />
        <Stat label="Time played" value={formatHoursMinutes(stats.totalSeconds)} />
        <Stat label="Best win streak" value={`${stats.longestWinStreak}`} />
        <Stat label="Worst loss streak" value={`${stats.longestLossStreak}`} />
      </div>
    </div>
  );
}

function RecordsCard({ stats }: { stats: FunStats }) {
  if (stats.records.length === 0) return null;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Records
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {stats.records.map((r) => (
          <div
            key={r.label}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                {r.label}
              </span>
              <span className="font-mono text-sm tabular-nums text-[var(--color-text-h)]">
                {r.value}
              </span>
            </div>
            {r.detail && (
              <div className="mt-0.5 truncate text-[10px] text-[var(--color-muted)]">{r.detail}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ByRaceSection({ stats }: { stats: FunStats }) {
  const entries = Object.entries(stats.byMyRace).sort((a, b) => b[1].games - a[1].games);
  if (entries.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {entries.map(([race, v]) => {
        const decided = v.wins + v.losses;
        const wr = decided > 0 ? Math.round((v.wins / decided) * 100) : null;
        const topUnits = Object.entries(v.unitsProduced)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8);
        const topBuildings = Object.entries(v.buildingsProduced)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6);
        return (
          <div
            key={race}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3"
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                As {race}
              </span>
              <span className="font-mono text-[10px] text-[var(--color-muted)]">
                {v.games} games · {v.wins}-{v.losses}
                {wr != null ? ` · ${wr}%` : ''}
              </span>
            </div>
            <div className="mb-2 text-[10px] text-[var(--color-muted)]">
              Workers trained:{' '}
              <span className="font-mono text-[var(--color-text-h)]">{v.workers}</span>
            </div>
            {topUnits.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  Units
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums">
                  {topUnits.map(([u, n]) => (
                    <div key={u} className="flex justify-between">
                      <span className="truncate text-[var(--color-text-h)]">{u}</span>
                      <span className="text-[var(--color-muted)]">{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {topBuildings.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  Buildings
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums">
                  {topBuildings.map(([b, n]) => (
                    <div key={b} className="flex justify-between">
                      <span className="truncate text-[var(--color-text-h)]">{b}</span>
                      <span className="text-[var(--color-muted)]">{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TopOpponentsCard({ stats }: { stats: FunStats }) {
  if (stats.topOpponents.length === 0) return null;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Top opponents
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            <th className="py-1">Name</th>
            <th className="py-1 text-center">Race</th>
            <th className="py-1 text-right">Games</th>
            <th className="py-1 text-right">W-L</th>
            <th className="py-1 text-right">WR</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {stats.topOpponents.map((o) => {
            const decided = o.wins + o.losses;
            const wr = decided > 0 ? Math.round((o.wins / decided) * 100) : null;
            return (
              <tr key={o.name} className="border-t border-[var(--color-border)]">
                <td className="max-w-[140px] truncate py-1 text-[var(--color-text-h)]">{o.name}</td>
                <td className="py-1 text-center">{o.race}</td>
                <td className="py-1 text-right">{o.games}</td>
                <td className="py-1 text-right">{o.wins}-{o.losses}</td>
                <td className="py-1 text-right">{wr != null ? `${wr}%` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TopMapsCard({ stats }: { stats: FunStats }) {
  if (stats.topMaps.length === 0) return null;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Top maps
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            <th className="py-1">Map</th>
            <th className="py-1 text-right">Games</th>
            <th className="py-1 text-right">W-L</th>
            <th className="py-1 text-right">WR</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {stats.topMaps.map((m) => {
            const decided = m.wins + m.losses;
            const wr = decided > 0 ? Math.round((m.wins / decided) * 100) : null;
            return (
              <tr key={m.name} className="border-t border-[var(--color-border)]">
                <td className="max-w-[200px] truncate py-1 text-[var(--color-text-h)]">{m.name}</td>
                <td className="py-1 text-right">{m.games}</td>
                <td className="py-1 text-right">{m.wins}-{m.losses}</td>
                <td className="py-1 text-right">{wr != null ? `${wr}%` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LengthBucketsCard({ stats }: { stats: FunStats }) {
  if (stats.lengthBuckets.length === 0) return null;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Game length by matchup
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            <th className="py-1">Matchup</th>
            <th className="py-1 text-right">Games</th>
            <th className="py-1 text-right">≥15m</th>
            <th className="py-1 text-right">≥20m</th>
            <th className="py-1 text-right">≥30m</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {stats.lengthBuckets.map((r) => (
            <tr key={r.matchup} className="border-t border-[var(--color-border)]">
              <td className="py-1 text-[var(--color-text-h)]">{r.matchup}</td>
              <td className="py-1 text-right">{r.games}</td>
              <td className="py-1 text-right">{pct(r.over15, r.games)}%</td>
              <td className="py-1 text-right">{pct(r.over20, r.games)}%</td>
              <td className="py-1 text-right">{pct(r.over30, r.games)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OpeningsCard({ stats }: { stats: FunStats }) {
  if (stats.openings.length === 0) return null;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Favorite opening
      </div>
      <div className="mb-2 text-[10px] text-[var(--color-muted)]">
        Most common first tech building per matchup.
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            <th className="py-1">Matchup</th>
            <th className="py-1">Opening</th>
            <th className="py-1 text-right">Used</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {stats.openings.map((o) => (
            <tr key={o.matchup} className="border-t border-[var(--color-border)]">
              <td className="py-1 text-[var(--color-text-h)]">{o.matchup}</td>
              <td className="py-1 text-[var(--color-text-h)]">{o.opening}</td>
              <td className="py-1 text-right">
                {o.count}/{o.games}
                <span className="ml-1 text-[var(--color-muted)]">
                  ({Math.round((o.count / Math.max(1, o.games)) * 100)}%)
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Helpers

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</div>
      <div className="font-mono text-lg tabular-nums">{value}</div>
    </div>
  );
}

function FilterBar({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (options.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="w-16 text-[var(--color-muted)]">{label}</span>
      <button
        onClick={() => onChange(null)}
        className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
          value == null
            ? 'bg-[var(--color-accent)] text-white'
            : 'border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text-h)]'
        }`}
      >
        All
      </button>
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(value === o ? null : o)}
          className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
            value === o
              ? 'bg-[var(--color-accent)] text-white'
              : 'border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text-h)]'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function IdentityBar({
  identities,
  onAdd,
  onRemove,
}: {
  identities: string[];
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const [value, setValue] = useState('');
  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onAdd(v);
    setValue('');
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        className="w-16 text-[var(--color-muted)]"
        title="Names you play under — used to split stats into 'me' vs opponent"
      >
        Me tags
      </span>
      {identities.map((name) => (
        <span
          key={name}
          className="flex items-center gap-1 rounded bg-[color-mix(in_oklab,var(--color-accent)_22%,transparent)] px-2 py-0.5 text-[var(--color-text-h)]"
        >
          {name}
          <button
            onClick={() => onRemove(name)}
            className="text-[var(--color-muted)] hover:text-[var(--color-text-h)]"
            aria-label={`Remove ${name}`}
            title="Remove"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder={identities.length === 0 ? 'Add your BW name (press Enter)…' : 'Add another…'}
        className="w-48 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-0.5 text-xs text-[var(--color-text-h)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
      />
      {value.trim() && (
        <button
          onClick={submit}
          className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)] hover:text-[var(--color-text-h)]"
        >
          Add
        </button>
      )}
    </div>
  );
}
