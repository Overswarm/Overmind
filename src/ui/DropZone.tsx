import { useCallback, useRef, useState } from 'react';
import {
  ingestFile,
  filesFromDataTransfer,
  isReplayFile,
  isZipFile,
  expandZipsAndReps,
  pickFolder,
  readFileBytes,
  supportsFolderPicker,
} from '../storage/ingest';
import { useAppStore } from '../state/store';

export function DropZone() {
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const setActive = useAppStore((s) => s.setActive);
  const setLoading = useAppStore((s) => s.setLoading);
  const setError = useAppStore((s) => s.setError);

  const ingestMany = useCallback(
    async (rawEntries: Array<{ file: File; path: string }>) => {
      if (rawEntries.length === 0) return;
      setError(null);

      // Expand any .zip replay packs transparently before parsing.
      const hasZips = rawEntries.some((e) => isZipFile(e.file));
      if (hasZips) {
        setLoading(true, 'Extracting replay packs…');
      }
      const entries = hasZips ? await expandZipsAndReps(rawEntries) : rawEntries;
      if (entries.length === 0) {
        setLoading(false);
        setError('No .rep files found in the selected archive(s).');
        return;
      }

      setProgress({ done: 0, total: entries.length });
      setLoading(true, `Parsing ${entries.length} replay${entries.length === 1 ? '' : 's'}`);
      try {
        let last: Awaited<ReturnType<typeof ingestFile>> | null = null;
        for (let i = 0; i < entries.length; i++) {
          const { file, path } = entries[i];
          try {
            const bytes = await readFileBytes(file);
            last = await ingestFile({ name: file.name, path, bytes });
          } catch (err) {
            console.warn(`Failed to parse ${path}:`, err);
          }
          setProgress({ done: i + 1, total: entries.length });
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
      setDragActive(false);
      const entries = await filesFromDataTransfer(ev.dataTransfer.items);
      await ingestMany(entries);
    },
    [ingestMany],
  );

  const onPick = useCallback(
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

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors px-8 py-16 ${
        dragActive ? 'border-[var(--color-accent)] bg-[color-mix(in_oklab,var(--color-accent)_10%,transparent)]' : 'border-[var(--color-border)]'
      }`}
    >
      <div className="text-lg font-medium text-[var(--color-text-h)]">Drop .rep files, .zip replay packs, or folders</div>
      <div className="mt-1 text-sm text-[var(--color-muted)]">Parsed locally in your browser. Nothing is uploaded.</div>
      <div className="mt-6 flex gap-3">
        <button
          className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
          onClick={() => inputRef.current?.click()}
        >
          Choose files
        </button>
        {supportsFolderPicker() && (
          <button
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-4 py-2 text-sm font-medium text-[var(--color-text-h)] hover:border-[var(--color-accent)]"
            onClick={onPickFolder}
          >
            Choose folder
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple
        accept=".rep,.zip"
        onChange={onPick}
      />
      {progress && (
        <div className="mt-4 text-xs text-[var(--color-muted)]">
          {progress.done} / {progress.total} processed
        </div>
      )}
    </div>
  );
}
