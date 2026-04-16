import { useAppStore } from '../state/store';
import { cleanBwString, formatMMSS, frameToSeconds, raceLetter } from '../types/replay';

export function MetadataHeader() {
  const active = useAppStore((s) => s.active);
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
  const winners = c?.WinnerTeam ? ` · Team ${c.WinnerTeam} wins` : '';

  const mapTitle = cleanBwString(active.replay.MapData?.Name || h.Map) || active.name;

  return (
    <div className="flex h-14 items-center gap-4 px-4">
      <div>
        <div className="text-base font-semibold text-[var(--color-text-h)]">{mapTitle}</div>
        <div className="text-xs text-[var(--color-muted)]">
          {matchup} · {duration}
          {h.StartTime ? ` · ${new Date(h.StartTime).toLocaleString()}` : ''}
          {winners}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-3 text-xs text-[var(--color-muted)]">
        {(h.Players || [])
          .filter((p) => !p.Observer)
          .map((p, i) => (
            <div key={p.ID ?? i} className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: i === 0 ? 'var(--color-player-a)' : 'var(--color-player-b)' }}
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
