import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CronService } from "./service.js";
import {
  createFinishedBarrier,
  createCronStoreHarness,
  createNoopLogger,
  installCronTestHooks,
} from "./service.test-harness.js";
import type { CronJob } from "./types.js";

const noopLogger = createNoopLogger();
const { makeStorePath } = createCronStoreHarness({
  prefix: "openclaw-cron-delivery-channel-preserved-",
});
installCronTestHooks({ logger: noopLogger });

describe("#68760: delivery.channel must not revert after execution", () => {
  it("preserves delivery.channel=telegram after timer-driven execution", async () => {
    const store = await makeStorePath();
    const finished = createFinishedBarrier();
    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({
        status: "ok" as const,
        summary: "done",
        delivered: true,
      })),
      onEvent: finished.onEvent,
    });

    await cron.start();
    const job = await cron.add({
      name: "telegram-delivery",
      enabled: true,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "telegram", to: "123456" },
    });

    // Verify initial state
    expect(job.delivery?.channel).toBe("telegram");

    // Advance time to trigger the job
    vi.setSystemTime(new Date(job.state.nextRunAtMs! + 5));
    await vi.runOnlyPendingTimersAsync();
    await finished.waitForOk(job.id);

    // Read the persisted state from disk
    const raw = JSON.parse(await fs.promises.readFile(store.storePath, "utf-8")) as {
      jobs: CronJob[];
    };
    const persistedJob = raw.jobs.find((j) => j.id === job.id);

    // The delivery channel must remain "telegram", not revert to "last"
    expect(persistedJob?.delivery?.channel).toBe("telegram");
    expect(persistedJob?.delivery?.to).toBe("123456");
    expect(persistedJob?.delivery?.mode).toBe("announce");

    // Also check the in-memory state
    const inMemoryJob = cron.getJob(job.id);
    expect(inMemoryJob?.delivery?.channel).toBe("telegram");

    cron.stop();
    await store.cleanup();
  });

  it("preserves delivery.channel=telegram after manual cron.run", async () => {
    const store = await makeStorePath();
    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: false,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({
        status: "ok" as const,
        summary: "done",
        delivered: true,
      })),
    });

    await cron.start();
    const job = await cron.add({
      name: "manual-telegram",
      enabled: true,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: { kind: "agentTurn", message: "test" },
      delivery: { mode: "announce", channel: "telegram", to: "789" },
    });

    expect(job.delivery?.channel).toBe("telegram");

    const result = await cron.run(job.id, "force");
    expect(result).toEqual({ ok: true, ran: true });

    // Read from disk
    const raw = JSON.parse(await fs.promises.readFile(store.storePath, "utf-8")) as {
      jobs: CronJob[];
    };
    const persistedJob = raw.jobs.find((j) => j.id === job.id);

    expect(persistedJob?.delivery?.channel).toBe("telegram");
    expect(persistedJob?.delivery?.to).toBe("789");

    // Check in-memory
    const inMemoryJob = cron.getJob(job.id);
    expect(inMemoryJob?.delivery?.channel).toBe("telegram");

    cron.stop();
    await store.cleanup();
  });
});
