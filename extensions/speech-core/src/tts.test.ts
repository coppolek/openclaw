import { rmSync } from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { setReplyPayloadMetadata, type ReplyPayload } from "openclaw/plugin-sdk/reply-payload";
import type { SpeechProviderPlugin } from "openclaw/plugin-sdk/speech-core";
import { afterEach, describe, expect, it, vi } from "vitest";

type MockSpeechSynthesisRequest = {
  target?: string;
  text: string;
  __providerId: string;
};
type MockSpeechSynthesisResult = Awaited<ReturnType<SpeechProviderPlugin["synthesize"]>>;

const synthesizeMock = vi.hoisted(() =>
  vi.fn(
    async (request: MockSpeechSynthesisRequest): Promise<MockSpeechSynthesisResult> => ({
      audioBuffer: Buffer.from("voice"),
      fileExtension: ".ogg",
      outputFormat: "ogg",
      voiceCompatible: request.target === "voice-note",
    }),
  ),
);

const listSpeechProvidersMock = vi.hoisted(() => vi.fn());
const getSpeechProviderMock = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/channel-targets", () => ({
  normalizeChannelId: (channel: string | undefined) => channel?.trim().toLowerCase() ?? null,
}));

vi.mock("../api.js", async () => {
  const actual = await vi.importActual<typeof import("../api.js")>("../api.js");
  const mockProvider: SpeechProviderPlugin = {
    id: "mock",
    label: "Mock",
    autoSelectOrder: 1,
    capabilities: {
      sourceTextHandling: "strip_expressive_tags",
    },
    isConfigured: () => true,
    synthesize: (request) => synthesizeMock({ ...request, __providerId: "mock" }),
  };
  const elevenProvider: SpeechProviderPlugin = {
    id: "elevenlabs",
    label: "ElevenLabs",
    autoSelectOrder: 2,
    capabilities: {
      sourceTextHandling: "preserve_expressive_tags",
    },
    isConfigured: () => true,
    synthesize: (request) => synthesizeMock({ ...request, __providerId: "elevenlabs" }),
  };
  listSpeechProvidersMock.mockImplementation(() => [mockProvider, elevenProvider]);
  getSpeechProviderMock.mockImplementation((providerId: string) => {
    if (providerId === "mock") {
      return mockProvider;
    }
    if (providerId === "elevenlabs") {
      return elevenProvider;
    }
    return null;
  });
  return {
    ...actual,
    canonicalizeSpeechProviderId: (providerId: string | undefined) =>
      providerId?.trim().toLowerCase() || undefined,
    normalizeSpeechProviderId: (providerId: string | undefined) =>
      providerId?.trim().toLowerCase() || undefined,
    getSpeechProvider: getSpeechProviderMock,
    listSpeechProviders: listSpeechProvidersMock,
    scheduleCleanup: vi.fn(),
  };
});

const { _test, maybeApplyTtsToPayload } = await import("./tts.js");

const nativeVoiceNoteChannels = ["discord", "feishu", "matrix", "telegram", "whatsapp"] as const;

function createTtsConfig(prefsName: string, provider = "mock"): OpenClawConfig {
  return {
    messages: {
      tts: {
        enabled: true,
        provider,
        prefsPath: `/tmp/${prefsName}.json`,
      },
    },
  };
}

