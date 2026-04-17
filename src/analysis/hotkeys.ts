// Control-group / hotkey analytics. In BW, hitting Ctrl+N binds the current
// selection to group N, and later pressing N recalls it. Screp emits one
// "Hotkey" command per action with HotkeyType ∈ {Assign, Select, Add} and
// Group ∈ [0..9]. Usage ratio (recalls vs. manual click-select) is a
// strong proxy for a player's mechanical skill level — pros use control
// groups constantly; beginners almost never do.
//
// We also count plain "Select", "Select Add", "Select Remove" (both the
// classic and 1.21+ variants) as "manual selects" for the ratio.

import type { ParsedReplay } from '../types/replay';

export interface HotkeyStatsPlayer {
  playerID: number;
  assigns: number;             // Ctrl+N: bind selection to group N
  recalls: number;             // Press N: recall group N
  adds: number;                // Shift+N: add to group N
  manualSelects: number;       // Mouse-drag or click Select commands
  groupsUsed: number[];        // Sorted list of groups (0..9) ever assigned
  perGroupRecalls: number[];   // length 10; recall count per group index
}

export interface HotkeyStats {
  players: HotkeyStatsPlayer[];
}

const SELECT_TYPE_NAMES = new Set([
  'Select',
  'Select Add',
  'Select Remove',
  'Select 121',
  'Select Add 121',
  'Select Remove 121',
]);

export function computeHotkeyStats(replay: ParsedReplay): HotkeyStats {
  const players = (replay.Header?.Players ?? []).filter((p) => !p.Observer);
  const byPID = new Map<number, HotkeyStatsPlayer>();
  for (const p of players) {
    byPID.set(p.ID, {
      playerID: p.ID,
      assigns: 0,
      recalls: 0,
      adds: 0,
      manualSelects: 0,
      groupsUsed: [],
      perGroupRecalls: new Array(10).fill(0),
    });
  }

  const assignedGroups = new Map<number, Set<number>>(); // pid → groups assigned
  const cmds = replay.Commands?.Cmds ?? [];
  for (const c of cmds) {
    const tn = c.Type?.Name;
    if (!tn) continue;
    const s = byPID.get(c.PlayerID);
    if (!s) continue;

    if (tn === 'Hotkey') {
      const htName = (c.HotkeyType as { Name?: string } | undefined)?.Name;
      const group = typeof c.Group === 'number' ? c.Group : undefined;
      if (htName === 'Assign') {
        s.assigns++;
        if (group !== undefined) {
          let set = assignedGroups.get(c.PlayerID);
          if (!set) { set = new Set(); assignedGroups.set(c.PlayerID, set); }
          set.add(group);
        }
      } else if (htName === 'Select') {
        s.recalls++;
        if (group !== undefined && group >= 0 && group < 10) s.perGroupRecalls[group]++;
      } else if (htName === 'Add') {
        s.adds++;
      }
    } else if (SELECT_TYPE_NAMES.has(tn)) {
      s.manualSelects++;
    }
  }

  for (const [pid, set] of assignedGroups.entries()) {
    const s = byPID.get(pid);
    if (s) s.groupsUsed = [...set].sort((a, b) => a - b);
  }

  return { players: [...byPID.values()] };
}

// Ratio of control-group recalls to all selection actions (recalls + manual).
// Higher = more reliance on hotkeys.
export function hotkeyReliance(p: HotkeyStatsPlayer): number {
  const total = p.recalls + p.manualSelects;
  if (total === 0) return 0;
  return p.recalls / total;
}
