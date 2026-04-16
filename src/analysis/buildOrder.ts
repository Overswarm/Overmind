// Build order extraction: walks the commands array once and emits a
// chronological list of production / tech / upgrade events per player, with
// cumulative supply produced and worker count at the time of the event.
//
// Caveats:
//   - "Supply" here is supply PRODUCED (not alive). BW's displayed supply
//     decreases when units die; we don't have that signal without an engine
//     simulation, so this is an approximation. Still close enough that the
//     numbers match typical build-order notation (e.g. "9 Pool").
//   - Worker count is total produced, not alive. Same caveat.

import type { ParsedReplay, ReplayCommand } from '../types/replay';
import { cmdTechName, cmdUnit, cmdUpgradeName, isEffective, isType, TYPE_NAMES } from './commands';
import { unitMeta } from './units';

export interface BuildOrderEvent {
  frame: number;
  seconds: number;
  playerID: number;
  kind: 'train' | 'morph' | 'build' | 'buildingMorph' | 'tech' | 'upgrade' | 'cancel';
  name: string;                 // User-facing label (e.g. "Spawning Pool", "Stim Pack")
  supply: number;               // Supply produced by this player *before* this event
  workers: number;              // Worker-type units produced by this player *before* this event
}

export function computeBuildOrder(replay: ParsedReplay): BuildOrderEvent[] {
  const cmds = replay.Commands?.Cmds;
  if (!cmds?.length) return [];

  const supplyByPID = new Map<number, number>();
  const workersByPID = new Map<number, number>();
  const out: BuildOrderEvent[] = [];

  const fps = 1000 / 42;

  // Debug: one-shot histogram of IneffKind values so we can verify the filter
  // matches screp's output shape. Logs once per replay (not per command).
  if (typeof console !== 'undefined' && !(replay as unknown as { __overmindDumpedIneff?: boolean }).__overmindDumpedIneff) {
    const hist: Record<string, number> = {};
    for (const c of cmds) {
      const k = (c as { IneffKind?: unknown }).IneffKind;
      const key = k === undefined ? '(undefined)' : typeof k === 'object' ? JSON.stringify(k) : String(k);
      hist[key] = (hist[key] ?? 0) + 1;
    }
    // eslint-disable-next-line no-console
    console.debug('[overmind] IneffKind histogram:', hist);
    (replay as unknown as { __overmindDumpedIneff?: boolean }).__overmindDumpedIneff = true;
  }

  // Early-game dedupe: in the first ~1 second nobody has the resources to
  // queue multiples of anything (you start with exactly one unit's worth of
  // minerals), so repeated Train commands for the same player/unit inside
  // that window are always mashing. Screp's IneffKind heuristic sometimes
  // misses these because there's no prior "effective" command to compare
  // against. Keyed by `${pid}::${unitId}`.
  const EARLY_GAME_FRAMES = 48; // ~2s at 23.81 fps.
  const earlySeen = new Set<string>();

  for (const c of cmds) {
    const tn = c.Type?.Name;
    if (!tn) continue;

    // Skip commands screp has flagged as ineffective (spam, repeats, queue
    // already full, etc.). Without this, mashing 'p' at game start produces
    // phantom probes that were never actually trained.
    if (!isEffective(c)) continue;

    if (c.Frame < EARLY_GAME_FRAMES && (tn === TYPE_NAMES.train || tn === TYPE_NAMES.unitMorph)) {
      const u = cmdUnit(c);
      if (u) {
        const key = `${c.PlayerID}::${u.ID}`;
        if (earlySeen.has(key)) continue;
        earlySeen.add(key);
      }
    }

    const pid = c.PlayerID;
    const frame = c.Frame;
    const seconds = frame / fps;
    const supply = supplyByPID.get(pid) ?? 0;
    const workers = workersByPID.get(pid) ?? 0;

    switch (tn) {
      case TYPE_NAMES.train: {
        const u = cmdUnit(c);
        const meta = u ? unitMeta(u.ID) : undefined;
        if (!meta) break;
        out.push({ frame, seconds, playerID: pid, kind: 'train', name: meta.name, supply, workers });
        const count = meta.perMorph ?? 1;
        supplyByPID.set(pid, supply + meta.supply * count);
        if (meta.isWorker) workersByPID.set(pid, workers + count);
        break;
      }
      case TYPE_NAMES.unitMorph: {
        const u = cmdUnit(c);
        const meta = u ? unitMeta(u.ID) : undefined;
        if (!meta) break;
        out.push({ frame, seconds, playerID: pid, kind: 'morph', name: meta.name, supply, workers });
        // Unit morphs (Zergling, Mutalisk, Lurker, etc.) pay the morph supply.
        const count = meta.perMorph ?? 1;
        supplyByPID.set(pid, supply + meta.supply * count);
        break;
      }
      case TYPE_NAMES.build: {
        const u = cmdUnit(c);
        const meta = u ? unitMeta(u.ID) : undefined;
        if (!meta) break;
        out.push({ frame, seconds, playerID: pid, kind: 'build', name: meta.name, supply, workers });
        break;
      }
      case TYPE_NAMES.buildingMorph: {
        const u = cmdUnit(c);
        const meta = u ? unitMeta(u.ID) : undefined;
        if (!meta) break;
        out.push({ frame, seconds, playerID: pid, kind: 'buildingMorph', name: meta.name, supply, workers });
        break;
      }
      case TYPE_NAMES.tech: {
        const name = cmdTechName(c);
        if (!name) break;
        out.push({ frame, seconds, playerID: pid, kind: 'tech', name, supply, workers });
        break;
      }
      case TYPE_NAMES.upgrade: {
        const name = cmdUpgradeName(c);
        if (!name) break;
        out.push({ frame, seconds, playerID: pid, kind: 'upgrade', name, supply, workers });
        break;
      }
      default:
        break;
    }
  }

  out.sort((a, b) => a.frame - b.frame);
  return out;
}

