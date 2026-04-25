import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  listLibrary,
  getCachedReplay,
  deleteLibraryEntry,
  setFavorite,
  type LibraryEntry,
} from '../storage/db';
import { useAppStore } from '../state/store';
import { cleanBwString, formatMMSS, frameToSeconds } from '../types/replay';
import { useIngest } from '../storage/useIngest';
import { supportsFolderPicker } from '../storage/ingest';

type SortKey = 'recent' | 'longest' | 'map' | 'annotated' | 'favorites';

export function Library() {
  const entries = useLiveQuery(() => listLibrary(), [], []);
  const active = useAppStore((s) => s.active);
  const setActive = useAppStore((s) => s.setActive);
  const clearActive = useAppStore((s) => s.clearActive);
  const setError = useAppStore((s) => s.setError);

  const [search, setSearch] = useState('');
  const [matchup, setMatchup] = useState<string>('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { progress, onDrop, onPickFiles, onPickFolder } = useIngest();

  const onOpen = async (hash: string, name: string, path: string | undefined) => {
    const replay = await getCachedReplay(hash);
    if (!replay) {
      setError('Cached replay missing. Re-import the file.');
      return;
    }
    // We deliberately don't touch lastOpenedAt here — the "Recent" sort is
    // keyed off addedAt so the list stays stable when you click around. A
    // re-sort on every click made it impossible to step through neighboring
    // replays without losing your place.
    setActive({ hash, name, path, replay });
  };

  const onDelete = async (e: LibraryEntry, ev: React.MouseEvent) => {
    ev.stopPropagation();
    const label = cleanBwString(e.mapName) || e.name;
    if (!window.confirm(`Remove "${label}" from the library?`)) return;
    if (active?.hash === e.hash) clearActive();
    await deleteLibraryEntry(e.hash);
  };

  const onToggleFavorite = async (e: LibraryEntry, ev: React.MouseEvent) => {
    ev.stopPropagation();
    await setFavorite(e.hash, !e.favorite);
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
    // "Recent" = recently *added* to the library, not recently opened.
    // Re-opening a replay must not change its position; see onOpen above.
    const byRecency = (a: LibraryEntry, b: LibraryEntry) => b.addedAt - a.addedAt;
    if (sort === 'recent') {
      // Pinned replays always surface at the top of Recent — it's the default
      // sort, so this makes the favorite feature visible without requiring a
      // re-sort. Within each group, we fall back to recency.
      sorted.sort((a, b) => {
        const af = a.favorite ? 1 : 0;
        const bf = b.favorite ? 1 : 0;
        if (af !== bf) return bf - af;
        return byRecency(a, b);
      });
    } else if (sort === 'longest') {
      sorted.sort((a, b) => (b.durationFrames ?? 0) - (a.durationFrames ?? 0));
    } else if (sort === 'annotated') {
      // Annotated entries first (most-recent first), then the rest by recency.
      sorted.sort((a, b) => {
        const an = a.notes && a.notes.trim() ? (a.notesUpdatedAt ?? 0) : -1;
        const bn = b.notes && b.notes.trim() ? (b.notesUpdatedAt ?? 0) : -1;
        if (an !== bn) return bn - an;
        return byRecency(a, b);
      });
    } else if (sort === 'favorites') {
      // Pinned only, newest first. Non-favorites are dropped from the view.
      return sorted.filter((e) => e.favorite).sort(byRecency);
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

  const addControls = (
    <div className="flex items-stretch gap-1">
      <button
        onClick={() => fileInputRef.current?.click()}
        className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-h)]"
        title="Add .rep files or a .zip replay pack"
      >
        + Files
      </button>
      {supportsFolderPicker() && (
        <button
          onClick={onPickFolder}
          className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-h)]"
          title="Add a folder of replays"
        >
          + Folder
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept=".rep,.zip"
        onChange={onPickFiles}
      />
    </div>
  );

  return (
    <div
      className={`relative flex h-full flex-col ${
        dragOver ? 'ring-2 ring-inset ring-[var(--color-accent)]' : ''
      }`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        // Only clear when leaving the container itself, not its children.
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={async (ev) => {
        setDragOver(false);
        await onDrop(ev);
      }}
    >
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
            <option value="favorites">Favorites</option>
            <option value="longest">Longest</option>
            <option value="annotated">Annotated</option>
            <option value="map">Map A–Z</option>
          </select>
        </div>
        {addControls}
        <div className="text-[10px] text-[var(--color-muted)]">
          {filtered.length} / {entries.length}
        </div>
        {progress && (
          <div className="flex flex-col gap-0.5 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[10px] text-[var(--color-muted)]">
            <div className="flex items-center justify-between">
              <span>Importing…</span>
              <span className="font-mono tabular-nums">
                {progress.done} / {progress.total}
              </span>
            </div>
            {progress.current && (
              <div className="truncate font-mono" title={progress.current}>
                {progress.current}
              </div>
            )}
          </div>
        )}
      </div>
      <ul className="flex-1 overflow-y-auto divide-y divide-[var(--color-border)]">
        {filtered.map((e) => {
          const isActive = active?.hash === e.hash;
          const dur = e.durationFrames ? formatMMSS(frameToSeconds(e.durationFrames)) : '—';
          return (
            <li key={e.hash} className="group relative">
              <button
                className={`w-full text-left px-3 py-2 pr-14 text-sm transition-colors ${
                  isActive ? 'bg-[color-mix(in_oklab,var(--color-accent)_18%,transparent)] text-[var(--color-text-h)]' : 'hover:bg-[var(--color-bg-elev)]'
                }`}
                onClick={() => onOpen(e.hash, e.name, e.path)}
              >
                <div className="flex items-center gap-1.5 truncate font-medium text-[var(--color-text-h)]">
                  {e.favorite && (
                    <span
                      className="text-[var(--color-accent)]"
                      title="Favorite"
                      aria-label="Favorite"
                    >
                      ★
                    </span>
                  )}
                  {e.notes && e.notes.trim() && (
                    <span
                      className="text-[var(--color-muted)]"
                      title="Has notes"
                      aria-label="Has notes"
                    >
                      ✎
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
                onClick={(ev) => onToggleFavorite(e, ev)}
                className={`absolute right-7 top-1 flex h-5 w-5 items-center justify-center rounded transition-opacity hover:bg-[var(--color-bg-elev)] focus:opacity-100 ${
                  e.favorite
                    ? 'text-[var(--color-accent)] opacity-100'
                    : 'text-[var(--color-muted)] opacity-0 hover:text-[var(--color-text-h)] group-hover:opacity-100'
                }`}
                title={e.favorite ? 'Unpin from favorites' : 'Pin as favorite'}
                aria-label={e.favorite ? 'Unpin' : 'Pin as favorite'}
                aria-pressed={!!e.favorite}
              >
                {e.favorite ? '★' : '☆'}
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
