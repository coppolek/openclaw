import {
  applyAgentDefaultModelPrimary,
  applyProviderConfigWithModelCatalog,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/provider-onboard";
import {
  ASTRAFLOW_BASE_URL,
  ASTRAFLOW_CN_BASE_URL,
  ASTRAFLOW_CN_MODEL_CATALOG,
  ASTRAFLOW_MODEL_CATALOG,
  buildAstraflowModelDefinition,
} from "./models.js";

export const ASTRAFLOW_DEFAULT_MODEL_REF = "astraflow/claude-sonnet-4-6";
export const ASTRAFLOW_CN_DEFAULT_MODEL_REF = "astraflow-cn/deepseek-ai/DeepSeek-V3.2";

export function applyAstraflowProviderConfig(cfg: OpenClawConfig): OpenClawConfig {
  const models = { ...cfg.agents?.defaults?.models };
  models[ASTRAFLOW_DEFAULT_MODEL_REF] = {
    ...models[ASTRAFLOW_DEFAULT_MODEL_REF],
    alias: models[ASTRAFLOW_DEFAULT_MODEL_REF]?.alias ?? "UCloud AstraFlow",
  };

  return applyProviderConfigWithModelCatalog(cfg, {
    agentModels: models,
    providerId: "astraflow",
    api: "openai-completions",
    baseUrl: ASTRAFLOW_BASE_URL,
    catalogModels: ASTRAFLOW_MODEL_CATALOG.map(buildAstraflowModelDefinition),
  });
}

export function applyAstraflowConfig(cfg: OpenClawConfig): OpenClawConfig {
  return applyAgentDefaultModelPrimary(
    applyAstraflowProviderConfig(cfg),
    ASTRAFLOW_DEFAULT_MODEL_REF,
  );
}

export function applyAstraflowCnProviderConfig(cfg: OpenClawConfig): OpenClawConfig {
  const models = { ...cfg.agents?.defaults?.models };
  models[ASTRAFLOW_CN_DEFAULT_MODEL_REF] = {
    ...models[ASTRAFLOW_CN_DEFAULT_MODEL_REF],
    alias: models[ASTRAFLOW_CN_DEFAULT_MODEL_REF]?.alias ?? "UCloud AstraFlow (China)",
  };

  return applyProviderConfigWithModelCatalog(cfg, {
    agentModels: models,
    providerId: "astraflow-cn",
    api: "openai-completions",
    baseUrl: ASTRAFLOW_CN_BASE_URL,
    catalogModels: ASTRAFLOW_CN_MODEL_CATALOG.map(buildAstraflowModelDefinition),
  });
}

export function applyAstraflowCnConfig(cfg: OpenClawConfig): OpenClawConfig {
  return applyAgentDefaultModelPrimary(
    applyAstraflowCnProviderConfig(cfg),
    ASTRAFLOW_CN_DEFAULT_MODEL_REF,
  );
}
