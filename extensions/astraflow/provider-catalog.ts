import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import {
  ASTRAFLOW_BASE_URL,
  ASTRAFLOW_CN_BASE_URL,
  ASTRAFLOW_CN_MODEL_CATALOG,
  ASTRAFLOW_MODEL_CATALOG,
  buildAstraflowModelDefinition,
} from "./models.js";

export function buildAstraflowProvider(): ModelProviderConfig {
  const baseUrl = process.env.ASTRAFLOW_BASE_URL?.trim() || ASTRAFLOW_BASE_URL;
  return {
    baseUrl,
    api: "openai-completions",
    models: ASTRAFLOW_MODEL_CATALOG.map(buildAstraflowModelDefinition),
  };
}

export function buildAstraflowCnProvider(): ModelProviderConfig {
  const baseUrl = process.env.ASTRAFLOW_CN_BASE_URL?.trim() || ASTRAFLOW_CN_BASE_URL;
  return {
    baseUrl,
    api: "openai-completions",
    models: ASTRAFLOW_CN_MODEL_CATALOG.map(buildAstraflowModelDefinition),
  };
}
