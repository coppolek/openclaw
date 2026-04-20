import {
  ACPX_BACKEND_ID,
  AcpxRuntime as BaseAcpxRuntime,
  createAcpRuntime,
  createAgentRegistry,
  createFileSessionStore,
  decodeAcpxRuntimeHandleState,
  encodeAcpxRuntimeHandleState,
  type AcpAgentRegistry,
  type AcpRuntimeDoctorReport,
  type AcpRuntimeEvent,
  type AcpRuntimeHandle,
  type AcpRuntimeOptions,
  type AcpRuntimeStatus,
} from "acpx/runtime";
import type { AcpRuntime } from "../runtime-api.js";

type AcpSessionStore = AcpRuntimeOptions["sessionStore"];
type AcpSessionRecord = Parameters<AcpSessionStore["save"]>[0];
type AcpLoadedSessionRecord = Awaited<ReturnType<AcpSessionStore["load"]>>;

type AcpClientLike = {
  close: () => Promise<void>;
};

type AcpClientFactoryOptions = {
  agentCommand: string;
  cwd: string;
  mcpServers?: unknown[];
  permissionMode?: unknown;
  nonInteractivePermissions?: unknown;
  verbose?: boolean;
};

type AcpRuntimeManagerLike = {
  createClient: (options: AcpClientFactoryOptions) => AcpClientLike;
  runTurn: (input: Parameters<AcpRuntime["runTurn"]>[0]) => AsyncIterable<AcpRuntimeEvent>;
};

type BaseAcpxRuntimeTestOptions = {
  managerFactory?: (
    options: AcpRuntimeOptions,
  ) => Promise<AcpRuntimeManagerLike> | AcpRuntimeManagerLike;
};

type AcpxRuntimeCompatOptions = AcpRuntimeOptions & {
  queueOwnerTtlSeconds?: number;
};

type ResetAwareSessionStore = AcpSessionStore & {
  markFresh: (sessionKey: string) => void;
};

function readSessionRecordName(record: AcpSessionRecord): string {
  if (typeof record !== "object" || record === null) {
    return "";
  }
  const { name } = record as { name?: unknown };
  return typeof name === "string" ? name.trim() : "";
}

function createResetAwareSessionStore(baseStore: AcpSessionStore): ResetAwareSessionStore {
  const freshSessionKeys = new Set<string>();

  return {
    async load(sessionId: string): Promise<AcpLoadedSessionRecord> {
      const normalized = sessionId.trim();
      if (normalized && freshSessionKeys.has(normalized)) {
        return undefined;
      }
      return await baseStore.load(sessionId);
    },
    async save(record: AcpSessionRecord): Promise<void> {
      await baseStore.save(record);
      const sessionName = readSessionRecordName(record);
      if (sessionName) {
        freshSessionKeys.delete(sessionName);
      }
    },
    markFresh(sessionKey: string): void {
      const normalized = sessionKey.trim();
      if (normalized) {
        freshSessionKeys.add(normalized);
      }
    },
  };
}

type AcpxRuntimeLike = AcpRuntime & {
  probeAvailability(): Promise<void>;
  isHealthy(): boolean;
  doctor(): Promise<AcpRuntimeDoctorReport>;
};

function normalizeQueueOwnerTtlMs(ttlSeconds: number | undefined): number {
  if (ttlSeconds == null || !Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
    return 300_000;
  }
  return Math.round(ttlSeconds * 1_000);
}

function createClientPoolKey(options: AcpClientFactoryOptions): string {
  const servers = Array.isArray(options.mcpServers)
    ? options.mcpServers
    : options.mcpServers == null
      ? []
      : [options.mcpServers];
  return JSON.stringify({
    agentCommand: options.agentCommand,
    cwd: options.cwd,
    mcpServers: servers,
    permissionMode: options.permissionMode,
    nonInteractivePermissions: options.nonInteractivePermissions,
    verbose: options.verbose === true,
  });
}

