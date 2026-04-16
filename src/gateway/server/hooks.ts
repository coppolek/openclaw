import { randomUUID } from "node:crypto";
import { sanitizeInboundSystemTags } from "../../auto-reply/reply/inbound-text.js";
import type { CliDeps } from "../../cli/deps.types.js";
import { loadConfig } from "../../config/config.js";
import { resolveMainSessionKeyFromConfig } from "../../config/sessions.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { runCronIsolatedAgentTurn } from "../../cron/isolated-agent.js";
import type { CronJob } from "../../cron/types.js";
import { requestHeartbeatNow } from "../../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import type { createSubsystemLogger } from "../../logging/subsystem.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { type HookAgentDispatchPayload, type HooksConfigResolved } from "../hooks.js";
import { createHooksRequestHandler, type HookClientIpConfig } from "../server-http.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

export function resolveHookClientIpConfig(cfg: OpenClawConfig): HookClientIpConfig {
  return {
    trustedProxies: cfg.gateway?.trustedProxies,
    allowRealIpFallback: cfg.gateway?.allowRealIpFallback === true,
  };
}

export function createGatewayHooksRequestHandler(params: {
  deps: CliDeps;
  getHooksConfig: () => HooksConfigResolved | null;
  getClientIpConfig: () => HookClientIpConfig;
  bindHost: string;
  port: number;
  logHooks: SubsystemLogger;
}) {
  const { deps, getHooksConfig, getClientIpConfig, bindHost, port, logHooks } = params;

  const dispatchWakeHook = (value: { text: string; mode: "now" | "next-heartbeat" }) => {
    const sessionKey = resolveMainSessionKeyFromConfig();
    enqueueSystemEvent(value.text, { sessionKey, trusted: false });
    if (value.mode === "now") {
      requestHeartbeatNow({ reason: "hook:wake" });
    }
  };

  const dispatchAgentHook = async (
    value: HookAgentDispatchPayload,
  ): Promise<{ runId: string; outputText?: string; agentError?: string }> => {
    const sessionKey = value.sessionKey;
    const mainSessionKey = resolveMainSessionKeyFromConfig();
    const safeName = sanitizeInboundSystemTags(value.name);
    const jobId = randomUUID();
    const now = Date.now();
    const delivery = value.deliver
      ? {
          mode: "announce" as const,
          channel: value.channel,
          to: value.to,
        }
      : { mode: "none" as const };
    const job: CronJob = {
      id: jobId,
      agentId: value.agentId,
      name: safeName,
      enabled: true,
      createdAtMs: now,
      updatedAtMs: now,
      schedule: { kind: "at", at: new Date(now).toISOString() },
      sessionTarget: "isolated",
      wakeMode: value.wakeMode,
      payload: {
        kind: "agentTurn",
        message: value.message,
        model: value.model,
        thinking: value.thinking,
        timeoutSeconds: value.timeoutSeconds,
        allowUnsafeExternalContent: value.allowUnsafeExternalContent,
        externalContentSource: value.externalContentSource,
      },
      delivery,
      state: { nextRunAtMs: now },
    };

    const runId = randomUUID();

    // Shared post-run helper: logs the result as a system event and fires heartbeat.
    // For blocking calls: returns { outputText } on success or { agentError } when
    // runCronIsolatedAgentTurn signals a non-ok status (without throwing).
    const handleRunResult = (
      result: Awaited<ReturnType<typeof runCronIsolatedAgentTurn>>,
    ): { outputText?: string; agentError?: string } => {
      const summary =
        normalizeOptionalString(result.summary) ||
        normalizeOptionalString(result.error) ||
        result.status;
      const prefix =
        result.status === "ok" ? `Hook ${safeName}` : `Hook ${safeName} (${result.status})`;
      if (!result.delivered) {
        enqueueSystemEvent(`${prefix}: ${summary}`.trim(), {
          sessionKey: mainSessionKey,
          trusted: false,
        });
        if (value.wakeMode === "now") {
          requestHeartbeatNow({ reason: `hook:${jobId}` });
        }
      }
      // Propagate non-ok status as an error so blocking callers get a 500.
      if (result.status !== "ok") {
        return { agentError: summary };
      }
      return { outputText: result.outputText };
    };

    const handleRunError = (err: unknown): void => {
      logHooks.warn(`hook agent failed: ${String(err)}`);
      enqueueSystemEvent(`Hook ${safeName} (error): ${String(err)}`, {
        sessionKey: mainSessionKey,
        trusted: false,
      });
      if (value.wakeMode === "now") {
        requestHeartbeatNow({ reason: `hook:${jobId}:error` });
      }
    };

    if (value.blocking) {
      try {
        const cfg = loadConfig();
        const result = await runCronIsolatedAgentTurn({
          cfg,
          deps,
          job,
          message: value.message,
          sessionKey,
          lane: "cron",
          deliveryContract: "shared",
        });
        const { outputText, agentError } = handleRunResult(result);
        return { runId, outputText, agentError };
      } catch (err) {
        handleRunError(err);
        return { runId, agentError: String(err) };
      }
    } else {
      void (async () => {
        try {
          const cfg = loadConfig();
          const result = await runCronIsolatedAgentTurn({
            cfg,
            deps,
            job,
            message: value.message,
            sessionKey,
            lane: "cron",
            deliveryContract: "shared",
          });
          handleRunResult(result);
        } catch (err) {
          handleRunError(err);
        }
      })();

      return { runId };
    }
  };

  return createHooksRequestHandler({
    getHooksConfig,
    bindHost,
    port,
    logHooks,
    getClientIpConfig,
    dispatchAgentHook,
    dispatchWakeHook,
  });
}
