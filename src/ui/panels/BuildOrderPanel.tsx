import { useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../../state/store';
import { cleanBwString, formatMMSS } from '../../types/replay';
import {
  buildOrderToCsv,
  buildOrderToJson,
  buildOrderToText,
  computeBuildOrder,
  type BuildOrderEvent,
} from '../../analysis/buildOrder';

const KIND_LABELS: Record<BuildOrderEvent['kind'], string> = {
  train: 'train',
  morph: 'morph',
  build: 'build',
  buildingMorph: 'morph',
  tech: 'tech',
  upgrade: 'upgrade',
  cancel: 'cancel',
};

const KIND_COLORS: Record<BuildOrderEvent['kind'], string> = {
  train: 'text-sky-300',
  morph: 'text-fuchsia-300',
  build: 'text-emerald-300',
  buildingMorph: 'text-fuchsia-300',
  tech: 'text-amber-300',
  upgrade: 'text-amber-300',
  cancel: 'text-rose-300',
};

export function BuildOrderPanel() {
  const active = useAppStore((s) => s.active);
  const currentFrame = useAppStore((s) => s.currentFrame);
  const setFrame = useAppStore((s) => s.setFrame);
  const listRef = useRef<HTMLDivElement>(null);

  const { events, playerNames, activeIndex } = useMemo(() => {
    if (!active) return { events: [] as BuildOrderEvent[], playerNames: {} as Record<number, string>, activeIndex: -1 };
    const ev = computeBuildOrder(active.replay);
    const names: Record<number, string> = {};
    for (const p of active.replay.Header?.Players ?? []) names[p.ID] = cleanBwString(p.Name);
    // Find the last event at or before currentFrame.
    let idx = -1;
    for (let i = 0; i < ev.length; i++) {
      if (ev[i].frame <= currentFrame) idx = i;
      else break;
    }
    return { events: ev, playerNames: names, activeIndex: idx };
  }, [active, currentFrame]);

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const row = listRef.current.querySelector<HTMLDivElement>(`[data-idx="${activeIndex}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!active) return null;

  const download = (kind: 'txt' | 'csv' | 'json') => {
    const filenameBase = (active.replay.MapData?.Name || active.name || 'build-order').replace(/[^\w\-.]+/g, '_');
    let blob: Blob;
    let ext: string;
    if (kind === 'txt') {
      blob = new Blob([buildOrderToText(events, playerNames)], { type: 'text/plain' });
      ext = 'txt';
    } else if (kind === 'csv') {
      blob = new Blob([buildOrderToCsv(events, playerNames)], { type: 'text/csv' });
      ext = 'csv';
    } else {
      blob = new Blob([buildOrderToJson(events, playerNames)], { type: 'application/json' });
      ext = 'json';
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameBase}.buildorder.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };

  return (
    <div className="flex h-full flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Build order
          <span className="ml-2 text-[10px] font-normal normal-case text-[var(--color-muted)]">
            {events.length} events
          </span>
        </div>
        <div className="flex gap-1">
          {(['txt', 'csv', 'json'] as const).map((k) => (
            <button
              key={k}
              onClick={() => download(k)}
              className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)] hover:text-[var(--color-text-h)]"
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-snug">
        {events.length === 0 ? (
          <div className="p-4 text-center text-sm text-[var(--color-muted)]">
            No production events. (Short or non-melee replay?)
          </div>
        ) : (
          events.map((e, i) => (
            <div
              key={i}
              data-idx={i}
              onClick={() => setFrame(e.frame)}
              className={`grid cursor-pointer grid-cols-[48px_36px_1fr_auto] items-baseline gap-2 px-3 py-1 hover:bg-[var(--color-bg-elev)] ${
                i === activeIndex ? 'bg-[color-mix(in_oklab,var(--color-accent)_20%,transparent)]' : ''
              }`}
              title={`Click to jump to ${formatMMSS(e.seconds)}`}
            >
              <span className="tabular-nums text-[var(--color-muted)]">{formatMMSS(e.seconds)}</span>
              <span className="tabular-nums text-[var(--color-text-h)]">{e.supply}</span>
              <span className={`truncate ${KIND_COLORS[e.kind]}`}>{e.name}</span>
              <span className="text-[10px] uppercase text-[var(--color-muted)]">
                {playerNames[e.playerID] || `P${e.playerID}`} · {KIND_LABELS[e.kind]}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
