import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { sleep } from "openclaw/plugin-sdk/text-runtime";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadWebMedia } from "../media.js";
import type { WebInboundMsg } from "./types.js";

vi.mock("openclaw/plugin-sdk/runtime-env", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/runtime-env")>(
    "openclaw/plugin-sdk/runtime-env",
  );
  return {
    ...actual,
    shouldLogVerbose: vi.fn(() => true),
    logVerbose: vi.fn(),
  };
});

vi.mock("openclaw/plugin-sdk/text-runtime", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/text-runtime")>(
    "openclaw/plugin-sdk/text-runtime",
  );
  return {
    ...actual,
    sleep: vi.fn(async () => {}),
  };
});

vi.mock("../media.js", () => ({
  loadWebMedia: vi.fn(),
}));

let deliverWebReply: typeof import("./deliver-reply.js").deliverWebReply;

function makeMsg(): WebInboundMsg {
  return {
    from: "+10000000000",
    to: "+20000000000",
    id: "msg-1",
    reply: vi.fn(async () => undefined),
    sendMedia: vi.fn(async () => undefined),
  } as unknown as WebInboundMsg;
}

function mockLoadedImageMedia() {
  (
    loadWebMedia as unknown as { mockResolvedValueOnce: (v: unknown) => void }
  ).mockResolvedValueOnce({
    buffer: Buffer.from("img"),
    contentType: "image/jpeg",
    kind: "image",
  });
}

function mockFirstSendMediaFailure(msg: WebInboundMsg, message: string) {
  (
    msg.sendMedia as unknown as { mockRejectedValueOnce: (v: unknown) => void }
  ).mockRejectedValueOnce(new Error(message));
}

function mockFirstReplyFailure(msg: WebInboundMsg, message: string) {
  (msg.reply as unknown as { mockRejectedValueOnce: (v: unknown) => void }).mockRejectedValueOnce(
    new Error(message),
  );
}

