/// <reference lib="webworker" />
// Worker that loads the screp WASM module and parses .rep bytes off the main
// thread. Communicates via structured messages; see ParserRequest/Response.

import type { ParserRequest, ParserResponse } from './protocol';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var Go: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  var overmindParseReplay: (bytes: Uint8Array) => { ok: true; data: string } | { ok: false; error: string };
  var overmindParserReady: boolean | undefined;
}

const WASM_EXEC_URL = new URL('/wasm/wasm_exec.js', self.location.href).toString();
const WASM_BIN_URL = new URL('/wasm/screp.wasm', self.location.href).toString();

let readyPromise: Promise<void> | null = null;

async function ensureReady(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const execText = await fetch(WASM_EXEC_URL).then((r) => {
      if (!r.ok) throw new Error(`failed to fetch wasm_exec.js: ${r.status}`);
      return r.text();
    });
    // wasm_exec.js is a classic script; evaluate it in the worker's global
    // scope so it can attach `Go` to globalThis.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    new Function(execText).call(globalThis);
    const GoCtor = (globalThis as unknown as { Go?: new () => unknown }).Go;
    if (!GoCtor) throw new Error('Go runtime did not attach to globalThis');
    const go = new GoCtor() as { importObject: WebAssembly.Imports; run: (i: WebAssembly.Instance) => void };
    const { instance } = await WebAssembly.instantiateStreaming(fetch(WASM_BIN_URL), go.importObject);
    // go.run blocks (its main() does `select {}`), so we fire and forget.
    go.run(instance);
    // Poll for the export to become available. This typically resolves on the
    // next microtask but we guard with a timeout.
    const start = performance.now();
    while (typeof globalThis.overmindParseReplay !== 'function') {
      if (performance.now() - start > 5000) {
        throw new Error('timed out waiting for WASM parser to initialize');
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  })();
  return readyPromise;
}

self.onmessage = async (ev: MessageEvent<ParserRequest>) => {
  const req = ev.data;
  try {
    await ensureReady();
    if (req.kind === 'ping') {
      post({ id: req.id, kind: 'pong' });
      return;
    }
    if (req.kind === 'parse') {
      const bytes = req.bytes instanceof Uint8Array ? req.bytes : new Uint8Array(req.bytes);
      const result = globalThis.overmindParseReplay(bytes);
      if (!result.ok) {
        post({ id: req.id, kind: 'error', error: result.error });
        return;
      }
      // result.data is a JSON string; pass it through without parsing so the
      // main thread can JSON.parse in its own task if preferred.
      post({ id: req.id, kind: 'parsed', json: result.data });
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ id: req.id, kind: 'error', error: message });
  }
};

function post(msg: ParserResponse) {
  (self as DedicatedWorkerGlobalScope).postMessage(msg);
}
