import type { MarkdownTableMode } from "openclaw/plugin-sdk/config-runtime";
import { chunkMarkdownTextWithMode, type ChunkMode } from "openclaw/plugin-sdk/reply-chunking";
import type { ReplyPayload } from "openclaw/plugin-sdk/reply-chunking";
import { sendMediaWithLeadingCaption } from "openclaw/plugin-sdk/reply-payload";
import { logVerbose, shouldLogVerbose } from "openclaw/plugin-sdk/runtime-env";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/text-runtime";
import { loadWebMedia } from "../media.js";
import {
  normalizeWhatsAppLoadedMedia,
  normalizeWhatsAppOutboundPayload,
  sendWhatsAppOutboundWithRetry,
} from "../outbound-media-contract.js";
import { newConnectionId } from "../reconnect.js";
import { formatError } from "../session.js";
import { convertMarkdownTables } from "../text-runtime.js";
import { markdownToWhatsApp } from "../text-runtime.js";
import { whatsappOutboundLog } from "./loggers.js";
import type { WebInboundMsg } from "./types.js";
import { elide } from "./util.js";

const REASONING_PREFIX = "reasoning:";

function shouldSuppressReasoningReply(payload: ReplyPayload): boolean {
  if (payload.isReasoning === true) {
    return true;
  }
  const text = payload.text;
  if (typeof text !== "string") {
    return false;
  }
  return normalizeLowercaseStringOrEmpty(text.trimStart()).startsWith(REASONING_PREFIX);
}

export async function deliverWebReply(params: {
  replyResult: ReplyPayload;
  msg: WebInboundMsg;
  mediaLocalRoots?: readonly string[];
  maxMediaBytes: number;
  textLimit: number;
  chunkMode?: ChunkMode;
  replyLogger: {
    info: (obj: unknown, msg: string) => void;
    warn: (obj: unknown, msg: string) => void;
  };
  connectionId?: string;
  skipLog?: boolean;
  tableMode?: MarkdownTableMode;
}) {
  const { replyResult, msg, maxMediaBytes, textLimit, replyLogger, connectionId, skipLog } = params;
  const replyStarted = Date.now();
  if (shouldSuppressReasoningReply(replyResult)) {
    whatsappOutboundLog.debug(`Suppressed reasoning payload to ${msg.from}`);
    return;
  }
  const tableMode = params.tableMode ?? "code";
  const chunkMode = params.chunkMode ?? "length";
  const normalizedReply = normalizeWhatsAppOutboundPayload(replyResult);
  const convertedText = markdownToWhatsApp(convertMarkdownTables(normalizedReply.text, tableMode));
  const textChunks = chunkMarkdownTextWithMode(convertedText, textLimit, chunkMode);
  const mediaList = normalizedReply.mediaUrls ?? [];

  const sendWithRetry = async (fn: () => Promise<unknown>, label: string, maxAttempts = 3) => {
    return await sendWhatsAppOutboundWithRetry({
      send: fn,
      maxAttempts,
      onRetry: ({ attempt, maxAttempts: retryMaxAttempts, backoffMs, errorText }) => {
        logVerbose(
          `Retrying ${label} to ${msg.from} after failure (${attempt}/${retryMaxAttempts - 1}) in ${backoffMs}ms: ${errorText}`,
        );
      },
    });
  };

  // Text-only replies
  if (mediaList.length === 0 && textChunks.length) {
    const totalChunks = textChunks.length;
    for (const [index, chunk] of textChunks.entries()) {
      const chunkStarted = Date.now();
      await sendWithRetry(() => msg.reply(chunk), "text");
      if (!skipLog) {
        const durationMs = Date.now() - chunkStarted;
        whatsappOutboundLog.debug(
          `Sent chunk ${index + 1}/${totalChunks} to ${msg.from} (${durationMs.toFixed(0)}ms)`,
        );
      }
    }
    replyLogger.info(
      {
        correlationId: msg.id ?? newConnectionId(),
        connectionId: connectionId ?? null,
        to: msg.from,
        from: msg.to,
        text: elide(replyResult.text, 240),
        mediaUrl: null,
        mediaSizeBytes: null,
        mediaKind: null,
        durationMs: Date.now() - replyStarted,
      },
      "auto-reply sent (text)",
    );
    return;
  }

  const remainingText = [...textChunks];

  // Media (with optional caption on first item)
  const leadingCaption = remainingText.shift() || "";
  await sendMediaWithLeadingCaption({
    mediaUrls: mediaList,
    caption: leadingCaption,
    send: async ({ mediaUrl, caption }) => {
      const media = normalizeWhatsAppLoadedMedia(
        await loadWebMedia(mediaUrl, {
          maxBytes: maxMediaBytes,
          localRoots: params.mediaLocalRoots,
        }),
        mediaUrl,
      );
      if (shouldLogVerbose()) {
        logVerbose(
          `Web auto-reply media size: ${(media.buffer.length / (1024 * 1024)).toFixed(2)}MB`,
        );
        logVerbose(`Web auto-reply media source: ${mediaUrl} (kind ${media.kind})`);
      }
      if (media.kind === "image") {
        await sendWithRetry(
          () =>
            msg.sendMedia({
              image: media.buffer,
              caption,
              mimetype: media.mimetype,
            }),
          "media:image",
        );
      } else if (media.kind === "audio") {
        await sendWithRetry(
          () =>
            msg.sendMedia({
              audio: media.buffer,
              ptt: true,
              mimetype: media.mimetype,
              caption,
            }),
          "media:audio",
        );
      } else if (media.kind === "video") {
        await sendWithRetry(
          () =>
            msg.sendMedia({
              video: media.buffer,
              caption,
              mimetype: media.mimetype,
            }),
          "media:video",
        );
      } else {
        await sendWithRetry(
          () =>
            msg.sendMedia({
              document: media.buffer,
              fileName: media.fileName,
              caption,
              mimetype: media.mimetype,
            }),
          "media:document",
        );
      }
      whatsappOutboundLog.info(
        `Sent media reply to ${msg.from} (${(media.buffer.length / (1024 * 1024)).toFixed(2)}MB)`,
      );
      replyLogger.info(
        {
          correlationId: msg.id ?? newConnectionId(),
          connectionId: connectionId ?? null,
          to: msg.from,
          from: msg.to,
          text: caption ?? null,
          mediaUrl,
          mediaSizeBytes: media.buffer.length,
          mediaKind: media.kind,
          durationMs: Date.now() - replyStarted,
        },
        "auto-reply sent (media)",
      );
    },
    onError: async ({ error, mediaUrl, caption, isFirst }) => {
      whatsappOutboundLog.error(`Failed sending web media to ${msg.from}: ${formatError(error)}`);
      replyLogger.warn({ err: error, mediaUrl }, "failed to send web media reply");
      if (!isFirst) {
        return;
      }
      const warning =
        error instanceof Error ? `⚠️ Media failed: ${error.message}` : "⚠️ Media failed.";
      const fallbackTextParts = [remainingText.shift() ?? caption ?? "", warning].filter(Boolean);
      const fallbackText = fallbackTextParts.join("\n");
      if (!fallbackText) {
        return;
      }
      whatsappOutboundLog.warn(`Media skipped; sent text-only to ${msg.from}`);
      await msg.reply(fallbackText);
    },
  });

  // Remaining text chunks after media
  for (const chunk of remainingText) {
    await msg.reply(chunk);
  }
}
