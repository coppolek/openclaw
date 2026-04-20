import os from "node:os";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSubagentSpawnTestConfig,
  loadSubagentSpawnModuleForTest,
} from "./subagent-spawn.test-helpers.js";

// Covers the gap that mofolo's #64864 hook cannot fill on its own: when the
// tool-wiring layer (pi-tools / tool-resolution) doesn't populate
// ctx.agent{To,ThreadId} on the spawn call (e.g. router-style top-level-agent
// flows where the current invocation isn't a fresh inbound), the spawned child
// must still inherit the parent session's stored deliveryContext so outbound
// replies route back to the originating thread.

const hoisted = vi.hoisted(() => ({
  callGatewayMock: vi.fn(),
  updateSessionStoreMock: vi.fn(),
  configOverride: {} as Record<string, unknown>,
  parentEntry: undefined as Record<string, unknown> | undefined,
}));

let spawnSubagentDirect: typeof import("./subagent-spawn.js").spawnSubagentDirect;
let resetSubagentRegistryForTests: typeof import("./subagent-registry.js").resetSubagentRegistryForTests;

function configWithMain() {
  return createSubagentSpawnTestConfig(os.tmpdir(), {
    agents: {
      defaults: { workspace: os.tmpdir() },
      list: [{ id: "main", workspace: "/tmp/workspace-main" }],
    },
  });
}

function captureAgentCallsForChild(childKeyPattern: RegExp) {
  const calls: Array<Record<string, unknown>> = [];
  hoisted.callGatewayMock.mockImplementation(
    async (request: { method?: string; params?: unknown }) => {
      if (request.method === "agent") {
        const params = request.params as { sessionKey?: string } & Record<string, unknown>;
        if (typeof params?.sessionKey === "string" && childKeyPattern.test(params.sessionKey)) {
          calls.push(params);
        }
        return { runId: "run-1" };
      }
      if (request.method?.startsWith("sessions.")) {
        return { ok: true };
      }
      return { ok: true };
    },
  );
  return calls;
}

