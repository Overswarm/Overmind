import { useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../state/store';
import { FRAMES_PER_SECOND, formatMMSS, frameToSeconds } from '../types/replay';
import { cachedSwings } from '../analysis/cache';
import type { SwingMarker } from '../analysis/swings';

const KIND_COLOR: Record<SwingMarker['kind'], string> = {
  expansion: 'var(--color-accent)',
  tech: '#a78bfa',
  unit: '#f59e0b',
};

export function Timeline() {
  const active = useAppStore((s) => s.active);
  const currentFrame = useAppStore((s) => s.currentFrame);
  const setFrame = useAppStore((s) => s.setFrame);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const setPlaying = useAppStore((s) => s.setPlaying);

  useEffect(() => {
    // Keyboard controls only active when a replay is loaded.
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying(!isPlaying);
      } else if (e.code === 'ArrowLeft') {
        const step = e.shiftKey ? FRAMES_PER_SECOND * 10 : FRAMES_PER_SECOND;
        setFrame(Math.max(0, currentFrame - step));
      } else if (e.code === 'ArrowRight') {
        const step = e.shiftKey ? FRAMES_PER_SECOND * 10 : FRAMES_PER_SECOND;
        setFrame(Math.min(active.replay.Header.Frames, currentFrame + step));
      } else if (e.code === 'Home') {
        setFrame(0);
      } else if (e.code === 'End') {
        setFrame(active.replay.Header.Frames);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, currentFrame, isPlaying, setFrame, setPlaying]);

  // Keep a ref for the rAF loop so it reads the latest frame without the
  // useEffect closing over a stale value or re-subscribing each frame.
  const currentFrameRef = useRef(currentFrame);
  currentFrameRef.current = currentFrame;

  useEffect(() => {
    if (!active || !isPlaying) return;
    const total = active.replay.Header.Frames;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dtSec = (now - last) / 1000;
      last = now;
      const next = currentFrameRef.current + dtSec * FRAMES_PER_SECOND;
      if (next >= total) {
        useAppStore.getState().setFrame(total);
        setPlaying(false);
        return;
      }
      useAppStore.getState().setFrame(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, isPlaying, setPlaying]);

  if (!active) {
    return (
      <div className="flex h-20 items-center px-4 text-sm text-[var(--color-muted)]">
        Load a replay to enable the timeline.
      </div>
    );
  }

  const total = active.replay.Header.Frames;
  const elapsed = formatMMSS(frameToSeconds(currentFrame));
  const totalStr = formatMMSS(frameToSeconds(total));

  return (
    <div className="flex h-20 items-center gap-3 px-4">
      <button
        onClick={() => setPlaying(!isPlaying)}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[var(--color-text-h)] hover:border-[var(--color-accent)]"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? '❚❚' : '▶'}
      </button>
      <div className="font-mono text-xs text-[var(--color-muted)] tabular-nums">
        {elapsed} / {totalStr}
      </div>
      <SwingTrack total={total} />
    </div>
  );
}

// Scrubber + overlayed swing markers. The range input and the absolute marker
// layer share the same width via a flex container, so marker positions line up
// with input values.
function SwingTrack({ total }: { total: number }) {
  const active = useAppStore((s) => s.active);
  const currentFrame = useAppStore((s) => s.currentFrame);
  const setFrame = useAppStore((s) => s.setFrame);

  const markers = useMemo(() => {
    if (!active) return [];
    return cachedSwings(active.hash, active.replay);
  }, [active]);

  const players = (active?.replay.Header?.Players ?? []).filter((p) => !p.Observer);
  const pidIndex = new Map(players.map((p, i) => [p.ID, i]));

  return (
    <div className="relative flex-1">
      <input
        type="range"
        min={0}
        max={total}
        step={1}
        value={Math.min(currentFrame, total)}
        onChange={(e) => setFrame(Number(e.target.value))}
        className="relative z-10 h-4 w-full accent-[var(--color-accent)]"
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-full">
        {markers.map((m, i) => {
          const pct = total > 0 ? (m.frame / total) * 100 : 0;
          const idx = pidIndex.get(m.playerID) ?? 0;
          const side = idx === 0 ? 'top' : 'bottom';
          return (
            <button
              key={i}
              type="button"
              onClick={() => setFrame(m.frame)}
              title={`${formatMMSS(m.seconds)} · ${m.label}`}
              className="pointer-events-auto absolute h-2 w-[2px] -translate-x-1/2"
              style={{
                left: `${pct}%`,
                [side]: '0',
                background: KIND_COLOR[m.kind],
                opacity: 0.85,
              }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wide text-[var(--color-muted)]">
        <span>
          <span className="mr-1 inline-block h-1.5 w-1.5 align-middle" style={{ background: KIND_COLOR.expansion }} /> expand
          <span className="ml-3 mr-1 inline-block h-1.5 w-1.5 align-middle" style={{ background: KIND_COLOR.tech }} /> tech
          <span className="ml-3 mr-1 inline-block h-1.5 w-1.5 align-middle" style={{ background: KIND_COLOR.unit }} /> 1st unit
        </span>
        <span>top = P1 · bottom = P2</span>
      </div>
    </div>
  );
}
