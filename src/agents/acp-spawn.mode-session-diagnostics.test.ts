import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
  type OpenClawConfig,
} from "../config/config.js";

/**
 * Regression coverage for the ACP parity gap flagged on PR #67790 -- the
 * greptile P2 "ACP path still has the two-call dead-end on no-hook channels"
 * (comment id c2fb4007 dated 2026-04-16). Prior to this change:
 *   1) `runtime="acp", mode="session"` -> "requires thread=true"
 *   2) `runtime="acp", mode="session", thread=true` -> "thread=true is
 *       unavailable because no channel plugin registered subagent_spawning hooks"
 * Callers on webchat/CLI had the same documentation-visible deadlock that
 * `spawnSubagentDirect` already collapses. The ACP path now mirrors the same
 * up-front probe.
 */

const hoisted = vi.hoisted(() => ({
  hasHooksMock: vi.fn<(hookName: string) => boolean>(),
}));

vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => ({
    hasHooks: hoisted.hasHooksMock,
  }),
}));

function minimalAcpConfig(): OpenClawConfig {
  return {
    acp: {
      enabled: true,
      backend: "acpx",
      allowedAgents: ["codex"],
    },
    session: {
      mainKey: "main",
      scope: "per-sender",
    },
  } as unknown as OpenClawConfig;
}

describe('spawnAcpDirect mode="session" diagnostics on no-hook channels', () => {
  let spawnAcpDirect: typeof import("./acp-spawn.js").spawnAcpDirect;

  beforeEach(async () => {
    hoisted.hasHooksMock.mockReset();
    // Default: no channel plugin registered subagent_spawning. This is the
    // webchat / CLI shape — the probe should short-circuit before the old
    // "retry with thread=true" guidance fires.
    hoisted.hasHooksMock.mockReturnValue(false);
    setRuntimeConfigSnapshot(minimalAcpConfig());
    ({ spawnAcpDirect } = await import("./acp-spawn.js"));
  });

  afterEach(() => {
    clearRuntimeConfigSnapshot();
  });

  it("collapses the ACP deadlock into one actionable message when no channel has thread hooks", async () => {
    const result = await spawnAcpDirect(
      {
        task: "persistent planning session",
        agentId: "codex",
        mode: "session",
      },
      {
        agentSessionKey: "agent:main:main",
        agentChannel: "webchat",
      },
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.errorCode).toBe("thread_required");
      // Must mention the escape hatch so the user is never stuck.
      expect(result.error).toContain('mode="run"');
      // Must identify ACP specifically so callers on other runtimes don't
      // mistake this for the `runtime="subagent"` path's guidance.
      expect(result.error).toContain('runtime="acp"');
      // Must NOT tell the user to retry with thread=true when we already
      // know thread=true cannot be satisfied on this channel.
      expect(result.error).not.toContain("thread=true");
      expect(result.error).not.toContain("thread: true");
    }
  });

  it("still tells the user to retry with thread=true when some channel supports it", async () => {
    // Simulate a Discord-enabled deployment: the probe returns true, so the
    // original "retry with thread=true" guidance is still the right next step
    // for the caller. (A narrower channel-scoped probe is tracked separately;
    // see the open Codex comment on this PR.)
    hoisted.hasHooksMock.mockReturnValue(true);

    const result = await spawnAcpDirect(
      {
        task: "persistent planning session",
        agentId: "codex",
        mode: "session",
      },
      {
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
      },
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.errorCode).toBe("thread_required");
      expect(result.error).toContain("thread: true");
      expect(result.error).toContain('mode="run"');
    }
  });
});
