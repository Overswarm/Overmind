import { useEffect, useMemo, useState } from 'react';
import { db, getCachedReplay, listLibrary, type LibraryEntry } from '../storage/db';
import { formatMMSS } from '../types/replay';
import { aggregateDigests, digestReplay, type ReplayDigest } from '../analysis/aggregate';
import { renderLibraryExport } from '../analysis/llmExport';
import { useSettingsStore } from '../state/settings';
import { MapDetail } from './MapDetail';
import { CompareView } from './CompareView';
import { TimingsCard } from './TimingsCard';
import { TrendChart } from './TrendChart';
import { OpponentProfile } from './OpponentProfile';

// Analysis view: loads every library entry that has a cached parsed replay
// and produces cross-replay aggregates + a dense LLM-friendly export. Entries
// without a cached parse are listed but skipped from the stats — re-opening
// the replay once in the main view re-caches it.
export function AnalysisView() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [digests, setDigests] = useState<ReplayDigest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMatchup, setFilterMatchup] = useState<string | null>(null);
  const [filterRace, setFilterRace] = useState<string | null>(null);
  const [filterMap, setFilterMap] = useState<string | null>(null);
  const [filterMeOnly, setFilterMeOnly] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [comparing, setComparing] = useState(false);
  const [mapDetail, setMapDetail] = useState<string | null>(null);

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
      const miss: string[] = [];
      // Process sequentially: re-using Dexie connections under high concurrency
      // triggers "DatabaseClosedError" intermittently. Per-replay digest is
      // small, so one-at-a-time is fast enough for typical libraries.
      for (const e of lib) {
        try {
          const parsed = await getCachedReplay(e.hash);
          if (!parsed) { miss.push(e.hash); continue; }
          out.push(digestReplay(e, parsed, identities));
        } catch (err) {
          console.warn('[analysis] failed to digest', e.hash, err);
          miss.push(e.hash);
        }
      }
      if (cancelled) return;
      setDigests(out);
      setMissing(miss);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [identities]);

  const filtered = useMemo(() => {
    return digests.filter((d) => {
      if (filterMatchup && d.matchup !== filterMatchup) return false;
      if (filterRace && !d.players.some((p) => p.race === filterRace)) return false;
      if (filterMap && (d.mapName ?? '').toLowerCase() !== filterMap.toLowerCase()) return false;
      if (filterMeOnly && !d.players.some((p) => p.isMe)) return false;
      return true;
    });
  }, [digests, filterMatchup, filterRace, filterMap, filterMeOnly]);

  const agg = useMemo(() => aggregateDigests(filtered), [filtered]);

  const matchups = useMemo(() => {
    const m = new Set<string>();
    for (const d of digests) m.add(d.matchup);
    return [...m].sort();
  }, [digests]);
  const races = useMemo(() => {
    const r = new Set<string>();
    for (const d of digests) for (const p of d.players) r.add(p.race);
    return [...r].sort();
  }, [digests]);
  const maps = useMemo(() => {
    const m = new Set<string>();
    for (const d of digests) if (d.mapName) m.add(d.mapName);
    return [...m].sort();
  }, [digests]);

  const exportLLM = () => {
    const text = renderLibraryExport(filtered, agg);
    download('overmind-library.md', text, 'text/markdown');
  };
  const exportJson = () => {
    const data = { aggregate: agg, replays: filtered };
    download('overmind-library.json', JSON.stringify(data, null, 2), 'application/json');
  };
  const reparseMissing = async () => {
    if (missing.length === 0) return;
    // Just prompt the user to re-open them; auto re-parse would need access
    // to the raw file bytes which we don't persist.
    alert(
      `${missing.length} replay(s) have no cached parse. Open each once from the Library to cache them, then return here.`,
    );
  };

  const clearLibrary = async () => {
    if (!window.confirm(`Delete all ${entries.length} replays from the library? This cannot be undone.`)) return;
    await db.transaction('rw', db.library, db.parsed, async () => {
      await db.library.clear();
      await db.parsed.clear();
    });
    setEntries([]);
    setDigests([]);
    setMissing([]);
  };

  const toggleSelect = (hash: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());
  const selectAllFiltered = () => setSelected(new Set(filtered.map((d) => d.hash)));

  const comparingDigests = useMemo(
    () => digests.filter((d) => selected.has(d.hash)),
    [digests, selected],
  );

  if (comparing && comparingDigests.length >= 2) {
    return (
      <CompareView
        digests={comparingDigests}
        onBack={() => setComparing(false)}
      />
    );
  }

  if (mapDetail) {
    const forMap = digests.filter(
      (d) => (d.mapName ?? '').toLowerCase() === mapDetail.toLowerCase(),
    );
    return (
      <MapDetail
        mapName={mapDetail}
        digests={forMap}
        onBack={() => setMapDetail(null)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4 text-sm text-[var(--color-text-h)]">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-lg font-semibold">Library analysis</div>
        <div className="text-xs text-[var(--color-muted)]">
          {loading ? 'Loading…' : `${filtered.length} of ${digests.length} replays · ${missing.length} missing parse`}
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={exportLLM}
            className="rounded bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-white hover:opacity-90"
            title="Download an LLM-friendly markdown summary of the filtered replays"
          >
            Export LLM markdown
          </button>
          <button
            onClick={exportJson}
            className="rounded border border-[var(--color-border)] px-3 py-1 text-xs hover:text-[var(--color-text-h)]"
          >
            Export JSON
          </button>
          {missing.length > 0 && (
            <button
              onClick={reparseMissing}
              className="rounded border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text-h)]"
            >
              {missing.length} need re-parse
            </button>
          )}
          <button
            onClick={clearLibrary}
            className="rounded border border-rose-500/30 px-3 py-1 text-xs text-rose-300 hover:text-rose-200"
            title="Delete every replay in the library"
          >
            Clear library
          </button>
        </div>
      </div>

      <IdentityBar
        identities={identities}
        onAdd={addIdentity}
        onRemove={removeIdentity}
      />

      <FilterBar
        label="Matchup"
        options={matchups}
        value={filterMatchup}
        onChange={setFilterMatchup}
      />
      <FilterBar
        label="Race"
        options={races}
        value={filterRace}
        onChange={setFilterRace}
      />
      <FilterBar
        label="Map"
        options={maps}
        value={filterMap}
        onChange={setFilterMap}
        extraAction={
          filterMap
            ? {
                label: 'Open map page',
                onClick: () => setMapDetail(filterMap),
              }
            : undefined
        }
      />
      {identities.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="w-16 text-[var(--color-muted)]">Me</span>
          <button
            onClick={() => setFilterMeOnly((v) => !v)}
            className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
              filterMeOnly
                ? 'bg-[var(--color-accent)] text-white'
                : 'border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text-h)]'
            }`}
          >
            My games only
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="Replays" value={`${filtered.length}`} />
        <Card label="Avg duration" value={formatMMSS(agg.averageDurationSeconds)} />
        <Card
          label="Avg supply block"
          value={formatMMSS(agg.supplyBlockAverageSeconds)}
          sub="per player"
        />
        <Card
          label="Avg production idle"
          value={`${Math.round(agg.productionIdleAverageRatio * 100)}%`}
          sub="per building pool"
        />
      </div>

      {agg.me.games > 0 && <MeCard agg={agg.me} />}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="theme-panel rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Matchups
          </div>
          <DistributionList
            rows={Object.entries(agg.matchupCounts).map(([k, v]) => ({ k, v }))}
          />
        </div>
        <div className="theme-panel rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            By race
          </div>
          <div className="grid grid-cols-[auto_auto_auto_auto_auto] gap-x-4 gap-y-1 font-mono tabular-nums">
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Race</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Games</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">W-L-?</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Winrate</div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Avg APM</div>
            {Object.entries(agg.byRace).map(([r, v]) => {
              const decided = v.wins + v.losses;
              const wr = decided > 0 ? Math.round((v.wins / decided) * 100) : null;
              return (
                <div key={r} className="contents">
                  <div className="font-semibold">{r}</div>
                  <div>{v.games}</div>
                  <div>{v.wins}-{v.losses}-{v.unknown}</div>
                  <div>{wr != null ? `${wr}%` : '—'}</div>
                  <div>{Math.round(agg.averageApmByRace[r] ?? 0)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <TimingsCard agg={agg} />

      <TrendChart digests={filtered} hasIdentities={identities.length > 0} />

      {identities.length > 0 && <OpponentProfile digests={filtered} />}

      <div className="theme-panel rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          <span>Games ({filtered.length})</span>
          <span className="ml-auto flex items-center gap-2 text-[10px] normal-case">
            {selected.size > 0 && (
              <>
                <span>{selected.size} selected</span>
                <button
                  onClick={clearSelection}
                  className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:text-[var(--color-text-h)]"
                >
                  Clear
                </button>
                <button
                  onClick={() => setComparing(true)}
                  disabled={selected.size < 2}
                  className="rounded bg-[var(--color-accent)] px-2 py-0.5 text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Compare ({selected.size})
                </button>
              </>
            )}
            {selected.size === 0 && filtered.length > 1 && (
              <button
                onClick={selectAllFiltered}
                className="rounded border border-[var(--color-border)] px-2 py-0.5 hover:text-[var(--color-text-h)]"
                title="Select all filtered games for comparison"
              >
                Select all
              </button>
            )}
          </span>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-bg-elev)]">
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                <th className="w-8 px-3 py-1"></th>
                <th className="px-3 py-1">Map</th>
                <th className="px-3 py-1">Matchup</th>
                <th className="px-3 py-1">Players</th>
                <th className="px-3 py-1 text-right">Dur.</th>
                <th className="px-3 py-1 text-right">Winner</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const winners = d.winnerTeam != null
                  ? d.players.filter((p) => p.team === d.winnerTeam).map((p) => p.name).join(', ')
                  : '';
                const isSelected = selected.has(d.hash);
                return (
                  <tr key={d.hash} className={`border-t border-[var(--color-border)] ${isSelected ? 'bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)]' : ''}`}>
                    <td className="px-3 py-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(d.hash)}
                        className="accent-[var(--color-accent)]"
                        aria-label={`Select ${d.mapName}`}
                      />
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-1" title={d.mapName}>
                      {d.mapName ? (
                        <button
                          onClick={() => d.mapName && setMapDetail(d.mapName)}
                          className="truncate underline-offset-2 hover:text-[var(--color-accent)] hover:underline"
                        >
                          {d.mapName}
                        </button>
                      ) : (
                        <span className="text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1 font-mono">{d.matchup}</td>
                    <td className="px-3 py-1 text-[var(--color-muted)]">
                      {d.players.map((p) => (
                        <span key={p.playerID} className={p.isMe ? 'text-[var(--color-accent)]' : ''}>
                          {p.name} ({p.race}){p === d.players[d.players.length - 1] ? '' : ' vs '}
                        </span>
                      ))}
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
      <span className="w-16 text-[var(--color-muted)]" title="Names you play under — used to split stats into 'me' vs opponent">
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

function MeCard({ agg }: { agg: import('../analysis/aggregate').MeAggregate }) {
  const decided = agg.wins + agg.losses;
  const wr = decided > 0 ? Math.round((agg.wins / decided) * 100) : null;
  return (
    <div className="rounded-lg border border-[var(--color-accent)]/40 bg-[color-mix(in_oklab,var(--color-accent)_6%,var(--color-bg-panel))] p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
        As me
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Games</div>
          <div className="font-mono text-lg tabular-nums">{agg.games}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Record</div>
          <div className="font-mono text-lg tabular-nums">
            {agg.wins}-{agg.losses}
            {agg.unknown > 0 && <span className="text-[var(--color-muted)]">-{agg.unknown}</span>}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Winrate</div>
          <div className="font-mono text-lg tabular-nums">{wr != null ? `${wr}%` : '—'}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">APM (me vs opp)</div>
          <div className="font-mono text-lg tabular-nums">
            {Math.round(agg.averageApmMe)} / {Math.round(agg.averageApmOpp)}
          </div>
        </div>
      </div>
      {Object.keys(agg.byOpponentRace).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-mono">
          {Object.entries(agg.byOpponentRace)
            .sort((a, b) => b[1].games - a[1].games)
            .map(([race, v]) => {
              const d = v.wins + v.losses;
              const vw = d > 0 ? Math.round((v.wins / d) * 100) : null;
              return (
                <span
                  key={race}
                  className="rounded bg-[var(--color-bg-elev)] px-2 py-0.5 text-[var(--color-text-h)]"
                >
                  vs {race}: {v.wins}-{v.losses} {vw != null ? `(${vw}%)` : ''}
                </span>
              );
            })}
        </div>
      )}
    </div>
  );
}

function FilterBar({
  label,
  options,
  value,
  onChange,
  extraAction,
}: {
  label: string;
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
  extraAction?: { label: string; onClick: () => void };
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
      {extraAction && (
        <button
          onClick={extraAction.onClick}
          className="rounded border border-[var(--color-accent)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white"
        >
          {extraAction.label}
        </button>
      )}
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="theme-panel rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
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

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
