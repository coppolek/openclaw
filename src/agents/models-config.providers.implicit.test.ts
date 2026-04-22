import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProviderCatalogTimeoutMsForTest } from "./models-config.providers.implicit.js";

const warnSpy = vi.hoisted(() => vi.fn());

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    warn: warnSpy,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }),
}));

describe("resolveProviderCatalogTimeoutMsForTest", () => {
  beforeEach(() => {
    warnSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to 15s in non-live mode", () => {
    expect(resolveProviderCatalogTimeoutMsForTest({})).toBe(15_000);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("uses the explicit non-live override when valid", () => {
    expect(
      resolveProviderCatalogTimeoutMsForTest({
        OPENCLAW_PROVIDER_DISCOVERY_TIMEOUT_MS: "23000",
      }),
    ).toBe(23_000);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns and falls back to the default timeout for invalid explicit overrides", () => {
    expect(
      resolveProviderCatalogTimeoutMsForTest({
        OPENCLAW_PROVIDER_DISCOVERY_TIMEOUT_MS: "abc",
      }),
    ).toBe(15_000);
    expect(warnSpy).toHaveBeenCalledWith(
      'OPENCLAW_PROVIDER_DISCOVERY_TIMEOUT_MS="abc" is not a valid positive integer; using default',
    );
  });

  it("honors the live override when live mode is enabled", () => {
    expect(
      resolveProviderCatalogTimeoutMsForTest({
        OPENCLAW_LIVE_TEST: "1",
        OPENCLAW_LIVE_PROVIDER_DISCOVERY_TIMEOUT_MS: "42000",
      }),
    ).toBe(42_000);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns and falls back to the live default for invalid live overrides", () => {
    expect(
      resolveProviderCatalogTimeoutMsForTest({
        LIVE: "1",
        OPENCLAW_LIVE_PROVIDER_DISCOVERY_TIMEOUT_MS: "0",
      }),
    ).toBe(15_000);
    expect(warnSpy).toHaveBeenCalledWith(
      'OPENCLAW_LIVE_PROVIDER_DISCOVERY_TIMEOUT_MS="0" is not a valid positive integer; using default',
    );
  });
});
