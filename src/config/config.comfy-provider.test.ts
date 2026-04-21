import { describe, expect, it, vi } from "vitest";
import { validateConfigObjectWithPlugins } from "./validation.js";

vi.unmock("../version.js");

describe("comfy provider config validation", () => {
  it("accepts bundled comfy provider config on models.providers path", () => {
    const res = validateConfigObjectWithPlugins({
      models: {
        providers: {
          comfy: {
            mode: "local",
            baseUrl: "http://127.0.0.1:8188",
            allowPrivateNetwork: true,
            music: {
              workflowPath: "./workflows/music-api.json",
              promptNodeId: "94",
              promptInputName: "tags",
              outputNodeId: "107",
            },
          },
        },
      },
    });

    expect(res.ok).toBe(true);
  });

  it("rejects invalid bundled comfy provider keys on models.providers path", () => {
    const res = validateConfigObjectWithPlugins({
      models: {
        providers: {
          comfy: {
            mode: "local",
            notARealKey: true,
          },
        },
      },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "models.providers.comfy",
            message: expect.stringContaining("invalid config:"),
          }),
        ]),
      );
    }
  });

  // Regression: providers whose plugin declares a plugin-overlay `configSchema`
  // (for `plugins.entries.<id>.config`) must still validate against the core
  // provider schema at `models.providers.<id>`. Previously the validator
  // matched on any `configSchema` presence, which caused core-only keys
  // like `baseUrl` / `models` to be rejected by the overlay schema.
  it("accepts core provider config for plugins with only a plugin-overlay configSchema", () => {
    const res = validateConfigObjectWithPlugins({
      models: {
        providers: {
          openai: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: "sk-test",
            models: [
              {
                id: "gpt-5.4",
                name: "gpt-5.4",
              },
            ],
          },
        },
      },
    });

    expect(res.ok).toBe(true);
  });
});
