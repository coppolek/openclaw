import {
  createDefaultModelsPresetAppliers,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/provider-onboard";
import {
  buildFriendliaiCatalogModels,
  buildFriendliaiProvider,
  FRIENDLIAI_DEFAULT_MODEL_ID,
} from "./provider-catalog.js";

export const FRIENDLIAI_DEFAULT_MODEL_REF = `friendliai/${FRIENDLIAI_DEFAULT_MODEL_ID}`;

const friendliaiPresetAppliers = createDefaultModelsPresetAppliers({
  primaryModelRef: FRIENDLIAI_DEFAULT_MODEL_REF,
  resolveParams: (_cfg: OpenClawConfig) => {
    const defaultProvider = buildFriendliaiProvider();
    return {
      providerId: "friendliai",
      api: defaultProvider.api ?? "openai-completions",
      baseUrl: defaultProvider.baseUrl,
      defaultModels: buildFriendliaiCatalogModels(),
      defaultModelId: FRIENDLIAI_DEFAULT_MODEL_ID,
      aliases: [{ modelRef: FRIENDLIAI_DEFAULT_MODEL_REF, alias: "GLM-5.1" }],
    };
  },
});

export function applyFriendliaiProviderConfig(cfg: OpenClawConfig): OpenClawConfig {
  return friendliaiPresetAppliers.applyProviderConfig(cfg);
}

export function applyFriendliaiConfig(cfg: OpenClawConfig): OpenClawConfig {
  return friendliaiPresetAppliers.applyConfig(cfg);
}
