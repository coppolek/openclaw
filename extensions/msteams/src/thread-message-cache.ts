/**
 * In-memory thread message cache for Teams channel threads.
 *
 * When Graph API is unavailable (e.g., developer tenant restrictions),
 * this cache provides thread context from messages received via RSC or
 * Bot Framework webhooks. Messages are stored by (channelId, threadId)
 * and expire after a TTL.
 */

export type CachedThreadMessage = {
  messageId: string;
  from: string; // display name
  fromId: string; // user/app ID
  content: string;
  timestamp: number; // unix ms
};

const MAX_MESSAGES_PER_THREAD = 50;
const ENTRY_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

type ThreadEntry = {
  messages: CachedThreadMessage[];
  lastAccessedAt: number;
};

const cache = new Map<string, ThreadEntry>();

function makeKey(channelId: string, threadId: string): string {
  return `${channelId}\0${threadId}`;
}

/**
 * Store a message in the thread cache. No-ops for duplicate messageIds.
 */
export function cacheThreadMessage(
  channelId: string,
  threadId: string,
  message: CachedThreadMessage,
): void {
  const key = makeKey(channelId, threadId);
  let entry = cache.get(key);
  if (!entry) {
    entry = { messages: [], lastAccessedAt: Date.now() };
    cache.set(key, entry);
  }
  // Deduplicate by messageId.
  if (message.messageId && entry.messages.some((m) => m.messageId === message.messageId)) {
    return;
  }
  entry.messages.push(message);
  // Keep only the most recent N messages.
  if (entry.messages.length > MAX_MESSAGES_PER_THREAD) {
    entry.messages = entry.messages.slice(-MAX_MESSAGES_PER_THREAD);
  }
  entry.lastAccessedAt = Date.now();
}

/**
 * Retrieve cached messages for a thread, sorted by timestamp ascending.
 */
export function getThreadMessages(channelId: string, threadId: string): CachedThreadMessage[] {
  const key = makeKey(channelId, threadId);
  const entry = cache.get(key);
  if (!entry) {
    return [];
  }
  entry.lastAccessedAt = Date.now();
  return [...entry.messages].toSorted((a, b) => a.timestamp - b.timestamp);
}

/**
 * Remove cache entries that haven't been accessed within the TTL.
 * Call periodically or before cache reads to prevent unbounded growth.
 */
export function clearExpiredThreadCacheEntries(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.lastAccessedAt > ENTRY_TTL_MS) {
      cache.delete(key);
    }
  }
}

/**
 * Clear all thread cache entries. Exported for testing only.
 */
export function _clearThreadCacheForTest(): void {
  cache.clear();
}

// Exported for testing only.
export { cache as _threadCacheForTest };
