import type { Model } from "@mariozechner/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("forwards optional auditContext into the shared guarded fetch seam", async () => {
    const { buildGuardedModelFetch } = await import("./provider-transport-fetch.js");
    const model = {
      id: "plamo-3.0-prime-beta",
      provider: "plamo",
      api: "openai-completions",
      baseUrl: "https://api.platform.preferredai.jp/v1",
    } as unknown as Model<"openai-completions">;

    const fetcher = buildGuardedModelFetch(model, { auditContext: "plamo-stream" });
    await fetcher("https://api.platform.preferredai.jp/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"messages":[]}',
    });

    expect(fetchWithSsrFGuardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.platform.preferredai.jp/v1/chat/completions",
        auditContext: "plamo-stream",
      }),
    );
  });

  it("applies resolved transport auth and extra headers before dispatch", async () => {
    resolveProviderRequestPolicyConfigMock.mockReturnValue({
      allowPrivateNetwork: false,
      headers: {
        "X-Tenant": "acme",
        "X-Proxy-Token": "proxy-token",
        "X-Provider": "provider",
      },
      policy: {
        attributionHeaders: {
          "X-Provider": "provider",
        },
      },
      auth: {
        configured: true,
        mode: "header",
        headerName: "X-Proxy-Token",
        value: "proxy-token",
        injectAuthorizationHeader: false,
      },
    } as never);

    const { buildGuardedModelFetch } = await import("./provider-transport-fetch.js");
    const model = {
      id: "plamo-3.0-prime-beta",
      provider: "plamo",
      api: "openai-completions",
      baseUrl: "https://api.platform.preferredai.jp/v1",
    } as unknown as Model<"openai-completions">;

    const fetcher = buildGuardedModelFetch(model);
    await fetcher("https://api.platform.preferredai.jp/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer caller",
        "X-Call": "1",
        "X-Provider": "caller",
      },
      body: '{"messages":[]}',
    });

    const request = fetchWithSsrFGuardMock.mock.calls[0]?.[0] as {
      init?: RequestInit;
    };
    const headers = new Headers(request.init?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-call")).toBe("1");
    expect(headers.get("x-provider")).toBe("provider");
    expect(headers.get("x-proxy-token")).toBe("proxy-token");
    expect(headers.get("x-tenant")).toBe("acme");
  });

  it("keeps configured bearer auth overrides ahead of caller authorization headers", async () => {
    resolveProviderRequestPolicyConfigMock.mockReturnValue({
      allowPrivateNetwork: false,
      headers: {
        Authorization: "Bearer override-token",
      },
      policy: {
        attributionHeaders: {},
      },
      auth: {
        configured: true,
        mode: "authorization-bearer",
        headerName: "Authorization",
        value: "override-token",
        injectAuthorizationHeader: true,
      },
    } as never);

    const { buildGuardedModelFetch } = await import("./provider-transport-fetch.js");
    const model = {
      id: "plamo-3.0-prime-beta",
      provider: "plamo",
      api: "openai-completions",
      baseUrl: "https://api.platform.preferredai.jp/v1",
    } as unknown as Model<"openai-completions">;

    const fetcher = buildGuardedModelFetch(model);
    await fetcher("https://api.platform.preferredai.jp/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer caller",
      },
      body: '{"messages":[]}',
    });

    const request = fetchWithSsrFGuardMock.mock.calls[0]?.[0] as {
      init?: RequestInit;
    };
    const headers = new Headers(request.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer override-token");
  });
});
