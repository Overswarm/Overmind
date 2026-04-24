import { useMemo, useState } from 'react';
import { useAppStore } from '../state/store';
import { useSettingsStore } from '../state/settings';
import { cleanBwString, formatMMSS, frameToSeconds, raceLetter } from '../types/replay';
import { playerColorVar, playerSlotMap } from './playerColor';

export function MetadataHeader() {
  const active = useAppStore((s) => s.active);
  const identities = useSettingsStore((s) => s.identities);
  const [revealOutcome, setRevealOutcome] = useState(false);
  const slots = useMemo(
    () => playerSlotMap(active?.replay.Header?.Players, identities),
    [active, identities],
  );
  if (!active) {
    return (
      <div className="flex h-14 items-center px-4 text-[var(--color-text-h)]">
        <span className="text-lg font-semibold tracking-tight">Overmind</span>
        <span className="ml-2 text-sm text-[var(--color-muted)]">StarCraft: Brood War replay analyzer</span>
      </div>
    );
  }
  const h = active.replay.Header;
  const c = active.replay.Computed;
  const duration = formatMMSS(frameToSeconds(h.Frames));
  const matchup = deriveMatchup(active.replay);

  const mapTitle = cleanBwString(active.replay.MapData?.Name || h.Map) || active.name;

  // Who left the game, and when. screp records per-player LeaveGameCmds in
  // Computed; the replay saver's leave is not recorded, so absence of a leave
  // for a player isn't proof they stayed.
  const leaves = (c?.LeaveGameCmds ?? [])
    .map((l) => {
      const player = (h.Players || []).find((p) => p.ID === l.PlayerID);
      return {
        name: player ? cleanBwString(player.Name) : `P${l.PlayerID}`,
        seconds: frameToSeconds(l.Frame),
        reason: (l as { Reason?: { Name?: string } }).Reason?.Name,
      };
    })
    .sort((a, b) => a.seconds - b.seconds);

  const winningTeam = c?.WinnerTeam;
  const winnerNames = winningTeam
    ? (h.Players || [])
        .filter((p) => !p.Observer && p.Team === winningTeam)
        .map((p) => cleanBwString(p.Name))
    : [];
  const hasOutcome = winnerNames.length > 0 || leaves.length > 0;

  return (
    <div className="flex h-14 items-center gap-4 px-4">
      <div className="min-w-0">
        <div className="truncate text-base font-semibold text-[var(--color-text-h)]">{mapTitle}</div>
        <div className="flex items-center gap-2 truncate text-xs text-[var(--color-muted)]">
          <span>
            {matchup} · {duration}
            {h.StartTime ? ` · ${new Date(h.StartTime).toLocaleString()}` : ''}
          </span>
          {hasOutcome && (
            <>
              {!revealOutcome ? (
                <button
                  onClick={() => setRevealOutcome(true)}
                  className="rounded border border-[var(--color-border)] px-1.5 py-[1px] text-[10px] uppercase tracking-wide hover:text-[var(--color-text-h)]"
                  title="Show winner and leave times (spoilers)"
                >
                  Reveal outcome
                </button>
              ) : (
                <span className="flex items-center gap-2">
                  {winnerNames.length > 0 && (
                    <span className="text-[var(--color-text-h)]">
                      🏆 {winnerNames.join(' & ')}
                    </span>
                  )}
                  {leaves.map((l, i) => (
                    <span key={i}>
                      · {l.name} left {formatMMSS(l.seconds)}
                      {l.reason && l.reason !== 'Quit' ? ` (${l.reason})` : ''}
                    </span>
                  ))}
                  <button
                    onClick={() => setRevealOutcome(false)}
                    className="ml-1 text-[var(--color-muted)] hover:text-[var(--color-text-h)]"
                    title="Hide"
                  >
                    ✕
                  </button>
                </span>
              )}
            </>
          )}
        </div>
      </div>
      {/* Player-name pills sit in their own block next to the map/outcome so
          they stay anchored to the upper-left regardless of which view is
          active. The border-l gives visual separation without coupling them
          to the map block or to the right-side header buttons. */}
      <div className="flex items-center gap-3 border-l border-[var(--color-border)] pl-4 text-xs text-[var(--color-muted)]">
        {(h.Players || [])
          .filter((p) => !p.Observer)
          .map((p, i) => (
            <div key={p.ID ?? i} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: playerColorVar(slots.get(p.ID) ?? i) }}
              />
              <span className="font-mono">{raceLetter(p.Race)}</span>
              <span className="text-[var(--color-text-h)]">{cleanBwString(p.Name)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function deriveMatchup(replay: { Header?: { Players?: Array<{ Team: number; Race?: { Letter?: number; ShortName?: string }; Observer?: boolean }> } }): string {
  const players = replay.Header?.Players?.filter((p) => !p.Observer) ?? [];
  if (!players.length) return '??';
  const parts: string[] = [];
  let prevTeam = players[0].Team;
  players.forEach((p, i) => {
    if (i > 0 && p.Team !== prevTeam) parts.push('v');
    parts.push(raceLetter(p.Race));
    prevTeam = p.Team;
  });
  return parts.join('');
}
