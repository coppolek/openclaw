import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetSpottedIdsCacheForTest,
  isConnectionBoundIdError,
  markConnectionBoundIdsAsSpotted,
  rewriteSpottedConnectionBoundIds,
} from "./openai-responses-spotted-ids.js";

function makeBase64Id(prefix: string, length = 512): string {
  return Buffer.from(`${prefix}-${"x".repeat(length)}`).toString("base64");
}

describe("openai-responses-spotted-ids", () => {
  beforeEach(() => {
    __resetSpottedIdsCacheForTest();
  });

  it("detects the connection-bound ID error message in either case", () => {
    expect(
      isConnectionBoundIdError("400 input item ID does not belong to this connection"),
    ).toBe(true);
    expect(isConnectionBoundIdError("Input item id does not belong to this connection.")).toBe(
      true,
    );
    expect(isConnectionBoundIdError("rate limit exceeded")).toBe(false);
    expect(isConnectionBoundIdError("")).toBe(false);
    expect(isConnectionBoundIdError(undefined)).toBe(false);
  });

  it("rewrites known spotted IDs to short local IDs and leaves unknown IDs alone", () => {
    const spotted = makeBase64Id("spotted");
    const fresh = makeBase64Id("fresh");

    const input: Array<Record<string, unknown>> = [
      { id: spotted, type: "reasoning" },
      { id: fresh, type: "message" },
      { id: "msg_short", type: "message" },
      { type: "message" },
    ];

    markConnectionBoundIdsAsSpotted([{ id: spotted, type: "reasoning" }]);
    const rewrote = rewriteSpottedConnectionBoundIds(input);

    expect(rewrote).toBe(true);
    expect(input[0].id).toMatch(/^rs_[a-z0-9]+$/);
    expect(input[1].id).toBe(fresh);
    expect(input[2].id).toBe("msg_short");
  });

  it("only marks IDs that look like connection-bound base64 tokens", () => {
    const payload = [
      { id: makeBase64Id("real-looking"), type: "message" },
      { id: "msg_short_client_id", type: "message" },
      { id: "", type: "message" },
      { type: "message" },
    ];
    const spotted = markConnectionBoundIdsAsSpotted(payload);
    expect(spotted).toHaveLength(1);
    expect(spotted[0]).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("uses type-appropriate prefixes for replacement IDs", () => {
    const rs = makeBase64Id("rs");
    const fc = makeBase64Id("fc");
    const msg = makeBase64Id("msg");
    markConnectionBoundIdsAsSpotted([
      { id: rs, type: "reasoning" },
      { id: fc, type: "function_call" },
      { id: msg, type: "message" },
    ]);
    const input: Array<Record<string, unknown>> = [
      { id: rs, type: "reasoning" },
      { id: fc, type: "function_call" },
      { id: msg, type: "message" },
    ];
    rewriteSpottedConnectionBoundIds(input);
    expect(input[0].id).toMatch(/^rs_/);
    expect(input[1].id).toMatch(/^fc_/);
    expect(input[2].id).toMatch(/^msg_/);
  });

  it("tolerates non-array input without throwing", () => {
    expect(rewriteSpottedConnectionBoundIds(undefined)).toBe(false);
    expect(rewriteSpottedConnectionBoundIds("some string")).toBe(false);
    expect(markConnectionBoundIdsAsSpotted(undefined)).toEqual([]);
  });
});
