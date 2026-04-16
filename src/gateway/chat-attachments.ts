import type { OpenClawConfig } from "../config/types.openclaw.js";
import { formatErrorMessage } from "../infra/errors.js";
import { estimateBase64DecodedBytes } from "../media/base64.js";
import { MAX_IMAGE_BYTES } from "../media/constants.js";
import { extensionForMime, mimeTypeFromFilePath } from "../media/mime.js";
import type { PromptImageOrderEntry } from "../media/prompt-image-order.js";
import { sniffMimeFromBase64 } from "../media/sniff-mime-from-base64.js";
import { deleteMediaBuffer, saveMediaBuffer } from "../media/store.js";
import { normalizeOptionalLowercaseString } from "../shared/string-coerce.js";

export type ChatAttachment = {
  type?: string;
  mimeType?: string;
  fileName?: string;
  content?: unknown;
};

export type ChatImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type OffloadedRef = {
  mediaRef: string;
  id: string;
  path: string;
  mimeType: string;
  label: string;
  sizeBytes: number;
};

export type ParsedMessageWithImages = {
  message: string;
  images: ChatImageContent[];
  imageOrder: PromptImageOrderEntry[];
  offloadedRefs: OffloadedRef[];
};

type AttachmentLog = {
  info?: (message: string) => void;
  warn: (message: string) => void;
};

type NormalizedAttachment = {
  label: string;
  mime: string;
  base64: string;
};

type SavedMedia = {
  id: string;
  path: string;
};

const OFFLOAD_THRESHOLD_BYTES = 2_000_000;

// Gateway RPC entrypoints (chat.send, agent.run, node-events) have no channel
// or account in scope, so they cannot walk the usual per-channel mediaMaxMb
// chain. They follow the global `agents.defaults.mediaMaxMb` so a user who
// raises their per-agent cap sees the same cap on direct RPC inputs. Fallback
// is 20MB — the middle of the per-channel defaults (Slack/GoogleChat/iMessage
// are 16–20MB), not the legacy 5MB which was a pre-"any MIME" image-era value.
export const DEFAULT_CHAT_ATTACHMENT_MAX_MB = 20;

export function resolveChatAttachmentMaxBytes(cfg: OpenClawConfig): number {
  const configured = cfg.agents?.defaults?.mediaMaxMb;
  const mb =
    typeof configured === "number" && Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_CHAT_ATTACHMENT_MAX_MB;
  return Math.floor(mb * 1024 * 1024);
}

// `unsupported-non-image` is transitional: agent.run + node-events callers
// will be removed once they wire ctx.MediaPaths.
export type UnsupportedAttachmentReason =
  | "empty-payload"
  | "text-only-image"
  | "unsupported-non-image"
  | "non-image-too-large-for-sandbox";

/** Client-side attachment refusal — maps to 4xx INVALID_REQUEST. */
export class UnsupportedAttachmentError extends Error {
  readonly reason: UnsupportedAttachmentReason;
  constructor(reason: UnsupportedAttachmentReason, message: string) {
    super(message);
    this.name = "UnsupportedAttachmentError";
    this.reason = reason;
  }
}

/** Media-store persistence failure (ENOSPC, EPERM, …) — maps to 5xx UNAVAILABLE. */
export class MediaOffloadError extends Error {
  readonly cause: unknown;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaOffloadError";
    this.cause = options?.cause;
  }
}

function normalizeMime(mime?: string): string | undefined {
  if (!mime) {
    return undefined;
  }
  const cleaned = normalizeOptionalLowercaseString(mime.split(";")[0]);
  return cleaned || undefined;
}

function isImageMime(mime?: string): boolean {
  return typeof mime === "string" && mime.startsWith("image/");
}

// OOXML containers (docx/xlsx/pptx) sniff as application/zip and bare octet
// payloads sniff as application/octet-stream. Treat both as "unspecific" so
// a more specific provided MIME or filename extension wins. Mirrors
// detectMime's isGenericMime guard in src/media/mime.ts.
function isGenericContainerMime(mime?: string): boolean {
  return mime === "application/zip" || mime === "application/octet-stream";
}

function isValidBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) {
    return false;
  }
  // A full O(n) regex scan is safe: no overlapping quantifiers, fails linearly.
  // Prevents adversarial payloads padded with megabytes of whitespace from
  // bypassing length thresholds.
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

// Buffer.from silently drops invalid base64 chars; this catches truncated
// payloads before they hit disk. MUST be called outside the MediaOffloadError
// try/catch so corrupt-input errors stay 4xx, not 5xx.
function verifyDecodedSize(buffer: Buffer, estimatedBytes: number, label: string): void {
  if (Math.abs(buffer.byteLength - estimatedBytes) > 3) {
    throw new Error(
      `attachment ${label}: base64 contains invalid characters ` +
        `(expected ~${estimatedBytes} bytes decoded, got ${buffer.byteLength})`,
    );
  }
}

function ensureExtension(label: string, mime: string): string {
  if (/\.[a-zA-Z0-9]+$/.test(label)) {
    return label;
  }
  const ext = extensionForMime(mime) ?? "";
  return ext ? `${label}${ext}` : label;
}

function assertSavedMedia(value: unknown, label: string): SavedMedia {
  if (
    value === null ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof (value as Record<string, unknown>).id !== "string"
  ) {
    throw new Error(`attachment ${label}: saveMediaBuffer returned an unexpected shape`);
  }
  const id = (value as Record<string, unknown>).id as string;
  if (id.length === 0) {
    throw new Error(`attachment ${label}: saveMediaBuffer returned an empty media ID`);
  }
  if (id.includes("/") || id.includes("\\") || id.includes("\0")) {
    throw new Error(
      `attachment ${label}: saveMediaBuffer returned an unsafe media ID ` +
        `(contains path separator or null byte)`,
    );
  }
  const path = (value as Record<string, unknown>).path;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`attachment ${label}: saveMediaBuffer returned no on-disk path`);
  }
  return { id, path };
}

function normalizeAttachment(
  att: ChatAttachment,
  idx: number,
  opts: { stripDataUrlPrefix: boolean; requireImageMime: boolean },
): NormalizedAttachment {
  const mime = att.mimeType ?? "";
  const content = att.content;
  const label = att.fileName || att.type || `attachment-${idx + 1}`;

  if (typeof content !== "string") {
    throw new Error(`attachment ${label}: content must be base64 string`);
  }
  if (opts.requireImageMime && !mime.startsWith("image/")) {
    throw new Error(`attachment ${label}: only image/* supported`);
  }

  let base64 = content.trim();
  if (opts.stripDataUrlPrefix) {
    const dataUrlMatch = /^data:[^;]+;base64,(.*)$/.exec(base64);
    if (dataUrlMatch) {
      base64 = dataUrlMatch[1];
    }
  }
  return { label, mime, base64 };
}

function validateAttachmentBase64OrThrow(
  normalized: NormalizedAttachment,
  opts: { maxBytes: number },
): number {
  if (!isValidBase64(normalized.base64)) {
    throw new Error(`attachment ${normalized.label}: invalid base64 content`);
  }
  const sizeBytes = estimateBase64DecodedBytes(normalized.base64);
  if (sizeBytes <= 0 || sizeBytes > opts.maxBytes) {
    throw new Error(
      `attachment ${normalized.label}: exceeds size limit (${sizeBytes} > ${opts.maxBytes} bytes)`,
    );
  }
  return sizeBytes;
}

