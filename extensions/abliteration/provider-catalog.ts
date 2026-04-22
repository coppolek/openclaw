import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import {
  ABLITERATION_BASE_URL,
  ABLITERATION_MODEL_CATALOG,
  ABLITERATION_PROVIDER_API,
  buildAbliterationModelDefinition,
} from "./models.js";

export function buildAbliterationProvider(): ModelProviderConfig {
  return {
    baseUrl: ABLITERATION_BASE_URL,
    api: ABLITERATION_PROVIDER_API,
    authHeader: true,
    models: ABLITERATION_MODEL_CATALOG.map(buildAbliterationModelDefinition),
  };
}
