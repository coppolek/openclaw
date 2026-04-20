import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpRuntime, AcpRuntimeEvent } from "../runtime-api.js";
import { AcpxRuntime, encodeAcpxRuntimeHandleState } from "./runtime.js";

type TestSessionStore = {
  load(sessionId: string): Promise<Record<string, unknown> | undefined>;
  save(record: Record<string, unknown>): Promise<void>;
};

function makeRuntime(baseStore: TestSessionStore): {
  runtime: AcpxRuntime;
  wrappedStore: TestSessionStore & { markFresh: (sessionKey: string) => void };
  delegate: { close: AcpRuntime["close"] };
} {
  const runtime = new AcpxRuntime({
    cwd: "/tmp",
    sessionStore: baseStore,
    agentRegistry: {
      resolve: () => "codex",
      list: () => ["codex"],
    },
    permissionMode: "approve-reads",
  });

  return {
    runtime,
    wrappedStore: (
      runtime as unknown as {
        sessionStore: TestSessionStore & { markFresh: (sessionKey: string) => void };
      }
    ).sessionStore,
    delegate: (runtime as unknown as { delegate: { close: AcpRuntime["close"] } }).delegate,
  };
}

function toRuntimeSessionName(value: unknown): string {
  return String(value);
}

describe("AcpxRuntime fresh reset wrapper", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps stale persistent loads hidden until a fresh record is saved", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => ({ acpxRecordId: "stale" }) as never),
      save: vi.fn(async () => {}),
    };

    const { runtime, wrappedStore } = makeRuntime(baseStore);

    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toEqual({
      acpxRecordId: "stale",
    });
    expect(baseStore.load).toHaveBeenCalledTimes(1);

    await runtime.prepareFreshSession({
      sessionKey: "agent:codex:acp:binding:test",
    });

    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toBeUndefined();
    expect(baseStore.load).toHaveBeenCalledTimes(1);
    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toBeUndefined();
    expect(baseStore.load).toHaveBeenCalledTimes(1);

    await wrappedStore.save({
      acpxRecordId: "fresh-record",
      name: "agent:codex:acp:binding:test",
    } as never);

    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toEqual({
      acpxRecordId: "stale",
    });
    expect(baseStore.load).toHaveBeenCalledTimes(2);
  });

  it("marks the session fresh after discardPersistentState close", async () => {
    const baseStore: TestSessionStore = {
      load: vi.fn(async () => ({ acpxRecordId: "stale" }) as never),
      save: vi.fn(async () => {}),
    };

    const { runtime, wrappedStore, delegate } = makeRuntime(baseStore);
    const close = vi.spyOn(delegate, "close").mockResolvedValue(undefined);

    await runtime.close({
      handle: {
        sessionKey: "agent:codex:acp:binding:test",
        backend: "acpx",
        runtimeSessionName: "agent:codex:acp:binding:test",
      },
      reason: "new-in-place-reset",
      discardPersistentState: true,
    });

    expect(close).toHaveBeenCalledWith({
      handle: {
        sessionKey: "agent:codex:acp:binding:test",
        backend: "acpx",
        runtimeSessionName: "agent:codex:acp:binding:test",
      },
      reason: "new-in-place-reset",
      discardPersistentState: true,
    });
    expect(await wrappedStore.load("agent:codex:acp:binding:test")).toBeUndefined();
    expect(baseStore.load).not.toHaveBeenCalled();
  });

  it("reuses parked clients between persistent turns", async () => {
    const rawClose = vi.fn(async () => {});
    const createClient = vi.fn(() => ({ close: rawClose }));

    const manager: {
      createClient: (options: Record<string, unknown>) => { close: () => Promise<void> };
      runTurn: (input: Parameters<AcpRuntime["runTurn"]>[0]) => AsyncIterable<AcpRuntimeEvent>;
    } = {
      createClient,
      runTurn: async function* (_input: Parameters<AcpRuntime["runTurn"]>[0]) {
        const client = manager.createClient({
          agentCommand: "claude",
          cwd: "/tmp",
          permissionMode: "approve-reads",
        });
        yield { type: "status", text: "ok" } as const;
        await client.close();
      },
    };

    const runtime = new AcpxRuntime(
      {
        cwd: "/tmp",
        sessionStore: {
          load: vi.fn(async () => undefined),
          save: vi.fn(async () => {}),
        },
        agentRegistry: {
          resolve: () => "claude",
          list: () => ["claude"],
        },
        permissionMode: "approve-reads",
        queueOwnerTtlSeconds: 300,
      },
      {
        managerFactory: () => manager,
      },
    );

    const persistentHandle = {
      sessionKey: "agent:claude:acp:binding:test",
      backend: "acpx",
      runtimeSessionName: toRuntimeSessionName(
        encodeAcpxRuntimeHandleState({
          name: "agent:claude:acp:binding:test",
          agent: "claude",
          cwd: "/tmp",
          mode: "persistent",
          acpxRecordId: "record-1",
          backendSessionId: "backend-1",
        }),
      ),
    };

    for await (const _event of runtime.runTurn({
      handle: persistentHandle,
      text: "first",
      mode: "prompt",
      requestId: "req-1",
    })) {
      // drain events
    }

    for await (const _event of runtime.runTurn({
      handle: persistentHandle,
      text: "second",
      mode: "prompt",
      requestId: "req-2",
    })) {
      // drain events
    }

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(rawClose).not.toHaveBeenCalled();
  });

  it("does not park clients for oneshot turns", async () => {
    const rawClose = vi.fn(async () => {});
    const createClient = vi.fn(() => ({ close: rawClose }));

    const manager: {
      createClient: (options: Record<string, unknown>) => { close: () => Promise<void> };
      runTurn: (input: Parameters<AcpRuntime["runTurn"]>[0]) => AsyncIterable<AcpRuntimeEvent>;
    } = {
      createClient,
      runTurn: async function* (_input: Parameters<AcpRuntime["runTurn"]>[0]) {
        const client = manager.createClient({
          agentCommand: "claude",
          cwd: "/tmp",
          permissionMode: "approve-reads",
        });
        yield { type: "status", text: "ok" } as const;
        await client.close();
      },
    };

    const runtime = new AcpxRuntime(
      {
        cwd: "/tmp",
        sessionStore: {
          load: vi.fn(async () => undefined),
          save: vi.fn(async () => {}),
        },
        agentRegistry: {
          resolve: () => "claude",
          list: () => ["claude"],
        },
        permissionMode: "approve-reads",
        queueOwnerTtlSeconds: 300,
      },
      {
        managerFactory: () => manager,
      },
    );

    const oneshotHandle = {
      sessionKey: "agent:claude:acp:binding:test",
      backend: "acpx",
      runtimeSessionName: toRuntimeSessionName(
        encodeAcpxRuntimeHandleState({
          name: "agent:claude:acp:binding:test",
          agent: "claude",
          cwd: "/tmp",
          mode: "oneshot",
          acpxRecordId: "record-1",
          backendSessionId: "backend-1",
        }),
      ),
    };

    for await (const _event of runtime.runTurn({
      handle: oneshotHandle,
      text: "first",
      mode: "prompt",
      requestId: "req-1",
    })) {
      // drain events
    }

    for await (const _event of runtime.runTurn({
      handle: oneshotHandle,
      text: "second",
      mode: "prompt",
      requestId: "req-2",
    })) {
      // drain events
    }

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(rawClose).toHaveBeenCalledTimes(2);
  });
});
