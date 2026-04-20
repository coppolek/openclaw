import type { CampfireWebhookPayload } from "../types.js";
import { isCampfireUrlInWorkspaceScope } from "../workspace-url.js";

function isAllowedReplyUrl(replyUrl: string, baseUrl: string): boolean {
  return isCampfireUrlInWorkspaceScope(replyUrl, baseUrl);
}

function findSegmentAfter(pathname: string, marker: string): string | null {
  const segments = pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const markerIndex = segments.findIndex((segment) => segment.toLowerCase() === marker);
  if (markerIndex < 0) {
    return null;
  }
  const nextSegment = segments[markerIndex + 1]?.trim();
  return nextSegment ? nextSegment : null;
}

function resolveInboundRoomId(payload: CampfireWebhookPayload): string {
  const fallbackRoomId = String(payload.room.id);
  const normalizedPath = payload.room.path.trim();
  if (!normalizedPath) {
    return fallbackRoomId;
  }

  try {
    const url = new URL(normalizedPath);
    return (
      findSegmentAfter(url.pathname, "rooms") ??
      findSegmentAfter(url.pathname, "chats") ??
      findSegmentAfter(url.pathname, "buckets") ??
      fallbackRoomId
    );
  } catch {
    return fallbackRoomId;
  }
}

export function buildCampfireInboundContext(params: {
  payload: CampfireWebhookPayload;
  allowFrom?: string[];
  baseUrl: string;
}) {
  const { payload, allowFrom, baseUrl } = params;
  const routeRoomId = resolveInboundRoomId(payload);
  const senderId = String(payload.user.id);
  const senderName = payload.user.name;

  const normalizedAllowFrom = (allowFrom ?? []).map((entry) => entry.trim()).filter(Boolean);
  const senderAllowed =
    normalizedAllowFrom.length === 0 ||
    normalizedAllowFrom.includes("*") ||
    normalizedAllowFrom.includes(senderId);

  const replyUrlAllowed = isAllowedReplyUrl(payload.room.path, baseUrl);

  return {
    isAllowed: senderAllowed && replyUrlAllowed,
    sender: {
      id: senderId,
      name: senderName,
    },
    roomId: routeRoomId,
    roomName: payload.room.name,
    replyUrl: payload.room.path,
    messageId: String(payload.message.id),
    text: payload.message.body.plain,
    threadKey: `campfire:room:${routeRoomId}`,
  };
}
