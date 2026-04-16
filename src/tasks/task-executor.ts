import type { OpenClawConfig } from "../config/types.openclaw.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  cancelTaskById,
  createTaskRecord,
  findLatestTaskForFlowId,
  isParentFlowLinkError,
  linkTaskToFlowById,
  listTasksForFlowId,
  markTaskLostById,
  markTaskRunningByRunId,
  markTaskTerminalByRunId,
  recordTaskProgressByRunId,
  setTaskRunDeliveryStatusByRunId,
} from "./runtime-internal.js";
import { getTaskFlowByIdForOwner } from "./task-flow-owner-access.js";
import type { TaskFlowRecord } from "./task-flow-registry.types.js";
import {
  createTaskFlowForTask,
  deleteTaskFlowRecordById,
  getTaskFlowById,
  requestFlowCancel,
  updateFlowRecordByIdExpectedRevision,
} from "./task-flow-runtime-internal.js";
import { summarizeTaskRecords } from "./task-registry.summary.js";
import type {
  TaskDeliveryState,
  TaskDeliveryStatus,
  TaskNotifyPolicy,
  TaskRecord,
  TaskRegistrySummary,
  TaskRuntime,
  TaskScopeKind,
  TaskStatus,
  TaskTerminalOutcome,
} from "./task-registry.types.js";

const log = createSubsystemLogger("tasks/executor");

function isOneTaskFlowEligible(task: TaskRecord): boolean {
  if (task.parentFlowId?.trim() || task.scopeKind !== "session") {
    return false;
  }
  if (task.deliveryStatus === "not_applicable") {
    return false;
  }
  return task.runtime === "acp" || task.runtime === "subagent";
}

function ensureSingleTaskFlow(params: {
  task: TaskRecord;
  requesterOrigin?: TaskDeliveryState["requesterOrigin"];
}): TaskRecord {
  if (!isOneTaskFlowEligible(params.task)) {
    return params.task;
  }
  try {
    const flow = createTaskFlowForTask({
      task: params.task,
      requesterOrigin: params.requesterOrigin,
    });
    const linked = linkTaskToFlowById({
      taskId: params.task.taskId,
      flowId: flow.flowId,
    });
    if (!linked) {
      deleteTaskFlowRecordById(flow.flowId);
      return params.task;
    }
    if (linked.parentFlowId !== flow.flowId) {
      deleteTaskFlowRecordById(flow.flowId);
      return linked;
    }
    return linked;
  } catch (error) {
    log.warn("Failed to create one-task flow for detached run", {
      taskId: params.task.taskId,
      runId: params.task.runId,
      error,
    });
    return params.task;
  }
}

export function createQueuedTaskRun(params: {
  runtime: TaskRuntime;
  taskKind?: string;
  sourceId?: string;
  requesterSessionKey?: string;
  ownerKey?: string;
  scopeKind?: TaskScopeKind;
  requesterOrigin?: TaskDeliveryState["requesterOrigin"];
  parentFlowId?: string;
  childSessionKey?: string;
  parentTaskId?: string;
  agentId?: string;
  runId?: string;
  label?: string;
  task: string;
  preferMetadata?: boolean;
  notifyPolicy?: TaskNotifyPolicy;
  deliveryStatus?: TaskDeliveryStatus;
}): TaskRecord {
  const task = createTaskRecord({
    ...params,
    status: "queued",
  });
  return ensureSingleTaskFlow({
    task,
    requesterOrigin: params.requesterOrigin,
  });
}

export function getFlowTaskSummary(flowId: string): TaskRegistrySummary {
  return summarizeTaskRecords(listTasksForFlowId(flowId));
}

export function createRunningTaskRun(params: {
  runtime: TaskRuntime;
  taskKind?: string;
  sourceId?: string;
  requesterSessionKey?: string;
  ownerKey?: string;
  scopeKind?: TaskScopeKind;
  requesterOrigin?: TaskDeliveryState["requesterOrigin"];
  parentFlowId?: string;
  childSessionKey?: string;
  parentTaskId?: string;
  agentId?: string;
  runId?: string;
  label?: string;
  task: string;
  notifyPolicy?: TaskNotifyPolicy;
  deliveryStatus?: TaskDeliveryStatus;
  preferMetadata?: boolean;
  startedAt?: number;
  lastEventAt?: number;
  progressSummary?: string | null;
}): TaskRecord {
  const task = createTaskRecord({
    ...params,
    status: "running",
  });

  // Fix race condition where startedAt (captured by caller) is before createdAt (captured by createTaskRecord)
  if (task.startedAt && task.startedAt < task.createdAt) {
    task.startedAt = task.createdAt;
  }

  return ensureSingleTaskFlow({
    task,
    requesterOrigin: params.requesterOrigin,
  });
}

