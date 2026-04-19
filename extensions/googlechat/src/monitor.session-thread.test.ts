import { describe, expect, it } from "vitest";
import { resolveGoogleChatSessionKey } from "./monitor.js";

describe("resolveGoogleChatSessionKey", () => {
  const baseSessionKey = "agent:main:googlechat:group:spaces/aaaa";
  const threadA = "spaces/aaaa/threads/t-A";
  const threadB = "spaces/aaaa/threads/t-B";

  it("returns the base session key when sessionThread is disabled", () => {
    expect(
      resolveGoogleChatSessionKey({
        baseSessionKey,
        threadName: threadA,
        sessionThread: false,
      }),
    ).toBe(baseSessionKey);
  });

  it("returns the base session key when sessionThread is undefined (default)", () => {
    expect(
      resolveGoogleChatSessionKey({
        baseSessionKey,
        threadName: threadA,
        sessionThread: undefined,
      }),
    ).toBe(baseSessionKey);
  });

  it("appends a :thread:<id> suffix when sessionThread is enabled and inbound has a thread", () => {
    const key = resolveGoogleChatSessionKey({
      baseSessionKey,
      threadName: threadA,
      sessionThread: true,
    });
    expect(key.startsWith(baseSessionKey)).toBe(true);
    expect(key).toContain(":thread:");
    expect(key).not.toBe(baseSessionKey);
  });

  it("falls back to the base session key when sessionThread is enabled but inbound has no thread", () => {
    expect(
      resolveGoogleChatSessionKey({
        baseSessionKey,
        threadName: null,
        sessionThread: true,
      }),
    ).toBe(baseSessionKey);
    expect(
      resolveGoogleChatSessionKey({
        baseSessionKey,
        threadName: undefined,
        sessionThread: true,
      }),
    ).toBe(baseSessionKey);
  });

  it("produces distinct session keys for distinct threads so sessions don't cross", () => {
    const a = resolveGoogleChatSessionKey({
      baseSessionKey,
      threadName: threadA,
      sessionThread: true,
    });
    const b = resolveGoogleChatSessionKey({
      baseSessionKey,
      threadName: threadB,
      sessionThread: true,
    });
    expect(a).not.toBe(b);
  });

  it("keeps the base session key prefix so upstream routing tokens stay intact", () => {
    const key = resolveGoogleChatSessionKey({
      baseSessionKey,
      threadName: threadA,
      sessionThread: true,
    });
    expect(key.startsWith(`${baseSessionKey}:thread:`)).toBe(true);
  });
});
