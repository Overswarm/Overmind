// Helpers for walking the flat `Commands.Cmds` array from screp. Commands are
// polymorphic: all share a Frame/PlayerID/Type base, but individual kinds have
// extra fields (Unit, Pos, Order, Message, Reason, etc.). We use the Type.Name
// string to discriminate — these names are stable in screp's output.

import type { ParsedReplay, ReplayCommand } from '../types/replay';

export const TYPE_NAMES = {
  train: 'Train',
  unitMorph: 'Unit Morph',
  build: 'Build',
  buildingMorph: 'Building Morph',
  tech: 'Tech',
  upgrade: 'Upgrade',
  chat: 'Chat',
  leaveGame: 'Leave Game',
  cancelTrain: 'Cancel Train',
  cancelConstruction: 'Cancel Construction',
  cancelMorph: 'Cancel Morph',
} as const;

export type KnownTypeName = (typeof TYPE_NAMES)[keyof typeof TYPE_NAMES];

export function cmdTypeName(cmd: ReplayCommand): string | undefined {
  return cmd.Type?.Name;
}

export function isType(cmd: ReplayCommand, name: KnownTypeName): boolean {
  return cmdTypeName(cmd) === name;
}

export function commandsOfType(replay: ParsedReplay, name: KnownTypeName): ReplayCommand[] {
  const cmds = replay.Commands?.Cmds ?? [];
  return cmds.filter((c) => isType(c, name));
}

// Returns the unit object embedded in Train / UnitMorph / Build / BuildingMorph
// commands. screp flattens the embedded Base, so these live on the command
// directly: `{ Frame, PlayerID, Type, Unit: { ID, Name }, ... }`.
export function cmdUnit(cmd: ReplayCommand): { ID: number; Name?: string } | undefined {
  const u = cmd.Unit as { ID?: number; Name?: string } | undefined;
  if (!u || typeof u.ID !== 'number') return undefined;
  return { ID: u.ID, Name: u.Name };
}

export function cmdMessage(cmd: ReplayCommand): string | undefined {
  const m = cmd.Message;
  return typeof m === 'string' ? m : undefined;
}

export function cmdSenderSlotID(cmd: ReplayCommand): number | undefined {
  const s = cmd.SenderSlotID;
  return typeof s === 'number' ? s : undefined;
}

export function cmdLeaveReason(cmd: ReplayCommand): string | undefined {
  const r = cmd.Reason as { Name?: string } | undefined;
  return r?.Name;
}

export function cmdTechName(cmd: ReplayCommand): string | undefined {
  const t = cmd.Tech as { Name?: string } | undefined;
  return t?.Name;
}

export function cmdUpgradeName(cmd: ReplayCommand): string | undefined {
  const u = cmd.Upgrade as { Name?: string } | undefined;
  return u?.Name;
}

// Effective commands are actions screp deemed non-redundant (not spam). This
// classification is populated by rep.Compute() on the Go side. screp serialises
// IneffKind as a plain JSON string ("Effective", "FastRepetition", ...) via a
// custom MarshalJSON; older / hypothetical builds could emit a number or an
// object, so we accept any of those shapes.
export function isEffective(cmd: ReplayCommand): boolean {
  const k = cmd.IneffKind;
  if (k === undefined || k === null) return true;
  if (typeof k === 'string') return k === '' || k === 'Effective';
  if (typeof k === 'number') return k === 0;
  if (typeof k === 'object') {
    const name = (k as { Name?: string }).Name;
    return !name || name === '' || name === 'Effective';
  }
  return true;
}