function patchManagerForPersistentReuse(params: {
  manager: AcpRuntimeManagerLike;
  queueOwnerTtlMs: number;
}): void {
  const { manager } = params;
  const queueOwnerTtlMs = params.queueOwnerTtlMs;
  const parkedClientsByKey = new Map<string, AcpClientLike>();
  const parkedTimersByClient = new Map<AcpClientLike, NodeJS.Timeout>();
  const keyByClient = new Map<AcpClientLike, string>();
  const rawCloseByClient = new Map<AcpClientLike, () => Promise<void>>();
  let persistentTurnDepth = 0;

  const clearParkedTimer = (client: AcpClientLike) => {
    const timer = parkedTimersByClient.get(client);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    parkedTimersByClient.delete(client);
  };

  const dropParkedReference = (client: AcpClientLike) => {
    const key = keyByClient.get(client);
    if (!key) {
      return;
    }
    if (parkedClientsByKey.get(key) === client) {
      parkedClientsByKey.delete(key);
    }
  };

  const closeImmediately = async (client: AcpClientLike): Promise<void> => {
    clearParkedTimer(client);
    dropParkedReference(client);
    const rawClose = rawCloseByClient.get(client);
    if (!rawClose) {
      return;
    }
    await rawClose();
  };

  const parkForReuse = async (client: AcpClientLike): Promise<void> => {
    const key = keyByClient.get(client);
    if (!key) {
      await closeImmediately(client);
      return;
    }

    const previous = parkedClientsByKey.get(key);
    if (previous && previous !== client) {
      await closeImmediately(previous);
    }
    clearParkedTimer(client);
    parkedClientsByKey.set(key, client);

    if (queueOwnerTtlMs > 0) {
      const timer = setTimeout(() => {
        void closeImmediately(client);
      }, queueOwnerTtlMs);
      timer.unref?.();
      parkedTimersByClient.set(client, timer);
    }
  };

  const originalCreateClient = manager.createClient.bind(manager);
  manager.createClient = (options: AcpClientFactoryOptions): AcpClientLike => {
    const key = createClientPoolKey(options);
    const parked = parkedClientsByKey.get(key);
    if (parked) {
      parkedClientsByKey.delete(key);
      clearParkedTimer(parked);
      return parked;
    }

    const client = originalCreateClient(options);
    const rawClose = client.close.bind(client);
    keyByClient.set(client, key);
    rawCloseByClient.set(client, rawClose);

    client.close = async () => {
      if (persistentTurnDepth > 0) {
        await parkForReuse(client);
        return;
      }
      await closeImmediately(client);
    };

    return client;
  };

  const originalRunTurn = manager.runTurn.bind(manager);
  manager.runTurn = async function* (
    input: Parameters<AcpRuntime["runTurn"]>[0],
  ): AsyncIterable<AcpRuntimeEvent> {
    const decoded = decodeAcpxRuntimeHandleState(input.handle.runtimeSessionName) as {
      mode?: string;
    } | null;
    const isPersistentTurn = decoded?.mode === "persistent";
    if (isPersistentTurn) {
      persistentTurnDepth += 1;
    }
    try {
      yield* originalRunTurn(input);
    } finally {
      if (isPersistentTurn) {
        persistentTurnDepth = Math.max(0, persistentTurnDepth - 1);
      }
    }
  };
}

export class AcpxRuntime implements AcpxRuntimeLike {
  private readonly sessionStore: ResetAwareSessionStore;
  private readonly delegate: BaseAcpxRuntime;

  constructor(options: AcpxRuntimeCompatOptions, testOptions?: BaseAcpxRuntimeTestOptions) {
    const queueOwnerTtlMs = normalizeQueueOwnerTtlMs(options.queueOwnerTtlSeconds);
    const { queueOwnerTtlSeconds: _queueOwnerTtlSeconds, ...baseOptions } = options;
    this.sessionStore = createResetAwareSessionStore(options.sessionStore);
    const managerFactoryFromTests = testOptions?.managerFactory;
    const patchedTestOptions: BaseAcpxRuntimeTestOptions = {
      ...testOptions,
      managerFactory: async (runtimeOptions: AcpRuntimeOptions) => {
        const manager = managerFactoryFromTests
          ? await managerFactoryFromTests(runtimeOptions)
          : await (
              new BaseAcpxRuntime(runtimeOptions) as unknown as {
                getManager: () => Promise<AcpRuntimeManagerLike>;
              }
            ).getManager();
        patchManagerForPersistentReuse({ manager, queueOwnerTtlMs });
        return manager;
      },
    };
    this.delegate = new BaseAcpxRuntime(
      {
        ...baseOptions,
        sessionStore: this.sessionStore,
      },
      patchedTestOptions,
    );
  }

  isHealthy(): boolean {
    return this.delegate.isHealthy();
  }

  probeAvailability(): Promise<void> {
    return this.delegate.probeAvailability();
  }

  doctor(): Promise<AcpRuntimeDoctorReport> {
    return this.delegate.doctor();
  }

  ensureSession(input: Parameters<AcpRuntime["ensureSession"]>[0]): Promise<AcpRuntimeHandle> {
    return this.delegate.ensureSession(input);
  }

  runTurn(input: Parameters<AcpRuntime["runTurn"]>[0]): AsyncIterable<AcpRuntimeEvent> {
    return this.delegate.runTurn(input);
  }

  getCapabilities(): ReturnType<BaseAcpxRuntime["getCapabilities"]> {
    return this.delegate.getCapabilities();
  }

  getStatus(input: Parameters<NonNullable<AcpRuntime["getStatus"]>>[0]): Promise<AcpRuntimeStatus> {
    return this.delegate.getStatus(input);
  }

  setMode(input: Parameters<NonNullable<AcpRuntime["setMode"]>>[0]): Promise<void> {
    return this.delegate.setMode(input);
  }

  setConfigOption(input: Parameters<NonNullable<AcpRuntime["setConfigOption"]>>[0]): Promise<void> {
    return this.delegate.setConfigOption(input);
  }

  cancel(input: Parameters<AcpRuntime["cancel"]>[0]): Promise<void> {
    return this.delegate.cancel(input);
  }

  async prepareFreshSession(input: { sessionKey: string }): Promise<void> {
    this.sessionStore.markFresh(input.sessionKey);
  }

  close(input: Parameters<AcpRuntime["close"]>[0]): Promise<void> {
    return this.delegate
      .close({
        handle: input.handle,
        reason: input.reason,
        discardPersistentState: input.discardPersistentState,
      })
      .then(() => {
        if (input.discardPersistentState) {
          this.sessionStore.markFresh(input.handle.sessionKey);
        }
      });
  }
}

export {
  ACPX_BACKEND_ID,
  createAcpRuntime,
  createAgentRegistry,
  createFileSessionStore,
  decodeAcpxRuntimeHandleState,
  encodeAcpxRuntimeHandleState,
};

export type { AcpAgentRegistry, AcpRuntimeOptions, AcpSessionRecord, AcpSessionStore };
