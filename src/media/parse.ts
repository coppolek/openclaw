// Shared helpers for parsing MEDIA tokens from command/stdout text.

import { parseFenceSpans } from "../markdown/fences.js";
import { parseAudioTag } from "./audio-tags.js";

// Allow optional wrapping backticks and punctuation after the token; capture the core token.
export const MEDIA_TOKEN_RE = /\bMEDIA:\s*`?([^\n]+)`?/g;

export type ParsedMediaOutputSegment =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "media";
      url: string;
    };

export function normalizeMediaSource(src: string) {
  return src.startsWith("file://") ? src.replace("file://", "") : src;
}

function cleanCandidate(raw: string) {
  return raw.replace(/^[`"'[{(]+/, "").replace(/[`"'\\})\],]+$/, "");
}

const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const HAS_FILE_EXT = /\.\w{1,10}$/;

// Matches ".." as a standalone path segment (start, middle, or end).
const TRAVERSAL_SEGMENT_RE = /(?:^|[/\\])\.\.(?:[/\\]|$)/;

function hasTraversalOrHomeDirPrefix(candidate: string): boolean {
  return (
    candidate.startsWith("../") ||
    candidate === ".." ||
    candidate.startsWith("~") ||
    TRAVERSAL_SEGMENT_RE.test(candidate)
  );
}

// Broad structural check: does this look like a local file path? Used only for
// stripping MEDIA: lines from output text — never for media approval.
function looksLikeLocalFilePath(candidate: string): boolean {
  return (
    candidate.startsWith("/") ||
    candidate.startsWith("./") ||
    candidate.startsWith("../") ||
    candidate.startsWith("~") ||
    WINDOWS_DRIVE_RE.test(candidate) ||
    candidate.startsWith("\\\\") ||
    (!SCHEME_RE.test(candidate) && (candidate.includes("/") || candidate.includes("\\")))
  );
}

// Recognize safe local file path patterns for media approval, rejecting
// traversal and home-dir paths so they never reach downstream load/send logic.
function isLikelyLocalPath(candidate: string): boolean {
  if (hasTraversalOrHomeDirPrefix(candidate)) {
    return false;
  }
  return (
    candidate.startsWith("/") ||
    candidate.startsWith("./") ||
    WINDOWS_DRIVE_RE.test(candidate) ||
    candidate.startsWith("\\\\") ||
    (!SCHEME_RE.test(candidate) && (candidate.includes("/") || candidate.includes("\\")))
  );
}

function isValidMedia(
  candidate: string,
  opts?: { allowSpaces?: boolean; allowBareFilename?: boolean },
) {
  if (!candidate) {
    return false;
  }
  if (candidate.length > 4096) {
    return false;
  }
  if (!opts?.allowSpaces && /\s/.test(candidate)) {
    return false;
  }
  if (/^https?:\/\//i.test(candidate)) {
    return true;
  }

  if (isLikelyLocalPath(candidate)) {
    return true;
  }

  // Hard reject traversal/home-dir patterns before the bare-filename fallback
  // to prevent path traversal bypasses (e.g. "../../.env" matching HAS_FILE_EXT).
  if (hasTraversalOrHomeDirPrefix(candidate)) {
    return false;
  }

  // Accept bare filenames (e.g. "image.png") only when the caller opts in.
  // This avoids treating space-split path fragments as separate media items.
  if (opts?.allowBareFilename && !SCHEME_RE.test(candidate) && HAS_FILE_EXT.test(candidate)) {
    return true;
  }

  return false;
}

function unwrapQuoted(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return undefined;
  }
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (first !== last) {
    return undefined;
  }
  if (first !== `"` && first !== "'" && first !== "`") {
    return undefined;
  }
  return trimmed.slice(1, -1).trim();
}

function mayContainFenceMarkers(input: string): boolean {
  return input.includes("```") || input.includes("~~~");
}

// Check if a character offset is inside any fenced code block
function isInsideFence(fenceSpans: Array<{ start: number; end: number }>, offset: number): boolean {
  return fenceSpans.some((span) => offset >= span.start && offset < span.end);
}

/**
 * Heuristic: detect whether a line is likely part of a top-level indented
 * code block.  Requires 4+ leading spaces or a tab AND the preceding line
 * was blank or itself an indented-code line (prevents interrupting a
 * paragraph).
 *
 * This is a practical approximation, NOT a full CommonMark parser.
 * Known gaps: container context (list / blockquote indentation) is not
 * tracked, so deeply indented list continuations may be mis-classified.
 * The trade-off favours false positives (skip extraction from a non-code
 * line) over false negatives (extract MEDIA from a code line).
 */
function isIndentedCodeLine(line: string, prevLineBlankOrCode: boolean): boolean {
  return prevLineBlankOrCode && /^(?:    |\t)/.test(line);
}

export function splitMediaFromOutput(raw: string): {
  text: string;
  mediaUrls?: string[];
  mediaUrl?: string; // legacy first item for backward compatibility
  audioAsVoice?: boolean; // true if [[audio_as_voice]] tag was found
  segments?: ParsedMediaOutputSegment[];
} {
  // KNOWN: Leading whitespace is semantically meaningful in Markdown (lists, indented fences).
  // We only trim the end; token cleanup below handles removing `MEDIA:` lines.
  const trimmedRaw = raw.trimEnd();
  if (!trimmedRaw.trim()) {
    return { text: "" };
  }
  const mayContainMediaToken = /media:/i.test(trimmedRaw);
  const mayContainAudioTag = trimmedRaw.includes("[[");
  if (!mayContainMediaToken && !mayContainAudioTag) {
    return { text: trimmedRaw };
  }

  const media: string[] = [];
  let foundMediaToken = false;
  const segments: ParsedMediaOutputSegment[] = [];

  const pushTextSegment = (text: string) => {
    if (!text) {
      return;
    }
    const last = segments[segments.length - 1];
    if (last?.type === "text") {
      last.text = `${last.text}\n${text}`;
      return;
    }
    segments.push({ type: "text", text });
  };

  // Parse fenced code blocks to avoid extracting MEDIA tokens from inside them
  const hasFenceMarkers = mayContainFenceMarkers(trimmedRaw);
  const fenceSpans = hasFenceMarkers ? parseFenceSpans(trimmedRaw) : [];

  // Collect tokens line by line so we can strip them cleanly.
  const lines = trimmedRaw.split("\n");
  const keptLines: string[] = [];
  const keptLineIsCode: boolean[] = [];

  let lineOffset = 0; // Track character offset for fence checking
  let prevLineBlankOrIndentedCode = true; // document start counts as "preceded by blank"
  for (const line of lines) {
    const isBlank = line.trim() === "";
    const isIndented = isIndentedCodeLine(line, prevLineBlankOrIndentedCode);

    // Skip MEDIA extraction if this line is inside a fenced code block
    if (hasFenceMarkers && isInsideFence(fenceSpans, lineOffset)) {
      keptLines.push(line);
      keptLineIsCode.push(true);
      pushTextSegment(line);
      lineOffset += line.length + 1; // +1 for newline
      // Exiting a fenced block is a block boundary: next line can start
      // an indented code block without a preceding blank line.
      prevLineBlankOrIndentedCode = true;
      continue;
    }

    // Skip MEDIA extraction if this line is inside an indented code block
    if (isIndented) {
      keptLines.push(line);
      keptLineIsCode.push(true);
      pushTextSegment(line);
      lineOffset += line.length + 1;
      prevLineBlankOrIndentedCode = true;
      continue;
    }

    const trimmedStart = line.trimStart();
    if (!trimmedStart.toUpperCase().startsWith("MEDIA:")) {
      keptLines.push(line);
      keptLineIsCode.push(false);
      pushTextSegment(line);
      lineOffset += line.length + 1; // +1 for newline
      prevLineBlankOrIndentedCode = isBlank;
      continue;
    }

    const matches = Array.from(line.matchAll(MEDIA_TOKEN_RE));
    if (matches.length === 0) {
      keptLines.push(line);
      keptLineIsCode.push(false);
      pushTextSegment(line);
      lineOffset += line.length + 1; // +1 for newline
      prevLineBlankOrIndentedCode = isBlank;
      continue;
    }

    const pieces: string[] = [];
    const lineSegments: ParsedMediaOutputSegment[] = [];
    let cursor = 0;

    for (const match of matches) {
      const start = match.index ?? 0;
      pieces.push(line.slice(cursor, start));

      const payload = match[1];
      const unwrapped = unwrapQuoted(payload);
      const payloadValue = unwrapped ?? payload;
      const parts = unwrapped ? [unwrapped] : payload.split(/\s+/).filter(Boolean);
      const mediaStartIndex = media.length;
      let validCount = 0;
      const invalidParts: string[] = [];
      let hasValidMedia = false;
      for (const part of parts) {
        const candidate = normalizeMediaSource(cleanCandidate(part));
        if (isValidMedia(candidate, unwrapped ? { allowSpaces: true } : undefined)) {
          media.push(candidate);
          hasValidMedia = true;
          foundMediaToken = true;
          validCount += 1;
        } else {
          invalidParts.push(part);
        }
      }

      const trimmedPayload = payloadValue.trim();
      const looksLikeLocalPath =
        looksLikeLocalFilePath(trimmedPayload) || trimmedPayload.startsWith("file://");
      if (
        !unwrapped &&
        validCount === 1 &&
        invalidParts.length > 0 &&
        /\s/.test(payloadValue) &&
        looksLikeLocalPath
      ) {
        const fallback = normalizeMediaSource(cleanCandidate(payloadValue));
        if (isValidMedia(fallback, { allowSpaces: true })) {
          media.splice(mediaStartIndex, media.length - mediaStartIndex, fallback);
          hasValidMedia = true;
          foundMediaToken = true;
          validCount = 1;
          invalidParts.length = 0;
        }
      }

      if (!hasValidMedia && !unwrapped && /\s/.test(payloadValue)) {
        const spacedFallback = normalizeMediaSource(cleanCandidate(payloadValue));
        if (isValidMedia(spacedFallback, { allowSpaces: true, allowBareFilename: true })) {
          media.splice(mediaStartIndex, media.length - mediaStartIndex, spacedFallback);
          hasValidMedia = true;
          foundMediaToken = true;
          validCount = 1;
          invalidParts.length = 0;
        }
      }

      if (!hasValidMedia) {
        const fallback = normalizeMediaSource(cleanCandidate(payloadValue));
        if (isValidMedia(fallback, { allowSpaces: true, allowBareFilename: true })) {
          media.push(fallback);
          hasValidMedia = true;
          foundMediaToken = true;
          invalidParts.length = 0;
        }
      }

      if (hasValidMedia) {
        const beforeText = pieces
          .join("")
          .replace(/[ \t]{2,}/g, " ")
          .trim();
        if (beforeText) {
          lineSegments.push({ type: "text", text: beforeText });
        }
        pieces.length = 0;
        for (const url of media.slice(mediaStartIndex, mediaStartIndex + validCount)) {
          lineSegments.push({ type: "media", url });
        }
        if (invalidParts.length > 0) {
          pieces.push(invalidParts.join(" "));
        }
      } else if (looksLikeLocalPath) {
        // Strip MEDIA: lines with local paths even when invalid (e.g. absolute paths
        // from internal tools like TTS). They should never leak as visible text.
        foundMediaToken = true;
      } else {
        // If no valid media was found in this match, keep the original token text.
        pieces.push(match[0]);
      }

      cursor = start + match[0].length;
    }

    pieces.push(line.slice(cursor));

    const cleanedLine = pieces
      .join("")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

    // If the line becomes empty, drop it.
    if (cleanedLine) {
      keptLines.push(cleanedLine);
      keptLineIsCode.push(false);
      lineSegments.push({ type: "text", text: cleanedLine });
    }
    for (const segment of lineSegments) {
      if (segment.type === "text") {
        pushTextSegment(segment.text);
        continue;
      }
      segments.push(segment);
    }
    lineOffset += line.length + 1; // +1 for newline
    prevLineBlankOrIndentedCode = false;
  }

  let cleanedText = keptLines
    .map((line, i) =>
      keptLineIsCode[i]
        ? line
        : line.replace(/[ \t]+$/, "").replace(/[ \t]{2,}/g, " "),
    )
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/^\n+/, "")
    .trimEnd();

  // Detect and strip [[audio_as_voice]] tag
  const audioTagResult = parseAudioTag(cleanedText);
  const hasAudioAsVoice = audioTagResult.audioAsVoice;
  if (audioTagResult.hadTag) {
    cleanedText = audioTagResult.text.replace(/\n{2,}/g, "\n").replace(/^\n+/, "").trimEnd();
  }

  if (media.length === 0) {
    const parsedText = foundMediaToken || hasAudioAsVoice ? cleanedText : trimmedRaw;
    const result: ReturnType<typeof splitMediaFromOutput> = {
      text: parsedText,
      segments: parsedText ? [{ type: "text", text: parsedText }] : [],
    };
    if (hasAudioAsVoice) {
      result.audioAsVoice = true;
    }
    return result;
  }

  return {
    text: cleanedText,
    mediaUrls: media,
    mediaUrl: media[0],
    segments: segments.length > 0 ? segments : [{ type: "text", text: cleanedText }],
    ...(hasAudioAsVoice ? { audioAsVoice: true } : {}),
  };
}
