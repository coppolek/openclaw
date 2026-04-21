import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import { installHeartbeatRunnerTestRuntime } from "./heartbeat-runner.test-harness.js";
import { seedMainSessionStore, withTempHeartbeatSandbox } from "./heartbeat-runner.test-utils.js";

installHeartbeatRunnerTestRuntime();

describe("runHeartbeatOnce – session label uses agent identity name", () => {
  it("sets ConversationLabel to identity.name when configured", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg: OpenClawConfig = {
        agents: {
          list: [
            {
              id: "main",
              identity: { name: "Jarvis" },
              heartbeat: { every: "5m", target: "telegram", to: "123" },
            },
          ],
          defaults: {
            workspace: tmpDir,
          },
        },
        session: { store: storePath },
      };

      await seedMainSessionStore(storePath, cfg, {
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "123",
      });

      replySpy.mockResolvedValue({ text: "HEARTBEAT_OK" });

      await runHeartbeatOnce({
        cfg,
        deps: {
          telegram: vi.fn().mockResolvedValue({ messageId: "m1" }),
          getQueueSize: () => 0,
          nowMs: () => 0,
        },
      });

      expect(replySpy).toHaveBeenCalled();
      const calledCtx = replySpy.mock.calls[0]?.[0] as { ConversationLabel?: string };
      expect(calledCtx.ConversationLabel).toBe("Jarvis");
    });
  });

  it("falls back to agentId when identity.name is not configured", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "5m", target: "telegram", to: "123" },
          },
        },
        session: { store: storePath },
      };

      await seedMainSessionStore(storePath, cfg, {
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "123",
      });

      replySpy.mockResolvedValue({ text: "HEARTBEAT_OK" });

      await runHeartbeatOnce({
        cfg,
        deps: {
          telegram: vi.fn().mockResolvedValue({ messageId: "m1" }),
          getQueueSize: () => 0,
          nowMs: () => 0,
        },
      });

      expect(replySpy).toHaveBeenCalled();
      const calledCtx = replySpy.mock.calls[0]?.[0] as { ConversationLabel?: string };
      // When no identity.name, should fall back to the agentId (default: "main")
      expect(calledCtx.ConversationLabel).toBe("main");
    });
  });

  it("does not use 'heartbeat' as ConversationLabel", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "5m", target: "telegram", to: "456" },
          },
        },
        session: { store: storePath },
      };

      await seedMainSessionStore(storePath, cfg, {
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "456",
      });

      replySpy.mockResolvedValue({ text: "HEARTBEAT_OK" });

      await runHeartbeatOnce({
        cfg,
        deps: {
          telegram: vi.fn().mockResolvedValue({ messageId: "m1" }),
          getQueueSize: () => 0,
          nowMs: () => 0,
        },
      });

      expect(replySpy).toHaveBeenCalled();
      const calledCtx = replySpy.mock.calls[0]?.[0] as { ConversationLabel?: string };
      expect(calledCtx.ConversationLabel).not.toBe("heartbeat");
    });
  });
});
