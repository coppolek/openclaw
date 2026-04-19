import { getReplyPayloadMetadata, setReplyPayloadMetadata } from "openclaw/plugin-sdk/reply-payload";
import { describe, expect, it } from "vitest";
import { appendUsageLine } from "./agent-runner-usage-line.js";

describe("appendUsageLine", () => {
  it("preserves TTS metadata when extending the final text payload", () => {
    const payload = setReplyPayloadMetadata(
      { text: "Hello there." },
      { ttsSourceText: "[Warmly] Hello there." },
    );

    const updated = appendUsageLine([payload], "Usage: 1 in / 1 out");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.text).toBe("Hello there.\nUsage: 1 in / 1 out");
    if (!updated[0]) {
      throw new Error("expected payload");
    }
    expect(getReplyPayloadMetadata(updated[0])).toEqual({
      ttsSourceText: "[Warmly] Hello there.",
    });
  });
});
