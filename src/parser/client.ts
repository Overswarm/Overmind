// Main-thread client for the parser worker. Handles request IDs, transfer of
// the replay bytes, and JSON parsing of the screp output.

import type { ParserRequest, ParserResponse } from './protocol';
import type { ParsedReplay } from '../types/replay';

let worker: Worker | null = null;
let nextId = 1;
const inflight = new Map<number, { resolve: (v: ParserResponse) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./parser.worker.ts', import.meta.url), {
    type: 'module',
    name: 'overmind-parser',
  });
  worker.onmessage = (ev: MessageEvent<ParserResponse>) => {
    const res = ev.data;
    const pending = inflight.get(res.id);
    if (!pending) return;
    inflight.delete(res.id);
    pending.resolve(res);
  };
  worker.onerror = (ev) => {
    const err = new Error(ev.message || 'parser worker error');
    for (const p of inflight.values()) p.reject(err);
    inflight.clear();
  };
  return worker;
}

function send(req: ParserRequest, transfer: Transferable[] = []): Promise<ParserResponse> {
  const w = getWorker();
  return new Promise((resolve, reject) => {
    inflight.set(req.id, { resolve, reject });
    w.postMessage(req, transfer);
  });
}

export async function parseReplay(bytes: ArrayBuffer | Uint8Array): Promise<ParsedReplay> {
  const id = nextId++;
  const ab: ArrayBuffer =
    bytes instanceof Uint8Array
      ? (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : bytes;
  const res = await send({ id, kind: 'parse', bytes: ab }, [ab]);
  if (res.kind === 'error') throw new Error(res.error);
  if (res.kind !== 'parsed') throw new Error(`unexpected response ${res.kind}`);
  return JSON.parse(res.json) as ParsedReplay;
}

export async function pingParser(): Promise<void> {
  const id = nextId++;
  const res = await send({ id, kind: 'ping' });
  if (res.kind === 'error') throw new Error(res.error);
}
