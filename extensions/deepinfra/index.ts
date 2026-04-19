import type {
  ProviderAuthContext,
  ProviderAuthMethod,
  ProviderAuthMethodNonInteractiveContext,
  ProviderAuthResult,
} from "openclaw/plugin-sdk/core";
import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  createProviderApiKeyAuthMethod,
  isProviderApiKeyConfigured,
} from "openclaw/plugin-sdk/provider-auth";
import type { ProviderCatalogContext } from "openclaw/plugin-sdk/provider-catalog-shared";
import type { OpenClawConfig } from "openclaw/plugin-sdk/provider-onboard";
import { isProxyReasoningUnsupported } from "openclaw/plugin-sdk/provider-stream";
import { applyDeepInfraConfig } from "./onboard.js";
import { createDeepInfraSystemCacheWrapper, createDeepInfraWrapper } from "./stream.js";
import { buildDeepInfraProviderWithDiscovery } from "./provider-catalog.js";
import {
  DEEPINFRA_MODEL_CATALOG,
  discoverDeepInfraModels,
  resolveDeepInfraDefaultModelRef,
} from "./provider-models.js";

const PROVIDER_ID = "deepinfra";
const AUTH_METHOD_ID = "api-key";
const AUTH_LABEL = "DeepInfra API key";
const AUTH_HINT = "Unified API for open source models";

const DEEPINFRA_CACHE_TTL_MODEL_PREFIXES = [
  "anthropic/",
] as const;

async function runCatalog(ctx: ProviderCatalogContext) {
  const apiKey = ctx.resolveProviderApiKey(PROVIDER_ID).apiKey;
  if (!apiKey) {
    return null;
  }
  const provider = await buildDeepInfraProviderWithDiscovery();
  return {
    provider: {
      ...provider,
      apiKey,
    },
  };
}

function buildApiKeyAuthMethod(defaultModelRef: string): ProviderAuthMethod {
  return createProviderApiKeyAuthMethod({
    methodId: AUTH_METHOD_ID,
    label: AUTH_LABEL,
    hint: AUTH_HINT,
    optionKey: "deepinfraApiKey",
    flagName: "--deepinfra-api-key",
    envVar: "DEEPINFRA_API_KEY",
    promptMessage: "Enter DeepInfra API key",
    defaultModel: defaultModelRef,
    providerId: PROVIDER_ID,
    expectedProviders: [PROVIDER_ID],
    applyConfig: (cfg: OpenClawConfig) => applyDeepInfraConfig(cfg, defaultModelRef),
    wizard: {
      choiceId: "deepinfra-api-key",
      choiceLabel: AUTH_LABEL,
      choiceHint: AUTH_HINT,
      groupId: PROVIDER_ID,
      groupLabel: "DeepInfra",
      groupHint: AUTH_HINT,
      methodId: AUTH_METHOD_ID,
    },
  });
}

// The default model ref is resolved dynamically from the discovered catalog so
// onboarding never commits to a model the runtime registry won't serve. If the
// preferred default is missing from /models (deprecation, region filtering,
// curated list change), fall back to the first discovered model instead.
const deepInfraAuthMethod: ProviderAuthMethod = {
  id: AUTH_METHOD_ID,
  label: AUTH_LABEL,
  hint: AUTH_HINT,
  kind: "api_key",
  wizard: {
    choiceId: "deepinfra-api-key",
    choiceLabel: AUTH_LABEL,
    choiceHint: AUTH_HINT,
    groupId: PROVIDER_ID,
    groupLabel: "DeepInfra",
    groupHint: AUTH_HINT,
    methodId: AUTH_METHOD_ID,
  },
  run: async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
    const ref = await resolveDeepInfraDefaultModelRef();
    return buildApiKeyAuthMethod(ref).run(ctx);
  },
  runNonInteractive: async (
    ctx: ProviderAuthMethodNonInteractiveContext,
  ): Promise<OpenClawConfig | null> => {
    const method = buildApiKeyAuthMethod(await resolveDeepInfraDefaultModelRef());
    return method.runNonInteractive ? method.runNonInteractive(ctx) : null;
  },
};

export default definePluginEntry({
  id: PROVIDER_ID,
  name: "DeepInfra Provider",
  description: "Bundled DeepInfra provider plugin",
  register(api: OpenClawPluginApi) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: "DeepInfra",
      docsPath: "/providers/deepinfra",
      auth: [deepInfraAuthMethod],
      catalog: {
        order: "simple",
        run: runCatalog,
        preserveDiscoveryOrder: true,
      },
      augmentModelCatalog: async (ctx) => {
        const hasConfiguredAuth =
          Boolean(ctx.config?.models?.providers?.[PROVIDER_ID]?.apiKey) ||
          isProviderApiKeyConfigured({
            provider: PROVIDER_ID,
            agentDir: ctx.agentDir,
          });
        const models = hasConfiguredAuth
          ? await discoverDeepInfraModels()
          : DEEPINFRA_MODEL_CATALOG;
        return models.map((m) => ({
          provider: PROVIDER_ID,
          id: m.id,
          name: m.name,
          reasoning: m.reasoning,
          input: m.input ? [...m.input] : undefined,
          contextWindow: m.contextWindow,
        }));
      },
      capabilities: {
        openAiCompatTurnValidation: false,
        geminiThoughtSignatureSanitization: true,
        geminiThoughtSignatureModelHints: ["gemini"],
        dropThinkingBlockModelHints: ["claude"],
      },
      wrapStreamFn: (ctx) => {
        const thinkingLevel = isProxyReasoningUnsupported(ctx.modelId)
          ? undefined
          : ctx.thinkingLevel;
        let streamFn = createDeepInfraWrapper(ctx.streamFn, thinkingLevel);
        streamFn = createDeepInfraSystemCacheWrapper(streamFn);
        return streamFn;
      },
      isCacheTtlEligible: (ctx) =>
        DEEPINFRA_CACHE_TTL_MODEL_PREFIXES.some((p) => ctx.modelId.startsWith(p)),
    });
  },
});
