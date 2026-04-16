//go:build js && wasm

// Package main provides a WebAssembly wrapper around icza/screp that exposes a
// single JS function, overmindParseReplay, taking a Uint8Array and returning a
// JSON string with the parsed replay plus command/map/computed sections.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"syscall/js"

	"github.com/icza/screp/rep"
	"github.com/icza/screp/repparser"
)

func main() {
	js.Global().Set("overmindParseReplay", js.FuncOf(parseReplay))
	js.Global().Set("overmindParserReady", js.ValueOf(true))
	// Block forever; the Go runtime under wasm_exec exits otherwise.
	select {}
}

// parseReplay(uint8Array) -> { ok: true, data: string } | { ok: false, error: string }
// The data field is a JSON string (not a JS object) so we can stream it across
// postMessage cheaply without walking a huge value graph through syscall/js.
func parseReplay(_ js.Value, args []js.Value) any {
	if len(args) < 1 {
		return errResult("missing replay bytes")
	}
	src := args[0]
	if src.Type() != js.TypeObject {
		return errResult("expected Uint8Array")
	}
	length := src.Get("byteLength").Int()
	buf := make([]byte, length)
	js.CopyBytesToGo(buf, src)

	cfg := repparser.Config{
		Commands:    true,
		MapData:     true,
		MapGraphics: false,
	}
	replay, err := repparser.ParseConfig(buf, cfg)
	if err != nil {
		return errResult(fmt.Sprintf("parse error: %v", err))
	}
	replay.Compute()

	out := marshalReplay(replay)
	data, err := json.Marshal(out)
	if err != nil {
		return errResult(fmt.Sprintf("encode error: %v", err))
	}

	return map[string]any{
		"ok":   true,
		"data": string(data),
	}
}

func errResult(msg string) map[string]any {
	return map[string]any{"ok": false, "error": msg}
}

// marshalReplay projects screp's rich Go types into a JSON-friendly shape.
// We keep field names close to screp's conventions so downstream types stay
// familiar, but drop fields that do not survive JSON cleanly or that we do not
// need on the client.
func marshalReplay(r *rep.Replay) map[string]any {
	if r == nil {
		return nil
	}
	// screp's own MarshalJSON is reasonably complete. We reuse it by letting
	// the standard library marshal the value, then re-unmarshal into a generic
	// map so our outer json.Marshal does not double-encode.
	raw, err := json.Marshal(r)
	if err != nil {
		return map[string]any{"marshal_error": err.Error()}
	}
	var generic map[string]any
	if err := json.Unmarshal(raw, &generic); err != nil {
		return map[string]any{"unmarshal_error": err.Error()}
	}
	return generic
}

// ensure bytes import is retained if we later stream sections.
var _ = bytes.NewReader