function mockSecondReplySuccess(msg: WebInboundMsg) {
  (msg.reply as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(
    undefined,
  );
}

const replyLogger = {
  info: vi.fn(),
  warn: vi.fn(),
};

async function expectReplySuppressed(replyResult: { text: string; isReasoning?: boolean }) {
  const msg = makeMsg();
  await deliverWebReply({
    replyResult,
    msg,
    maxMediaBytes: 1024 * 1024,
    textLimit: 200,
    replyLogger,
    skipLog: true,
  });
  expect(msg.reply).not.toHaveBeenCalled();
  expect(msg.sendMedia).not.toHaveBeenCalled();
}

describe("deliverWebReply", () => {
  beforeAll(async () => {
    ({ deliverWebReply } = await import("./deliver-reply.js"));
  });

  it("suppresses payloads flagged as reasoning", async () => {
    await expectReplySuppressed({ text: "Reasoning:\n_hidden_", isReasoning: true });
  });

  it("suppresses payloads that start with reasoning prefix text", async () => {
    await expectReplySuppressed({ text: "   \n Reasoning:\n_hidden_" });
  });

  it("does not suppress messages that mention Reasoning: mid-text", async () => {
    const msg = makeMsg();

    await deliverWebReply({
      replyResult: { text: "Intro line\nReasoning: appears in content but is not a prefix" },
      msg,
      maxMediaBytes: 1024 * 1024,
      textLimit: 200,
      replyLogger,
      skipLog: true,
    });

    expect(msg.reply).toHaveBeenCalledTimes(1);
    expect(msg.reply).toHaveBeenCalledWith(
      "Intro line\nReasoning: appears in content but is not a prefix",
    );
  });

  it("sends chunked text replies and logs a summary", async () => {
    const msg = makeMsg();

    await deliverWebReply({
      replyResult: { text: "aaaaaa" },
      msg,
      maxMediaBytes: 1024 * 1024,
      textLimit: 3,
      replyLogger,
      skipLog: true,
    });

    expect(msg.reply).toHaveBeenCalledTimes(2);
    expect(msg.reply).toHaveBeenNthCalledWith(1, "aaa");
    expect(msg.reply).toHaveBeenNthCalledWith(2, "aaa");
    expect(replyLogger.info).toHaveBeenCalledWith(expect.any(Object), "auto-reply sent (text)");
  });

  it.each(["connection closed", "operation timed out"])(
    "retries text send on transient failure: %s",
    async (errorMessage) => {
      const msg = makeMsg();
      mockFirstReplyFailure(msg, errorMessage);
      mockSecondReplySuccess(msg);

      await deliverWebReply({
        replyResult: { text: "hi" },
        msg,
        maxMediaBytes: 1024 * 1024,
        textLimit: 200,
        replyLogger,
        skipLog: true,
      });

      expect(msg.reply).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(500);
    },
  );

  it("sends image media with caption and then remaining text", async () => {
    const msg = makeMsg();
    const mediaLocalRoots = ["/tmp/workspace-work"];
    mockLoadedImageMedia();

    await deliverWebReply({
      replyResult: { text: "aaaaaa", mediaUrl: "http://example.com/img.jpg" },
      msg,
      mediaLocalRoots,
      maxMediaBytes: 1024 * 1024,
      textLimit: 3,
      replyLogger,
      skipLog: true,
    });

    expect(loadWebMedia).toHaveBeenCalledWith("http://example.com/img.jpg", {
      maxBytes: 1024 * 1024,
      localRoots: mediaLocalRoots,
    });

    expect(msg.sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        image: expect.any(Buffer),
        caption: "aaa",
        mimetype: "image/jpeg",
      }),
    );
    expect(msg.reply).toHaveBeenCalledWith("aaa");
    expect(replyLogger.info).toHaveBeenCalledWith(expect.any(Object), "auto-reply sent (media)");
    expect(logVerbose).toHaveBeenCalled();
  });

  it("retries media send on transient failure", async () => {
    const msg = makeMsg();
    mockLoadedImageMedia();
    mockFirstSendMediaFailure(msg, "socket reset");
    (
      msg.sendMedia as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce(undefined);

    await deliverWebReply({
      replyResult: { text: "caption", mediaUrl: "http://example.com/img.jpg" },
      msg,
      maxMediaBytes: 1024 * 1024,
      textLimit: 200,
      replyLogger,
      skipLog: true,
    });

    expect(msg.sendMedia).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("falls back to text-only when the first media send fails", async () => {
    const msg = makeMsg();
    mockLoadedImageMedia();
    mockFirstSendMediaFailure(msg, "boom");

    await deliverWebReply({
      replyResult: { text: "caption", mediaUrl: "http://example.com/img.jpg" },
      msg,
      maxMediaBytes: 1024 * 1024,
      textLimit: 20,
      replyLogger,
      skipLog: true,
    });

    expect(msg.reply).toHaveBeenCalledTimes(1);
    expect(
      String((msg.reply as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]),
    ).toContain("⚠️ Media failed");
    expect(replyLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ mediaUrl: "http://example.com/img.jpg" }),
      "failed to send web media reply",
    );
  });

  it("sends audio media as ptt voice note", async () => {
    const msg = makeMsg();
    (
      loadWebMedia as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      buffer: Buffer.from("aud"),
      contentType: "audio/ogg",
      kind: "audio",
    });

    await deliverWebReply({
      replyResult: { text: "cap", mediaUrl: "http://example.com/a.ogg" },
      msg,
      maxMediaBytes: 1024 * 1024,
      textLimit: 200,
      replyLogger,
      skipLog: true,
    });

    expect(msg.sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.any(Buffer),
        ptt: true,
        mimetype: "audio/ogg; codecs=opus",
        caption: "cap",
      }),
    );
  });

  it("rejects voice-note coercion when audioAsVoice is true but media is not verified audio", async () => {
    const msg = makeMsg();
    (
      loadWebMedia as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      buffer: Buffer.from("aud"),
      contentType: "application/octet-stream",
      kind: "document",
      fileName: "voice.ogg",
    });

    await deliverWebReply({
      replyResult: { text: "cap", mediaUrl: "http://example.com/voice.ogg", audioAsVoice: true },
      msg,
      maxMediaBytes: 1024 * 1024,
      textLimit: 200,
      replyLogger,
      skipLog: true,
    });

    expect(msg.sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.any(Buffer),
        fileName: "voice.ogg",
        mimetype: "application/octet-stream",
        caption: "cap",
      }),
    );
  });

  it("falls back to opus mimetype when contentType contains control characters", async () => {
    const msg = makeMsg();
    (
      loadWebMedia as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      buffer: Buffer.from("aud"),
      contentType: "audio/ogg\r\nX-Inj: bad",
      kind: "audio",
      fileName: "voice.ogg",
    });

    await deliverWebReply({
      replyResult: { text: "cap", mediaUrl: "http://example.com/voice.ogg", audioAsVoice: true },
      msg,
      maxMediaBytes: 1024 * 1024,
      textLimit: 200,
      replyLogger,
      skipLog: true,
    });

    expect(msg.sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.any(Buffer),
        ptt: true,
        mimetype: "audio/ogg; codecs=opus",
        caption: "cap",
      }),
    );
  });

  it("uses image/jpeg fallback when image contentType contains control characters", async () => {
    const msg = makeMsg();
    (
      loadWebMedia as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      buffer: Buffer.from("img"),
      contentType: "image/png\r\nX-Inj: bad",
      kind: "image",
      fileName: "photo.png",
    });

    await deliverWebReply({
      replyResult: { text: "img cap", mediaUrl: "http://example.com/photo.png" },
      msg,
      maxMediaBytes: 1024 * 1024,
      textLimit: 200,
      replyLogger,
      skipLog: true,
    });

    expect(msg.sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        image: expect.any(Buffer),
        mimetype: "image/jpeg",
        caption: "img cap",
      }),
    );
  });

  it("uses video/mp4 fallback when video contentType contains control characters", async () => {
    const msg = makeMsg();
    (
      loadWebMedia as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      buffer: Buffer.from("vid"),
      contentType: "video/quicktime\r\nX-Inj: bad",
      kind: "video",
      fileName: "movie.mov",
    });

    await deliverWebReply({
      replyResult: { text: "vid cap", mediaUrl: "http://example.com/movie.mov" },
      msg,
      maxMediaBytes: 1024 * 1024,
      textLimit: 200,
      replyLogger,
      skipLog: true,
    });

    expect(msg.sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.any(Buffer),
        mimetype: "video/mp4",
        caption: "vid cap",
      }),
    );
  });

  it("uses octet-stream fallback when document contentType contains control characters", async () => {
    const msg = makeMsg();
    (
      loadWebMedia as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      buffer: Buffer.from("doc"),
      contentType: "application/pdf\r\nX-Inj: bad",
      kind: "document",
      fileName: "report.pdf",
    });

    await deliverWebReply({
      replyResult: { text: "doc cap", mediaUrl: "http://example.com/report.pdf" },
      msg,
      maxMediaBytes: 1024 * 1024,
      textLimit: 200,
      replyLogger,
      skipLog: true,
    });

    expect(msg.sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.any(Buffer),
        fileName: "report.pdf",
        mimetype: "application/octet-stream",
        caption: "doc cap",
      }),
    );
  });

  it("keeps non-audio documents as documents even when audioAsVoice is true", async () => {
    const msg = makeMsg();
    (
      loadWebMedia as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      buffer: Buffer.from("pdf"),
      contentType: "application/pdf",
      kind: "document",
      fileName: "file.pdf",
    });

    await deliverWebReply({
      replyResult: { text: "cap", mediaUrl: "http://example.com/file.pdf", audioAsVoice: true },
      msg,
      maxMediaBytes: 1024 * 1024,
      textLimit: 200,
      replyLogger,
      skipLog: true,
    });

    expect(msg.sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.any(Buffer),
        fileName: "file.pdf",
        mimetype: "application/pdf",
        caption: "cap",
      }),
    );
  });

  it("keeps document path for audio-like file when audioAsVoice is unset", async () => {
    const msg = makeMsg();
    (
      loadWebMedia as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      buffer: Buffer.from("aud"),
      contentType: "application/octet-stream",
      kind: "document",
      fileName: "voice.ogg",
    });

    await deliverWebReply({
      replyResult: { text: "cap", mediaUrl: "http://example.com/voice.ogg" },
      msg,
      maxMediaBytes: 1024 * 1024,
      textLimit: 200,
      replyLogger,
      skipLog: true,
    });

    expect(msg.sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.any(Buffer),
        fileName: "voice.ogg",
        mimetype: "application/octet-stream",
        caption: "cap",
      }),
    );
  });

  it("sends video media", async () => {
    const msg = makeMsg();
    (
      loadWebMedia as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      buffer: Buffer.from("vid"),
      contentType: "video/mp4",
      kind: "video",
    });

    await deliverWebReply({
      replyResult: { text: "cap", mediaUrl: "http://example.com/v.mp4" },
      msg,
      maxMediaBytes: 1024 * 1024,
      textLimit: 200,
      replyLogger,
      skipLog: true,
    });

    expect(msg.sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.any(Buffer),
        caption: "cap",
        mimetype: "video/mp4",
      }),
    );
  });

  it("sends non-audio/image/video media as document", async () => {
    const msg = makeMsg();
    (
      loadWebMedia as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      buffer: Buffer.from("bin"),
      contentType: undefined,
      kind: "file",
      fileName: "x.bin",
    });

    await deliverWebReply({
      replyResult: { text: "cap", mediaUrl: "http://example.com/x.bin" },
      msg,
      maxMediaBytes: 1024 * 1024,
      textLimit: 200,
      replyLogger,
      skipLog: true,
    });

    expect(msg.sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.any(Buffer),
        fileName: "x.bin",
        caption: "cap",
        mimetype: "application/octet-stream",
      }),
    );
  });
});
