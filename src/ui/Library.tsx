import { useLiveQuery } from 'dexie-react-hooks';
import { listLibrary, getCachedReplay, touchLibraryEntry } from '../storage/db';
import { useAppStore } from '../state/store';
import { formatMMSS, frameToSeconds } from '../types/replay';

export function Library() {
  const entries = useLiveQuery(() => listLibrary(), [], []);
  const active = useAppStore((s) => s.active);
  const setActive = useAppStore((s) => s.setActive);
  const setError = useAppStore((s) => s.setError);

  const onOpen = async (hash: string, name: string, path: string | undefined) => {
    const replay = await getCachedReplay(hash);
    if (!replay) {
      setError('Cached replay missing. Re-import the file.');
      return;
    }
    await touchLibraryEntry(hash);
    setActive({ hash, name, path, replay });
  };

  if (!entries || entries.length === 0) {
    return (
      <div className="p-3 text-sm text-[var(--color-muted)]">
        No replays yet. Drop a .rep file or folder in the main panel.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {entries.map((e) => {
        const isActive = active?.hash === e.hash;
        const dur = e.durationFrames ? formatMMSS(frameToSeconds(e.durationFrames)) : '—';
        return (
          <li key={e.hash}>
            <button
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                isActive ? 'bg-[color-mix(in_oklab,var(--color-accent)_18%,transparent)] text-[var(--color-text-h)]' : 'hover:bg-[var(--color-bg-elev)]'
              }`}
              onClick={() => onOpen(e.hash, e.name, e.path)}
            >
              <div className="truncate font-medium text-[var(--color-text-h)]">{e.mapName || e.name}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                <span className="rounded bg-[var(--color-bg-elev)] px-1.5 py-0.5 font-mono">{e.matchup || '??'}</span>
                <span>{dur}</span>
                <span className="truncate">{(e.players || []).join(' vs ')}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
