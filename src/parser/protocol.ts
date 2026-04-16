// Wire protocol between the main thread and the parser worker. Kept in a
// separate module so both sides can import without pulling in worker-only code.

export type ParserRequest =
  | { id: number; kind: 'ping' }
  | { id: number; kind: 'parse'; bytes: Uint8Array | ArrayBuffer };

export type ParserResponse =
  | { id: number; kind: 'pong' }
  | { id: number; kind: 'parsed'; json: string }
  | { id: number; kind: 'error'; error: string };
