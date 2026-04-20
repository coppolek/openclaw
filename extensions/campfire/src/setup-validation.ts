import type { ChannelSetupInput } from "openclaw/plugin-sdk/channel-setup";

function trimOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeCampfireBaseUrl(value: string | undefined): string {
  return (trimOptionalString(value) ?? "").replace(/\/+$/u, "");
}

export function resolveCampfireBaseUrl(input: ChannelSetupInput): string {
  return normalizeCampfireBaseUrl(input.httpUrl ?? input.url);
}

export function resolveCampfireBotKey(input: ChannelSetupInput): string {
  return trimOptionalString(input.botToken ?? input.token) ?? "";
}

export function resolveOptionalCampfireSetupString(value: string | undefined): string | undefined {
  return trimOptionalString(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeUrlPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/u, "");
  return trimmed ? trimmed : "/";
}

function isBareBasecampHost(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    if (!/(^|\.)basecamp\.com$/u.test(parsed.hostname)) {
      return false;
    }
    return normalizeUrlPath(parsed.pathname) === "/";
  } catch {
    return false;
  }
}

export function validateCampfireSetupInput(input: ChannelSetupInput): string | null {
  const baseUrl = resolveCampfireBaseUrl(input);
  const botKey = resolveCampfireBotKey(input);
  if (!baseUrl || !botKey) {
    return "Campfire requires --http-url (or --url) and --bot-token (or --token).";
  }
  if (!isHttpUrl(baseUrl)) {
    return "Campfire --http-url/--url must be a valid http(s) URL.";
  }
  if (isBareBasecampHost(baseUrl)) {
    return "Campfire --http-url/--url must include a Basecamp workspace path (for example https://3.basecamp.com/1234567).";
  }
  return null;
}
