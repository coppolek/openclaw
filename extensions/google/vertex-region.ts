import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { resolveProviderEndpoint } from "openclaw/plugin-sdk/provider-http";

const GOOGLE_VERTEX_DEFAULT_REGION = "us-central1";
const GOOGLE_VERTEX_REGION_RE = /^[a-z0-9-]+$/;
const GCP_VERTEX_GOOGLE_CREDENTIALS_MARKER = "gcp-vertex-google-credentials";

type AdcProjectFile = {
  project_id?: unknown;
  quota_project_id?: unknown;
};

function normalizeOptionalInput(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function resolveGoogleVertexRegion(env: NodeJS.ProcessEnv = process.env): string {
  const region =
    normalizeOptionalInput(env.GOOGLE_CLOUD_LOCATION) ||
    normalizeOptionalInput(env.CLOUD_ML_REGION);

  return region && GOOGLE_VERTEX_REGION_RE.test(region) ? region : GOOGLE_VERTEX_DEFAULT_REGION;
}

export function resolveGoogleVertexRegionFromBaseUrl(baseUrl?: string): string | undefined {
  const endpoint = resolveProviderEndpoint(baseUrl);
  return endpoint.endpointClass === "google-vertex" ? endpoint.googleVertexRegion : undefined;
}

export function resolveGoogleVertexClientRegion(params?: {
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  return (
    resolveGoogleVertexRegionFromBaseUrl(params?.baseUrl) || resolveGoogleVertexRegion(params?.env)
  );
}

function resolveDefaultAdcPath(env: NodeJS.ProcessEnv = process.env): string {
  return platform() === "win32"
    ? join(
        env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
        "gcloud",
        "application_default_credentials.json",
      )
    : join(homedir(), ".config", "gcloud", "application_default_credentials.json");
}

function resolveAdcCredentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeOptionalInput(env.GOOGLE_APPLICATION_CREDENTIALS) ?? resolveDefaultAdcPath(env);
}

function readAdcFile(env: NodeJS.ProcessEnv = process.env): AdcProjectFile | undefined {
  try {
    return JSON.parse(readFileSync(resolveAdcCredentialsPath(env), "utf8")) as AdcProjectFile;
  } catch {
    return undefined;
  }
}

function canReadAdc(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    readFileSync(resolveAdcCredentialsPath(env), "utf8");
    return true;
  } catch {
    return false;
  }
}

export function resolveGoogleVertexProjectId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    normalizeOptionalInput(env.GOOGLE_CLOUD_PROJECT) ||
    normalizeOptionalInput(env.GOOGLE_CLOUD_PROJECT_ID) ||
    resolveGoogleVertexProjectIdFromAdc(env)
  );
}

function resolveGoogleVertexProjectIdFromAdc(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const parsed = readAdcFile(env);
  if (!parsed) {
    return undefined;
  }
  return (
    normalizeOptionalInput(parsed.project_id) || normalizeOptionalInput(parsed.quota_project_id)
  );
}

export function resolveGoogleVertexBaseUrl(region: string): string {
  return region.toLowerCase() === "global"
    ? "https://aiplatform.googleapis.com"
    : `https://${region}-aiplatform.googleapis.com`;
}

export function hasGoogleVertexCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  return canReadAdc(env);
}

export function hasGoogleVertexAvailableAuth(env: NodeJS.ProcessEnv = process.env): boolean {
  return hasGoogleVertexCredentials(env);
}

export function resolveGoogleVertexConfigApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return hasGoogleVertexAvailableAuth(env) ? GCP_VERTEX_GOOGLE_CREDENTIALS_MARKER : undefined;
}
