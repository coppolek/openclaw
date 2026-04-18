import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isValidXaiTtsModel,
  isValidXaiTtsVoice,
  XAI_BASE_URL,
  XAI_TTS_MODELS,
  XAI_TTS_VOICES,
  xaiTTS,
} from "./tts.js";

describe("xai tts", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("isValidXaiTtsVoice", () => {
    it("accepts all valid voices", () => {
      for (const voice of XAI_TTS_VOICES) {
        expect(isValidXaiTtsVoice(voice)).toBe(true);
      }
    });

    it("rejects invalid voice names", () => {
      expect(isValidXaiTtsVoice("invalid")).toBe(false);
      expect(isValidXaiTtsVoice("")).toBe(false);
      expect(isValidXaiTtsVoice("ALLOY")).toBe(false);
      expect(isValidXaiTtsVoice("alloy ")).toBe(false);
      expect(isValidXaiTtsVoice(" alloy")).toBe(false);
    });

    it("treats custom endpoints as permissive", () => {
      expect(isValidXaiTtsVoice("grok-voice-custom", "https://custom.api.x.ai/v1")).toBe(true);
    });
  });

  describe("isValidXaiTtsModel", () => {
    it("matches the supported model set", () => {
      expect(XAI_TTS_MODELS).toContain("grok-4-voice");
      expect(XAI_TTS_MODELS).toHaveLength(1);
      const cases = [
        { model: "grok-4-voice", expected: true },
        { model: "invalid", expected: false },
        { model: "", expected: false },
      ] as const;
      for (const testCase of cases) {
        expect(isValidXaiTtsModel(testCase.model), testCase.model).toBe(testCase.expected);
      }
    });

    it("treats custom endpoints as permissive", () => {
      expect(isValidXaiTtsModel("custom-voice-model", "https://custom.api.x.ai/v1")).toBe(true);
    });
  });

  describe("xaiTTS diagnostics", () => {
    it("includes parsed provider detail and request id for JSON API errors", async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: "Invalid API key",
                type: "invalid_request_error",
                code: "invalid_api_key",
              },
            }),
            {
              status: 401,
              headers: {
                "Content-Type": "application/json",
                "x-request-id": "req_123",
              },
            },
          ),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(
        xaiTTS({
          text: "hello",
          apiKey: "bad-key",
          baseUrl: XAI_BASE_URL,
          model: "grok-4-voice",
          voice: "alloy",
          responseFormat: "mp3",
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow(
        "xAI TTS API error (401): Invalid API key [type=invalid_request_error, code=invalid_api_key] [request_id=req_123]",
      );
    });

    it("falls back to raw body text when the error body is non-JSON", async () => {
      const fetchMock = vi.fn(
        async () => new Response("temporary upstream outage", { status: 503 }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(
        xaiTTS({
          text: "hello",
          apiKey: "test-key",
          baseUrl: XAI_BASE_URL,
          model: "grok-4-voice",
          voice: "alloy",
          responseFormat: "mp3",
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow("xAI TTS API error (503): temporary upstream outage");
    });
  });
});
