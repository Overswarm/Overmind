import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { getNotes, setNotes } from '../../storage/db';

const SAVE_DEBOUNCE_MS = 400;

export function NotesPanel() {
  const active = useAppStore((s) => s.active);
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<number | null>(null);
  const loadedHash = useRef<string | null>(null);

  // Load notes whenever the active replay changes. Track loadedHash so the
  // debounced save doesn't persist an empty value from a just-switched replay.
  useEffect(() => {
    if (!active) {
      setValue('');
      loadedHash.current = null;
      return;
    }
    loadedHash.current = active.hash;
    getNotes(active.hash).then((n) => {
      // Discard if the replay changed underneath us before the read resolved.
      if (loadedHash.current === active.hash) setValue(n);
    });
  }, [active]);

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  const onChange = (next: string) => {
    setValue(next);
    if (!active) return;
    const hash = active.hash;
    setStatus('saving');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      await setNotes(hash, next);
      // Only flip back to "saved" if we're still on this replay.
      if (loadedHash.current === hash) setStatus('saved');
    }, SAVE_DEBOUNCE_MS);
  };

  if (!active) return null;

  return (
    <div className="theme-panel flex h-full flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        <span>Notes</span>
        <span className="font-normal normal-case text-[10px] text-[var(--color-muted)]">
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Write anything about this replay — what worked, what to rewatch, timing windows to remember. Saved locally, tied to the replay's content hash."
        className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[11px] leading-snug text-[var(--color-text-h)] placeholder:text-[var(--color-muted)] focus:outline-none"
      />
    </div>
  );
}
