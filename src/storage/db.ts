// Dexie-backed local storage. Two tables:
//
//   library: compact header metadata for the replay browser. Enough to sort,
//            filter, and display without re-parsing.
//   parsed:  full parsed replay JSON keyed by content hash, so re-opening the
//            same file is instant.
//
// We key both tables by the SHA-256 of the raw .rep bytes (hex, lowercase).
// The hash is the only identifier that survives moving/renaming files.

import Dexie, { type EntityTable } from 'dexie';
import type { ParsedReplay } from '../types/replay';

export interface LibraryEntry {
  hash: string;
  name: string;         // Filename as last seen on disk
  path?: string;        // Relative path in the original folder, if known
  size: number;         // Byte length of the .rep
  addedAt: number;      // epoch ms
  lastOpenedAt?: number;

  // Denormalized header fields for fast library browsing
  mapName?: string;
  matchup?: string;
  players?: string[];   // Non-observer player names, team order
  durationFrames?: number;
  startTime?: string;
  winnerTeam?: number;
}

export interface ParsedEntry {
  hash: string;
  replay: ParsedReplay;
  cachedAt: number;
  parserVersion: string; // Bump to invalidate cached entries when parser output shape changes
}

export const PARSER_VERSION = 'screp-1.12.11+overmind-0';

// Using Dexie's v4+ EntityTable typings; keyPath is the primary key.
type OvermindDB = Dexie & {
  library: EntityTable<LibraryEntry, 'hash'>;
  parsed: EntityTable<ParsedEntry, 'hash'>;
};

export const db = new Dexie('overmind') as OvermindDB;

db.version(1).stores({
  library: 'hash, addedAt, lastOpenedAt, mapName, matchup, startTime',
  parsed: 'hash, cachedAt',
});

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer so SubtleCrypto sees a plain BufferSource
  // regardless of whether the caller supplied a Uint8Array backed by a
  // SharedArrayBuffer.
  const copy = new Uint8Array(bytes instanceof Uint8Array ? bytes.byteLength : bytes.byteLength);
  copy.set(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const digest = await crypto.subtle.digest('SHA-256', copy);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) hex += view[i].toString(16).padStart(2, '0');
  return hex;
}

export async function getCachedReplay(hash: string): Promise<ParsedReplay | undefined> {
  const row = await db.parsed.get(hash);
  if (!row) return undefined;
  if (row.parserVersion !== PARSER_VERSION) {
    // Stale cache — drop it so the caller re-parses.
    await db.parsed.delete(hash);
    return undefined;
  }
  return row.replay;
}

export async function putCachedReplay(hash: string, replay: ParsedReplay): Promise<void> {
  await db.parsed.put({ hash, replay, cachedAt: Date.now(), parserVersion: PARSER_VERSION });
}

export async function upsertLibraryEntry(entry: LibraryEntry): Promise<void> {
  const existing = await db.library.get(entry.hash);
  if (existing) {
    await db.library.update(entry.hash, {
      name: entry.name,
      path: entry.path ?? existing.path,
      lastOpenedAt: entry.lastOpenedAt ?? existing.lastOpenedAt,
      mapName: entry.mapName ?? existing.mapName,
      matchup: entry.matchup ?? existing.matchup,
      players: entry.players ?? existing.players,
      durationFrames: entry.durationFrames ?? existing.durationFrames,
      startTime: entry.startTime ?? existing.startTime,
      winnerTeam: entry.winnerTeam ?? existing.winnerTeam,
    });
  } else {
    await db.library.add(entry);
  }
}

export async function touchLibraryEntry(hash: string): Promise<void> {
  await db.library.update(hash, { lastOpenedAt: Date.now() });
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  return db.library.orderBy('addedAt').reverse().toArray();
}
