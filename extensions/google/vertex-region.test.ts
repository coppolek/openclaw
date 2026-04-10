import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveGoogleVertexRegion,
  resolveGoogleVertexRegionFromBaseUrl,
  resolveGoogleVertexClientRegion,
  resolveGoogleVertexProjectId,
  resolveGoogleVertexBaseUrl,
  hasGoogleVertexCredentials,
  resolveGoogleVertexConfigApiKey,
} from "./vertex-region.js";

describe("resolveGoogleVertexRegion", () => {
  it("defaults to us-central1", () => {
    expect(resolveGoogleVertexRegion({})).toBe("us-central1");
  });

  it("reads GOOGLE_CLOUD_LOCATION", () => {
    expect(resolveGoogleVertexRegion({ GOOGLE_CLOUD_LOCATION: "europe-west4" })).toBe(
      "europe-west4",
    );
  });

  it("reads CLOUD_ML_REGION as fallback", () => {
    expect(resolveGoogleVertexRegion({ CLOUD_ML_REGION: "asia-east1" })).toBe("asia-east1");
  });

  it("prefers GOOGLE_CLOUD_LOCATION over CLOUD_ML_REGION", () => {
    expect(
      resolveGoogleVertexRegion({
        GOOGLE_CLOUD_LOCATION: "us-west1",
        CLOUD_ML_REGION: "europe-west4",
      }),
    ).toBe("us-west1");
  });

  it("rejects invalid region strings", () => {
    expect(resolveGoogleVertexRegion({ GOOGLE_CLOUD_LOCATION: "not valid!" })).toBe("us-central1");
  });
});

describe("resolveGoogleVertexRegionFromBaseUrl", () => {
  it("parses regional Vertex endpoints", () => {
    expect(
      resolveGoogleVertexRegionFromBaseUrl("https://europe-west4-aiplatform.googleapis.com"),
    ).toBe("europe-west4");
  });

  it("treats the global Vertex endpoint as global", () => {
    expect(resolveGoogleVertexRegionFromBaseUrl("https://aiplatform.googleapis.com")).toBe(
      "global",
    );
  });

  it("returns undefined for non-Vertex URLs", () => {
    expect(
      resolveGoogleVertexRegionFromBaseUrl("https://generativelanguage.googleapis.com"),
    ).toBeUndefined();
  });
});

describe("resolveGoogleVertexClientRegion", () => {
  it("prefers baseUrl region over env", () => {
    expect(
      resolveGoogleVertexClientRegion({
        baseUrl: "https://europe-west4-aiplatform.googleapis.com",
        env: { GOOGLE_CLOUD_LOCATION: "us-west1" },
      }),
    ).toBe("europe-west4");
  });

  it("falls back to env when no baseUrl", () => {
    expect(
      resolveGoogleVertexClientRegion({
        env: { GOOGLE_CLOUD_LOCATION: "asia-east1" },
      }),
    ).toBe("asia-east1");
  });
});

describe("resolveGoogleVertexProjectId", () => {
  it("reads GOOGLE_CLOUD_PROJECT", () => {
    expect(resolveGoogleVertexProjectId({ GOOGLE_CLOUD_PROJECT: "my-project" })).toBe("my-project");
  });

  it("reads GOOGLE_CLOUD_PROJECT_ID as fallback", () => {
    expect(resolveGoogleVertexProjectId({ GOOGLE_CLOUD_PROJECT_ID: "other-project" })).toBe(
      "other-project",
    );
  });

  it("reads from ADC file", () => {
    const adcDir = join(tmpdir(), `vertex-region-test-${Date.now()}`);
    mkdirSync(adcDir, { recursive: true });
    const adcPath = join(adcDir, "adc.json");
    writeFileSync(adcPath, JSON.stringify({ project_id: "adc-project" }));
    try {
      expect(resolveGoogleVertexProjectId({ GOOGLE_APPLICATION_CREDENTIALS: adcPath })).toBe(
        "adc-project",
      );
    } finally {
      rmSync(adcDir, { recursive: true, force: true });
    }
  });

  it("returns undefined with no credentials", () => {
    expect(
      resolveGoogleVertexProjectId({
        GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/path.json",
      }),
    ).toBeUndefined();
  });
});

describe("resolveGoogleVertexBaseUrl", () => {
  it("builds regional URL", () => {
    expect(resolveGoogleVertexBaseUrl("us-central1")).toBe(
      "https://us-central1-aiplatform.googleapis.com",
    );
  });

  it("builds global URL", () => {
    expect(resolveGoogleVertexBaseUrl("global")).toBe("https://aiplatform.googleapis.com");
  });
});

describe("hasGoogleVertexCredentials", () => {
  it("returns false when no ADC available", () => {
    expect(
      hasGoogleVertexCredentials({
        GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/path.json",
      }),
    ).toBe(false);
  });

  it("returns true when ADC file exists", () => {
    const adcDir = join(tmpdir(), `vertex-cred-test-${Date.now()}`);
    mkdirSync(adcDir, { recursive: true });
    const adcPath = join(adcDir, "adc.json");
    writeFileSync(adcPath, JSON.stringify({ project_id: "test" }));
    try {
      expect(hasGoogleVertexCredentials({ GOOGLE_APPLICATION_CREDENTIALS: adcPath })).toBe(true);
    } finally {
      rmSync(adcDir, { recursive: true, force: true });
    }
  });
});

describe("resolveGoogleVertexConfigApiKey", () => {
  it("returns marker when credentials available", () => {
    const adcDir = join(tmpdir(), `vertex-apikey-test-${Date.now()}`);
    mkdirSync(adcDir, { recursive: true });
    const adcPath = join(adcDir, "adc.json");
    writeFileSync(adcPath, JSON.stringify({ project_id: "test" }));
    try {
      expect(resolveGoogleVertexConfigApiKey({ GOOGLE_APPLICATION_CREDENTIALS: adcPath })).toBe(
        "gcp-vertex-google-credentials",
      );
    } finally {
      rmSync(adcDir, { recursive: true, force: true });
    }
  });

  it("returns undefined when no credentials", () => {
    expect(
      resolveGoogleVertexConfigApiKey({
        GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/path.json",
      }),
    ).toBeUndefined();
  });
});
