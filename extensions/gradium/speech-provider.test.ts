import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGradiumSpeechProvider } from "./speech-provider.js";

describe("gradium speech provider", () => {
  const provider = buildGradiumSpeechProvider();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports configured when GRADIUM_API_KEY is set", () => {
    const original = process.env.GRADIUM_API_KEY;
    try {
      process.env.GRADIUM_API_KEY = "gsk_test";
      expect(provider.isConfigured({ providerConfig: {} })).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env.GRADIUM_API_KEY;
      } else {
        process.env.GRADIUM_API_KEY = original;
      }
    }
  });

  it("reports not configured when no key is available", () => {
    const original = process.env.GRADIUM_API_KEY;
    try {
      delete process.env.GRADIUM_API_KEY;
      expect(provider.isConfigured({ providerConfig: {} })).toBe(false);
    } finally {
      if (original !== undefined) {
        process.env.GRADIUM_API_KEY = original;
      }
    }
  });

  it("synthesizes audio via the Gradium TTS endpoint", async () => {
    const audioData = Buffer.from("wav-audio-data");
    const fetchMock = vi.fn(async () => new Response(audioData, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.synthesize({
      text: "OpenClaw test",
      cfg: {} as never,
      providerConfig: { apiKey: "gsk_test123" },
      target: "audio-file",
      timeoutMs: 30_000,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.gradium.ai/api/post/speech/tts");
    const headers = new Headers(init.headers);
    expect(headers.get("x-api-key")).toBe("gsk_test123");
    expect(JSON.parse(init.body as string)).toEqual({
      text: "OpenClaw test",
      voice_id: "YTpq7expH9539ERJ",
      only_audio: true,
      output_format: "wav",
      json_config: { padding_bonus: 0 },
    });
    expect(result.outputFormat).toBe("wav");
    expect(result.fileExtension).toBe(".wav");
    expect(result.audioBuffer).toEqual(audioData);
  });

  it("throws when no API key is available", async () => {
    const original = process.env.GRADIUM_API_KEY;
    try {
      delete process.env.GRADIUM_API_KEY;
      await expect(
        provider.synthesize({
          text: "test",
          cfg: {} as never,
          providerConfig: {},
          target: "audio-file",
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow("Gradium API key missing");
    } finally {
      if (original !== undefined) {
        process.env.GRADIUM_API_KEY = original;
      }
    }
  });
});
