import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

type AdcAuthorizedUser = {
  type: "authorized_user";
  client_id: string;
  client_secret: string;
  refresh_token: string;
  quota_project_id?: string;
  project_id?: string;
};

type AdcFile = AdcAuthorizedUser | { type: string; project_id?: string };

type GoogleVertexAccessToken = {
  accessToken: string;
  projectId: string | undefined;
  expiresAt: number;
};

let cachedToken: GoogleVertexAccessToken | null = null;

function resolveDefaultAdcPath(env: NodeJS.ProcessEnv = process.env): string {
  return platform() === "win32"
    ? join(
        env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
        "gcloud",
        "application_default_credentials.json",
      )
    : join(homedir(), ".config", "gcloud", "application_default_credentials.json");
}

function readAdcFile(env: NodeJS.ProcessEnv = process.env): AdcFile | undefined {
  const path = env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || resolveDefaultAdcPath(env);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AdcFile;
  } catch {
    return undefined;
  }
}

async function refreshAuthorizedUserToken(
  adc: AdcAuthorizedUser,
): Promise<{ access_token: string; expires_in: number }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: adc.client_id,
      client_secret: adc.client_secret,
      refresh_token: adc.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Google ADC token refresh failed (${response.status}): ${text}`);
  }
  return (await response.json()) as { access_token: string; expires_in: number };
}

export async function resolveGoogleVertexAccessToken(
  env: NodeJS.ProcessEnv = process.env,
): Promise<GoogleVertexAccessToken | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken;
  }

  const adc = readAdcFile(env);
  if (!adc) {
    return null;
  }

  const projectId =
    env.GOOGLE_CLOUD_PROJECT?.trim() ||
    env.GOOGLE_CLOUD_PROJECT_ID?.trim() ||
    ("quota_project_id" in adc ? adc.quota_project_id : undefined) ||
    adc.project_id ||
    undefined;

  if (adc.type === "authorized_user") {
    const result = await refreshAuthorizedUserToken(adc as AdcAuthorizedUser);
    cachedToken = {
      accessToken: result.access_token,
      projectId,
      expiresAt: Date.now() + result.expires_in * 1000,
    };
    return cachedToken;
  }

  return null;
}

export function clearGoogleVertexTokenCache(): void {
  cachedToken = null;
}
