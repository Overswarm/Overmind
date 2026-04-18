import { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { cleanBwString } from '../../types/replay';
import { cachedBuildOrder } from '../../analysis/cache';
import { computeRoster, type RosterForPlayer, type RosterRole } from '../../analysis/roster';

const ROLE_ORDER: RosterRole[] = ['worker', 'army', 'building'];
const ROLE_LABEL: Record<RosterRole, string> = {
  worker: 'Workers',
  army: 'Army',
  building: 'Buildings',
};

export function RosterPanel() {
  const active = useAppStore((s) => s.active);
  const currentFrame = useAppStore((s) => s.currentFrame);

  const { players, rosters } = useMemo(() => {
    if (!active) return { players: [] as { id: number; name: string }[], rosters: new Map<number, RosterForPlayer>() };
    const events = cachedBuildOrder(active.hash, active.replay);
    const rosters = computeRoster(events, currentFrame);
    const players = (active.replay.Header?.Players ?? [])
      .filter((p) => !p.Observer)
      .map((p) => ({ id: p.ID, name: cleanBwString(p.Name) }));
    return { players, rosters };
  }, [active, currentFrame]);

  if (!active) return null;

  return (
    <div className="theme-panel flex h-full flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
      <div className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Roster <span className="ml-1 font-normal normal-case text-[var(--color-muted)]">· produced so far</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 text-xs">
        <div className="flex flex-col gap-3">
          {players.map((p, i) => {
            const r = rosters.get(p.id);
            return (
              <div key={p.id} className="min-w-0">
                <div className="mb-1 flex items-center gap-1 truncate">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: i === 0 ? 'var(--color-player-a)' : 'var(--color-player-b)' }}
                  />
                  <span className="truncate text-[var(--color-text-h)]">{p.name}</span>
                </div>
                {ROLE_ORDER.map((role) => {
                  const entries = r?.byRole[role] ?? [];
                  if (entries.length === 0) return null;
                  return (
                    <div key={role} className="mb-2">
                      <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                        {ROLE_LABEL[role]}
                      </div>
                      <div className="font-mono tabular-nums leading-snug">
                        {entries.map((e) => (
                          <div
                            key={e.name}
                            className="flex items-baseline justify-between gap-2 text-[var(--color-text-h)]"
                          >
                            <span className="truncate">{e.name}</span>
                            <span className="text-[var(--color-muted)]">×{e.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {!r && (
                  <div className="text-[10px] text-[var(--color-muted)]">Nothing yet.</div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-[10px] leading-relaxed text-[var(--color-muted)]">
          Counts are <b>produced</b>, not alive. Unit deaths aren't in the replay without an engine simulation.
        </div>
      </div>
    </div>
  );
}
