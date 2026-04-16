// TypeScript projection of screp's JSON output. We only declare the fields we
// actively use; everything else is kept as `unknown` so we don't lie about the
// shape. When we need something new, pull it up from `Record<string, unknown>`
// into a real field here.
//
// Field names match screp's default Go JSON tags (Go field names, since screp
// does not set explicit json tags on most fields). Optional fields reflect the
// `omitempty` + `-` cases we've seen in the source.

export interface ParsedReplay {
  Header: ReplayHeader;
  Commands?: ReplayCommands;
  MapData?: ReplayMapData;
  Computed?: ReplayComputed;
  ShieldBattery?: Record<string, unknown>;
}

export interface ReplayHeader {
  Engine?: NamedConst;
  Version?: string;
  Frames: number;
  StartTime?: string;
  Title?: string;
  MapWidth: number;
  MapHeight: number;
  AvailSlotsCount?: number;
  Speed?: NamedConst;
  Type?: NamedConst;
  SubType?: number;
  Host?: string;
  Map?: string;
  Players: ReplayPlayer[];
}

export interface ReplayPlayer {
  SlotID: number;
  ID: number;
  Type?: NamedConst;
  Race?: RaceConst;
  Team: number;
  Name: string;
  Color?: NamedConst;
  Observer?: boolean;
}

export interface ReplayCommands {
  Cmds: ReplayCommand[];
}

// Base fields present on every screp command. Specific command types add
// extra fields; they are captured via the index signature.
export interface ReplayCommand {
  Frame: number;
  PlayerID: number;
  Type: NamedConst;
  IneffKind?: NamedConst;
  // Command-specific payload (e.g. UnitTag, Pos, Unit, TargetUnit)
  [key: string]: unknown;
}

export interface ReplayMapData {
  Name?: string;
  TileSet?: NamedConst;
  TileSetMissing?: boolean;
  StartLocations?: Array<{ SlotID: number; Point: Point }>;
  MineralFields?: ResourceSpot[];
  Geysers?: ResourceSpot[];
}

export interface ResourceSpot {
  Point?: Point;
  ResourceAmount?: number;
  Sprite?: boolean;
}

export interface Point {
  X: number;
  Y: number;
}

export interface ReplayComputed {
  PlayerDescs: PlayerDesc[];
  ChatCmds?: ChatCmd[];
  LeaveGameCmds?: LeaveGameCmd[];
  WinnerTeam?: number;
  RepSaverPlayerID?: number;
}

export interface PlayerDesc {
  PlayerID: number;
  LastCmdFrame?: number;
  CmdCount?: number;
  EffectiveCmdCount?: number;
  APM?: number;
  EAPM?: number;
  StartLocation?: Point;
  StartDirection?: number;
}

export interface ChatCmd {
  Frame: number;
  PlayerID: number;
  Message?: string;
  [key: string]: unknown;
}

export interface LeaveGameCmd {
  Frame: number;
  PlayerID: number;
  Reason?: NamedConst;
  [key: string]: unknown;
}

// Many screp enum values serialize as {"ID":…,"Name":…} structs. We mirror
// that here. Some (like Race) add extra fields.
export interface NamedConst {
  ID?: number;
  Name?: string;
  ShortName?: string;
}

export interface RaceConst extends NamedConst {
  Letter?: string;
}

// Utility: frames→seconds. screp's native rate is 23.81 FPS (BW fastest).
export const FRAMES_PER_SECOND = 1000 / 42;

export function frameToSeconds(frame: number): number {
  return frame / FRAMES_PER_SECOND;
}

export function formatMMSS(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
