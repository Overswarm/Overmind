import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../state/store';
import { useSettingsStore } from '../state/settings';
import { FRAMES_PER_SECOND, formatMMSS, frameToSeconds } from '../types/replay';
import { cachedSwings } from '../analysis/cache';
import type { SwingMarker } from '../analysis/swings';
import { playerSlotMap } from './playerColor';

const KIND_COLOR: Record<SwingMarker['kind'], string> = {
  expansion: 'var(--color-accent)',
  tech: 'var(--color-swing-tech)',
  unit: 'var(--color-swing-unit)',
  scout: 'var(--color-swing-scout)',
  firstContact: 'var(--color-swing-contact)',
};

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4, 8] as const;
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export function Timeline() {
  const active = useAppStore((s) => s.active);
  const currentFrame = useAppStore((s) => s.currentFrame);
  const setFrame = useAppStore((s) => s.setFrame);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  // Ref so the rAF loop reads the latest speed without re-subscribing.
  const speedRef = useRef<PlaybackSpeed>(speed);
  useEffect(() => { speedRef.current = speed; }, [speed]);

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
    // Local accumulator: the store floors currentFrame, so we can't rely on
    // reading it back each tick — sub-frame progress would be lost and we'd
    // never advance. Seed from the store, then step forward locally.
    let frame = useAppStore.getState().currentFrame;
    const tick = (now: number) => {
      const dtSec = (now - last) / 1000;
      last = now;
      frame += dtSec * FRAMES_PER_SECOND * speedRef.current;
      if (frame >= total) {
        useAppStore.getState().setFrame(total);
        setPlaying(false);
        return;
      }
      useAppStore.getState().setFrame(frame);
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
        onClick={() => {
          // Starting from the very end just ends immediately — rewind first.
          if (!isPlaying && currentFrame >= total) setFrame(0);
          setPlaying(!isPlaying);
        }}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[var(--color-text-h)] hover:border-[var(--color-accent)]"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? '❚❚' : '▶'}
      </button>
      <div className="font-mono text-xs text-[var(--color-muted)] tabular-nums">
        {elapsed} / {totalStr}
      </div>
      <div className="flex items-center gap-0.5">
        {PLAYBACK_SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
              speed === s
                ? 'bg-[var(--color-accent)] text-white'
                : 'border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text-h)]'
            }`}
            title={`Playback speed ${s}×`}
          >
            {s}×
          </button>
        ))}
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
  const identities = useSettingsStore((s) => s.identities);

  const markers = useMemo(() => {
    if (!active) return [];
    return cachedSwings(active.hash, active.replay);
  }, [active]);

  const slots = useMemo(
    () => playerSlotMap(active?.replay.Header?.Players, identities),
    [active, identities],
  );

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
          // 4-player games: stick the extra slots to the bottom; slot 0 stays
          // on top so "me" is consistent across replays.
          const slot = slots.get(m.playerID) ?? 0;
          const side = slot === 0 ? 'top' : 'bottom';
          // First-contact is a shared event — render it spanning the full
          // marker area so it reads as distinct from single-player ticks.
          const isShared = m.kind === 'firstContact';
          return (
            <button
              key={i}
              type="button"
              onClick={() => setFrame(m.frame)}
              title={`${formatMMSS(m.seconds)} · ${m.label}`}
              className={`pointer-events-auto absolute ${isShared ? 'h-full top-0' : 'h-2'} w-[2px] -translate-x-1/2`}
              style={{
                left: `${pct}%`,
                ...(isShared ? {} : { [side]: '0' }),
                background: KIND_COLOR[m.kind],
                opacity: isShared ? 0.9 : 0.85,
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
          <span className="ml-3 mr-1 inline-block h-1.5 w-1.5 align-middle" style={{ background: KIND_COLOR.scout }} /> scout
          <span className="ml-3 mr-1 inline-block h-1.5 w-1.5 align-middle" style={{ background: KIND_COLOR.firstContact }} /> 1st contact
        </span>
        <span>top = slot 0 · bottom = slot 1</span>
      </div>
    </div>
  );
}
