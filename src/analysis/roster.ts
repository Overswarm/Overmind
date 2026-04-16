// Live roster: counts of units / buildings each player has produced up to a
// given frame. Without a game simulation we can't know what's still alive;
// this is strictly "produced so far".
//
// We derive counts from build-order events (train / morph / build /
// buildingMorph). Upgrades and tech are excluded — they have their own rollup
// via the build order panel.

import type { BuildOrderEvent } from './buildOrder';
import { unitMeta, type UnitMeta } from './units';

export type RosterRole = 'worker' | 'army' | 'building';

export interface RosterEntry {
  name: string;
  count: number;
  role: RosterRole;
}

export interface RosterForPlayer {
  playerID: number;
  workers: number;
  supplyProduced: number;
  byRole: Record<RosterRole, RosterEntry[]>;
}

// Resolve a build-order event's unit metadata by its `name` field (set by
// computeBuildOrder from unitMeta.name). Cheap linear scan is fine here —
// each replay has O(hundreds) of events.
const nameIndex = new Map<string, UnitMeta>();
function metaByName(name: string): UnitMeta | undefined {
  if (nameIndex.size === 0) {
    // Lazy-populate from the units table. We don't export the full TABLE, so
    // walk a range of IDs and collect from unitMeta.
    for (let id = 0; id < 0x100; id++) {
      const m = unitMeta(id);
      if (m) nameIndex.set(m.name, m);
    }
  }
  return nameIndex.get(name);
}

export function computeRoster(events: BuildOrderEvent[], uptoFrame: number): Map<number, RosterForPlayer> {
  const byPID = new Map<number, RosterForPlayer>();
  const ensure = (pid: number): RosterForPlayer => {
    let r = byPID.get(pid);
    if (!r) {
      r = {
        playerID: pid,
        workers: 0,
        supplyProduced: 0,
        byRole: { worker: [], army: [], building: [] },
      };
      byPID.set(pid, r);
    }
    return r;
  };

  // Tally counts keyed by (pid, name) so we can aggregate like units.
  const tally = new Map<string, { pid: number; name: string; role: RosterRole; count: number }>();
  const key = (pid: number, name: string) => `${pid}::${name}`;

  for (const e of events) {
    if (e.frame > uptoFrame) break;
    if (e.kind !== 'train' && e.kind !== 'morph' && e.kind !== 'build' && e.kind !== 'buildingMorph') continue;
    const meta = metaByName(e.name);
    if (!meta) continue;
    const role: RosterRole = meta.isWorker ? 'worker' : meta.isBuilding ? 'building' : 'army';
    const count = meta.perMorph ?? 1;
    const k = key(e.playerID, meta.name);
    const prev = tally.get(k);
    if (prev) prev.count += count;
    else tally.set(k, { pid: e.playerID, name: meta.name, role, count });

    const r = ensure(e.playerID);
    if (meta.isWorker) r.workers += count;
    r.supplyProduced += meta.supply * count;
  }

  for (const { pid, name, role, count } of tally.values()) {
    const r = ensure(pid);
    r.byRole[role].push({ name, count, role });
  }

  // Stable descending sort by count so the most-built unit shows first.
  for (const r of byPID.values()) {
    for (const role of ['worker', 'army', 'building'] as RosterRole[]) {
      r.byRole[role].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }
  }

  return byPID;
}
