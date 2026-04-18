// Persistent user settings: names the user plays under ("me" identities) and
// other preferences that outlive a session. Kept separate from the main app
// store so that transient UI state (current frame, playback) stays cheap.
//
// Persistence is simple localStorage — the payload is tiny and synchronous
// reads at startup don't need Dexie's async machinery.

import { create } from 'zustand';

const STORAGE_KEY = 'overmind.settings.v1';

export interface Settings {
  // Names (cleaned, case-insensitive) the user plays under. Used to split
  // aggregates into "me" vs "opponent" — winrate as me, my APM vs theirs, etc.
  identities: string[];
}

interface SettingsState extends Settings {
  setIdentities: (names: string[]) => void;
  addIdentity: (name: string) => void;
  removeIdentity: (name: string) => void;
}

function load(): Settings {
  if (typeof localStorage === 'undefined') return { identities: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { identities: [] };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      identities: Array.isArray(parsed.identities)
        ? parsed.identities.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : [],
    };
  } catch {
    return { identities: [] };
  }
}

function save(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // localStorage can throw in private mode or when full — non-fatal.
  }
}

function normalize(name: string): string {
  return name.trim();
}

function eqCI(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...load(),
  setIdentities: (names) => {
    const cleaned: string[] = [];
    for (const n of names) {
      const t = normalize(n);
      if (!t) continue;
      if (!cleaned.some((c) => eqCI(c, t))) cleaned.push(t);
    }
    set({ identities: cleaned });
    save({ identities: cleaned });
  },
  addIdentity: (name) => {
    const t = normalize(name);
    if (!t) return;
    const cur = get().identities;
    if (cur.some((c) => eqCI(c, t))) return;
    const next = [...cur, t];
    set({ identities: next });
    save({ identities: next });
  },
  removeIdentity: (name) => {
    const t = normalize(name);
    const next = get().identities.filter((c) => !eqCI(c, t));
    set({ identities: next });
    save({ identities: next });
  },
}));

// Test-only helper: given the configured identities, decide if a player
// name matches. Cleaned BW strings sometimes include color codes; callers
// should clean before comparing.
export function isIdentityMatch(playerName: string, identities: string[]): boolean {
  const n = playerName.trim().toLowerCase();
  if (!n) return false;
  return identities.some((i) => i.trim().toLowerCase() === n);
}
