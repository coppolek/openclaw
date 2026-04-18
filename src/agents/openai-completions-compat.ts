import type { Model } from "@mariozechner/pi-ai";
import type { ProviderEndpointClass, ProviderRequestCapabilities } from "./provider-attribution.js";
import { resolveProviderRequestCapabilities } from "./provider-attribution.js";

type OpenAICompletionsCompatDefaultsInput = {
  provider?: string;
  endpointClass: ProviderEndpointClass;
  knownProviderFamily: string;
  supportsNativeStreamingUsageCompat?: boolean;
  usesExplicitProxyLikeEndpoint?: boolean;
};

export type OpenAICompletionsCompatDefaults = {
  supportsStore: boolean;
  supportsDeveloperRole: boolean;
  supportsReasoningEffort: boolean;
  supportsUsageInStreaming: boolean;
  maxTokensField: "max_completion_tokens" | "max_tokens";
  thinkingFormat: "openai" | "openrouter" | "zai";
  supportsStrictMode: boolean;
};

export type DetectedOpenAICompletionsCompat = {
  capabilities: ProviderRequestCapabilities;
  defaults: OpenAICompletionsCompatDefaults;
};

function isDefaultRouteProvider(provider: string | undefined, ...ids: string[]) {
  return provider !== undefined && ids.includes(provider);
}

// Known local OpenAI-compatible inference servers that honor
// `stream_options.include_usage` the same way Ollama does. Anything not in
// this set continues to fall through to the generic compat rules.
const KNOWN_LOCAL_OPENAI_COMPAT_PROVIDERS = new Set<string>([
  "vllm",
  "localai",
  "sglang",
  "llama-cpp",
  "llama.cpp",
  "llamacpp",
  "jan",
  "lmstudio",
  "lm-studio",
  "text-generation-webui",
  "tabby",
  "tabbyapi",
]);

export function resolveOpenAICompletionsCompatDefaults(
  input: OpenAICompletionsCompatDefaultsInput,
): OpenAICompletionsCompatDefaults {
  const {
    provider,
    endpointClass,
    knownProviderFamily,
    supportsNativeStreamingUsageCompat = false,
    usesExplicitProxyLikeEndpoint = false,
  } = input;
  const isDefaultRoute = endpointClass === "default";
  const usesConfiguredNonOpenAIEndpoint =
    endpointClass !== "default" && endpointClass !== "openai-public";
  const isMoonshotLike =
    knownProviderFamily === "moonshot" ||
    knownProviderFamily === "modelstudio" ||
    endpointClass === "moonshot-native" ||
    endpointClass === "modelstudio-native";
  const isZai =
    endpointClass === "zai-native" ||
    (isDefaultRoute && isDefaultRouteProvider(input.provider, "zai"));
  const isNonStandard =
    endpointClass === "cerebras-native" ||
    endpointClass === "chutes-native" ||
    endpointClass === "deepseek-native" ||
    endpointClass === "mistral-public" ||
    endpointClass === "opencode-native" ||
    endpointClass === "xai-native" ||
    isZai ||
    (isDefaultRoute &&
      isDefaultRouteProvider(input.provider, "cerebras", "chutes", "deepseek", "opencode", "xai"));
  const isOpenRouterLike = input.provider === "openrouter" || endpointClass === "openrouter";
  const usesMaxTokens =
    endpointClass === "chutes-native" ||
    endpointClass === "mistral-public" ||
    knownProviderFamily === "mistral" ||
    (isDefaultRoute && isDefaultRouteProvider(provider, "chutes"));
  const isOllamaCompatProvider = provider === "ollama";
  const isKnownLocalOpenAICompatProvider =
    provider !== undefined && KNOWN_LOCAL_OPENAI_COMPAT_PROVIDERS.has(provider.toLowerCase());

  return {
    supportsStore:
      !isNonStandard && knownProviderFamily !== "mistral" && !usesExplicitProxyLikeEndpoint,
    supportsDeveloperRole: !isNonStandard && !isMoonshotLike && !usesConfiguredNonOpenAIEndpoint,
    supportsReasoningEffort:
      !isZai &&
      knownProviderFamily !== "mistral" &&
      endpointClass !== "xai-native" &&
      !usesExplicitProxyLikeEndpoint,
    // Known local OpenAI-compatible inference servers (vLLM, LocalAI, SGLang,
    // llama.cpp --server, Jan, LM Studio, text-generation-webui, TabbyAPI)
    // implement `stream_options.include_usage` the same way Ollama does.
    // Without opting them in, streaming responses carry no `usage` field and
    // session totalTokens stays stale, rendering `unknown/Nk (?%)` in
    // `openclaw status`. See #47639.
    supportsUsageInStreaming:
      isOllamaCompatProvider ||
      isKnownLocalOpenAICompatProvider ||
      (!isNonStandard && (!usesConfiguredNonOpenAIEndpoint || supportsNativeStreamingUsageCompat)),
    maxTokensField: usesMaxTokens ? "max_tokens" : "max_completion_tokens",
    thinkingFormat: isZai ? "zai" : isOpenRouterLike ? "openrouter" : "openai",
    supportsStrictMode: !isZai && !usesConfiguredNonOpenAIEndpoint,
  };
}

export function resolveOpenAICompletionsCompatDefaultsFromCapabilities(
  input: Pick<
    ProviderRequestCapabilities,
    | "endpointClass"
    | "knownProviderFamily"
    | "supportsNativeStreamingUsageCompat"
    | "usesExplicitProxyLikeEndpoint"
  > & {
    provider?: string;
  },
): OpenAICompletionsCompatDefaults {
  return resolveOpenAICompletionsCompatDefaults(input);
}

export function detectOpenAICompletionsCompat(
  model: Pick<Model<"openai-completions">, "provider" | "baseUrl" | "id" | "compat">,
): DetectedOpenAICompletionsCompat {
  const capabilities = resolveProviderRequestCapabilities({
    provider: model.provider,
    api: "openai-completions",
    baseUrl: model.baseUrl,
    capability: "llm",
    transport: "stream",
    modelId: model.id,
    compat:
      model.compat && typeof model.compat === "object"
        ? (model.compat as { supportsStore?: boolean })
        : undefined,
  });
  return {
    capabilities,
    defaults: resolveOpenAICompletionsCompatDefaultsFromCapabilities({
      provider: model.provider,
      ...capabilities,
    }),
  };
}
