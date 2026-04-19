import { describe, expect, test, vi } from "vitest";
import { HEARTBEAT_PROMPT } from "../auto-reply/heartbeat.js";
import { buildSessionHistorySnapshot, SessionHistorySseState } from "./session-history-state.js";
import * as sessionUtils from "./session-utils.js";

describe("SessionHistorySseState", () => {
  test("uses the initial raw snapshot for both first history and seq seeding", () => {
    const readSpy = vi.spyOn(sessionUtils, "readSessionMessages").mockReturnValue([
      {
        role: "assistant",
        content: [{ type: "text", text: "stale disk message" }],
        __openclaw: { seq: 1 },
      },
    ]);
    try {
      const state = SessionHistorySseState.fromRawSnapshot({
        target: { sessionId: "sess-main" },
        rawMessages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "fresh snapshot message" }],
            __openclaw: { seq: 2 },
          },
        ],
      });

      expect(state.snapshot().messages).toHaveLength(1);
      expect(
        (
          state.snapshot().messages[0] as {
            content?: Array<{ text?: string }>;
            __openclaw?: { seq?: number };
          }
        ).content?.[0]?.text,
      ).toBe("fresh snapshot message");
      expect(
        (
          state.snapshot().messages[0] as {
            __openclaw?: { seq?: number };
          }
        ).__openclaw?.seq,
      ).toBe(2);

      const appended = state.appendInlineMessage({
        message: {
          role: "assistant",
          content: [{ type: "text", text: "next message" }],
        },
      });

      expect(appended?.messageSeq).toBe(3);
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
    }
  });

  test("reuses one canonical array for items and messages", () => {
    const snapshot = buildSessionHistorySnapshot({
      rawMessages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "first" }],
          __openclaw: { seq: 1 },
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "second" }],
          __openclaw: { seq: 2 },
        },
      ],
      limit: 1,
    });

    expect(snapshot.history.items).toBe(snapshot.history.messages);
    expect(snapshot.history.messages[0]?.__openclaw?.seq).toBe(2);
    expect(snapshot.rawTranscriptSeq).toBe(2);
  });

  test("filters mixed system-line plus heartbeat prompt entries from snapshot history", () => {
    const snapshot = buildSessionHistorySnapshot({
      rawMessages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "System: [2026-04-17 12:20:33 AKDT] Gateway restart restart ok\n" +
                "System: [2026-04-17 12:20:33 AKDT] Run: openclaw doctor --non-interactive\n\n" +
                HEARTBEAT_PROMPT,
            },
          ],
          __openclaw: { seq: 1 },
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "HEARTBEAT_OK" }],
          __openclaw: { seq: 2 },
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "kept" }],
          __openclaw: { seq: 3 },
        },
      ],
    });

    expect(snapshot.history.messages).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "kept" }],
        __openclaw: { seq: 3 },
      },
    ]);
    expect(snapshot.rawTranscriptSeq).toBe(3);
  });

  test("strips inbound envelopes from snapshot history messages", () => {
    const snapshot = buildSessionHistorySnapshot({
      rawMessages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: 'Sender (untrusted metadata):\n```json\n{"label":"openclaw-control-ui"}\n```\n\n[Sun 2026-04-19 10:08 AKDT] Does this look correct?',
            },
          ],
          __openclaw: { seq: 1 },
        },
      ],
    });

    expect(snapshot.history.messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Does this look correct?" }],
        senderLabel: "openclaw-control-ui",
        __openclaw: { seq: 1 },
      },
    ]);
  });

  test("truncates visible session-history text after stripping inbound envelopes", () => {
    const snapshot = buildSessionHistorySnapshot({
      rawMessages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                'Sender (untrusted metadata):\n```json\n{"label":"openclaw-control-ui","context":"' +
                "x".repeat(200) +
                '"}\n```\n\n[Sun 2026-04-19 10:08 AKDT] Actual body that should survive truncation',
            },
          ],
          __openclaw: { seq: 1 },
        },
      ],
      maxChars: 10,
    });

    expect(snapshot.history.messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Actual bod\n...(truncated)..." }],
        senderLabel: "openclaw-control-ui",
        __openclaw: { seq: 1 },
      },
    ]);
  });

  test("filters punctuated heartbeat-only assistant acks from snapshot history", () => {
    const snapshot = buildSessionHistorySnapshot({
      rawMessages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "HEARTBEAT_OK." }],
          __openclaw: { seq: 1 },
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "kept" }],
          __openclaw: { seq: 2 },
        },
      ],
    });

    expect(snapshot.history.messages).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "kept" }],
        __openclaw: { seq: 2 },
      },
    ]);
  });

  test("strips inbound envelopes from inline appended messages", () => {
    const state = SessionHistorySseState.fromRawSnapshot({
      target: { sessionId: "sess-main" },
      rawMessages: [],
    });

    const appended = state.appendInlineMessage({
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text: 'Sender (untrusted metadata):\n```json\n{"label":"openclaw-control-ui"}\n```\n\n[Sun 2026-04-19 10:08 AKDT] Does this look correct?',
          },
        ],
      },
    });

    expect(appended?.message).toEqual({
      role: "user",
      content: [{ type: "text", text: "Does this look correct?" }],
      senderLabel: "openclaw-control-ui",
      __openclaw: { seq: 1 },
    });
    expect(state.snapshot().messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Does this look correct?" }],
        senderLabel: "openclaw-control-ui",
        __openclaw: { seq: 1 },
      },
    ]);
  });

  test("truncates visible inline session-history text after stripping inbound envelopes", () => {
    const state = SessionHistorySseState.fromRawSnapshot({
      target: { sessionId: "sess-main" },
      rawMessages: [],
      maxChars: 10,
    });

    const appended = state.appendInlineMessage({
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text:
              'Sender (untrusted metadata):\n```json\n{"label":"openclaw-control-ui","context":"' +
              "x".repeat(200) +
              '"}\n```\n\n[Sun 2026-04-19 10:08 AKDT] Actual body that should survive truncation',
          },
        ],
      },
    });

    expect(appended?.message).toEqual({
      role: "user",
      content: [{ type: "text", text: "Actual bod\n...(truncated)..." }],
      senderLabel: "openclaw-control-ui",
      __openclaw: { seq: 1 },
    });
  });

  test("filters inline appended mixed system-line plus heartbeat entries", () => {
    const state = SessionHistorySseState.fromRawSnapshot({
      target: { sessionId: "sess-main" },
      rawMessages: [],
    });

    const appendedUser = state.appendInlineMessage({
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "System: [2026-04-17 12:20:33 AKDT] Gateway restart restart ok\n\n" +
              HEARTBEAT_PROMPT,
          },
        ],
      },
    });
    const appendedAck = state.appendInlineMessage({
      message: {
        role: "assistant",
        content: [{ type: "text", text: "HEARTBEAT_OK" }],
      },
    });
    const appendedReply = state.appendInlineMessage({
      message: {
        role: "assistant",
        content: [{ type: "text", text: "kept" }],
      },
    });

    expect(appendedUser).toBeNull();
    expect(appendedAck).toBeNull();
    expect(appendedReply?.message).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "kept" }],
      __openclaw: { seq: 3 },
    });
    expect(state.snapshot().messages).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "kept" }],
        __openclaw: { seq: 3 },
      },
    ]);
  });
});