export function startTaskRunByRunId(params: {
  runId: string;
  runtime?: TaskRuntime;
  sessionKey?: string;
  startedAt?: number;
  lastEventAt?: number;
  progressSummary?: string | null;
  eventSummary?: string | null;
}) {
  return markTaskRunningByRunId(params);
}

export function recordTaskRunProgressByRunId(params: {
  runId: string;
  runtime?: TaskRuntime;
  sessionKey?: string;
  lastEventAt?: number;
  progressSummary?: string | null;
  eventSummary?: string | null;
}) {
  return recordTaskProgressByRunId(params);
}

export function completeTaskRunByRunId(params: {
  runId: string;
  runtime?: TaskRuntime;
  sessionKey?: string;
  endedAt: number;
  lastEventAt?: number;
  progressSummary?: string | null;
  terminalSummary?: string | null;
  terminalOutcome?: TaskTerminalOutcome | null;
}) {
  return markTaskTerminalByRunId({
    runId: params.runId,
    runtime: params.runtime,
    sessionKey: params.sessionKey,
    status: "succeeded",
    endedAt: params.endedAt,
    lastEventAt: params.lastEventAt,
    progressSummary: params.progressSummary,
    terminalSummary: params.terminalSummary,
    terminalOutcome: params.terminalOutcome,
  });
}

export function failTaskRunByRunId(params: {
  runId: string;
  runtime?: TaskRuntime;
  sessionKey?: string;
  status?: Extract<TaskStatus, "failed" | "timed_out" | "cancelled">;
  endedAt: number;
  lastEventAt?: number;
  error?: string;
  progressSummary?: string | null;
  terminalSummary?: string | null;
}) {
  return markTaskTerminalByRunId({
    runId: params.runId,
    runtime: params.runtime,
    sessionKey: params.sessionKey,
    status: params.status ?? "failed",
    endedAt: params.endedAt,
    lastEventAt: params.lastEventAt,
    error: params.error,
    progressSummary: params.progressSummary,
    terminalSummary: params.terminalSummary,
  });
}

export function markTaskRunLostById(params: {
  taskId: string;
  endedAt: number;
  lastEventAt?: number;
  error?: string;
  cleanupAfter?: number;
}) {
  return markTaskLostById(params);
}

export function setDetachedTaskDeliveryStatusByRunId(params: {
  runId: string;
  runtime?: TaskRuntime;
  sessionKey?: string;
  deliveryStatus: TaskDeliveryStatus;
}) {
  return setTaskRunDeliveryStatusByRunId(params);
}

type RetryBlockedFlowResult = {
  found: boolean;
  retried: boolean;
  reason?: string;
  previousTask?: TaskRecord;
  task?: TaskRecord;
};

type RetryBlockedFlowParams = {
  flowId: string;
  sourceId?: string;
  requesterOrigin?: TaskDeliveryState["requesterOrigin"];
  childSessionKey?: string;
  agentId?: string;
  runId?: string;
  label?: string;
  task?: string;
  preferMetadata?: boolean;
  notifyPolicy?: TaskNotifyPolicy;
  deliveryStatus?: TaskDeliveryStatus;
  status: "queued" | "running";
  startedAt?: number;
  lastEventAt?: number;
  progressSummary?: string | null;
};

function resolveRetryableBlockedFlowTask(flowId: string): {
  flowFound: boolean;
  retryable: boolean;
  latestTask?: TaskRecord;
  reason?: string;
} {
  const flow = getTaskFlowById(flowId);
  if (!flow) {
    return {
      flowFound: false,
      retryable: false,
      reason: "Flow not found.",
    };
  }
  const latestTask = findLatestTaskForFlowId(flowId);
  if (!latestTask) {
    return {
      flowFound: true,
      retryable: false,
      reason: "Flow has no retryable task.",
    };
  }
  if (flow.status !== "blocked") {
    return {
      flowFound: true,
      retryable: false,
      latestTask,
      reason: "Flow is not blocked.",
    };
  }
  if (latestTask.status !== "succeeded" || latestTask.terminalOutcome !== "blocked") {
    return {
      flowFound: true,
      retryable: false,
      latestTask,
      reason: "Latest TaskFlow task is not blocked.",
    };
  }
  return {
    flowFound: true,
    retryable: true,
    latestTask,
  };
}

