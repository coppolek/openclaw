import fs from "node:fs";
import { normalizeOptionalString } from "../shared/string-coerce.js";

const CONTAINER_MARKER_PATHS = ["/.dockerenv", "/run/.containerenv"] as const;

export function resolveDaemonContainerContext(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return (
    normalizeOptionalString(env.OPENCLAW_CONTAINER_HINT) ||
    normalizeOptionalString(env.OPENCLAW_CONTAINER) ||
    null
  );
}

export function detectContainerEnvironment(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (resolveDaemonContainerContext(env)) {
    return true;
  }
  if (normalizeOptionalString(env.container) || normalizeOptionalString(env.CONTAINER)) {
    return true;
  }
  return CONTAINER_MARKER_PATHS.some((markerPath) => fs.existsSync(markerPath));
}
