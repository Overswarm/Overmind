// Side-by-side replay comparison. Invoked from AnalysisView when the user
// multi-selects two or more replays in the games table. Runs entirely on
// the pre-computed digests — no re-parse required.
//
// Layout is a simple horizontal scroll so comparing 4+ replays doesn't
// collapse the columns into unreadable strips. Each column is a full card:
// meta, per-player APM / supply-block / production-idle, top units/buildings.

import { useMemo } from 'react';
import { formatMMSS } from '../types/replay';
import type { ReplayDigest, PlayerDigest } from '../analysis/aggregate';

export function CompareView({
  digests,
  onBack,
}: {
  digests: ReplayDigest[];
  onBack: () => void;
}) {
  // Union of races across selected replays, so the side-by-side
  // "me vs opponent" block lines up even when races differ.
  const unionUnits = useMemo(() => {
    const s = new Set<string>();
    for (const d of digests) for (const p of d.players) for (const k of Object.keys(p.unitsProduced)) s.add(k);
    return [...s].sort();
  }, [digests]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-4 text-sm text-[var(--color-text-h)]">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-text-h)]"
        >
          ← Back
        </button>
        <div className="text-lg font-semibold">Compare {digests.length} replays</div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto">
        {digests.map((d) => (
          <div
            key={d.hash}
            className="flex w-80 flex-shrink-0 flex-col gap-2 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3"
          >
            <div className="truncate text-sm font-semibold" title={d.mapName}>
              {d.mapName ?? d.name}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
              <span className="rounded bg-[var(--color-bg-elev)] px-1.5 py-0.5 font-mono">{d.matchup}</span>
              <span className="font-mono tabular-nums">{formatMMSS(d.durationSeconds)}</span>
              {d.startTime && <span className="truncate">{d.startTime.slice(0, 10)}</span>}
            </div>

            {d.players.map((p) => (
              <PlayerBlock key={p.playerID} p={p} />
            ))}

            <div className="mt-2 border-t border-[var(--color-border)] pt-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Units produced
              </div>
              <div className="grid grid-cols-[1fr_repeat(var(--n),auto)] gap-x-2 text-[11px] font-mono tabular-nums"
                   style={{ ['--n' as string]: d.players.length }}>
                <div className="text-[10px] text-[var(--color-muted)]">Unit</div>
                {d.players.map((p) => (
                  <div key={p.playerID} className="text-right text-[10px] text-[var(--color-muted)]">
                    {p.name.slice(0, 8)}
                  </div>
                ))}
                {unionUnits.map((u) => {
                  const anyHas = d.players.some((p) => (p.unitsProduced[u] ?? 0) > 0);
                  if (!anyHas) return null;
                  return (
                    <div key={u} className="contents">
                      <div className="truncate text-[var(--color-muted)]" title={u}>{u}</div>
                      {d.players.map((p) => (
                        <div key={p.playerID} className="text-right">
                          {p.unitsProduced[u] ?? 0}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayerBlock({ p }: { p: PlayerDigest }) {
  return (
    <div
      className={`rounded border px-2 py-1.5 ${
        p.isMe
          ? 'border-[var(--color-accent)]/40 bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)]'
          : 'border-[var(--color-border)] bg-[var(--color-bg-elev)]'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1 truncate font-mono text-xs">
          <span className="truncate" title={p.name}>{p.name}</span>
          <span className="text-[var(--color-muted)]">{p.race}</span>
          {p.isMe && <span className="rounded bg-[var(--color-accent)] px-1 text-[9px] text-white">me</span>}
        </div>
        {p.won === true && <span className="text-[10px] font-semibold text-emerald-400">WIN</span>}
        {p.won === false && <span className="text-[10px] font-semibold text-rose-400">LOSS</span>}
      </div>
      <div className="mt-0.5 grid grid-cols-3 gap-1 font-mono text-[10px] tabular-nums text-[var(--color-muted)]">
        <div>APM <span className="text-[var(--color-text-h)]">{p.apm}</span></div>
        <div>EAPM <span className="text-[var(--color-text-h)]">{p.eapm}</span></div>
        <div>Blk <span className="text-[var(--color-text-h)]">{formatMMSS(p.supplyBlockSeconds)}</span></div>
      </div>
    </div>
  );
}
