import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  ANTHROPIC_BY_MODEL_REPLAY_HOOKS,
  normalizeProviderId,
} from "openclaw/plugin-sdk/provider-model-shared";
import {
  createBedrockNoCacheWrapper,
  isAnthropicBedrockModel,
  streamWithPayloadPatch,
} from "openclaw/plugin-sdk/provider-stream-shared";
import {
  mergeImplicitBedrockProvider,
  resolveBedrockConfigApiKey,
  resolveImplicitBedrockProvider,
} from "./api.js";
import { bedrockMemoryEmbeddingProviderAdapter } from "./memory-embedding-adapter.js";

type GuardrailConfig = {
  guardrailIdentifier: string;
  guardrailVersion: string;
  streamProcessingMode?: "sync" | "async";
  trace?: "enabled" | "disabled" | "enabled_full";
};

type AmazonBedrockPluginConfig = {
  discovery?: {
    enabled?: boolean;
    region?: string;
    providerFilter?: string[];
    refreshInterval?: number;
    defaultContextWindow?: number;
    defaultMaxTokens?: number;
  };
  guardrail?: GuardrailConfig;
};

function createGuardrailWrapStreamFn(
  innerWrapStreamFn: (ctx: { modelId: string; streamFn?: StreamFn }) => StreamFn | null | undefined,
  guardrailConfig: GuardrailConfig,
): (ctx: { modelId: string; streamFn?: StreamFn }) => StreamFn | null | undefined {
  return (ctx) => {
    const inner = innerWrapStreamFn(ctx);
    if (!inner) {
      return inner;
    }
    return (model, context, options) => {
      return streamWithPayloadPatch(inner, model, context, options, (payload) => {
        const gc: Record<string, unknown> = {
          guardrailIdentifier: guardrailConfig.guardrailIdentifier,
          guardrailVersion: guardrailConfig.guardrailVersion,
        };
        if (guardrailConfig.streamProcessingMode) {
          gc.streamProcessingMode = guardrailConfig.streamProcessingMode;
        }
        if (guardrailConfig.trace) {
          gc.trace = guardrailConfig.trace;
        }
        payload.guardrailConfig = gc;
      });
    };
  };
}

/**
 * Mirrors pi-ai's internal `supportsPromptCaching` check. Returns true when
 * pi-ai would inject cache points on its own (so we don't need to).
 *
 * This is intentionally a conservative subset — if pi-ai adds new models we
 * haven't mirrored yet, `needsCachePointInjection` returns true and the
 * `hasCachePoint` guard in `injectBedrockCachePoints` prevents double injection.
 * The only cost is a lightweight wrapper on those requests.
 */
function piAiWouldInjectCachePoints(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!id.includes("claude")) {
    return false;
  }
  // Claude 4.x
  if (id.includes("-4-") || id.includes("-4.")) {
    return true;
  }
  // Claude 3.7 Sonnet
  if (id.includes("claude-3-7-sonnet")) {
    return true;
  }
  // Claude 3.5 Haiku
  if (id.includes("claude-3-5-haiku")) {
    return true;
  }
  return false;
}

/**
 * Detect Bedrock application inference profile ARNs — these are the only IDs
 * where pi-ai's model-name-based checks fail because the ARN is opaque.
 * System-defined profiles (us., eu., global.) and base model IDs always
 * contain the model name and are handled by pi-ai natively.
 */
const BEDROCK_APP_INFERENCE_PROFILE_RE = /^arn:aws(-cn|-us-gov)?:bedrock:.*:application-inference-profile\//i;

function isBedrockAppInferenceProfile(modelId: string): boolean {
  return BEDROCK_APP_INFERENCE_PROFILE_RE.test(modelId);
}

/**
 * pi-ai's internal `supportsPromptCaching` checks `model.id` for specific Claude
 * model name patterns, which fails for application inference profile ARNs (opaque
 * IDs that may not contain the model name). When OpenClaw's `isAnthropicBedrockModel`
 * identifies the model but pi-ai won't inject cache points, we do it via onPayload.
 *
 * Gated to application inference profile ARNs only — regular Claude model IDs and
 * system-defined inference profiles (us.anthropic.claude-*) are left to pi-ai.
 */