// Parses Gateway RPC attachments into inline image blocks and media-store
// offloads, mirroring the channel inbound path. Throws UnsupportedAttachmentError
// (4xx), MediaOffloadError (5xx), or plain Error (base64/size — 4xx). Best-
// effort cleans up partial offloads on throw.
//
// `supportsInlineImages: false` rejects image attachments only; non-images
// still flow to offload so text-only models can read them via Bash/Read.
// `acceptNonImage: false` rejects non-image attachments outright (use for
// callers that have not yet wired ctx.MediaPaths).
export async function parseMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: {
    maxBytes?: number;
    log?: AttachmentLog;
    supportsInlineImages?: boolean;
    acceptNonImage?: boolean;
  },
): Promise<ParsedMessageWithImages> {
  const maxBytes = opts?.maxBytes ?? DEFAULT_CHAT_ATTACHMENT_MAX_MB * 1024 * 1024;
  const log = opts?.log;
  const supportsInlineImages = opts?.supportsInlineImages !== false;
  const acceptNonImage = opts?.acceptNonImage !== false;

  if (!attachments || attachments.length === 0) {
    return { message, images: [], imageOrder: [], offloadedRefs: [] };
  }

  const images: ChatImageContent[] = [];
  const imageOrder: PromptImageOrderEntry[] = [];
  const offloadedRefs: OffloadedRef[] = [];
  let updatedMessage = message;

  // Track IDs of files saved during this request for cleanup if a later
  // attachment fails validation and the entire parse is aborted.
  const savedMediaIds: string[] = [];

  try {
    for (const [idx, att] of attachments.entries()) {
      if (!att) {
        continue;
      }

      const normalized = normalizeAttachment(att, idx, {
        stripDataUrlPrefix: true,
        requireImageMime: false,
      });

      const { base64: b64, label, mime } = normalized;

      // Empty content is a client-side validation refusal, not "malformed
      // base64" — report it with the more specific reason so callers can
      // distinguish "you sent nothing" from "you sent garbage".
      if (b64.length === 0) {
        throw new UnsupportedAttachmentError("empty-payload", `attachment ${label}: empty payload`);
      }

      if (!isValidBase64(b64)) {
        throw new Error(`attachment ${label}: invalid base64 content`);
      }

      const sizeBytes = estimateBase64DecodedBytes(b64);
      if (sizeBytes > maxBytes) {
        throw new Error(
          `attachment ${label}: exceeds size limit (${sizeBytes} > ${maxBytes} bytes)`,
        );
      }

      const providedMime = normalizeMime(mime);
      const sniffedMime = normalizeMime(await sniffMimeFromBase64(b64));
      const labelMime = normalizeMime(mimeTypeFromFilePath(label));

      // Prefer specific MIME signals over generic container types. OOXML
      // documents (docx/xlsx/pptx) sniff as application/zip; without this
      // priority the agent would receive a `.zip` instead of the specific
      // Office document the caller declared.
      const finalMime =
        (sniffedMime && !isGenericContainerMime(sniffedMime) && sniffedMime) ||
        (providedMime && !isGenericContainerMime(providedMime) && providedMime) ||
        (labelMime && !isGenericContainerMime(labelMime) && labelMime) ||
        sniffedMime ||
        providedMime ||
        labelMime ||
        "application/octet-stream";

      if (sniffedMime && providedMime && sniffedMime !== providedMime) {
        const usedSource = finalMime === sniffedMime ? "sniffed" : "provided";
        log?.warn(
          `attachment ${label}: mime mismatch (${providedMime} -> ${sniffedMime}), using ${usedSource}`,
        );
      }
      const isImage = isImageMime(finalMime);

      if (isImage && !supportsInlineImages) {
        throw new UnsupportedAttachmentError(
          "text-only-image",
          `attachment ${label}: active model does not accept image inputs`,
        );
      }
      if (!isImage && !acceptNonImage) {
        throw new UnsupportedAttachmentError(
          "unsupported-non-image",
          `attachment ${label}: non-image attachments (${finalMime}) are not supported on this entrypoint`,
        );
      }
      // Agent-side hydration (loadImageFromRef via optimizeAndClampImage / GIF
      // direct compare) caps at MAX_IMAGE_BYTES. Accepting images above that
      // would offload a file the runner later drops to null — a successful
      // response with a silently missing image. Reject here so the client
      // sees an explicit 4xx. Non-image attachments keep the full maxBytes
      // ceiling because their host path (ctx.MediaPaths → Read/Bash) doesn't
      // load into the model.
      if (isImage && sizeBytes > MAX_IMAGE_BYTES) {
        throw new Error(
          `attachment ${label}: image exceeds size limit (${sizeBytes} > ${MAX_IMAGE_BYTES} bytes)`,
        );
      }

      const shouldOffload = !isImage || sizeBytes > OFFLOAD_THRESHOLD_BYTES;

      if (!shouldOffload) {
        images.push({ type: "image", data: b64, mimeType: finalMime });
        imageOrder.push("inline");
        continue;
      }

      // Decode and run input-validation BEFORE the MediaOffloadError try/catch.
      // verifyDecodedSize is a 4xx client error and must not be wrapped as a
      // 5xx MediaOffloadError.
      const buffer = Buffer.from(b64, "base64");
      verifyDecodedSize(buffer, sizeBytes, label);

      let savedMedia: SavedMedia;
      try {
        const labelWithExt = ensureExtension(label, finalMime);
        const rawResult = await saveMediaBuffer(
          buffer,
          finalMime,
          "inbound",
          maxBytes,
          labelWithExt,
        );
        savedMedia = assertSavedMedia(rawResult, label);
      } catch (err) {
        throw new MediaOffloadError(
          `[Gateway Error] Failed to save intercepted media to disk: ${formatErrorMessage(err)}`,
          { cause: err },
        );
      }

      savedMediaIds.push(savedMedia.id);

      const mediaRef = `media://inbound/${savedMedia.id}`;

      // Image offloads append the media:// URI for native image-injection
      // resolution in the agent runner. Non-image offloads rely on caller-side
      // ctx.MediaPaths routing → workspace stage → buildInboundMediaNote.
      if (isImage) {
        updatedMessage += `\n[media attached: ${mediaRef}]`;
      }
      log?.info?.(`[Gateway] Offloaded attachment (${finalMime}). Saved: ${mediaRef}`);

      offloadedRefs.push({
        mediaRef,
        id: savedMedia.id,
        path: savedMedia.path,
        mimeType: finalMime,
        label,
        sizeBytes,
      });
      // imageOrder drives mergePromptAttachmentImages / splitPromptAndAttachmentRefs
      // downstream, pairing every "offloaded" slot with a trailing
      // `[media attached: media://...]` URI. Only image offloads emit that URI
      // (see the isImage branch above), so tagging a non-image file here would
      // make the single offloaded image consume the first slot in a mixed
      // [non-image, inline, offloaded-image] batch — reordering real images.
      if (isImage) {
        imageOrder.push("offloaded");
      }
    }
  } catch (err) {
    // Best-effort cleanup before rethrowing.
    if (savedMediaIds.length > 0) {
      await Promise.allSettled(savedMediaIds.map((id) => deleteMediaBuffer(id, "inbound")));
    }
    throw err;
  }

  return {
    message: updatedMessage !== message ? updatedMessage.trimEnd() : message,
    images,
    imageOrder,
    offloadedRefs,
  };
}

/**
 * @deprecated Use parseMessageWithAttachments instead.
 * This function converts images to markdown data URLs which Claude API cannot process as images.
 */
export function buildMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number },
): string {
  const maxBytes = opts?.maxBytes ?? 2_000_000;

  if (!attachments || attachments.length === 0) {
    return message;
  }

  const blocks: string[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }

    const normalized = normalizeAttachment(att, idx, {
      stripDataUrlPrefix: false,
      requireImageMime: true,
    });
    validateAttachmentBase64OrThrow(normalized, { maxBytes });

    const { base64, label, mime } = normalized;
    const safeLabel = label.replace(/\s+/g, "_");
    blocks.push(`![${safeLabel}](data:${mime};base64,${base64})`);
  }

  if (blocks.length === 0) {
    return message;
  }

  const separator = message.trim().length > 0 ? "\n\n" : "";
  return `${message}${separator}${blocks.join("\n\n")}`;
}
