import { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { useSettingsStore } from '../../state/settings';
import { cachedCoaching, cachedDigest } from '../../analysis/cache';
import type { Callout, CalloutSeverity } from '../../analysis/coaching';
import { playerColorVar, playerSlotMap } from '../playerColor';

export function CoachPanel() {
  const active = useAppStore((s) => s.active);
  const setFrame = useAppStore((s) => s.setFrame);
  const identities = useSettingsStore((s) => s.identities);

  const { coaching, meIDs, slots } = useMemo(() => {
    if (!active)
      return {
        coaching: null,
        meIDs: new Set<number>(),
        slots: new Map<number, number>(),
      };
    const digest = cachedDigest(active.hash, active.replay, active.name, identities);
    const c = cachedCoaching(active.hash, active.replay, active.name, identities);
    const me = new Set(digest.players.filter((p) => p.isMe).map((p) => p.playerID));
    const slots = playerSlotMap(active.replay.Header?.Players, identities);
    return { coaching: c, meIDs: me, slots };
  }, [active, identities]);

  if (!active || !coaching) return null;

  // Sort so any me-flagged player comes first — the user mostly cares about
  // their own mistakes. When no me-tag is set, preserve the replay's player
  // order so it lines up with the other panels.
  const sorted = [...coaching].sort((a, b) => {
    const am = meIDs.has(a.playerID) ? 0 : 1;
    const bm = meIDs.has(b.playerID) ? 0 : 1;
    return am - bm;
  });

  return (
    <div className="theme-panel flex h-full flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        <span>Auto Coach Warnings</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
        {sorted.map((pc, i) => {
          const isMe = meIDs.has(pc.playerID);
          return (
            <div
              key={pc.playerID}
              className={i > 0 ? 'mt-4 border-t border-[var(--color-border)] pt-3' : ''}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: playerColorVar(slots.get(pc.playerID) ?? i) }}
                />
                <span className="truncate font-semibold text-[var(--color-text-h)]">
                  {pc.name}
                </span>
                <span className="text-[10px] font-mono text-[var(--color-muted)]">
                  {pc.race}
                </span>
                {isMe && (
                  <span className="rounded bg-[var(--color-accent)] px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide text-white">
                    me
                  </span>
                )}
                <span className="ml-auto text-[10px] text-[var(--color-muted)]">
                  {pc.callouts.length === 0
                    ? 'clean'
                    : `${pc.callouts.length} warning${pc.callouts.length === 1 ? '' : 's'}`}
                </span>
              </div>
              {pc.callouts.length === 0 ? (
                <div className="mt-2 text-[11px] text-[var(--color-muted)]">
                  No warnings. Clean macro.
                </div>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {pc.callouts.map((c, k) => (
                    <CalloutRow key={k} callout={c} onJump={setFrame} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <div className="mt-3 border-t border-[var(--color-border)] pt-2 text-[10px] leading-relaxed text-[var(--color-muted)]">
          Warnings are heuristic: supply blocks, late expansion vs opponent,
          no 3rd CC/Nexus (or 5th hatch) within 7 minutes, slow first combat
          unit, and sustained mineral / gas floats. Resource numbers are
          estimated (BW replays don't record exact totals). A clean game
          should produce zero warnings.
        </div>
      </div>
    </div>
  );
}

function CalloutRow({ callout, onJump }: { callout: Callout; onJump: (f: number) => void }) {
  const color = severityColor(callout.severity);
  return (
    <li
      className="flex gap-2 rounded border px-2 py-1.5"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-bg-elev)',
      }}
    >
      <span
        className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: color }}
        title={callout.severity}
        aria-label={callout.severity}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold text-[var(--color-text-h)]">
            {callout.title}
          </span>
          {callout.frame != null && (
            <button
              onClick={() => onJump(callout.frame!)}
              className="shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0 text-[10px] uppercase tracking-wide text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-h)]"
              title="Jump to this moment in the timeline"
            >
              jump
            </button>
          )}
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-[var(--color-muted)]">
          {callout.detail}
        </div>
      </div>
    </li>
  );
}

function severityColor(s: CalloutSeverity): string {
  if (s === 'major') return 'rgb(248 113 113)';
  if (s === 'minor') return 'rgb(250 204 21)';
  return 'var(--color-muted)';
}
