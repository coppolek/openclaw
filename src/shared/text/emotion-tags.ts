import type { EmotionMode } from "../../emotion-mode.js";
import { findCodeRegions, isInsideCode } from "./code-regions.js";

const EMOTION_TAG_RE = /\[([A-Za-z][A-Za-z0-9 _/-]{0,47})\](?!\()/g;

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
  const before = index > 0 ? text[index - 1] : undefined;
  const after = text[index + rawTag.length];
  return isEmotionTagBoundary(before, "before") && isEmotionTagBoundary(after, "after");
}

function stripTrailingPartialEmotionTag(text: string): StripEmotionTagsResult {
  if (!text.endsWith("[") && !/\[[A-Za-z][A-Za-z0-9 _/-]*$/u.test(text)) {
    return { text, changed: false };
  }
  const trailingMatch = /\[[A-Za-z][A-Za-z0-9 _/-]*$/u.exec(text);
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