function needsCachePointInjection(modelId: string): boolean {
  return (
    isBedrockAppInferenceProfile(modelId) &&
    isAnthropicBedrockModel(modelId) &&
    !piAiWouldInjectCachePoints(modelId)
  );
}

type BedrockCachePoint = { cachePoint: { type: "default"; ttl?: string } };
type BedrockContentBlock = Record<string, unknown>;
type BedrockMessage = { role?: string; content?: BedrockContentBlock[] };

function hasCachePoint(blocks: BedrockContentBlock[] | undefined): boolean {
  return blocks?.some((b) => b.cachePoint != null) === true;
}

function makeCachePoint(cacheRetention: string | undefined): BedrockCachePoint {
  return {
    cachePoint: {
      type: "default",
      ...(cacheRetention === "long" ? { ttl: "1h" } : {}),
    },
  };
}

/**
 * Inject Bedrock Converse cache points into the payload when pi-ai skipped them
 * because it didn't recognize the model ID (application inference profiles).
 */
function injectBedrockCachePoints(
  payload: Record<string, unknown>,
  cacheRetention: string | undefined,
): void {
  if (!cacheRetention || cacheRetention === "none") {
    return;
  }
  const point = makeCachePoint(cacheRetention);

  // Inject into system prompt if missing.
  const system = payload.system as BedrockContentBlock[] | undefined;
  if (Array.isArray(system) && system.length > 0 && !hasCachePoint(system)) {
    system.push(point);
  }

  // Inject into the last user message if missing.
  // Bedrock Converse uses lowercase roles ("user" / "assistant").
  const messages = payload.messages as BedrockMessage[] | undefined;
  if (Array.isArray(messages) && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "user" && Array.isArray(msg.content)) {
        if (!hasCachePoint(msg.content)) {
          msg.content.push(point);
        }
        break;
      }
    }
  }
}

