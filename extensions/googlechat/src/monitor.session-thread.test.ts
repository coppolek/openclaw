import { describe, expect, it } from "vitest";
import { resolveGoogleChatPeerId } from "./monitor.js";

describe("resolveGoogleChatPeerId", () => {
  const spaceId = "spaces/AAAA";
  const threadA = "spaces/AAAA/threads/t-A";
  const threadB = "spaces/AAAA/threads/t-B";

  it("returns spaceId when sessionThread is disabled", () => {
    expect(resolveGoogleChatPeerId({ spaceId, threadName: threadA, sessionThread: false })).toBe(
      spaceId,
    );
  });

  it("returns spaceId when sessionThread is undefined (default)", () => {
    expect(
      resolveGoogleChatPeerId({ spaceId, threadName: threadA, sessionThread: undefined }),
    ).toBe(spaceId);
  });

  it("returns thread name when sessionThread is enabled and inbound has a thread", () => {
    expect(resolveGoogleChatPeerId({ spaceId, threadName: threadA, sessionThread: true })).toBe(
      threadA,
    );
  });

  it("falls back to spaceId when sessionThread is enabled but inbound has no thread", () => {
    expect(resolveGoogleChatPeerId({ spaceId, threadName: null, sessionThread: true })).toBe(
      spaceId,
    );
    expect(resolveGoogleChatPeerId({ spaceId, threadName: undefined, sessionThread: true })).toBe(
      spaceId,
    );
  });

  it("produces distinct peer ids for distinct threads so sessions don't cross", () => {
    const a = resolveGoogleChatPeerId({ spaceId, threadName: threadA, sessionThread: true });
    const b = resolveGoogleChatPeerId({ spaceId, threadName: threadB, sessionThread: true });
    expect(a).not.toBe(b);
  });
});