function retryBlockedFlowTask(params: RetryBlockedFlowParams): RetryBlockedFlowResult {
  const resolved = resolveRetryableBlockedFlowTask(params.flowId);
  if (!resolved.retryable || !resolved.latestTask) {
    return {
      found: resolved.flowFound,
      retried: false,
      reason: resolved.reason,
    };
  }
  const flow = getTaskFlowById(params.flowId);
  if (!flow) {
    return {
      found: false,
      retried: false,
      reason: "Flow not found.",
      previousTask: resolved.latestTask,
    };
  }
  const task = createTaskRecord({
    runtime: resolved.latestTask.runtime,
    sourceId: params.sourceId ?? resolved.latestTask.sourceId,
    ownerKey: flow.ownerKey,
    scopeKind: "session",
    requesterOrigin: params.requesterOrigin ?? flow.requesterOrigin,
    parentFlowId: flow.flowId,
    childSessionKey: params.childSessionKey,
    parentTaskId: resolved.latestTask.taskId,
    agentId: params.agentId ?? resolved.latestTask.agentId,
    runId: params.runId,
    label: params.label ?? resolved.latestTask.label,
    task: params.task ?? resolved.latestTask.task,
    preferMetadata: params.preferMetadata,
    notifyPolicy: params.notifyPolicy ?? resolved.latestTask.notifyPolicy,
    deliveryStatus: params.deliveryStatus ?? "pending",
    status: params.status,
    startedAt: params.startedAt,
    lastEventAt: params.lastEventAt,
    progressSummary: params.progressSummary,
  });
  return {
    found: true,
    retried: true,
    previousTask: resolved.latestTask,
    task,
  };
}

export function retryBlockedFlowAsQueuedTaskRun(
  params: Omit<RetryBlockedFlowParams, "status" | "startedAt" | "lastEventAt" | "progressSummary">,
): RetryBlockedFlowResult {
  return retryBlockedFlowTask({
    ...params,
    status: "queued",
  });
}

export function retryBlockedFlowAsRunningTaskRun(
  params: Omit<RetryBlockedFlowParams, "status">,
): RetryBlockedFlowResult {
  return retryBlockedFlowTask({
    ...params,
    status: "running",
  });
}

type CancelFlowResult = {
  found: boolean;
  cancelled: boolean;
  reason?: string;
  flow?: TaskFlowRecord;
  tasks?: TaskRecord[];
};

type RunTaskInFlowResult = {
  found: boolean;
  created: boolean;
  reason?: string;
  flow?: TaskFlowRecord;
  task?: TaskRecord;
};

function isActiveTaskStatus(status: TaskStatus): boolean {
  return status === "queued" || status === "running";
}

function isTerminalFlowStatus(status: TaskFlowRecord["status"]): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled" || status === "lost"
  );
}

function markFlowCancelRequested(flow: TaskFlowRecord): TaskFlowRecord | FlowUpdateFailure {
  if (flow.cancelRequestedAt != null) {
    return flow;
  }
  const result = requestFlowCancel({
    flowId: flow.flowId,
    expectedRevision: flow.revision,
  });
  if (result.applied) {
    return result.flow;
  }
  return {
    reason:
      result.reason === "revision_conflict"
        ? "Flow changed while cancellation was in progress."
        : "Flow not found.",
    flow: result.current ?? getTaskFlowById(flow.flowId),
  };
}

type FlowUpdateFailure = {
  reason: string;
  flow?: TaskFlowRecord;
};

function cancelManagedFlowAfterChildrenSettle(
  flow: TaskFlowRecord,
  endedAt: number,
): TaskFlowRecord | FlowUpdateFailure {
  const result = updateFlowRecordByIdExpectedRevision({
    flowId: flow.flowId,
    expectedRevision: flow.revision,
    patch: {
      status: "cancelled",
      blockedTaskId: null,
      blockedSummary: null,
      waitJson: null,
      endedAt,
      updatedAt: endedAt,
    },
  });
  if (result.applied) {
    return result.flow;
  }
  return {
    reason:
      result.reason === "revision_conflict"
        ? "Flow changed while cancellation was in progress."
        : "Flow not found.",
    flow: result.current ?? getTaskFlowById(flow.flowId),
  };
}

function mapRunTaskInFlowCreateError(params: {
  error: unknown;
  flowId: string;
}): RunTaskInFlowResult {
  const flow = getTaskFlowById(params.flowId);
  if (isParentFlowLinkError(params.error)) {
    if (params.error.code === "cancel_requested") {
      return {
        found: true,
        created: false,
        reason: "Flow cancellation has already been requested.",
        ...(flow ? { flow } : {}),
      }
    }
  }
  return {
    found: true,
    created: false,
    reason: "Failed to create task in flow.",
    ...(flow ? { flow } : {}),
  };
}
