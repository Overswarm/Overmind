import { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { cachedSupplyBlocks, cachedProductionIdle } from '../../analysis/cache';
import { cleanBwString, formatMMSS, FRAMES_PER_SECOND } from '../../types/replay';

export function MacroPanel() {
  const active = useAppStore((s) => s.active);
  const setFrame = useAppStore((s) => s.setFrame);

  const { supplyBlocks, productionIdle, players } = useMemo(() => {
    if (!active) {
      return {
        supplyBlocks: null, productionIdle: null,
        players: [] as { id: number; name: string }[],
      };
    }
    const sb = cachedSupplyBlocks(active.hash, active.replay);
    const pi = cachedProductionIdle(active.hash, active.replay);
    const plist: { id: number; name: string }[] = [];
    for (const p of active.replay.Header?.Players ?? []) {
      if (p.Observer) continue;
      plist.push({ id: p.ID, name: cleanBwString(p.Name) });
    }
    return { supplyBlocks: sb, productionIdle: pi, players: plist };
  }, [active]);

  if (!active || !supplyBlocks || !productionIdle) return null;

  return (
    <div className="flex h-full flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        <span>Macro · supply blocks & production idle</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
        {players.map((p, i) => {
          const blockTotal = supplyBlocks.totalSecondsByPID.get(p.id) ?? 0;
          const blocks = supplyBlocks.intervals.filter((iv) => iv.playerID === p.id);
          const pools = productionIdle.byPlayer.get(p.id) ?? [];
          const poolsWithBuildings = pools.filter((pl) => pl.count > 0);
          return (
            <div
              key={p.id}
              className={i > 0 ? 'mt-4 border-t border-[var(--color-border)] pt-3' : ''}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: i === 0 ? 'var(--color-player-a)' : 'var(--color-player-b)' }}
                />
                <span className="truncate font-semibold text-[var(--color-text-h)]">{p.name}</span>
              </div>

              <div className="mt-2 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                Supply blocks
              </div>
              <div className="mt-1 font-mono tabular-nums">
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Total time blocked</span>
                  <span className="text-[var(--color-text-h)]">{formatMMSS(blockTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-muted)]">Intervals</span>
                  <span className="text-[var(--color-text-h)]">{blocks.length}</span>
                </div>
              </div>
              {blocks.length > 0 && (
                <div className="mt-1 max-h-24 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-1 font-mono text-[10px] tabular-nums">
                  {blocks.slice(0, 8).map((iv, k) => (
                    <button
                      key={k}
                      onClick={() => setFrame(iv.startFrame)}
                      className="flex w-full justify-between gap-2 px-1 py-0.5 text-left hover:bg-[var(--color-bg-panel)]"
                      title="Jump to block start"
                    >
                      <span className="text-[var(--color-muted)]">
                        {formatMMSS(iv.startSeconds)}–{formatMMSS(iv.endSeconds)}
                      </span>
                      <span className="text-[var(--color-text-h)]">
                        {Math.round(iv.durationSeconds)}s
                      </span>
                    </button>
                  ))}
                  {blocks.length > 8 && (
                    <div className="px-1 pt-0.5 text-[var(--color-muted)]">
                      + {blocks.length - 8} more…
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                Production idle
              </div>
              {poolsWithBuildings.length === 0 ? (
                <div className="text-[10px] text-[var(--color-muted)]">
                  No production buildings built.
                </div>
              ) : (
                <div className="mt-1">
                  {poolsWithBuildings.map((pl) => {
                    const pct = Math.round(pl.idleRatio * 100);
                    const idleSec = Math.round(pl.idleFrames / FRAMES_PER_SECOND);
                    return (
                      <div key={pl.id} className="mb-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[var(--color-text-h)]">
                            {pl.name} <span className="text-[var(--color-muted)]">×{pl.count}</span>
                          </span>
                          <span className="font-mono tabular-nums text-[var(--color-muted)]">
                            {pct}% idle · {formatMMSS(idleSec)}
                          </span>
                        </div>
                        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded bg-[var(--color-bg-elev)]">
                          <div
                            className="h-full"
                            style={{
                              width: `${100 - pct}%`,
                              background: 'var(--color-accent)',
                            }}
                            title={`${100 - pct}% busy, ${pct}% idle`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <div className="mt-3 border-t border-[var(--color-border)] pt-2 text-[10px] leading-relaxed text-[var(--color-muted)]">
          Supply blocks and idle rates are <b>approximations</b>. Unit deaths
          aren't tracked, so late-game numbers over-estimate usage.
        </div>
      </div>
    </div>
  );
}
