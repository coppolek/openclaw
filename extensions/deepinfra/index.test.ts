import { captureEnv } from "openclaw/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSingleProviderPlugin } from "../../test/helpers/plugins/plugin-registration.js";
import deepinfraPlugin from "./index.js";
import { DEEPINFRA_MODEL_CATALOG } from "./provider-models.js";

const discoverDeepInfraModelsMock = vi.hoisted(() => vi.fn());

vi.mock("./provider-models.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./provider-models.js")>();
  return {
    ...mod,
    discoverDeepInfraModels: discoverDeepInfraModelsMock,
  };
});

describe("deepinfra augmentModelCatalog auth gate", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    envSnapshot = captureEnv(["DEEPINFRA_API_KEY"]);
    discoverDeepInfraModelsMock.mockReset();
  });

  afterEach(() => {
    envSnapshot.restore();
  });

  it("skips live discovery and returns the static catalog when unconfigured", async () => {
    delete process.env.DEEPINFRA_API_KEY;
    const provider = await registerSingleProviderPlugin(deepinfraPlugin);

    const entries = await provider.augmentModelCatalog?.({
      env: process.env,
      entries: [],
    } as never);

    expect(discoverDeepInfraModelsMock).not.toHaveBeenCalled();
    expect(entries).toHaveLength(DEEPINFRA_MODEL_CATALOG.length);
    expect(entries?.[0]?.provider).toBe("deepinfra");
    expect(entries?.[0]?.id).toBe(DEEPINFRA_MODEL_CATALOG[0]?.id);
  });

  it("calls live discovery when DEEPINFRA_API_KEY is set", async () => {
    process.env.DEEPINFRA_API_KEY = "test-key";
    discoverDeepInfraModelsMock.mockResolvedValue([
      {
        id: "acme/discovered",
        name: "Discovered",
        reasoning: true,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ]);

    const provider = await registerSingleProviderPlugin(deepinfraPlugin);

    const entries = await provider.augmentModelCatalog?.({
      env: process.env,
      entries: [],
    } as never);

    expect(discoverDeepInfraModelsMock).toHaveBeenCalledTimes(1);
    expect(entries).toEqual([
      {
        provider: "deepinfra",
        id: "acme/discovered",
        name: "Discovered",
        reasoning: true,
        input: ["text"],
        contextWindow: 128000,
      },
    ]);
  });
});
