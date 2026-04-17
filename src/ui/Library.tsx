import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { listLibrary, getCachedReplay, touchLibraryEntry, deleteLibraryEntry, type LibraryEntry } from '../storage/db';
import { useAppStore } from '../state/store';
import { cleanBwString, formatMMSS, frameToSeconds } from '../types/replay';

type SortKey = 'recent' | 'longest' | 'map' | 'annotated';

export function Library() {
  const entries = useLiveQuery(() => listLibrary(), [], []);
  const active = useAppStore((s) => s.active);
  const setActive = useAppStore((s) => s.setActive);
  const clearActive = useAppStore((s) => s.clearActive);
  const setError = useAppStore((s) => s.setError);

  const [search, setSearch] = useState('');
  const [matchup, setMatchup] = useState<string>('');
  const [sort, setSort] = useState<SortKey>('recent');

  const onOpen = async (hash: string, name: string, path: string | undefined) => {
    const replay = await getCachedReplay(hash);
    if (!replay) {
      setError('Cached replay missing. Re-import the file.');
      return;
    }
    await touchLibraryEntry(hash);
    setActive({ hash, name, path, replay });
  };

  const onDelete = async (e: LibraryEntry, ev: React.MouseEvent) => {
    ev.stopPropagation();
    const label = cleanBwString(e.mapName) || e.name;
    if (!window.confirm(`Remove "${label}" from the library?`)) return;
    if (active?.hash === e.hash) clearActive();
    await deleteLibraryEntry(e.hash);
  };

  const matchups = useMemo(() => {
    if (!entries) return [] as string[];
    return [...new Set(entries.map((e) => e.matchup).filter((m): m is string => !!m))].sort();
  }, [entries]);

  const filtered = useMemo(() => {
    if (!entries) return [] as LibraryEntry[];
    const q = search.trim().toLowerCase();
    let list = entries;
    if (q) {
      list = list.filter((e) => {
        const map = cleanBwString(e.mapName || e.name).toLowerCase();
        const players = (e.players ?? []).map((p) => cleanBwString(p).toLowerCase());
        const notes = (e.notes ?? '').toLowerCase();
        return map.includes(q) || players.some((p) => p.includes(q)) || notes.includes(q);
      });
    }
    if (matchup) list = list.filter((e) => e.matchup === matchup);
    const sorted = [...list];
    if (sort === 'recent') {
      sorted.sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
    } else if (sort === 'longest') {
      sorted.sort((a, b) => (b.durationFrames ?? 0) - (a.durationFrames ?? 0));
    } else if (sort === 'annotated') {
      // Annotated entries first (most-recent first), then the rest by recency.
      sorted.sort((a, b) => {
        const an = a.notes && a.notes.trim() ? (a.notesUpdatedAt ?? 0) : -1;
        const bn = b.notes && b.notes.trim() ? (b.notesUpdatedAt ?? 0) : -1;
        if (an !== bn) return bn - an;
        return (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt);
      });
    } else {
      sorted.sort((a, b) =>
        (cleanBwString(a.mapName || a.name)).localeCompare(cleanBwString(b.mapName || b.name))
      );
    }
    return sorted;
  }, [entries, search, matchup, sort]);

  if (!entries || entries.length === 0) {
    return (
      <div className="p-3 text-sm text-[var(--color-muted)]">
        No replays yet. Drop a .rep file or folder in the main panel.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-1 border-b border-[var(--color-border)] px-2 py-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search map or player…"
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text-h)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        />
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
          <select
            value={matchup}
            onChange={(e) => setMatchup(e.target.value)}
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-[10px]"
          >
            <option value="">All matchups</option>
            {matchups.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-[10px]"
          >
            <option value="recent">Recent</option>
            <option value="longest">Longest</option>
            <option value="annotated">Annotated</option>
            <option value="map">Map A–Z</option>
          </select>
        </div>
        <div className="text-[10px] text-[var(--color-muted)]">
          {filtered.length} / {entries.length}
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)]">
        {filtered.map((e) => {
          const isActive = active?.hash === e.hash;
          const dur = e.durationFrames ? formatMMSS(frameToSeconds(e.durationFrames)) : '—';
          return (
            <li key={e.hash} className="group relative">
              <button
                className={`w-full text-left px-3 py-2 pr-8 text-sm transition-colors ${
                  isActive ? 'bg-[color-mix(in_oklab,var(--color-accent)_18%,transparent)] text-[var(--color-text-h)]' : 'hover:bg-[var(--color-bg-elev)]'
                }`}
                onClick={() => onOpen(e.hash, e.name, e.path)}
              >
                <div className="flex items-center gap-1.5 truncate font-medium text-[var(--color-text-h)]">
                  {e.notes && e.notes.trim() && (
                    <span
                      className="text-[var(--color-accent)]"
                      title="Has notes"
                      aria-label="Has notes"
                    >
                      ★
                    </span>
                  )}
                  <span className="truncate">{cleanBwString(e.mapName) || e.name}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  <span className="rounded bg-[var(--color-bg-elev)] px-1.5 py-0.5 font-mono">{e.matchup || '??'}</span>
                  <span>{dur}</span>
                  <span className="truncate">{(e.players || []).map((p) => cleanBwString(p)).join(' vs ')}</span>
                </div>
              </button>
              <button
                onClick={(ev) => onDelete(e, ev)}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded text-[var(--color-muted)] opacity-0 transition-opacity hover:bg-[var(--color-bg-elev)] hover:text-[var(--color-text-h)] focus:opacity-100 group-hover:opacity-100"
                title="Remove from library"
                aria-label={`Remove ${cleanBwString(e.mapName) || e.name}`}
              >
                ×
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-3 py-4 text-center text-xs text-[var(--color-muted)]">
            No replays match those filters.
          </li>
        )}
      </ul>
    </div>
  );
}
