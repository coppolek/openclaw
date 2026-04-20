import { parseAgentSessionKey } from "../sessions/session-key-utils.js";
import { isDeliverableMessageChannel, normalizeMessageChannel } from "./message-channel.js";

export function inferHookMessageProviderFromSessionKey(
  sessionKey?: string | null,
): string | undefined {
  const rest = parseAgentSessionKey(sessionKey)?.rest;
  if (!rest) {
    return undefined;
  }
  const head = rest.split(":")[0]?.trim();
  if (!head) {
    return undefined;
  }
  const normalized = normalizeMessageChannel(head);
  return normalized && isDeliverableMessageChannel(normalized) ? normalized : undefined;
}

export function resolveHookMessageProvider(params: {
  sessionKey?: string | null;
  provider?: string | null;
}): string | undefined {
  const normalized = normalizeMessageChannel(params.provider);
  if (normalized && isDeliverableMessageChannel(normalized)) {
    return normalized;
  }
  return inferHookMessageProviderFromSessionKey(params.sessionKey);
}