export function registerAmazonBedrockPlugin(api: OpenClawPluginApi): void {
  // Keep registration-local constants inside the function so partial module
  // initialization during test bootstrap cannot trip TDZ reads.
  const providerId = "amazon-bedrock";
  const claude46ModelRe = /claude-(?:opus|sonnet)-4(?:\.|-)6(?:$|[-.])/i;
  // Match region from bedrock-runtime (Converse API) URLs.
  // e.g. https://bedrock-runtime.us-east-1.amazonaws.com
  const bedrockRegionRe = /bedrock-runtime\.([a-z0-9-]+)\.amazonaws\./;
  const bedrockContextOverflowPatterns = [
    /ValidationException.*(?:input is too long|max input token|input token.*exceed)/i,
    /ValidationException.*(?:exceeds? the (?:maximum|max) (?:number of )?(?:input )?tokens)/i,
    /ModelStreamErrorException.*(?:Input is too long|too many input tokens)/i,
  ] as const;
  const anthropicByModelReplayHooks = ANTHROPIC_BY_MODEL_REPLAY_HOOKS;
  const pluginConfig = (api.pluginConfig ?? {}) as AmazonBedrockPluginConfig;
  const guardrail = pluginConfig.guardrail;

  api.registerMemoryEmbeddingProvider(bedrockMemoryEmbeddingProviderAdapter);

  const baseWrapStreamFn = ({ modelId, streamFn }: { modelId: string; streamFn?: StreamFn }) =>
    isAnthropicBedrockModel(modelId) ? streamFn : createBedrockNoCacheWrapper(streamFn);

  const cacheWrapStreamFn =
    guardrail?.guardrailIdentifier && guardrail?.guardrailVersion
      ? createGuardrailWrapStreamFn(baseWrapStreamFn, guardrail)
      : baseWrapStreamFn;

  /** Extract the AWS region from a bedrock-runtime baseUrl. */
  function extractRegionFromBaseUrl(baseUrl: string | undefined): string | undefined {
    if (!baseUrl) {
      return undefined;
    }
    return bedrockRegionRe.exec(baseUrl)?.[1];
  }

  /**
   * Resolve the AWS region for Bedrock API calls.
   * Provider-specific baseUrl wins over global bedrockDiscovery to avoid signing
   * with the wrong region when discovery and provider target different regions.
   */
  function resolveBedrockRegion(
    config:
      | { models?: { bedrockDiscovery?: { region?: string }; providers?: Record<string, unknown> } }
      | undefined,
  ): string | undefined {
    // Try provider-specific baseUrl first.
    const providers = config?.models?.providers;
    if (providers) {
      const exact = (providers[providerId] as { baseUrl?: string } | undefined)?.baseUrl;
      if (exact) {
        const region = extractRegionFromBaseUrl(exact);
        if (region) {
          return region;
        }
      }
      // Fall back to alias matches (e.g. "bedrock" instead of "amazon-bedrock").
      for (const [key, value] of Object.entries(providers)) {
        if (key === providerId || normalizeProviderId(key) !== providerId) {
          continue;
        }
        const region = extractRegionFromBaseUrl((value as { baseUrl?: string }).baseUrl);
        if (region) {
          return region;
        }
      }
    }
    return config?.models?.bedrockDiscovery?.region;
  }

  api.registerProvider({
    id: providerId,
    label: "Amazon Bedrock",
    docsPath: "/providers/models",
    auth: [],
    catalog: {
      order: "simple",
      run: async (ctx) => {
        const implicit = await resolveImplicitBedrockProvider({
          config: ctx.config,
          pluginConfig,
          env: ctx.env,
        });
        if (!implicit) {
          return null;
        }
        return {
          provider: mergeImplicitBedrockProvider({
            existing: ctx.config.models?.providers?.[providerId],
            implicit,
          }),
        };
      },
    },
    resolveConfigApiKey: ({ env }) => resolveBedrockConfigApiKey(env),
    ...anthropicByModelReplayHooks,
    wrapStreamFn: ({ modelId, config, model, streamFn }) => {
      // Apply cache + guardrail wrapping.
      const wrapped = cacheWrapStreamFn({ modelId, streamFn });
      const region = resolveBedrockRegion(config) ?? extractRegionFromBaseUrl(model?.baseUrl);
      const injectCache = needsCachePointInjection(modelId);

      if (!region && !injectCache) {
        return wrapped;
      }

      const underlying = wrapped ?? streamFn;
      if (!underlying) {
        return wrapped;
      }
      return (streamModel, context, options) => {
        // pi-ai's bedrock provider reads `options.region` at runtime but the
        // StreamFn type does not declare it. Merge via Object.assign to avoid
        // an unsafe type assertion.
        const merged = Object.assign({}, options, region ? { region } : {});

        if (!injectCache) {
          return underlying(streamModel, context, merged);
        }

        // For application inference profiles whose ARN doesn't contain "claude",
        // pi-ai's supportsPromptCaching won't inject cache points. Patch the
        // Converse payload to add them so prompt caching works.
        // pi-ai defaults cacheRetention to "short" when not explicitly set.
        const cacheRetention =
          typeof merged.cacheRetention === "string" ? merged.cacheRetention : "short";
        return streamWithPayloadPatch(underlying, streamModel, context, merged, (payload) => {
          injectBedrockCachePoints(payload, cacheRetention);
        });
      };
    },
    matchesContextOverflowError: ({ errorMessage }) =>
      bedrockContextOverflowPatterns.some((pattern) => pattern.test(errorMessage)),
    classifyFailoverReason: ({ errorMessage }) => {
      if (/ThrottlingException|Too many concurrent requests/i.test(errorMessage)) {
        return "rate_limit";
      }
      if (/ModelNotReadyException/i.test(errorMessage)) {
        return "overloaded";
      }
      return undefined;
    },
    resolveThinkingProfile: ({ modelId }) => ({
      levels: [
        { id: "off" },
        { id: "minimal" },
        { id: "low" },
        { id: "medium" },
        { id: "high" },
        ...(claude46ModelRe.test(modelId.trim()) ? [{ id: "adaptive" as const }] : []),
      ],
      defaultLevel: claude46ModelRe.test(modelId.trim()) ? "adaptive" : undefined,
    }),
  });
}
