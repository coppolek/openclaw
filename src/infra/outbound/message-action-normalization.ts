import type {
  ChannelMessageActionName,
  ChannelThreadingToolContext,
} from "../../channels/plugins/types.public.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import {
  isDeliverableMessageChannel,
  normalizeMessageChannel,
} from "../../utils/message-channel.js";
import { applyTargetToParams } from "./channel-target.js";
import { actionHasTarget, actionRequiresTarget } from "./message-action-spec.js";

export function normalizeMessageActionInput(params: {
  action: ChannelMessageActionName;
  args: Record<string, unknown>;
  toolContext?: ChannelThreadingToolContext;
}): Record<string, unknown> {
  const normalizedArgs = { ...params.args };
  const { action, toolContext } = params;
  const explicitChannel = normalizeOptionalString(normalizedArgs.channel) ?? "";
  const inferredChannel =
    explicitChannel || normalizeMessageChannel(toolContext?.currentChannelProvider) || "";

  const explicitTarget = normalizeOptionalString(normalizedArgs.target) ?? "";
  const hasLegacyTargetFields =
    typeof normalizedArgs.to === "string" || typeof normalizedArgs.channelId === "string";
  const hasLegacyTarget =
    (normalizeOptionalString(normalizedArgs.to) ?? "").length > 0 ||
    (normalizeOptionalString(normalizedArgs.channelId) ?? "").length > 0;

  if (explicitTarget && hasLegacyTargetFields) {
    delete normalizedArgs.to;
    delete normalizedArgs.channelId;
  }

  if (
    !explicitTarget &&
    !hasLegacyTarget &&
    actionRequiresTarget(action) &&
    !actionHasTarget(action, normalizedArgs, { channel: inferredChannel })
  ) {
    const inferredTarget = normalizeOptionalString(toolContext?.currentChannelId);
    if (inferredTarget) {
      normalizedArgs.target = inferredTarget;
    }
  }

  if (!explicitTarget && actionRequiresTarget(action) && hasLegacyTarget) {
    const legacyTo = normalizeOptionalString(normalizedArgs.to) ?? "";
    const legacyChannelId = normalizeOptionalString(normalizedArgs.channelId) ?? "";
    const legacyTarget = legacyTo || legacyChannelId;
    if (legacyTarget) {
      normalizedArgs.target = legacyTarget;
      delete normalizedArgs.to;
      delete normalizedArgs.channelId;
    }
  }

  if (!explicitChannel) {
    if (inferredChannel && isDeliverableMessageChannel(inferredChannel)) {
      normalizedArgs.channel = inferredChannel;
    }
  }

  // LLMs (especially in cron/isolated contexts without toolContext) sometimes place the
  // target identifier in "channel" instead of "target" — e.g. "channel:123456" when the
  // intended field is "target". When the channel value looks like a target identifier
  // (contains ":"), two cases apply:
  //   (a) No target is resolved yet → promote channel to target.
  //   (b) Target is already resolved (e.g. via legacy to/channelId mapping above) → skip
  //       promotion, but still clear the channel field so downstream routing doesn't receive
  //       "channel:123456" as a provider name.
  // Check `normalizedArgs.target` directly since actionHasTarget does not inspect `target`.
  const resolvedTarget =
    typeof normalizedArgs.target === "string" ? normalizedArgs.target.trim() : "";
  if (explicitChannel && explicitChannel.includes(":") && actionRequiresTarget(action)) {
    if (!resolvedTarget && !actionHasTarget(action, normalizedArgs)) {
      // Case (a): promote channel to target.
      normalizedArgs.target = explicitChannel;
    }
    // In both cases, clear the malformed channel field.
    delete normalizedArgs.channel;
  }

  applyTargetToParams({ action, args: normalizedArgs });
  if (
    actionRequiresTarget(action) &&
    !actionHasTarget(action, normalizedArgs, { channel: inferredChannel })
  ) {
    throw new Error(`Action ${action} requires a target.`);
  }

  return normalizedArgs;
}
