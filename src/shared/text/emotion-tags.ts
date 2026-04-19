import type { EmotionMode } from "../../emotion-mode.js";
import { findCodeRegions, isInsideCode } from "./code-regions.js";

const EMOTION_TAG_RE = /\[([A-Za-z]+(?:[ /-][A-Za-z]+){0,7})\](?!\()/g;
const TRAILING_EMOTION_TAG_RE = /\[[A-Za-z]+(?:[ /-][A-Za-z]+){0,7}$/u;
const EMOTION_TAG_WORDS = new Set([
  "amused",
  "angry",
  "anxious",
  "apologetic",
  "astonished",
  "awed",
  "awkwardly",
  "breathless",
  "brightly",
  "calm",
  "careful",
  "cheerfully",
  "chuckles",
  "clear",
  "confident",
  "curious",
  "deadpan",
  "direct",
  "disappointed",
  "distant",
  "dramatic",
  "dryly",
  "embarrassed",
  "empathetic",
  "encouraging",
  "energetic",
  "exhales",
  "excited",
  "fast",
  "fearful",
  "firmly",
  "flatly",
  "frustrated",
  "gasps",
  "guilty",
  "hesitates",
  "interested",
  "irritated",
  "laughs",
  "lonely",
  "measured",
  "mischievously",
  "nervous",
  "panicked",
  "pauses",
  "playfully",
  "polished",
  "proudly",
  "quietly",
  "quizzically",
  "realizing",
  "relieved",
  "sad",
  "sarcastic",
  "serious",
  "shaken",
  "sharp",
  "sighs",
  "sincere",
  "skeptical",
  "slow",
  "slowly",
  "softly",
  "sorrowful",
  "steady",
  "surprised",
  "tenderly",
  "tense",
  "thoughtful",
  "voice",
  "breaking",
  "warmly",
  "whispers",
]);

type StripEmotionTagsOptions = {
  allowTrailingPartialTag?: boolean;
};

export type StripEmotionTagsResult = {
  text: string;
  changed: boolean;
};

function replacementPreservesWordBoundary(source: string, offset: number, length: number): string {
  const before = source[offset - 1];
  const after = source[offset + length];
  return before && after && !/\s/u.test(before) && !/\s/u.test(after) ? " " : "";
}

function isEmotionTagBoundary(char: string | undefined, side: "before" | "after"): boolean {
  if (!char) {
    return true;
  }
  if (side === "before") {
    return /[\s({>"'`]/u.test(char);
  }
  return /[\s.,!?;:)\]}>/"'`-]/u.test(char);
}

function isLikelyEmotionTag(text: string, index: number, rawTag: string, body: string): boolean {
  if (body.includes("  ")) {
    return false;
  }
  const trimmedBody = body.trim();
  if (!trimmedBody || /^(?:https?|www)\b/i.test(trimmedBody)) {
    return false;
  }
  const words = trimmedBody
    .split(/[ /-]+/u)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
  if (words.length === 0 || words.some((word) => !EMOTION_TAG_WORDS.has(word))) {
    return false;
  }
  const before = index > 0 ? text[index - 1] : undefined;
  const after = text[index + rawTag.length];
  return isEmotionTagBoundary(before, "before") && isEmotionTagBoundary(after, "after");
}

function stripTrailingPartialEmotionTag(text: string): StripEmotionTagsResult {
  if (!text.endsWith("[") && !TRAILING_EMOTION_TAG_RE.test(text)) {
    return { text, changed: false };
  }
  if (text.endsWith("[")) {
    const index = text.length - 1;
    const before = index > 0 ? text[index - 1] : undefined;
    if (!isEmotionTagBoundary(before, "before")) {
      return { text, changed: false };
    }
    const replacement = replacementPreservesWordBoundary(text, index, 1);
    return {
      text: text.slice(0, index) + replacement,
      changed: true,
    };
  }
  const trailingMatch = TRAILING_EMOTION_TAG_RE.exec(text);
  if (!trailingMatch || trailingMatch.index === undefined) {
    return { text, changed: false };
  }
  const before = trailingMatch.index > 0 ? text[trailingMatch.index - 1] : undefined;
  if (!isEmotionTagBoundary(before, "before")) {
    return { text, changed: false };
  }
  const replacement = replacementPreservesWordBoundary(
    text,
    trailingMatch.index,
    trailingMatch[0].length,
  );
  return {
    text: text.slice(0, trailingMatch.index) + replacement,
    changed: true,
  };
}

export function stripEmotionTags(
  text: string,
  options: StripEmotionTagsOptions = {},
): StripEmotionTagsResult {
  if (!text || !text.includes("[")) {
    return { text, changed: false };
  }

  const codeRegions = findCodeRegions(text);
  let changed = false;
  let result = "";
  let cursor = 0;

  for (const match of text.matchAll(EMOTION_TAG_RE)) {
    const index = match.index ?? 0;
    if (isInsideCode(index, codeRegions)) {
      continue;
    }
    const [rawTag, body] = match;
    if (!isLikelyEmotionTag(text, index, rawTag, body)) {
      continue;
    }
    result += text.slice(cursor, index);
    const replacement = replacementPreservesWordBoundary(text, index, rawTag.length);
    result += replacement;
    let nextCursor = index + rawTag.length;
    const before = index > 0 ? text[index - 1] : undefined;
    const after = text[nextCursor];
    const alreadySeparated =
      index === 0 || replacement === " " || (before ? /\s/u.test(before) : false);
    if (alreadySeparated && after && /\s/u.test(after)) {
      nextCursor += 1;
    }
    cursor = nextCursor;
    changed = true;
  }

  if (!changed) {
    if (!options.allowTrailingPartialTag) {
      return { text, changed: false };
    }
    return stripTrailingPartialEmotionTag(text);
  }

  result += text.slice(cursor);
  if (!options.allowTrailingPartialTag) {
    return { text: result, changed };
  }
  const trailing = stripTrailingPartialEmotionTag(result);
  return {
    text: trailing.text,
    changed: changed || trailing.changed,
  };
}

export function sanitizeEmotionTagsForMode(
  text: string,
  mode: EmotionMode | undefined,
  options: StripEmotionTagsOptions = {},
): StripEmotionTagsResult {
  if (mode === "full") {
    if (!options.allowTrailingPartialTag) {
      return { text, changed: false };
    }
    return stripTrailingPartialEmotionTag(text);
  }
  return stripEmotionTags(text, options);
}
