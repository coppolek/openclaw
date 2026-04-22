import { getReplyPayloadMetadata, setReplyPayloadMetadata } from "openclaw/plugin-sdk/reply-payload";
import { describe, expect, it } from "vitest";
import { appendUnscheduledReminderNote, UNSCHEDULED_REMINDER_NOTE } from "./agent-runner-reminder-guard.js";

describe("appendUnscheduledReminderNote", () => {
  it("preserves TTS metadata when appending the unscheduled reminder note", () => {
    const payload = setReplyPayloadMetadata(
      { text: "I'll remind you tomorrow morning." },
      { ttsSourceText: "[Warmly] I'll remind you tomorrow morning." },
    );

    const updated = appendUnscheduledReminderNote([payload]);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.text).toBe(`I'll remind you tomorrow morning.\n\n${UNSCHEDULED_REMINDER_NOTE}`);
    if (!updated[0]) {
      throw new Error("expected payload");
    }
    expect(getReplyPayloadMetadata(updated[0])).toEqual({
      ttsSourceText: "[Warmly] I'll remind you tomorrow morning.",
    });
  });
});
