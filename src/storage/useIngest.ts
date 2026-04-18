// Shared ingest hook: wraps the file picker / folder picker / drag-drop
// pipeline so both the empty-state DropZone and the Library sidebar can
// reuse it. Returns handlers suitable for wiring onto a drop target and a
// hidden <input type="file"> or a button that calls `pickFolder`.

import { useCallback, useState } from 'react';
import {
  ingestFile,
  filesFromDataTransfer,
  isReplayFile,
  isZipFile,
  expandZipsAndReps,
  pickFolder,
  readFileBytes,
} from '../storage/ingest';
import { useAppStore } from '../state/store';

export interface IngestProgress {
  done: number;
  total: number;
  // Display name of the file currently being parsed (or last completed if we've
  // finished the batch). Makes slow imports feel alive — the user can see
  // progress move through the folder rather than staring at a bare "5 / 200".
  current?: string;
}

export interface UseIngest {
  progress: IngestProgress | null;
  ingestMany: (entries: Array<{ file: File; path: string }>) => Promise<void>;
  onDrop: (ev: React.DragEvent) => Promise<void>;
  onPickFiles: (ev: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onPickFolder: () => Promise<void>;
}

export function useIngest(): UseIngest {
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const setActive = useAppStore((s) => s.setActive);
  const setLoading = useAppStore((s) => s.setLoading);
  const setError = useAppStore((s) => s.setError);

  const ingestMany = useCallback(
    async (rawEntries: Array<{ file: File; path: string }>) => {
      if (rawEntries.length === 0) return;
      setError(null);

      // Expand any .zip replay packs transparently before parsing.
      const hasZips = rawEntries.some((e) => isZipFile(e.file));
      if (hasZips) setLoading(true, 'Extracting replay packs…');
      const entries = hasZips ? await expandZipsAndReps(rawEntries) : rawEntries;
      if (entries.length === 0) {
        setLoading(false);
        setError('No .rep files found in the selected archive(s).');
        return;
      }

      setProgress({ done: 0, total: entries.length, current: entries[0]?.file.name });
      setLoading(true, `Parsing ${entries.length} replay${entries.length === 1 ? '' : 's'}`);
      try {
        let last: Awaited<ReturnType<typeof ingestFile>> | null = null;
        for (let i = 0; i < entries.length; i++) {
          const { file, path } = entries[i];
          setProgress({ done: i, total: entries.length, current: file.name });
          try {
            const bytes = await readFileBytes(file);
            last = await ingestFile({ name: file.name, path, bytes });
          } catch (err) {
            console.warn(`Failed to parse ${path}:`, err);
          }
          setProgress({ done: i + 1, total: entries.length, current: file.name });
        }
        if (last) {
          setActive({ hash: last.hash, name: last.name, path: last.path, replay: last.replay });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setProgress(null);
      }
    },
    [setActive, setError, setLoading],
  );

  const onDrop = useCallback(
    async (ev: React.DragEvent) => {
      ev.preventDefault();
      const entries = await filesFromDataTransfer(ev.dataTransfer.items);
      await ingestMany(entries);
    },
    [ingestMany],
  );

  const onPickFiles = useCallback(
    async (ev: React.ChangeEvent<HTMLInputElement>) => {
      const files = ev.target.files;
      if (!files) return;
      const entries: Array<{ file: File; path: string }> = [];
      for (const f of Array.from(files)) {
        if (isReplayFile(f) || isZipFile(f)) {
          entries.push({
            file: f,
            path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
          });
        }
      }
      await ingestMany(entries);
      ev.target.value = '';
    },
    [ingestMany],
  );

  const onPickFolder = useCallback(async () => {
    try {
      const entries = await pickFolder();
      await ingestMany(entries);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [ingestMany, setError]);

  return { progress, ingestMany, onDrop, onPickFiles, onPickFolder };
}
