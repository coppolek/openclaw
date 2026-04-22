import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/plugins/plugin-api.js";

vi.mock("./provider-catalog.js", () => ({
  buildAstraflowProvider: vi.fn(() => ({
    baseUrl: "https://api-us-ca.umodelverse.ai/v1",
    api: "openai-completions",
    models: [],
  })),
  buildAstraflowCnProvider: vi.fn(() => ({
    baseUrl: "https://api.modelverse.cn/v1",
    api: "openai-completions",
    models: [],
  })),
}));

vi.mock("./onboard.js", () => ({
  applyAstraflowConfig: vi.fn((cfg) => cfg),
  applyAstraflowCnConfig: vi.fn((cfg) => cfg),
  ASTRAFLOW_DEFAULT_MODEL_REF: "astraflow/claude-sonnet-4-6",
  ASTRAFLOW_CN_DEFAULT_MODEL_REF: "astraflow-cn/deepseek-ai/DeepSeek-V3.2",
}));

import plugin from "./index.js";

function registerProviders() {
  const registerProviderMock = vi.fn();

  plugin.register(
    createTestPluginApi({
      id: "astraflow",
      name: "UCloud AstraFlow",
      source: "test",
      config: {},
      pluginConfig: {},
      runtime: {} as never,
      registerProvider: registerProviderMock,
    }),
  );

  return registerProviderMock.mock.calls.map((call) => call[0]);
}

describe("astraflow plugin", () => {
  it("registers both global and china providers", () => {
    const providers = registerProviders();

    expect(providers).toHaveLength(2);
    expect(providers[0].id).toBe("astraflow");
    expect(providers[0].label).toBe("UCloud AstraFlow");
    expect(providers[0].envVars).toEqual(["ASTRAFLOW_API_KEY"]);
    expect(providers[0].auth).toHaveLength(1);

    expect(providers[1].id).toBe("astraflow-cn");
    expect(providers[1].label).toBe("UCloud AstraFlow (China)");
    expect(providers[1].envVars).toEqual(["ASTRAFLOW_CN_API_KEY"]);
    expect(providers[1].auth).toHaveLength(1);
  });

  it("global provider has correct auth wizard metadata", () => {
    const providers = registerProviders();
    const globalAuth = providers[0].auth[0];

    expect(globalAuth.id).toBe("api-key");
    expect(globalAuth.wizard.choiceId).toBe("astraflow-api-key");
    expect(globalAuth.wizard.groupId).toBe("astraflow");
  });

  it("china provider has correct auth wizard metadata", () => {
    const providers = registerProviders();
    const cnAuth = providers[1].auth[0];

    expect(cnAuth.id).toBe("api-key");
    expect(cnAuth.wizard.choiceId).toBe("astraflow-cn-api-key");
    expect(cnAuth.wizard.groupId).toBe("astraflow");
  });

  it("global catalog resolves when API key is present", async () => {
    const providers = registerProviders();

    const result = await providers[0].catalog.run({
      config: {},
      env: {},
      resolveProviderApiKey: () => ({ apiKey: "test-key" }),
      resolveProviderAuth: () => ({
        apiKey: "test-key",
        mode: "api_key",
        source: "env",
      }),
    } as never);

    expect(result).not.toBeNull();
    expect(result?.provider?.baseUrl).toBe("https://api-us-ca.umodelverse.ai/v1");
    expect(result?.provider?.api).toBe("openai-completions");
  });

  it("china catalog resolves when API key is present", async () => {
    const providers = registerProviders();

    const result = await providers[1].catalog.run({
      config: {},
      env: {},
      resolveProviderApiKey: () => ({ apiKey: "test-key" }),
      resolveProviderAuth: () => ({
        apiKey: "test-key",
        mode: "api_key",
        source: "env",
      }),
    } as never);

    expect(result).not.toBeNull();
    expect(result?.provider?.baseUrl).toBe("https://api.modelverse.cn/v1");
    expect(result?.provider?.api).toBe("openai-completions");
  });

  it("catalog returns null when no API key is available", async () => {
    const providers = registerProviders();

    const result = await providers[0].catalog.run({
      config: {},
      env: {},
      resolveProviderApiKey: () => ({ apiKey: undefined }),
      resolveProviderAuth: () => null,
    } as never);

    expect(result).toBeNull();
  });
});
