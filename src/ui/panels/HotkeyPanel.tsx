import { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { useSettingsStore } from '../../state/settings';
import { cachedHotkeyStats } from '../../analysis/cache';
import { hotkeyReliance } from '../../analysis/hotkeys';
import { cleanBwString } from '../../types/replay';
import { playerColorVar, playerSlotMap } from '../playerColor';

export function HotkeyPanel() {
  const active = useAppStore((s) => s.active);
  const identities = useSettingsStore((s) => s.identities);
  const stats = useMemo(() => {
    if (!active) return null;
    return cachedHotkeyStats(active.hash, active.replay);
  }, [active]);
  const slots = useMemo(
    () => playerSlotMap(active?.replay.Header?.Players, identities),
    [active, identities],
  );

  if (!active || !stats) return null;

  const playerNames: Record<number, string> = {};
  for (const p of active.replay.Header?.Players ?? []) playerNames[p.ID] = cleanBwString(p.Name);

  return (
    <div className="theme-panel flex h-full flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        <span>Hotkeys · Control Groups</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
        {stats.players.map((p, i) => {
          const reliance = hotkeyReliance(p);
          return (
            <div key={p.playerID} className={i > 0 ? 'mt-4 border-t border-[var(--color-border)] pt-3' : ''}>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: playerColorVar(slots.get(p.playerID) ?? i) }}
                />
                <span className="font-semibold text-[var(--color-text-h)]">
                  {playerNames[p.playerID] ?? `P${p.playerID}`}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-y-1 font-mono tabular-nums">
                <dt className="text-[var(--color-muted)]">Assigns (Ctrl+N)</dt>
                <dd className="text-right text-[var(--color-text-h)]">{p.assigns}</dd>
                <dt className="text-[var(--color-muted)]">Recalls (press N)</dt>
                <dd className="text-right text-[var(--color-text-h)]">{p.recalls}</dd>
                <dt className="text-[var(--color-muted)]">Adds (Shift+N)</dt>
                <dd className="text-right text-[var(--color-text-h)]">{p.adds}</dd>
                <dt className="text-[var(--color-muted)]">Manual selects</dt>
                <dd className="text-right text-[var(--color-text-h)]">{p.manualSelects}</dd>
                <dt className="text-[var(--color-muted)]">Hotkey reliance</dt>
                <dd className="text-right text-[var(--color-text-h)]">{Math.round(reliance * 100)}%</dd>
              </dl>
              <div className="mt-3 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                Groups used
              </div>
              <div className="mt-1 grid grid-cols-10 gap-0.5">
                {Array.from({ length: 10 }).map((_, g) => {
                  const assigned = p.groupsUsed.includes(g);
                  const recalls = p.perGroupRecalls[g];
                  const maxRecall = Math.max(1, ...p.perGroupRecalls);
                  const intensity = recalls / maxRecall;
                  return (
                    <div
                      key={g}
                      className="flex flex-col items-center gap-0.5"
                      title={`Group ${g}: ${assigned ? 'assigned' : 'unused'}, ${recalls} recalls`}
                    >
                      <div
                        className="h-5 w-full rounded-sm border border-[var(--color-border)]"
                        style={{
                          background: assigned
                            ? `color-mix(in oklab, var(--color-accent) ${Math.round(intensity * 100)}%, transparent)`
                            : 'transparent',
                        }}
                      />
                      <div className="font-mono text-[9px] text-[var(--color-muted)]">{g}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="mt-3 border-t border-[var(--color-border)] pt-2 text-[10px] text-[var(--color-muted)]">
          Reliance = recalls / (recalls + manual selects). Higher values
          indicate heavier control-group usage — a strong skill signal.
        </div>
      </div>
    </div>
  );
}