describe("spawnSubagentDirect parent-context backfill", () => {
  beforeAll(async () => {
    ({ spawnSubagentDirect, resetSubagentRegistryForTests } = await loadSubagentSpawnModuleForTest({
      callGatewayMock: hoisted.callGatewayMock,
      loadConfig: () => hoisted.configOverride,
      updateSessionStoreMock: hoisted.updateSessionStoreMock,
      resolveAgentConfig: () => undefined,
      resolveSubagentSpawnModelSelection: () => "openai-codex/gpt-5.4",
      resolveSandboxRuntimeStatus: () => ({ sandboxed: false }),
      sessionStorePath: "/tmp/subagent-spawn-backfill.json",
      resetModules: false,
      parentSessionEntry: undefined,
    }));
  });

  beforeEach(() => {
    resetSubagentRegistryForTests();
    hoisted.callGatewayMock.mockReset();
    hoisted.updateSessionStoreMock.mockReset();
    hoisted.configOverride = configWithMain();
    hoisted.parentEntry = undefined;

    hoisted.updateSessionStoreMock.mockImplementation(
      async (
        _storePath: string,
        mutator: (store: Record<string, Record<string, unknown>>) => unknown,
      ) => {
        const store: Record<string, Record<string, unknown>> = {};
        await mutator(store);
        return store;
      },
    );
  });

  it("inherits parent deliveryContext when ctx.agent{To,ThreadId} are absent", async () => {
    // Reload the module with a parent entry that mimics a Slack thread session.
    ({ spawnSubagentDirect, resetSubagentRegistryForTests } = await loadSubagentSpawnModuleForTest({
      callGatewayMock: hoisted.callGatewayMock,
      loadConfig: () => hoisted.configOverride,
      updateSessionStoreMock: hoisted.updateSessionStoreMock,
      resolveAgentConfig: () => undefined,
      resolveSubagentSpawnModelSelection: () => "openai-codex/gpt-5.4",
      resolveSandboxRuntimeStatus: () => ({ sandboxed: false }),
      sessionStorePath: "/tmp/subagent-spawn-backfill.json",
      resetModules: true,
      parentSessionEntry: {
        deliveryContext: {
          channel: "slack",
          to: "channel:C0ACJ9D6E4W",
          threadId: "1775970111.589749",
        },
      },
    }));

    const agentCalls = captureAgentCallsForChild(/^agent:main:subagent:/);

    const result = await spawnSubagentDirect(
      {
        task: "do thing",
        runTimeoutSeconds: 1,
        cleanup: "keep",
      },
      {
        agentSessionKey: "main",
        // Intentionally omit agentTo / agentThreadId — this is the failure mode.
      },
    );

    expect(result.status).toBe("accepted");

    // The backfilled delivery context must reach the gateway `agent` call so
    // gateway-side seeding (server-methods/agent.ts) writes it onto the child
    // session entry. Outbound replies then thread correctly.
    const agentCall = agentCalls[0];
    expect(agentCall).toBeDefined();
    expect(agentCall).toMatchObject({
      channel: "slack",
      to: "channel:C0ACJ9D6E4W",
      threadId: "1775970111.589749",
    });
  });

  it("does not cross channels when ctx and parent disagree", async () => {
    ({ spawnSubagentDirect, resetSubagentRegistryForTests } = await loadSubagentSpawnModuleForTest({
      callGatewayMock: hoisted.callGatewayMock,
      loadConfig: () => hoisted.configOverride,
      updateSessionStoreMock: hoisted.updateSessionStoreMock,
      resolveAgentConfig: () => undefined,
      resolveSubagentSpawnModelSelection: () => "openai-codex/gpt-5.4",
      resolveSandboxRuntimeStatus: () => ({ sandboxed: false }),
      sessionStorePath: "/tmp/subagent-spawn-backfill.json",
      resetModules: true,
      parentSessionEntry: {
        deliveryContext: {
          channel: "slack",
          to: "channel:C0ACJ9D6E4W",
          threadId: "1775970111.589749",
        },
      },
    }));

    const agentCalls = captureAgentCallsForChild(/^agent:main:subagent:/);

    const result = await spawnSubagentDirect(
      {
        task: "do thing",
        runTimeoutSeconds: 1,
        cleanup: "keep",
      },
      {
        agentSessionKey: "main",
        agentChannel: "discord",
        // No discord to/threadId — and parent's slack to/threadId must NOT leak.
      },
    );

    expect(result.status).toBe("accepted");

    const agentCall = agentCalls[0];
    expect(agentCall).toBeDefined();
    // mergeDeliveryContext's channelsConflict guard drops the parent's
    // route fields when channels disagree.
    expect(agentCall?.channel).toBe("discord");
    expect(agentCall?.to).toBeUndefined();
    expect(agentCall?.threadId).toBeUndefined();
  });

  it("does not inherit parent threadId when ctx targets a different `to`", async () => {
    // Router awoken by an internal trigger explicitly addresses a different
    // channel member (C999) at root-level with no threadId. Parent session has
    // a stored threadId from a prior conversation in C111. The backfill must
    // NOT fold parent's stale threadId into the root-level spawn to C999.
    ({ spawnSubagentDirect, resetSubagentRegistryForTests } = await loadSubagentSpawnModuleForTest({
      callGatewayMock: hoisted.callGatewayMock,
      loadConfig: () => hoisted.configOverride,
      updateSessionStoreMock: hoisted.updateSessionStoreMock,
      resolveAgentConfig: () => undefined,
      resolveSubagentSpawnModelSelection: () => "openai-codex/gpt-5.4",
      resolveSandboxRuntimeStatus: () => ({ sandboxed: false }),
      sessionStorePath: "/tmp/subagent-spawn-backfill.json",
      resetModules: true,
      parentSessionEntry: {
        deliveryContext: {
          channel: "slack",
          to: "channel:C111",
          threadId: "1775970111.589749",
        },
      },
    }));

    const agentCalls = captureAgentCallsForChild(/^agent:main:subagent:/);

    const result = await spawnSubagentDirect(
      {
        task: "do thing",
        runTimeoutSeconds: 1,
        cleanup: "keep",
      },
      {
        agentSessionKey: "main",
        agentChannel: "slack",
        agentTo: "channel:C999",
        // Intentionally no agentThreadId — root-level spawn to a different `to`.
      },
    );

    expect(result.status).toBe("accepted");

    const agentCall = agentCalls[0];
    expect(agentCall).toBeDefined();
    expect(agentCall?.channel).toBe("slack");
    expect(agentCall?.to).toBe("channel:C999");
    // Parent's threadId must not leak into a different conversation.
    expect(agentCall?.threadId).toBeUndefined();
  });

  it("ctx values win over parent deliveryContext when both are present", async () => {
    ({ spawnSubagentDirect, resetSubagentRegistryForTests } = await loadSubagentSpawnModuleForTest({
      callGatewayMock: hoisted.callGatewayMock,
      loadConfig: () => hoisted.configOverride,
      updateSessionStoreMock: hoisted.updateSessionStoreMock,
      resolveAgentConfig: () => undefined,
      resolveSubagentSpawnModelSelection: () => "openai-codex/gpt-5.4",
      resolveSandboxRuntimeStatus: () => ({ sandboxed: false }),
      sessionStorePath: "/tmp/subagent-spawn-backfill.json",
      resetModules: true,
      parentSessionEntry: {
        deliveryContext: {
          channel: "slack",
          to: "channel:STALE",
          threadId: "1700000000.000000",
        },
      },
    }));

    const agentCalls = captureAgentCallsForChild(/^agent:main:subagent:/);

    const result = await spawnSubagentDirect(
      {
        task: "do thing",
        runTimeoutSeconds: 1,
        cleanup: "keep",
      },
      {
        agentSessionKey: "main",
        agentChannel: "slack",
        agentTo: "channel:CURRENT",
        agentThreadId: "1776000000.111111",
      },
    );

    expect(result.status).toBe("accepted");

    const agentCall = agentCalls[0];
    expect(agentCall).toBeDefined();
    expect(agentCall).toMatchObject({
      channel: "slack",
      to: "channel:CURRENT",
      threadId: "1776000000.111111",
    });
  });

  it("child session entry is seeded with parent deliveryContext after spawn", async () => {
    // End-to-end assertion on the *persisted* child entry (not just the
    // gateway `agent` call params). The spawn path carries the parent's
    // delivery hint to the gateway `agent` call; the gateway then merges it
    // onto the child's session entry (see gateway/server-methods/agent.ts
    // seeding block). This test simulates that seeding so a regression in
    // either half of the chain — ctx backfill on spawn, or gateway-side
    // merge — fails loudly.
    ({ spawnSubagentDirect, resetSubagentRegistryForTests } = await loadSubagentSpawnModuleForTest({
      callGatewayMock: hoisted.callGatewayMock,
      loadConfig: () => hoisted.configOverride,
      updateSessionStoreMock: hoisted.updateSessionStoreMock,
      resolveAgentConfig: () => undefined,
      resolveSubagentSpawnModelSelection: () => "openai-codex/gpt-5.4",
      resolveSandboxRuntimeStatus: () => ({ sandboxed: false }),
      sessionStorePath: "/tmp/subagent-spawn-backfill.json",
      resetModules: true,
      parentSessionEntry: {
        deliveryContext: {
          channel: "slack",
          to: "channel:C0ACJ9D6E4W",
          threadId: "1775970111.589749",
        },
      },
    }));

    const gatewayStore: Record<string, Record<string, unknown>> = {};
    hoisted.callGatewayMock.mockImplementation(
      async (request: { method?: string; params?: unknown }) => {
        const method = request.method;
        const params = (request.params ?? {}) as Record<string, unknown>;
        if (method === "sessions.patch" && typeof params.key === "string") {
          const { key, ...patch } = params as { key: string } & Record<string, unknown>;
          gatewayStore[key] = { ...gatewayStore[key], ...patch };
          return { ok: true };
        }
        if (method === "agent" && typeof params.sessionKey === "string") {
          const sessionKey = params.sessionKey;
          const existing = (gatewayStore[sessionKey]?.deliveryContext ?? {}) as Record<
            string,
            unknown
          >;
          const hint: Record<string, unknown> = {};
          if (typeof params.channel === "string" && params.channel) {
            hint.channel = params.channel;
          }
          if (typeof params.to === "string" && params.to) {
            hint.to = params.to;
          }
          if (params.threadId != null && params.threadId !== "") {
            hint.threadId = params.threadId;
          }
          if (typeof params.accountId === "string" && params.accountId) {
            hint.accountId = params.accountId;
          }
          // Mirrors mergeDeliveryContext(primary=existing, fallback=hint):
          // existing wins, hint fills gaps. Later spread keys beat earlier.
          gatewayStore[sessionKey] = {
            ...gatewayStore[sessionKey],
            deliveryContext: { ...hint, ...existing },
          };
          return { runId: "run-1" };
        }
        return { ok: true };
      },
    );

    const result = await spawnSubagentDirect(
      {
        task: "do thing",
        runTimeoutSeconds: 1,
        cleanup: "keep",
      },
      {
        agentSessionKey: "main",
        // Intentionally omit agentTo / agentThreadId — forces the backfill
        // path to fill the child entry from the parent's stored context.
      },
    );

    expect(result.status).toBe("accepted");

    const childKey = Object.keys(gatewayStore).find((k) => k.startsWith("agent:main:subagent:"));
    expect(childKey).toBeDefined();
    const childEntry = gatewayStore[childKey as string];
    expect(childEntry?.deliveryContext).toMatchObject({
      channel: "slack",
      to: "channel:C0ACJ9D6E4W",
      threadId: "1775970111.589749",
    });
  });
});
