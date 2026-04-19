import { describe, expect, test } from "vitest";
import { sanitizeEmotionTagsForMode, stripEmotionTags } from "./emotion-tags.js";

describe("stripEmotionTags", () => {
  test("does not strip inline directive tags", () => {
    const onlyDirective = stripEmotionTags("[[audio_as_voice]]");
    const mixed = stripEmotionTags("[[audio_as_voice]] [warmly] hello");

    expect(onlyDirective).toEqual({ text: "[[audio_as_voice]]", changed: false });
    expect(mixed).toEqual({ text: "[[audio_as_voice]] hello", changed: true });
  });

  test("does not strip bracketed technical content", () => {
    const regex = stripEmotionTags("Use [A-Z] in the regex");
    const version = stripEmotionTags("Look for [v1.2] in the changelog");

    expect(regex).toEqual({ text: "Use [A-Z] in the regex", changed: false });
    expect(version).toEqual({ text: "Look for [v1.2] in the changelog", changed: false });
  });

  test("strips uppercase emotion tags while preserving bracketed technical content", () => {
    const uppercase = stripEmotionTags("[Warmly] hello there");
    const technical = stripEmotionTags("Keep [SOFTLY_TYPED] as a literal token");

    expect(uppercase).toEqual({ text: "hello there", changed: true });
    expect(technical).toEqual({
      text: "Keep [SOFTLY_TYPED] as a literal token",
      changed: false,
    });
  });
});

describe("sanitizeEmotionTagsForMode", () => {
  test("hides trailing partial tags in full mode without removing complete tags", () => {
    const result = sanitizeEmotionTagsForMode("[warmly] hello [soft", "full", {
      allowTrailingPartialTag: true,
    });

    expect(result).toEqual({ text: "[warmly] hello ", changed: true });
  });

  test("hides a bare trailing bracket during streaming", () => {
    const result = sanitizeEmotionTagsForMode("hello [", "on", {
      allowTrailingPartialTag: true,
    });

    expect(result).toEqual({ text: "hello ", changed: true });
  });
});
