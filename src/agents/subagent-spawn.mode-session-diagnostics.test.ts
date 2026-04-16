import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSubagentSpawnTestConfig,
  loadSubagentSpawnModuleForTest,
} from "./subagent-spawn.test-helpers.js";

/**
 * Regression coverage for #67400 -- the previously-confusing error cascade
 * when a channel did not support thread bindings. Prior behaviour:
 *   1) `mode="session"` -> "requires thread=true"
 *   2) `mode="session", thread=true` -> "thread=true is unavailable because no channel plugin registered subagent_spawning hooks"
 * The user had no path forward. These tests lock in the actionable diagnostics.
 */
describe('spawnSubagentDirect mode="session" diagnostics (#67400)', () => {
  const callGatewayMock = vi.fn();
  let spawnSubagentDirect: typeof import("./subagent-spawn.js").spawnSubagentDirect;
  let resetSubagentRegistryForTests: typeof import("./subagent-registry.js").resetSubagentRegistryForTests;

  beforeEach(async () => {
    callGatewayMock.mockReset();
    ({ spawnSubagentDirect, resetSubagentRegistryForTests } = await loadSubagentSpawnModuleForTest({
      callGatewayMock,
      loadConfig: () => createSubagentSpawnTestConfig(os.tmpdir()),
      workspaceDir: os.tmpdir(),
      // No hookRunner override -> default `{ hasHooks: () => false }` simulates
      // a channel (webchat, CLI, ...) that never registered subagent_spawning.
    }));
    resetSubagentRegistryForTests();
  });

  it("collapses the deadlock into one actionable message when the channel lacks thread hooks", async () => {
    // The reporter's first retry hit "mode=session requires thread=true", the
    // second hit "thread=true is unavailable". With no hook registered we can
    // detect that thread=true would also fail, so the first response should
    // already point at the viable alternatives.
    const result = await spawnSubagentDirect(
      {
        task: "persistent planning session",
        mode: "session",
      },
      {
        agentSessionKey: "agent:main:main",
        agentChannel: "webchat",
      },
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toContain("not running on a channel");
      // Must mention both escape hatches so the user is never stuck.
      expect(result.error).toContain('mode="run"');
      expect(result.error).toContain("sessions_send");
      // Must NOT tell the user to retry with thread=true when we already know
      // thread=true cannot be satisfied on this channel.
      expect(result.error).not.toContain("thread=true");
    }
  });

  it("rejects thread=true on the same channel with the same actionable guidance", async () => {
    const result = await spawnSubagentDirect(
      {
        task: "persistent planning session",
        mode: "session",
        thread: true,
      },
      {
        agentSessionKey: "agent:main:main",
        agentChannel: "webchat",
      },
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      // The second-try path ("thread=true is unavailable") should now also
      // hand the user both recovery options rather than just re-stating the
      // constraint.
      expect(result.error).toContain("not running on a channel");
      expect(result.error).toContain('mode="run"');
      expect(result.error).toContain("sessions_send");
    }
  });
});

describe('spawnSubagentDirect mode="session" on a thread-capable channel (#67400)', () => {
  const callGatewayMock = vi.fn();
  let spawnSubagentDirect: typeof import("./subagent-spawn.js").spawnSubagentDirect;
  let resetSubagentRegistryForTests: typeof import("./subagent-registry.js").resetSubagentRegistryForTests;

  beforeEach(async () => {
    callGatewayMock.mockReset();
    ({ spawnSubagentDirect, resetSubagentRegistryForTests } = await loadSubagentSpawnModuleForTest({
      callGatewayMock,
      loadConfig: () => createSubagentSpawnTestConfig(os.tmpdir()),
      workspaceDir: os.tmpdir(),
      // Simulate a channel (e.g. Discord) that HAS registered subagent_spawning.
      hookRunner: {
        hasHooks: () => true,
        runSubagentSpawning: async () => ({
          status: "ok" as const,
          threadBindingReady: true,
        }),
      },
    }));
    resetSubagentRegistryForTests();
  });

  it("still tells the user to retry with thread=true when the channel supports it", async () => {
    const result = await spawnSubagentDirect(
      {
        task: "persistent planning session",
        mode: "session",
      },
      {
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
      },
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      // When the channel CAN satisfy thread=true, keep steering the user
      // toward that path instead of away from the feature entirely.
      expect(result.error).toContain("thread: true");
      expect(result.error).toContain('mode="run"');
      expect(result.error).not.toContain("not running on a channel");
    }
  });
});
