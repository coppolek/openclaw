import type { Model } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchWithSsrFGuardMock,
  mergeModelProviderRequestOverridesMock,
  resolveProviderRequestPolicyConfigMock,
} = vi.hoisted(() => ({
  fetchWithSsrFGuardMock: vi.fn(),
  mergeModelProviderRequestOverridesMock: vi.fn((current, overrides) => ({
    ...current,
    ...overrides,
  })),
  resolveProviderRequestPolicyConfigMock: vi.fn(() => ({ allowPrivateNetwork: false })),
}));

vi.mock("../infra/net/fetch-guard.js", () => ({
  fetchWithSsrFGuard: fetchWithSsrFGuardMock,
}));

vi.mock("./provider-request-config.js", () => ({
  buildProviderRequestDispatcherPolicy: vi.fn(() => ({ mode: "direct" })),
  getModelProviderRequestTransport: vi.fn(() => undefined),
  mergeModelProviderRequestOverrides: mergeModelProviderRequestOverridesMock,
  resolveProviderRequestPolicyConfig: resolveProviderRequestPolicyConfigMock,
}));

describe("buildGuardedModelFetch", () => {
  beforeEach(() => {
    fetchWithSsrFGuardMock.mockReset().mockResolvedValue({
      response: new Response("ok", { status: 200 }),
      finalUrl: "https://api.openai.com/v1/responses",
      release: vi.fn(async () => undefined),
    });
    mergeModelProviderRequestOverridesMock.mockClear();
    resolveProviderRequestPolicyConfigMock
      .mockClear()
      .mockReturnValue({ allowPrivateNetwork: false });
    delete process.env.OPENCLAW_DEBUG_PROXY_ENABLED;
    delete process.env.OPENCLAW_DEBUG_PROXY_URL;
  });

  it("pushes provider capture metadata into the shared guarded fetch seam", async () => {
    const { buildGuardedModelFetch } = await import("./provider-transport-fetch.js");
    const model = {
      id: "gpt-5.4",
      provider: "openai",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
    } as unknown as Model<"openai-responses">;

    const fetcher = buildGuardedModelFetch(model);
    await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"input":"hello"}',
    });

    expect(fetchWithSsrFGuardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.openai.com/v1/responses",
        capture: {
          meta: {
            provider: "openai",
            api: "openai-responses",
            model: "gpt-5.4",
          },
        },
      }),
    );
  });

  it("does not force explicit debug proxy overrides onto plain HTTP model transports", async () => {
    process.env.OPENCLAW_DEBUG_PROXY_ENABLED = "1";
    process.env.OPENCLAW_DEBUG_PROXY_URL = "http://127.0.0.1:7799";

    const { buildGuardedModelFetch } = await import("./provider-transport-fetch.js");
    const model = {
      id: "kimi-k2.5:cloud",
      provider: "ollama",
      api: "ollama-chat",
      baseUrl: "http://127.0.0.1:11434/v1",
    } as unknown as Model<"ollama-chat">;

    const fetcher = buildGuardedModelFetch(model);
    await fetcher("http://127.0.0.1:11434/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"messages":[]}',
    });

    expect(mergeModelProviderRequestOverridesMock).toHaveBeenCalledWith(undefined, {
      proxy: undefined,
    });
  });

  describe("429 retry-after handling", () => {
    const anthropicModel = {
      id: "sonnet-4.6",
      provider: "anthropic",
      api: "anthropic-messages",
      baseUrl: "https://api.anthropic.com/v1",
    } as unknown as Model<"anthropic-messages">;

    const openaiModel = {
      id: "gpt-5.4",
      provider: "openai",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
    } as unknown as Model<"openai-responses">;

    afterEach(() => {
      delete process.env.OPENCLAW_SDK_RETRY_MAX_WAIT_SECONDS;
    });

    it("injects x-should-retry:false when 429 retry-after exceeds 60 seconds", async () => {
      fetchWithSsrFGuardMock.mockResolvedValue({
        response: new Response(null, {
          status: 429,
          headers: { "retry-after": "239" },
        }),
        finalUrl: "https://api.anthropic.com/v1/messages",
        release: vi.fn(async () => undefined),
      });

      const { buildGuardedModelFetch } = await import("./provider-transport-fetch.js");
      const response = await buildGuardedModelFetch(anthropicModel)(
        "https://api.anthropic.com/v1/messages",
        { method: "POST" },
      );

      expect(response.status).toBe(429);
      expect(response.headers.get("x-should-retry")).toBe("false");
      expect(response.headers.get("retry-after")).toBe("239");
    });

    it("injects x-should-retry:false when 429 retry-after-ms exceeds threshold (OpenAI)", async () => {
      fetchWithSsrFGuardMock.mockResolvedValue({
        response: new Response(null, {
          status: 429,
          headers: { "retry-after-ms": "90000" },
        }),
        finalUrl: "https://api.openai.com/v1/responses",
        release: vi.fn(async () => undefined),
      });

      const { buildGuardedModelFetch } = await import("./provider-transport-fetch.js");
      const response = await buildGuardedModelFetch(openaiModel)(
        "https://api.openai.com/v1/responses",
        { method: "POST" },
      );

      expect(response.headers.get("x-should-retry")).toBe("false");
    });

    it("injects x-should-retry:false when retry-after is an HTTP-date far in the future", async () => {
      const future = new Date(Date.now() + 120_000).toUTCString();
      fetchWithSsrFGuardMock.mockResolvedValue({
        response: new Response(null, {
          status: 429,
          headers: { "retry-after": future },
        }),
        finalUrl: "https://api.anthropic.com/v1/messages",
        release: vi.fn(async () => undefined),
      });

      const { buildGuardedModelFetch } = await import("./provider-transport-fetch.js");
      const response = await buildGuardedModelFetch(anthropicModel)(
        "https://api.anthropic.com/v1/messages",
        { method: "POST" },
      );

      expect(response.headers.get("x-should-retry")).toBe("false");
    });

    it("respects OPENCLAW_SDK_RETRY_MAX_WAIT_SECONDS env override", async () => {
      process.env.OPENCLAW_SDK_RETRY_MAX_WAIT_SECONDS = "10";
      fetchWithSsrFGuardMock.mockResolvedValue({
        response: new Response(null, {
          status: 429,
          headers: { "retry-after": "30" },
        }),
        finalUrl: "https://api.anthropic.com/v1/messages",
        release: vi.fn(async () => undefined),
      });

      const { buildGuardedModelFetch } = await import("./provider-transport-fetch.js");
      const response = await buildGuardedModelFetch(anthropicModel)(
        "https://api.anthropic.com/v1/messages",
        { method: "POST" },
      );

      expect(response.headers.get("x-should-retry")).toBe("false");
    });

    it("leaves headers untouched when 429 retry-after is under the threshold", async () => {
      fetchWithSsrFGuardMock.mockResolvedValue({
        response: new Response(null, {
          status: 429,
          headers: { "retry-after": "30" },
        }),
        finalUrl: "https://api.anthropic.com/v1/messages",
        release: vi.fn(async () => undefined),
      });

      const { buildGuardedModelFetch } = await import("./provider-transport-fetch.js");
      const response = await buildGuardedModelFetch(anthropicModel)(
        "https://api.anthropic.com/v1/messages",
        { method: "POST" },
      );

      expect(response.headers.get("x-should-retry")).toBeNull();
    });

    it("leaves headers untouched when 429 has no retry-after header", async () => {
      fetchWithSsrFGuardMock.mockResolvedValue({
        response: new Response(null, { status: 429 }),
        finalUrl: "https://api.anthropic.com/v1/messages",
        release: vi.fn(async () => undefined),
      });

      const { buildGuardedModelFetch } = await import("./provider-transport-fetch.js");
      const response = await buildGuardedModelFetch(anthropicModel)(
        "https://api.anthropic.com/v1/messages",
        { method: "POST" },
      );

      expect(response.headers.get("x-should-retry")).toBeNull();
    });

    it("leaves headers untouched when retry-after is malformed", async () => {
      fetchWithSsrFGuardMock.mockResolvedValue({
        response: new Response(null, {
          status: 429,
          headers: { "retry-after": "soon" },
        }),
        finalUrl: "https://api.anthropic.com/v1/messages",
        release: vi.fn(async () => undefined),
      });

      const { buildGuardedModelFetch } = await import("./provider-transport-fetch.js");
      const response = await buildGuardedModelFetch(anthropicModel)(
        "https://api.anthropic.com/v1/messages",
        { method: "POST" },
      );

      expect(response.headers.get("x-should-retry")).toBeNull();
    });

    it("ignores long retry-after on non-429 responses", async () => {
      fetchWithSsrFGuardMock.mockResolvedValue({
        response: new Response(null, {
          status: 503,
          headers: { "retry-after": "239" },
        }),
        finalUrl: "https://api.anthropic.com/v1/messages",
        release: vi.fn(async () => undefined),
      });

      const { buildGuardedModelFetch } = await import("./provider-transport-fetch.js");
      const response = await buildGuardedModelFetch(anthropicModel)(
        "https://api.anthropic.com/v1/messages",
        { method: "POST" },
      );

      expect(response.headers.get("x-should-retry")).toBeNull();
    });
  });
});
