// Global app state. Intentionally small: the active replay, a derived
// scrubbable current frame, and UI flags. Derived analytics should live in
// modules under src/analysis and be recomputed from `current.replay`.

import { create } from 'zustand';
import type { ParsedReplay } from '../types/replay';

export interface ActiveReplay {
  hash: string;
  name: string;
  path?: string;
  replay: ParsedReplay;
}

interface AppState {
  active: ActiveReplay | null;
  currentFrame: number;
  // Transient cursor frame for cross-panel hover sync. null = no hover.
  // Distinct from currentFrame so hovering the chart doesn't reseek playback.
  hoverFrame: number | null;
  isPlaying: boolean;
  loading: { busy: boolean; message?: string };
  error: string | null;

  setActive: (ar: ActiveReplay) => void;
  clearActive: () => void;
  setFrame: (frame: number) => void;
  setHoverFrame: (frame: number | null) => void;
  setPlaying: (p: boolean) => void;
  setLoading: (busy: boolean, message?: string) => void;
  setError: (err: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  active: null,
  currentFrame: 0,
  hoverFrame: null,
  isPlaying: false,
  loading: { busy: false },
  error: null,

  setActive: (ar) => set({ active: ar, currentFrame: 0, hoverFrame: null, error: null }),
  clearActive: () => set({ active: null, currentFrame: 0, hoverFrame: null, isPlaying: false }),
  setFrame: (frame) => set({ currentFrame: Math.max(0, Math.floor(frame)) }),
  setHoverFrame: (frame) => set({ hoverFrame: frame == null ? null : Math.max(0, Math.floor(frame)) }),
  setPlaying: (p) => set({ isPlaying: p }),
  setLoading: (busy, message) => set({ loading: { busy, message } }),
  setError: (err) => set({ error: err }),
}));
