import { useMemo, useState } from 'react';
import { useAppStore } from '../../state/store';

// Temporary development-only panel. Surfaces the raw screp output so we can
// verify field names and shape against the TypeScript model without opening
// devtools. Remove once all analytical panels are implemented.

export function DebugPanel() {
  const active = useAppStore((s) => s.active);
  const [section, setSection] = useState<'header' | 'computed' | 'mapdata' | 'commands-sample'>('header');

  const payload = useMemo(() => {
    if (!active) return null;
    const r = active.replay;
    if (section === 'header') return r.Header;
    if (section === 'computed') return r.Computed;
    if (section === 'mapdata') return r.MapData;
    if (section === 'commands-sample') {
      const cmds = r.Commands?.Cmds ?? [];
      return {
        count: cmds.length,
        first10: cmds.slice(0, 10),
      };
    }
    return null;
  }, [active, section]);

  if (!active) return null;

  return (
    <div className="theme-panel flex h-full flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Debug: raw parse output
        </div>
        <div className="flex gap-1">
          {(['header', 'computed', 'mapdata', 'commands-sample'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                section === s
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text-h)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-snug text-[var(--color-text)]">
        {payload === undefined || payload === null
          ? '(none)'
          : JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}
