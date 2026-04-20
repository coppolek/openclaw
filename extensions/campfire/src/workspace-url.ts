function parseAbsoluteUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/u, "");
  return trimmed.length > 0 ? trimmed : "/";
}

function hasValue(segment: string | undefined): segment is string {
  return Boolean(segment && segment.trim().length > 0);
}

function hasCampfireClassicMessagesPath(pathname: string): boolean {
  const segments = normalizePath(pathname).split("/").filter(Boolean);
  const roomIndex = segments.findIndex((segment) => segment.toLowerCase() === "rooms");
  if (roomIndex < 0) {
    return false;
  }
  if (
    !hasValue(segments[roomIndex + 1]) ||
    !hasValue(segments[roomIndex + 2]) ||
    segments[roomIndex + 3]?.toLowerCase() !== "messages"
  ) {
    return false;
  }
  const remaining = segments.length - (roomIndex + 4);
  return remaining === 0 || (remaining === 1 && hasValue(segments[roomIndex + 4]));
}

function hasBasecampChatMessagesPath(pathname: string): boolean {
  const segments = normalizePath(pathname).split("/").filter(Boolean);
  const bucketIndex = segments.findIndex((segment) => segment.toLowerCase() === "buckets");
  if (bucketIndex < 0) {
    return false;
  }
  if (
    !hasValue(segments[bucketIndex + 1]) ||
    segments[bucketIndex + 2]?.toLowerCase() !== "chats" ||
    !hasValue(segments[bucketIndex + 3]) ||
    segments[bucketIndex + 4]?.toLowerCase() !== "messages"
  ) {
    return false;
  }
  const remaining = segments.length - (bucketIndex + 5);
  return remaining === 0 || (remaining === 1 && hasValue(segments[bucketIndex + 5]));
}

function hasCampfireMessageEndpointPath(pathname: string): boolean {
  return hasCampfireClassicMessagesPath(pathname) || hasBasecampChatMessagesPath(pathname);
}

export function isValidCampfireUrl(value: string): boolean {
  return parseAbsoluteUrl(value) !== null;
}

export function isCampfireUrlInWorkspaceScope(targetUrl: string, baseUrl: string): boolean {
  const target = parseAbsoluteUrl(targetUrl);
  const base = parseAbsoluteUrl(baseUrl);
  if (!target || !base) {
    return false;
  }

  if (target.origin !== base.origin) {
    return false;
  }

  const basePath = normalizePath(base.pathname);
  const targetPath = normalizePath(target.pathname);
  const inScopeByPath =
    basePath === "/" ? true : targetPath === basePath || targetPath.startsWith(`${basePath}/`);
  if (!inScopeByPath) {
    return false;
  }

  return hasCampfireMessageEndpointPath(targetPath);
}
