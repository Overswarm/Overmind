// File ingest pipeline: bytes → hash → (cache hit or worker parse) → library
// index. Exposes a single `ingestFile` entry point plus helpers for the UI
// layer (drag-drop, file picker, folder picker).

import { parseReplay } from '../parser/client';
import { raceLetter, type ParsedReplay } from '../types/replay';
import {
  getCachedReplay,
  putCachedReplay,
  sha256Hex,
  touchLibraryEntry,
  upsertLibraryEntry,
  type LibraryEntry,
} from './db';

export interface IngestedReplay {
  hash: string;
  name: string;
  path?: string;
  size: number;
  replay: ParsedReplay;
  fromCache: boolean;
}

export interface IngestSource {
  name: string;
  path?: string;
  bytes: ArrayBuffer;
}

export async function ingestFile(source: IngestSource): Promise<IngestedReplay> {
  const hash = await sha256Hex(source.bytes);
  const cached = await getCachedReplay(hash);

  let replay: ParsedReplay;
  let fromCache = false;
  if (cached) {
    replay = cached;
    fromCache = true;
  } else {
    // parseReplay transfers the ArrayBuffer to the worker, so we pass a copy to
    // preserve the original for hashing / future reuse by the caller.
    const copy = source.bytes.slice(0);
    replay = await parseReplay(copy);
    await putCachedReplay(hash, replay);
  }

  const entry: LibraryEntry = {
    hash,
    name: source.name,
    path: source.path,
    size: source.bytes.byteLength,
    addedAt: Date.now(),
    lastOpenedAt: Date.now(),
    mapName: replay.MapData?.Name ?? replay.Header?.Map,
    matchup: deriveMatchup(replay),
    players: replay.Header?.Players?.filter((p) => !p.Observer).map((p) => p.Name),
    durationFrames: replay.Header?.Frames,
    startTime: replay.Header?.StartTime,
    winnerTeam: replay.Computed?.WinnerTeam,
  };
  await upsertLibraryEntry(entry);
  await touchLibraryEntry(hash);

  return { hash, name: source.name, path: source.path, size: source.bytes.byteLength, replay, fromCache };
}

function deriveMatchup(replay: ParsedReplay): string | undefined {
  const players = replay.Header?.Players;
  if (!players?.length) return undefined;
  const active = players.filter((p) => !p.Observer);
  if (!active.length) return undefined;
  const parts: string[] = [];
  let prevTeam = active[0].Team;
  for (const [i, p] of active.entries()) {
    if (i > 0 && p.Team !== prevTeam) parts.push('v');
    parts.push(raceLetter(p.Race));
    prevTeam = p.Team;
  }
  return parts.join('');
}

// File handling helpers --------------------------------------------------------

export function isReplayFile(file: { name: string }): boolean {
  return /\.rep$/i.test(file.name);
}

export async function readFileBytes(file: File): Promise<ArrayBuffer> {
  return await file.arrayBuffer();
}

// Collects .rep files from a DataTransferItemList (drag-drop). Recursively
// descends into folders when the browser supplies a FileSystemEntry.
export async function filesFromDataTransfer(items: DataTransferItemList): Promise<Array<{ file: File; path: string }>> {
  const out: Array<{ file: File; path: string }> = [];
  const walkers: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'file') continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.();
    if (entry) {
      walkers.push(walkEntry(entry, '', out));
    } else {
      const f = item.getAsFile();
      if (f && isReplayFile(f)) out.push({ file: f, path: f.name });
    }
  }
  await Promise.all(walkers);
  return out;
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: Array<{ file: File; path: string }>): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
    if (isReplayFile(file)) out.push({ file, path: prefix ? `${prefix}/${file.name}` : file.name });
    return;
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const children: FileSystemEntry[] = [];
    // readEntries returns results in batches; call until empty.
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      children.push(...batch);
    }
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    await Promise.all(children.map((c) => walkEntry(c, nextPrefix, out)));
  }
}

// File System Access API: folder picker with recursive traversal.
// Falls back to no-op if the API is unavailable (caller should hide the entry point).
export function supportsFolderPicker(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

export async function pickFolder(): Promise<Array<{ file: File; path: string }>> {
  const w = window as unknown as {
    showDirectoryPicker: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  };
  const dir = await w.showDirectoryPicker({ mode: 'read' });
  const out: Array<{ file: File; path: string }> = [];
  await walkHandle(dir, '', out);
  return out;
}

async function walkHandle(dir: FileSystemDirectoryHandle, prefix: string, out: Array<{ file: File; path: string }>): Promise<void> {
  // The TS DOM lib's async iterator for FileSystemDirectoryHandle is gated
  // behind dom.iterable; we read via values() which is widely available.
  const iter = (dir as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values();
  for await (const handle of iter) {
    const nextPrefix = prefix ? `${prefix}/${handle.name}` : handle.name;
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile();
      if (isReplayFile(file)) out.push({ file, path: nextPrefix });
    } else if (handle.kind === 'directory') {
      await walkHandle(handle as FileSystemDirectoryHandle, nextPrefix, out);
    }
  }
}