describe("speech-core native voice-note routing", () => {
  afterEach(() => {
    synthesizeMock.mockClear();
    synthesizeMock.mockImplementation(
      async (request: MockSpeechSynthesisRequest): Promise<MockSpeechSynthesisResult> => ({
        audioBuffer: Buffer.from("voice"),
        fileExtension: ".ogg",
        outputFormat: "ogg",
        voiceCompatible: request.target === "voice-note",
      }),
    );
  });

  it("keeps native voice-note channel support centralized", () => {
    for (const channel of nativeVoiceNoteChannels) {
      expect(_test.supportsNativeVoiceNoteTts(channel)).toBe(true);
      expect(_test.supportsNativeVoiceNoteTts(channel.toUpperCase())).toBe(true);
    }
    expect(_test.supportsNativeVoiceNoteTts("slack")).toBe(false);
    expect(_test.supportsNativeVoiceNoteTts(undefined)).toBe(false);
  });

  it("marks Discord auto TTS replies as native voice messages", async () => {
    const cfg = createTtsConfig("openclaw-speech-core-tts-test");
    const payload: ReplyPayload = {
      text: "This Discord reply should be delivered as a native voice note.",
    };

    let mediaDir: string | undefined;
    try {
      const result = await maybeApplyTtsToPayload({
        payload,
        cfg,
        channel: "discord",
        kind: "final",
      });

      expect(synthesizeMock).toHaveBeenCalledWith(
        expect.objectContaining({ target: "voice-note" }),
      );
      expect(result.audioAsVoice).toBe(true);
      expect(result.mediaUrl).toMatch(/voice-\d+\.ogg$/);

      mediaDir = result.mediaUrl ? path.dirname(result.mediaUrl) : undefined;
    } finally {
      if (mediaDir) {
        rmSync(mediaDir, { recursive: true, force: true });
      }
    }
  });

  it("keeps non-native voice-note channels as regular audio files", async () => {
    const cfg = createTtsConfig("openclaw-speech-core-tts-slack-test");
    const payload: ReplyPayload = {
      text: "Slack replies should be delivered as regular audio attachments.",
    };

    let mediaDir: string | undefined;
    try {
      const result = await maybeApplyTtsToPayload({
        payload,
        cfg,
        channel: "slack",
        kind: "final",
      });

      expect(synthesizeMock).toHaveBeenCalledWith(
        expect.objectContaining({ target: "audio-file" }),
      );
      expect(result.audioAsVoice).toBeUndefined();
      expect(result.mediaUrl).toMatch(/voice-\d+\.ogg$/);

      mediaDir = result.mediaUrl ? path.dirname(result.mediaUrl) : undefined;
    } finally {
      if (mediaDir) {
        rmSync(mediaDir, { recursive: true, force: true });
      }
    }
  });

  it("preserves emotion tags for expressive-capable speech providers when raw TTS metadata is present", async () => {
    const cfg = createTtsConfig("openclaw-speech-core-tts-eleven-test", "elevenlabs");
    const payload = setReplyPayloadMetadata(
      {
        text: "Hello there, friend.",
      } satisfies ReplyPayload,
      {
        ttsSourceText: "[warmly] Hello there, friend.",
      },
    );

    let mediaDir: string | undefined;
    try {
      const result = await maybeApplyTtsToPayload({
        payload,
        cfg,
        channel: "slack",
        kind: "final",
      });

      expect(synthesizeMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ text: "[warmly] Hello there, friend." }),
      );
      mediaDir = result.mediaUrl ? path.dirname(result.mediaUrl) : undefined;
    } finally {
      if (mediaDir) {
        rmSync(mediaDir, { recursive: true, force: true });
      }
    }
  });

  it("strips emotion tags for plain-text speech providers", async () => {
    const cfg = createTtsConfig("openclaw-speech-core-tts-mock-test", "mock");
    const payload = setReplyPayloadMetadata(
      {
        text: "Hello there, friend.",
      } satisfies ReplyPayload,
      {
        ttsSourceText: "[warmly] Hello there, friend.",
      },
    );

    let mediaDir: string | undefined;
    try {
      const result = await maybeApplyTtsToPayload({
        payload,
        cfg,
        channel: "slack",
        kind: "final",
      });

      expect(synthesizeMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ text: "Hello there, friend." }),
      );
      mediaDir = result.mediaUrl ? path.dirname(result.mediaUrl) : undefined;
    } finally {
      if (mediaDir) {
        rmSync(mediaDir, { recursive: true, force: true });
      }
    }
  });

  it("strips emotion tags before falling back from an expressive-capable provider to a plain-text provider", async () => {
    const cfg = createTtsConfig("openclaw-speech-core-tts-fallback-test", "elevenlabs");
    const payload = setReplyPayloadMetadata(
      {
        text: "Hello there, friend.",
      } satisfies ReplyPayload,
      {
        ttsSourceText: "[warmly] Hello there, friend.",
      },
    );

    synthesizeMock.mockImplementation(async (request: MockSpeechSynthesisRequest) => {
      if (request.__providerId === "elevenlabs") {
        throw new Error("elevenlabs unavailable");
      }
      return {
        audioBuffer: Buffer.from("voice"),
        fileExtension: ".ogg",
        outputFormat: "ogg",
        voiceCompatible: request.target === "voice-note",
      };
    });

    let mediaDir: string | undefined;
    try {
      const result = await maybeApplyTtsToPayload({
        payload,
        cfg,
        channel: "slack",
        kind: "final",
      });

      expect(synthesizeMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          __providerId: "elevenlabs",
          text: "[warmly] Hello there, friend.",
        }),
      );
      expect(synthesizeMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          __providerId: "mock",
          text: "Hello there, friend.",
        }),
      );
      mediaDir = result.mediaUrl ? path.dirname(result.mediaUrl) : undefined;
    } finally {
      if (mediaDir) {
        rmSync(mediaDir, { recursive: true, force: true });
      }
    }
  });

  it("restores expressive source text when falling back from a plain-text provider to an expressive-capable provider", async () => {
    const cfg = createTtsConfig("openclaw-speech-core-tts-reverse-fallback-test", "mock");
    const payload = setReplyPayloadMetadata(
      {
        text: "Hello there, friend.",
      } satisfies ReplyPayload,
      {
        ttsSourceText: "[warmly] Hello there, friend.",
      },
    );

    synthesizeMock.mockImplementation(async (request: MockSpeechSynthesisRequest) => {
      if (request.__providerId === "mock") {
        throw new Error("mock unavailable");
      }
      return {
        audioBuffer: Buffer.from("voice"),
        fileExtension: ".ogg",
        outputFormat: "ogg",
        voiceCompatible: request.target === "voice-note",
      };
    });

    let mediaDir: string | undefined;
    try {
      const result = await maybeApplyTtsToPayload({
        payload,
        cfg,
        channel: "slack",
        kind: "final",
      });

      expect(synthesizeMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          __providerId: "mock",
          text: "Hello there, friend.",
        }),
      );
      expect(synthesizeMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          __providerId: "elevenlabs",
          text: "[warmly] Hello there, friend.",
        }),
      );
      mediaDir = result.mediaUrl ? path.dirname(result.mediaUrl) : undefined;
    } finally {
      if (mediaDir) {
        rmSync(mediaDir, { recursive: true, force: true });
      }
    }
  });
});
