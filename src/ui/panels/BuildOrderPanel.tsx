import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { cleanBwString, formatMMSS } from '../../types/replay';
import {
  buildOrderToCsv,
  buildOrderToJson,
  buildOrderToText,
  type BuildOrderEvent,
} from '../../analysis/buildOrder';
import { cachedBuildOrder } from '../../analysis/cache';

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
  const hoverFrame = useAppStore((s) => s.hoverFrame);
  const setFrame = useAppStore((s) => s.setFrame);
  const listRef = useRef<HTMLDivElement>(null);
  // null = show all players; a number selects a single PID.
  const [filterPID, setFilterPID] = useState<number | null>(null);

  const players = useMemo(() => {
    if (!active) return [] as { id: number; name: string }[];
    return (active.replay.Header?.Players ?? [])
      .filter((p) => !p.Observer)
      .map((p) => ({ id: p.ID, name: cleanBwString(p.Name) }));
  }, [active]);

  // Reset filter when the active replay changes so we don't carry a stale PID.
  useEffect(() => {
    setFilterPID(null);
  }, [active?.hash]);

  const { events, playerNames, activeIndex } = useMemo(() => {
    if (!active) return { events: [] as BuildOrderEvent[], playerNames: {} as Record<number, string>, activeIndex: -1 };
    const all = cachedBuildOrder(active.hash, active.replay);
    const ev = filterPID == null ? all : all.filter((e) => e.playerID === filterPID);
    const names: Record<number, string> = {};
    for (const p of active.replay.Header?.Players ?? []) names[p.ID] = cleanBwString(p.Name);
    let idx = -1;
    for (let i = 0; i < ev.length; i++) {
      if (ev[i].frame <= currentFrame) idx = i;
      else break;
    }
    return { events: ev, playerNames: names, activeIndex: idx };
  }, [active, currentFrame, filterPID]);

  // Index of the event closest to the hover frame from the chart. We want the
  // last event at-or-before hoverFrame so the highlight matches the current
  // chart cursor semantics (same as activeIndex but for hover).
  const hoverIndex = useMemo(() => {
    if (hoverFrame == null) return -1;
    let idx = -1;
    for (let i = 0; i < events.length; i++) {
      if (events[i].frame <= hoverFrame) idx = i;
      else break;
    }
    return idx;
  }, [hoverFrame, events]);

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
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Build order
            <span className="ml-2 text-[10px] font-normal normal-case text-[var(--color-muted)]">
              {events.length} events
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilterPID(null)}
              className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                filterPID == null
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text-h)]'
              }`}
            >
              Both
            </button>
            {players.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setFilterPID(p.id)}
                className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                  filterPID === p.id
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text-h)]'
                }`}
                title={p.name}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: i === 0 ? 'var(--color-player-a)' : 'var(--color-player-b)' }}
                />
                <span className="max-w-[10ch] truncate normal-case">{p.name}</span>
              </button>
            ))}
          </div>
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
                i === activeIndex
                  ? 'bg-[color-mix(in_oklab,var(--color-accent)_20%,transparent)]'
                  : i === hoverIndex
                    ? 'bg-[color-mix(in_oklab,var(--color-accent)_9%,transparent)]'
                    : ''
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
