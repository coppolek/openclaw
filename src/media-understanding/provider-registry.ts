import type { OpenClawConfig } from "../config/types.js";
import { resolvePluginCapabilityProviders } from "../plugins/capability-provider-runtime.js";
import { resolveImageCapableConfigProviderIds } from "./config-provider-models.js";
import { describeImageWithModel, describeImagesWithModel } from "./image-runtime.js";
import { normalizeMediaProviderId } from "./provider-id.js";
import type { MediaUnderstandingProvider } from "./types.js";
import { describeImageWithModel, describeImagesWithModel } from "./image-runtime.js";

function mergeProviderIntoRegistry(
  registry: Map<string, MediaUnderstandingProvider>,
  provider: MediaUnderstandingProvider,
  registryKey = provider.id,
) {
  const normalizedKey = normalizeMediaProviderId(registryKey);
  const existing = registry.get(normalizedKey);
  const merged = existing
    ? {
        ...existing,
        ...provider,
        capabilities: provider.capabilities ?? existing.capabilities,
        defaultModels: provider.defaultModels ?? existing.defaultModels,
        autoPriority: provider.autoPriority ?? existing.autoPriority,
        nativeDocumentInputs: provider.nativeDocumentInputs ?? existing.nativeDocumentInputs,
      }
    : provider;
  registry.set(normalizedKey, merged);
}

export { normalizeMediaProviderId } from "./provider-id.js";

export function buildMediaUnderstandingRegistry(
  overrides?: Record<string, MediaUnderstandingProvider>,
  cfg?: OpenClawConfig,
): Map<string, MediaUnderstandingProvider> {
  const registry = new Map<string, MediaUnderstandingProvider>();
  for (const provider of resolvePluginCapabilityProviders({
    key: "mediaUnderstandingProviders",
    cfg,
  })) {
    mergeProviderIntoRegistry(registry, provider);
  }
  // Auto-register media-understanding for config providers with image-capable models (#51392)
  for (const normalizedKey of resolveImageCapableConfigProviderIds(cfg)) {
    if (!registry.has(normalizedKey)) {
      mergeProviderIntoRegistry(registry, {
        id: normalizedKey,
        capabilities: ["image"],
        describeImage: describeImageWithModel,
        describeImages: describeImagesWithModel,
      });
    }
  }
  if (overrides) {
    for (const [key, provider] of Object.entries(overrides)) {
      mergeProviderIntoRegistry(registry, provider, key);
    }
  }
  // Auto-register custom providers that use a known API format (e.g.
  // "anthropic-messages") and declare image input support.  This allows
  // third-party or self-hosted providers to be used by the `image` tool
  // without requiring a dedicated media-understanding plugin.
  const configuredProviders = cfg?.models?.providers;
  if (configuredProviders && typeof configuredProviders === "object") {
    for (const [providerId, providerConfig] of Object.entries(configuredProviders)) {
      const normalizedKey = normalizeMediaProviderId(providerId);
      if (registry.has(normalizedKey)) {
        continue;
      }
      const record = providerConfig as Record<string, unknown>;
      const api = record?.api;
      if (api === "anthropic-messages" || api === "openai-responses" || api === "openai-completions") {
        const rawModels = record?.models;
        const models: Array<Record<string, unknown>> = Array.isArray(rawModels)
          ? rawModels
          : [];
        const hasImageModel = models.some(
          (m) => Array.isArray(m?.input) && m.input.includes("image"),
        );
        if (hasImageModel) {
          registry.set(normalizedKey, {
            id: providerId,
            capabilities: ["image"],
            describeImage: describeImageWithModel,
            describeImages: describeImagesWithModel,
          });
        }
      }
    }
  }
  return registry;
}

export function getMediaUnderstandingProvider(
  id: string,
  registry: Map<string, MediaUnderstandingProvider>,
): MediaUnderstandingProvider | undefined {
  return registry.get(normalizeMediaProviderId(id));
}
