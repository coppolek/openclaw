import { describe, expect, it } from "vitest";
import { listTaskAuditFindings, summarizeTaskAuditFindings } from "./task-registry.audit.js";
import type { TaskRecord } from "./task-registry.types.js";

function createTask(partial: Partial<TaskRecord>): TaskRecord {
  return {
    taskId: partial.taskId ?? "task-1",
    runtime: partial.runtime ?? "acp",
    requesterSessionKey: partial.requesterSessionKey ?? partial.ownerKey ?? "agent:main:main",
    ownerKey: partial.ownerKey ?? partial.requesterSessionKey ?? "agent:main:main",
    scopeKind: partial.scopeKind ?? "session",
    task: partial.task ?? "Background task",
    status: partial.status ?? "queued",
    deliveryStatus: partial.deliveryStatus ?? "pending",
    notifyPolicy: partial.notifyPolicy ?? "done_only",
    createdAt: partial.createdAt ?? Date.parse("2026-03-30T00:00:00.000Z"),
    ...partial,
  };
}

describe("task-registry audit", () => {
  it("flags stale running, lost, and missing cleanup tasks", () => {
    const now = Date.parse("2026-03-30T01:00:00.000Z");
    const findings = listTaskAuditFindings({
      now,
      tasks: [
        createTask({
          taskId: "stale-running",
          status: "running",
          startedAt: now - 40 * 60_000,
          lastEventAt: now - 40 * 60_000,
        }),
        createTask({
          taskId: "lost-task",
          status: "lost",
          error: "backing session missing",
          endedAt: now - 5 * 60_000,
        }),
        createTask({
          taskId: "missing-cleanup",
          status: "failed",
          endedAt: now - 60_000,
          cleanupAfter: undefined,
        }),
      ],
    });

    expect(findings.map((finding) => [finding.code, finding.task.taskId])).toEqual([
      ["lost", "lost-task"],
      ["stale_running", "stale-running"],
      ["missing_cleanup", "missing-cleanup"],
    ]);
  });

  it("summarizes findings by severity and code", () => {
    const summary = summarizeTaskAuditFindings([
      {
        severity: "error",
        code: "stale_running",
        task: createTask({ taskId: "a", status: "running" }),
        detail: "running task appears stuck",
      },
      {
        severity: "warn",
        code: "delivery_failed",
        task: createTask({ taskId: "b", status: "failed" }),
        detail: "terminal update delivery failed",
      },
    ]);

    expect(summary).toEqual({
      total: 2,
      warnings: 1,
      errors: 1,
      byCode: {
        stale_queued: 0,
        stale_running: 1,
        lost: 0,
        delivery_failed: 1,
        missing_cleanup: 0,
        inconsistent_timestamps: 0,
      },
    });
  });

  it("does not flag startedAt equal to createdAt as inconsistent", () => {
    const now = Date.parse("2026-03-30T01:00:00.000Z");
    const base = Date.parse("2026-03-30T00:00:00.000Z");
    const findings = listTaskAuditFindings({
      now,
      tasks: [
        createTask({
          taskId: "same-ts",
          status: "succeeded",
          createdAt: base,
          startedAt: base,
          endedAt: base + 5000,
          cleanupAfter: now + 60_000,
        }),
      ],
    });
    expect(findings.map((f) => f.code)).toEqual([]);
  });

  it("does not flag startedAt slightly before createdAt within jitter tolerance", () => {
    const now = Date.parse("2026-03-30T01:00:00.000Z");
    const base = Date.parse("2026-03-30T00:00:00.000Z");
    const findings = listTaskAuditFindings({
      now,
      tasks: [
        createTask({
          taskId: "slight-jitter",
          status: "succeeded",
          createdAt: base + 500,
          startedAt: base,
          endedAt: base + 5000,
          cleanupAfter: now + 60_000,
        }),
      ],
    });
    expect(findings.map((f) => f.code)).toEqual([]);
  });

  it("flags startedAt significantly before createdAt as inconsistent", () => {
    const now = Date.parse("2026-03-30T01:00:00.000Z");
    const base = Date.parse("2026-03-30T00:00:00.000Z");
    const findings = listTaskAuditFindings({
      now,
      tasks: [
        createTask({
          taskId: "big-gap",
          status: "succeeded",
          createdAt: base + 2000,
          startedAt: base,
          endedAt: base + 5000,
          cleanupAfter: now + 60_000,
        }),
      ],
    });
    expect(findings.map((f) => f.code)).toEqual(["inconsistent_timestamps"]);
  });

  it("does not flag endedAt slightly before startedAt within jitter tolerance", () => {
    const now = Date.parse("2026-03-30T01:00:00.000Z");
    const base = Date.parse("2026-03-30T00:00:00.000Z");
    const findings = listTaskAuditFindings({
      now,
      tasks: [
        createTask({
          taskId: "end-jitter",
          status: "failed",
          createdAt: base,
          startedAt: base + 500,
          endedAt: base + 100,
          cleanupAfter: now + 60_000,
        }),
      ],
    });
    expect(findings.map((f) => f.code)).toEqual([]);
  });

  it("does not double-report lost tasks as missing cleanup", () => {
    const now = Date.parse("2026-03-30T01:00:00.000Z");
    const findings = listTaskAuditFindings({
      now,
      tasks: [
        createTask({
          taskId: "lost-projected",
          status: "lost",
          endedAt: now - 60_000,
          cleanupAfter: undefined,
        }),
      ],
    });

    expect(findings.map((finding) => finding.code)).toEqual(["lost"]);
  });
});
