import { normalizeOptionalString } from "../shared/string-coerce.js";
import { formatTerminalLink } from "./terminal-link.js";

function resolveDocsRoot(): string {
  return "https://docs.openclaw.ai";
}

export function formatDocsLink(
  path?: string | null,
  label?: string,
  opts?: { fallback?: string; force?: boolean },
): string {
  const trimmed = normalizeOptionalString(path) ?? "";
  const docsRoot = resolveDocsRoot();
  const url = trimmed.startsWith("http")
    ? trimmed
    : `${docsRoot}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
  return formatTerminalLink(label ?? url, url, {
    fallback: opts?.fallback ?? url,
    force: opts?.force,
  });
}
