import { useEffect } from 'react';
import { useAppStore } from '../state/store';
import { FRAMES_PER_SECOND, formatMMSS, frameToSeconds } from '../types/replay';

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

  // Keep a ref for the rAF loop without re-subscribing every frame.
  const currentFrameRef = { current: currentFrame };
  currentFrameRef.current = currentFrame;

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
      <input
        type="range"
        min={0}
        max={total}
        step={1}
        value={Math.min(currentFrame, total)}
        onChange={(e) => setFrame(Number(e.target.value))}
        className="flex-1 accent-[var(--color-accent)]"
      />
    </div>
  );
}
