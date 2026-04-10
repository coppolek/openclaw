import { describe, expect, it } from "vitest";
import {
  buildGoogleVertexProvider,
  mergeImplicitGoogleVertexProvider,
} from "./vertex-provider-catalog.js";

describe("buildGoogleVertexProvider", () => {
  it("builds provider with default region", () => {
    const provider = buildGoogleVertexProvider({
      env: {
        GOOGLE_CLOUD_PROJECT: "test-project",
      } as NodeJS.ProcessEnv,
    });
    expect(provider.baseUrl).toBe("https://us-central1-aiplatform.googleapis.com");
    expect(provider.api).toBe("google-generative-ai");
    expect(provider.apiKey).toBe("gcp-vertex-google-credentials");
    expect(provider.headers?.["x-openclaw-vertex-project-id"]).toBe("test-project");
    expect(provider.headers?.["x-openclaw-vertex-location"]).toBe("us-central1");
    expect(provider.models).toBeDefined();
    expect(provider.models!.length).toBeGreaterThan(0);
  });

  it("uses custom region", () => {
    const provider = buildGoogleVertexProvider({
      env: {
        GOOGLE_CLOUD_LOCATION: "europe-west4",
        GOOGLE_CLOUD_PROJECT: "eu-project",
      } as NodeJS.ProcessEnv,
    });
    expect(provider.baseUrl).toBe("https://europe-west4-aiplatform.googleapis.com");
    expect(provider.headers?.["x-openclaw-vertex-project-id"]).toBe("eu-project");
    expect(provider.headers?.["x-openclaw-vertex-location"]).toBe("europe-west4");
  });

  it("omits project header when no project available", () => {
    const provider = buildGoogleVertexProvider({
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/path.json",
      } as NodeJS.ProcessEnv,
    });
    expect(provider.headers?.["x-openclaw-vertex-project-id"]).toBeUndefined();
  });

  it("includes Gemini models in catalog", () => {
    const provider = buildGoogleVertexProvider({
      env: {} as NodeJS.ProcessEnv,
    });
    const modelIds = provider.models!.map((m) => m.id);
    expect(modelIds).toContain("gemini-3.1-pro-preview");
    expect(modelIds).toContain("gemini-3-flash-preview");
  });
});

describe("mergeImplicitGoogleVertexProvider", () => {
  it("returns implicit when no existing config", () => {
    const implicit = buildGoogleVertexProvider({
      env: { GOOGLE_CLOUD_PROJECT: "p" } as NodeJS.ProcessEnv,
    });
    const merged = mergeImplicitGoogleVertexProvider({ existing: undefined, implicit });
    expect(merged).toBe(implicit);
  });

  it("merges existing over implicit", () => {
    const implicit = buildGoogleVertexProvider({
      env: { GOOGLE_CLOUD_PROJECT: "p" } as NodeJS.ProcessEnv,
    });
    const existing = {
      baseUrl: "https://europe-west4-aiplatform.googleapis.com",
      headers: { "x-custom": "1" },
      models: [],
    };
    const merged = mergeImplicitGoogleVertexProvider({ existing, implicit });
    expect(merged.baseUrl).toBe("https://europe-west4-aiplatform.googleapis.com");
    expect(merged.headers?.["x-custom"]).toBe("1");
  });

  it("uses implicit models when existing has none", () => {
    const implicit = buildGoogleVertexProvider({
      env: { GOOGLE_CLOUD_PROJECT: "p" } as NodeJS.ProcessEnv,
    });
    const existing = { baseUrl: "https://us-west1-aiplatform.googleapis.com", models: [] };
    const merged = mergeImplicitGoogleVertexProvider({ existing, implicit });
    expect(merged.models).toEqual(implicit.models);
  });
});
