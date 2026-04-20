import { randomBytes } from "node:crypto";
import type { ResponseInput } from "openai/resources/responses/responses.js";
import { resolveGlobalDedupeCache } from "../infra/dedupe.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("openai-responses-spotted-ids");

// Some OpenAI-compatible providers (notably GitHub Copilot's `/responses`
// endpoint) encode connection/session state into `input[].id` values as
// long base64 tokens. Those IDs are bound to a specific upstream connection
// and are rejected with "input item ID does not belong to this connection"
// once that connection is gone.
//
// The fix is small: when we see that upstream error, remember which IDs in
// the outgoing payload looked like connection-bound tokens, then on retry —
// and on subsequent requests — replace them with short, locally generated
// IDs. `check()` refreshes the TTL on every hit, so an ID that the client
// keeps replaying in its conversation history stays remembered for as long
// as it is still being referenced.
const SPOTTED_IDS = resolveGlobalDedupeCache(
  Symbol.for("openclaw.openai-responses.spotted-ids"),
  { ttlMs: 60 * 60 * 1000, maxSize: 2000 },
);

const CONNECTION_BOUND_ID_ERROR_RE =
  /\binput item id does not belong to this connection\b/i;

export function isConnectionBoundIdError(errorMessage: string | undefined | null): boolean {
  if (!errorMessage) {
    return false;
  }
  return CONNECTION_BOUND_ID_ERROR_RE.test(errorMessage);
}

// Heuristic: a string looks connection-bound if it is long (short client IDs
// like `rs_abc123` are well under 20 chars) and decodes as base64 with a
// non-trivial payload. Returning false keeps user-supplied short IDs intact.
function looksLikeConnectionBoundId(id: string): boolean {
  if (typeof id !== "string" || id.length < 24) {
    return false;
  }
  if (!/^[A-Za-z0-9+/_-]+=*$/.test(id)) {
    return false;
  }
  // Buffer.from(id, "base64") in Node silently ignores invalid characters
  // rather than throwing, and the regex above has already validated the
  // character set, so no try/catch is needed here.
  return Buffer.from(id, "base64").length >= 16;
}

function generateReplacementId(type: string | undefined): string {
  const prefix = type === "reasoning" ? "rs" : type === "function_call" ? "fc" : "msg";
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

type InputItem = Record<string, unknown> & { id?: unknown; type?: unknown };

function isArrayInput(input: unknown): input is InputItem[] {
  return Array.isArray(input);
}

export function rewriteSpottedConnectionBoundIds(input: ResponseInput | unknown): boolean {
  if (!isArrayInput(input)) {
    return false;
  }
  let rewrote = false;
  for (const item of input) {
    const id = item.id;
    if (typeof id !== "string" || id.length === 0) {
      continue;
    }
    // `peek()` queries without mutating the cache; `check()` on a hit
    // refreshes the TTL so long-lived references stay remembered while
    // unused entries expire on their own.
    if (SPOTTED_IDS.peek(id)) {
      SPOTTED_IDS.check(id);
      item.id = generateReplacementId(typeof item.type === "string" ? item.type : undefined);
      rewrote = true;
    }
  }
  return rewrote;
}

export function markConnectionBoundIdsAsSpotted(input: ResponseInput | unknown): string[] {
  if (!isArrayInput(input)) {
    return [];
  }
  const spotted: string[] = [];
  for (const item of input) {
    const id = item.id;
    if (typeof id !== "string" || id.length === 0) {
      continue;
    }
    if (looksLikeConnectionBoundId(id)) {
      // `check()` on an absent key inserts it (see createDedupeCache).
      SPOTTED_IDS.check(id);
      spotted.push(id);
    }
  }
  if (spotted.length > 0) {
    log.info(
      `Marked ${spotted.length} connection-bound item ID(s) as spotted after upstream rejection`,
    );
  }
  return spotted;
}

// Exposed for tests.
export function __resetSpottedIdsCacheForTest(): void {
  SPOTTED_IDS.clear();
}
