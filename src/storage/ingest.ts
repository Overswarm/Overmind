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

export function isZipFile(file: { name: string }): boolean {
  return /\.zip$/i.test(file.name);
}

export async function readFileBytes(file: File): Promise<ArrayBuffer> {
  return await file.arrayBuffer();
}

// Unzip a .zip (replay pack) and return .rep entries as pseudo-Files. We do
// not write anything to disk — entries live in memory and are piped into the
// same ingest pipeline as dropped/picked files. Uses fflate's synchronous
// unzip which handles Deflate and Stored entries; unsupported compression
// methods throw and the caller logs them.
export async function filesFromZip(
  file: File,
): Promise<Array<{ file: File; path: string }>> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(bytes, {
    filter: (f) => /\.rep$/i.test(f.name),
  });
  const out: Array<{ file: File; path: string }> = [];
  for (const [entryPath, data] of Object.entries(entries)) {
    if (data.length === 0) continue;
    // Strip leading path components for display but keep them in `path` so
    // the library's `path` column reflects the archive's layout.
    const leaf = entryPath.split('/').pop() || entryPath;
    // Copy into a plain ArrayBuffer-backed view so File's BlobPart typing
    // matches (fflate yields Uint8Array<ArrayBufferLike> which TS rejects).
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const pseudo = new File([copy.buffer], leaf, { type: 'application/octet-stream' });
    out.push({ file: pseudo, path: `${file.name}!/${entryPath}` });
  }
  // Reference strFromU8 to satisfy bundlers that tree-shake unused named
  // imports — fflate ships them together and importing both keeps the
  // dynamic import's side-effect surface consistent.
  void strFromU8;
  return out;
}

// Given a mix of .rep and .zip files, return a flat list of { file, path }
// replay entries. Zips are expanded; other files are dropped.
export async function expandZipsAndReps(
  files: Array<{ file: File; path: string }>,
): Promise<Array<{ file: File; path: string }>> {
  const out: Array<{ file: File; path: string }> = [];
  for (const entry of files) {
    if (isReplayFile(entry.file)) {
      out.push(entry);
    } else if (isZipFile(entry.file)) {
      try {
        const extracted = await filesFromZip(entry.file);
        out.push(...extracted);
      } catch (err) {
        console.warn(`Failed to unzip ${entry.file.name}:`, err);
      }
    }
  }
  return out;
}

// Collects .rep and .zip files from a DataTransferItemList (drag-drop).
// Recursively descends into folders when the browser supplies a
// FileSystemEntry. Zip entries are returned as-is here; the caller is
// expected to expand them via `expandZipsAndReps`.
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
      if (f && (isReplayFile(f) || isZipFile(f))) out.push({ file: f, path: f.name });
    }
  }
  await Promise.all(walkers);
  return out;
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: Array<{ file: File; path: string }>): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
    if (isReplayFile(file) || isZipFile(file)) {
      out.push({ file, path: prefix ? `${prefix}/${file.name}` : file.name });
    }
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
