import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectContainerEnvironment, resolveDaemonContainerContext } from "./container-context.js";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
  },
}));

describe("resolveDaemonContainerContext", () => {
  it("prefers explicit OpenClaw container hints", () => {
    expect(
      resolveDaemonContainerContext({
        OPENCLAW_CONTAINER: "openclaw-demo-container",
      }),
    ).toBe("openclaw-demo-container");
    expect(
      resolveDaemonContainerContext({
        OPENCLAW_CONTAINER_HINT: "openclaw-demo-container",
      }),
    ).toBe("openclaw-demo-container");
  });
});

describe("detectContainerEnvironment", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it("returns true when explicit OpenClaw container hints are present", () => {
    expect(detectContainerEnvironment({ OPENCLAW_CONTAINER_HINT: "openclaw-demo-container" })).toBe(
      true,
    );
  });

  it("returns true for generic container env markers", () => {
    expect(detectContainerEnvironment({ container: "docker" })).toBe(true);
    expect(detectContainerEnvironment({ CONTAINER: "podman" })).toBe(true);
  });

  it("returns true when common Linux container marker files exist", () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (path) => path === "/.dockerenv" || path === "/run/.containerenv",
    );

    expect(detectContainerEnvironment({})).toBe(true);
  });

  it("returns false when no hints or markers are present", () => {
    expect(detectContainerEnvironment({})).toBe(false);
  });
});
