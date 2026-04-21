import type { ProviderResolveDynamicModelContext } from "openclaw/plugin-sdk/plugin-entry";
import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import {
  cloneFirstTemplateModel,
  DEFAULT_CONTEXT_TOKENS,
  normalizeModelCompat,
  OPENAI_COMPATIBLE_REPLAY_HOOKS,
} from "openclaw/plugin-sdk/provider-model-shared";
import { applyFriendliaiConfig, FRIENDLIAI_DEFAULT_MODEL_REF } from "./onboard.js";
import {
  buildFriendliaiProvider,
  FRIENDLIAI_BASE_URL,
  FRIENDLIAI_DEFAULT_CONTEXT_WINDOW,
  FRIENDLIAI_DEFAULT_MAX_TOKENS,
  FRIENDLIAI_DEFAULT_MODEL_ID,
} from "./provider-catalog.js";

const PROVIDER_ID = "friendliai";

function resolveFriendliaiDynamicModel(ctx: ProviderResolveDynamicModelContext) {
  const modelId = ctx.modelId.trim();
  if (!modelId) {
    return undefined;
  }

  return (
    cloneFirstTemplateModel({
      providerId: PROVIDER_ID,
      modelId,
      templateIds: [FRIENDLIAI_DEFAULT_MODEL_ID],
      ctx,
      patch: { provider: PROVIDER_ID, reasoning: false },
    }) ??
    normalizeModelCompat({
      id: modelId,
      name: modelId,
      provider: PROVIDER_ID,
      api: "openai-completions",
      baseUrl: FRIENDLIAI_BASE_URL,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: FRIENDLIAI_DEFAULT_CONTEXT_WINDOW,
      maxTokens: FRIENDLIAI_DEFAULT_MAX_TOKENS || DEFAULT_CONTEXT_TOKENS,
    })
  );
}

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "FriendliAI Provider",
  description: "Bundled FriendliAI provider plugin",
  provider: {
    label: "FriendliAI",
    aliases: ["friendli"],
    docsPath: "/providers/friendliai",
    auth: [
      {
        methodId: "api-key",
        label: "FriendliAI API key",
        hint: "API key",
        optionKey: "friendliaiApiKey",
        flagName: "--friendliai-api-key",
        envVar: "FRIENDLIAI_API_KEY",
        promptMessage: "Enter FriendliAI personal API key (flp_...)",
        defaultModel: FRIENDLIAI_DEFAULT_MODEL_REF,
        applyConfig: (cfg) => applyFriendliaiConfig(cfg),
      },
    ],
    catalog: {
      buildProvider: buildFriendliaiProvider,
      allowExplicitBaseUrl: true,
    },
    ...OPENAI_COMPATIBLE_REPLAY_HOOKS,
    resolveDynamicModel: (ctx) => resolveFriendliaiDynamicModel(ctx),
    isModernModelRef: () => true,
  },
});
