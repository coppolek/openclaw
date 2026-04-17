// Regression tests for the channel: prefix stripping fix in bind().
//
// Bug: sessions_spawn({ thread: true }) from a Discord channel always produced
// BINDING_CREATE_FAILED because conversationId "channel:<id>" survived into
// resolveChannelIdForBinding(), which passed it to GET /channels/channel:<id> —
// an invalid Discord snowflake.
//
// Fix: strip the channel: prefix only in the placement==="child" path, immediately
// before the resolveChannelIdForBinding() call. The placement==="current" path uses
// conversationId as a binding registry key in its canonical channel:<id> form and
// must not be changed — inbound lookups still arrive with the prefix intact.

import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/config-runtime";
import { getSessionBindingService } from "openclaw/plugin-sdk/conversation-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../send.messages.js", () => ({
  createThreadDiscord: vi.fn().mockResolvedValue({ id: "thread-created" }),
}));

const { __testing, createThreadBindingManager } = await import("./thread-bindings.manager.js");
const discordThreadBindingApi = await import("./thread-bindings.discord-api.js");

const baseConfig = {
  session: { mainKey: "main", scope: "per-sender" },
} satisfies OpenClawConfig;

const CHANNEL_ID_WITH_PREFIX = "channel:123456789012345678";
const CHANNEL_ID_BARE = "123456789012345678";
const PARENT_CHANNEL_ID = "987654321098765432";

describe("Discord bind() — channel: prefix handling", () => {
  beforeEach(() => {
    __testing.resetThreadBindingsForTests();
    clearRuntimeConfigSnapshot();
    vi.restoreAllMocks();
    setRuntimeConfigSnapshot({
      plugins: { entries: { discord: { enabled: true } } },
    });
    // Spy on all discord-api functions that may be called across both paths.
    // resolveChannelIdForBinding must always be a spy so placement=current tests
    // can assert it was NOT called — vi.restoreAllMocks() runs before each test.
    vi.spyOn(discordThreadBindingApi, "resolveChannelIdForBinding").mockResolvedValue(
      PARENT_CHANNEL_ID,
    );
    vi.spyOn(discordThreadBindingApi, "createWebhookForChannel").mockResolvedValue({
      webhookId: "wh-1",
      webhookToken: "tok-1",
    });
    vi.spyOn(discordThreadBindingApi, "maybeSendBindingMessage").mockResolvedValue(undefined);
  });

  describe("placement === 'child' (thread spawn)", () => {
    beforeEach(() => {
      vi.spyOn(discordThreadBindingApi, "createThreadForBinding").mockResolvedValue("thread-created");
    });

    it("strips channel: prefix before passing conversationId to resolveChannelIdForBinding", async () => {
      createThreadBindingManager({
        accountId: "default",
        cfg: baseConfig,
        persist: false,
        enableSweeper: false,
      });

      const binding = await getSessionBindingService().bind({
        targetSessionKey: "agent:test:acp:child-session",
        targetKind: "session",
        conversation: {
          channel: "discord",
          accountId: "default",
          conversationId: CHANNEL_ID_WITH_PREFIX,
        },
        placement: "child",
        metadata: { agentId: "test" },
      });

      expect(binding).not.toBeNull();
      // The stripped bare ID must reach resolveChannelIdForBinding
      expect(discordThreadBindingApi.resolveChannelIdForBinding).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: CHANNEL_ID_BARE }),
      );
      // The prefixed form must never reach the Discord REST layer
      expect(discordThreadBindingApi.resolveChannelIdForBinding).not.toHaveBeenCalledWith(
        expect.objectContaining({ threadId: CHANNEL_ID_WITH_PREFIX }),
      );
    });

    it("succeeds and creates a thread when conversationId has channel: prefix", async () => {
      createThreadBindingManager({
        accountId: "default",
        cfg: baseConfig,
        persist: false,
        enableSweeper: false,
      });

      const binding = await getSessionBindingService().bind({
        targetSessionKey: "agent:test:acp:child-session",
        targetKind: "session",
        conversation: {
          channel: "discord",
          accountId: "default",
          conversationId: CHANNEL_ID_WITH_PREFIX,
        },
        placement: "child",
        metadata: { agentId: "test" },
      });

      expect(binding).not.toBeNull();
      expect(discordThreadBindingApi.createThreadForBinding).toHaveBeenCalled();
    });
  });

  describe("placement === 'current' (bind to existing channel)", () => {
    it("preserves channel: prefix as the binding registry key", async () => {
      createThreadBindingManager({
        accountId: "default",
        cfg: baseConfig,
        persist: false,
        enableSweeper: false,
      });

      const service = getSessionBindingService();
      const binding = await service.bind({
        targetSessionKey: "agent:test:acp:current-session",
        targetKind: "session",
        conversation: {
          channel: "discord",
          accountId: "default",
          conversationId: CHANNEL_ID_WITH_PREFIX,
        },
        placement: "current",
        metadata: { agentId: "test" },
      });

      expect(binding).not.toBeNull();
      // resolveChannelIdForBinding is a Discord REST call — must NOT fire for current placement
      expect(discordThreadBindingApi.resolveChannelIdForBinding).not.toHaveBeenCalled();
      // Binding must be resolvable using the original prefixed conversationId
      const resolved = service.resolveByConversation({
        channel: "discord",
        accountId: "default",
        conversationId: CHANNEL_ID_WITH_PREFIX,
      });
      expect(resolved).toMatchObject({
        targetSessionKey: "agent:test:acp:current-session",
      });
    });

    it("is not resolvable when looked up with bare (stripped) conversationId", async () => {
      createThreadBindingManager({
        accountId: "default",
        cfg: baseConfig,
        persist: false,
        enableSweeper: false,
      });

      const service = getSessionBindingService();
      await service.bind({
        targetSessionKey: "agent:test:acp:current-session",
        targetKind: "session",
        conversation: {
          channel: "discord",
          accountId: "default",
          conversationId: CHANNEL_ID_WITH_PREFIX,
        },
        placement: "current",
        metadata: { agentId: "test" },
      });

      // Bare ID should not resolve — confirms prefix is preserved in the stored key
      const resolved = service.resolveByConversation({
        channel: "discord",
        accountId: "default",
        conversationId: CHANNEL_ID_BARE,
      });
      expect(resolved).toBeNull();
    });
  });
});
