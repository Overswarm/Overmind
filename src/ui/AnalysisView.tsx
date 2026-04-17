import { useEffect, useMemo, useState } from 'react';
import { db, getCachedReplay, listLibrary, type LibraryEntry } from '../storage/db';
import { formatMMSS } from '../types/replay';
import { aggregateDigests, digestReplay, type ReplayDigest } from '../analysis/aggregate';
import { renderLibraryExport } from '../analysis/llmExport';

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
  const [missing, setMissing] = useState<string[]>([]);

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
          out.push(digestReplay(e, parsed));
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
  }, []);

  const filtered = useMemo(() => {
    return digests.filter((d) => {
      if (filterMatchup && d.matchup !== filterMatchup) return false;
      if (filterRace && !d.players.some((p) => p.race === filterRace)) return false;
      if (filterMap && (d.mapName ?? '').toLowerCase() !== filterMap.toLowerCase()) return false;
      return true;
    });
  }, [digests, filterMatchup, filterRace, filterMap]);

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
      />

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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Matchups
          </div>
          <DistributionList
            rows={Object.entries(agg.matchupCounts).map(([k, v]) => ({ k, v }))}
          />
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3">
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

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
        <div className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Games ({filtered.length})
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-bg-elev)]">
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
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
                return (
                  <tr key={d.hash} className="border-t border-[var(--color-border)]">
                    <td className="max-w-[200px] truncate px-3 py-1" title={d.mapName}>{d.mapName}</td>
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
    <div className="flex items-center gap-2 text-xs">
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

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
