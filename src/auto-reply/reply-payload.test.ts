import { describe, expect, it } from "vitest";
import {
  cloneReplyPayloadMetadata,
  getReplyPayloadMetadata,
  setReplyPayloadMetadata,
} from "./reply-payload.js";

describe("reply payload metadata", () => {
  it("can be copied onto spread clones used by downstream reply shaping", () => {
    const original = setReplyPayloadMetadata(
      { text: "hello there" },
      { assistantMessageIndex: 2, ttsSourceText: "[Warmly] hello there" },
    );

    const cloned = cloneReplyPayloadMetadata(original, {
      ...original,
      text: "hello there\nUsage: 1 in / 1 out",
    });

    expect(getReplyPayloadMetadata(cloned)).toEqual({
      assistantMessageIndex: 2,
      ttsSourceText: "[Warmly] hello there",
    });
  });

  it("merges metadata updates after metadata has been copied to a clone", () => {
    const original = setReplyPayloadMetadata({ text: "hello there" }, { assistantMessageIndex: 2 });
    const cloned = cloneReplyPayloadMetadata(original, { ...original });

    setReplyPayloadMetadata(cloned, { ttsSourceText: "[warmly] hello there" });

    expect(getReplyPayloadMetadata(cloned)).toEqual({
      assistantMessageIndex: 2,
      ttsSourceText: "[warmly] hello there",
    });
    expect(getReplyPayloadMetadata(original)).toEqual({
      assistantMessageIndex: 2,
    });
  });
});