export function countBuildOrderCancels(replay: ParsedReplay): number {
  const cmds = replay.Commands?.Cmds ?? [];
  let n = 0;
  for (const c of cmds) {
    if (isType(c as ReplayCommand, TYPE_NAMES.cancelTrain)) n++;
    if (isType(c as ReplayCommand, TYPE_NAMES.cancelConstruction)) n++;
    if (isType(c as ReplayCommand, TYPE_NAMES.cancelMorph)) n++;
  }
  return n;
}

// ---- export formats ---------------------------------------------------------

export function buildOrderToText(events: BuildOrderEvent[], playerNames: Record<number, string>): string {
  const lines: string[] = [];
  for (const e of events) {
    const mm = Math.floor(e.seconds / 60);
    const ss = Math.floor(e.seconds % 60).toString().padStart(2, '0');
    const who = playerNames[e.playerID] ?? `P${e.playerID}`;
    lines.push(`${mm}:${ss}\t${e.supply}\t${who}\t${e.kind}\t${e.name}`);
  }
  return lines.join('\n');
}

export function buildOrderToCsv(events: BuildOrderEvent[], playerNames: Record<number, string>): string {
  const rows: string[] = ['time,supply,workers,player,kind,name'];
  for (const e of events) {
    const mm = Math.floor(e.seconds / 60);
    const ss = Math.floor(e.seconds % 60).toString().padStart(2, '0');
    const who = csvSafe(playerNames[e.playerID] ?? `P${e.playerID}`);
    rows.push(`${mm}:${ss},${e.supply},${e.workers},${who},${e.kind},${csvSafe(e.name)}`);
  }
  return rows.join('\n');
}

export function buildOrderToJson(events: BuildOrderEvent[], playerNames: Record<number, string>): string {
  const out = events.map((e) => ({
    time: formatMMSS(e.seconds),
    frame: e.frame,
    supply: e.supply,
    workers: e.workers,
    player: playerNames[e.playerID] ?? `P${e.playerID}`,
    kind: e.kind,
    name: e.name,
  }));
  return JSON.stringify(out, null, 2);
}

function csvSafe(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatMMSS(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
