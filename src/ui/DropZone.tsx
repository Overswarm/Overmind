import { useRef, useState } from 'react';
import { supportsFolderPicker } from '../storage/ingest';
import { useIngest } from '../storage/useIngest';

export function DropZone() {
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { progress, onDrop, onPickFiles, onPickFolder } = useIngest();

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
      onDrop={async (ev) => {
        setDragActive(false);
        await onDrop(ev);
      }}
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
        onChange={onPickFiles}
      />
      {progress && (
        <div className="mt-4 text-xs text-[var(--color-muted)]">
          {progress.done} / {progress.total} processed
        </div>
      )}
    </div>
  );
}
