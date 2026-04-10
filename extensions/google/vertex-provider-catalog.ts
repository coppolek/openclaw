import type {
  ModelDefinitionConfig,
  ModelProviderConfig,
} from "openclaw/plugin-sdk/provider-model-shared";
import {
  resolveGoogleVertexBaseUrl,
  resolveGoogleVertexProjectId,
  resolveGoogleVertexRegion,
} from "./vertex-region.js";

export const GOOGLE_VERTEX_DEFAULT_MODEL_ID = "gemini-3.1-pro-preview";
const GOOGLE_VERTEX_DEFAULT_CONTEXT_WINDOW = 1_000_000;
const GCP_VERTEX_GOOGLE_CREDENTIALS_MARKER = "gcp-vertex-google-credentials";

function buildGoogleVertexModel(params: {
  id: string;
  name: string;
  reasoning: boolean;
  input: ModelDefinitionConfig["input"];
  cost: ModelDefinitionConfig["cost"];
  maxTokens: number;
  contextWindow?: number;
}): ModelDefinitionConfig {
  return {
    id: params.id,
    name: params.name,
    reasoning: params.reasoning,
    input: params.input,
    cost: params.cost,
    contextWindow: params.contextWindow ?? GOOGLE_VERTEX_DEFAULT_CONTEXT_WINDOW,
    maxTokens: params.maxTokens,
  };
}

function buildGoogleVertexCatalog(): ModelDefinitionConfig[] {
  return [
    buildGoogleVertexModel({
      id: "gemini-3.1-pro-preview",
      name: "Gemini 3.1 Pro",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 1.25, output: 10, cacheRead: 0.315, cacheWrite: 0 },
      maxTokens: 65536,
    }),
    buildGoogleVertexModel({
      id: "gemini-3-flash-preview",
      name: "Gemini 3 Flash",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0 },
      maxTokens: 65536,
    }),
    buildGoogleVertexModel({
      id: "gemini-3.1-flash-lite-preview",
      name: "Gemini 3.1 Flash Lite",
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0.075, output: 0.3, cacheRead: 0.01875, cacheWrite: 0 },
      maxTokens: 65536,
    }),
    buildGoogleVertexModel({
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 1.25, output: 10, cacheRead: 0.315, cacheWrite: 0 },
      maxTokens: 65536,
    }),
    buildGoogleVertexModel({
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0 },
      maxTokens: 65536,
    }),
  ];
}

export function buildGoogleVertexProvider(params?: {
  env?: NodeJS.ProcessEnv;
}): ModelProviderConfig {
  const env = params?.env ?? process.env;
  const region = resolveGoogleVertexRegion(env);
  const projectId = resolveGoogleVertexProjectId(env);
  const baseUrl = resolveGoogleVertexBaseUrl(region);

  return {
    baseUrl,
    api: "google-generative-ai",
    apiKey: GCP_VERTEX_GOOGLE_CREDENTIALS_MARKER,
    models: buildGoogleVertexCatalog(),
    headers: {
      ...(projectId ? { "x-openclaw-vertex-project-id": projectId } : {}),
      "x-openclaw-vertex-location": region,
    },
  };
}

export function mergeImplicitGoogleVertexProvider(params: {
  existing: ModelProviderConfig | undefined;
  implicit: ModelProviderConfig;
}): ModelProviderConfig {
  const { existing, implicit } = params;
  if (!existing) {
    return implicit;
  }
  return {
    ...implicit,
    ...existing,
    models:
      Array.isArray(existing.models) && existing.models.length > 0
        ? existing.models
        : implicit.models,
  };
}
