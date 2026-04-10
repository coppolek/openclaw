import type { ImageGenerationProvider } from "openclaw/plugin-sdk/image-generation";
import type { MediaUnderstandingProvider } from "openclaw/plugin-sdk/media-understanding";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildGoogleGeminiCliBackend } from "./cli-backend.js";
import { registerGoogleGeminiCliProvider } from "./gemini-cli-provider.js";
import { buildGoogleMusicGenerationProvider } from "./music-generation-provider.js";
import { registerGoogleProvider } from "./provider-registration.js";
import { createGeminiWebSearchProvider } from "./src/gemini-web-search-provider.js";
import { buildGoogleVideoGenerationProvider } from "./video-generation-provider.js";
import {
  buildGoogleVertexProvider,
  mergeImplicitGoogleVertexProvider,
} from "./vertex-provider-catalog.js";
import {
  hasGoogleVertexAvailableAuth,
  resolveGoogleVertexBaseUrl,
  resolveGoogleVertexClientRegion,
  resolveGoogleVertexConfigApiKey,
  resolveGoogleVertexRegionFromBaseUrl,
} from "./vertex-region.js";

let googleImageGenerationProviderPromise: Promise<ImageGenerationProvider> | null = null;
let googleMediaUnderstandingProviderPromise: Promise<MediaUnderstandingProvider> | null = null;

type GoogleMediaUnderstandingProvider = MediaUnderstandingProvider & {
  describeImage: NonNullable<MediaUnderstandingProvider["describeImage"]>;
  describeImages: NonNullable<MediaUnderstandingProvider["describeImages"]>;
  transcribeAudio: NonNullable<MediaUnderstandingProvider["transcribeAudio"]>;
  describeVideo: NonNullable<MediaUnderstandingProvider["describeVideo"]>;
};

async function loadGoogleImageGenerationProvider(): Promise<ImageGenerationProvider> {
  if (!googleImageGenerationProviderPromise) {
    googleImageGenerationProviderPromise = import("./image-generation-provider.js").then((mod) =>
      mod.buildGoogleImageGenerationProvider(),
    );
  }
  return await googleImageGenerationProviderPromise;
}

async function loadGoogleMediaUnderstandingProvider(): Promise<MediaUnderstandingProvider> {
  if (!googleMediaUnderstandingProviderPromise) {
    googleMediaUnderstandingProviderPromise = import("./media-understanding-provider.js").then(
      (mod) => mod.googleMediaUnderstandingProvider,
    );
  }
  return await googleMediaUnderstandingProviderPromise;
}

async function loadGoogleRequiredMediaUnderstandingProvider(): Promise<GoogleMediaUnderstandingProvider> {
  const provider = await loadGoogleMediaUnderstandingProvider();
  if (
    !provider.describeImage ||
    !provider.describeImages ||
    !provider.transcribeAudio ||
    !provider.describeVideo
  ) {
    throw new Error("google media understanding provider missing required handlers");
  }
  return provider as GoogleMediaUnderstandingProvider;
}

function createLazyGoogleImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: "google",
    label: "Google",
    defaultModel: "gemini-3.1-flash-image-preview",
    models: ["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"],
    capabilities: {
      generate: {
        maxCount: 4,
        supportsSize: true,
        supportsAspectRatio: true,
        supportsResolution: true,
      },
      edit: {
        enabled: true,
        maxCount: 4,
        maxInputImages: 5,
        supportsSize: true,
        supportsAspectRatio: true,
        supportsResolution: true,
      },
      geometry: {
        sizes: ["1024x1024", "1024x1536", "1536x1024", "1024x1792", "1792x1024"],
        aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
        resolutions: ["1K", "2K", "4K"],
      },
    },
    generateImage: async (req) => (await loadGoogleImageGenerationProvider()).generateImage(req),
  };
}

function createLazyGoogleMediaUnderstandingProvider(): MediaUnderstandingProvider {
  return {
    id: "google",
    capabilities: ["image", "audio", "video"],
    defaultModels: {
      image: "gemini-3-flash-preview",
      audio: "gemini-3-flash-preview",
      video: "gemini-3-flash-preview",
    },
    autoPriority: { image: 30, audio: 40, video: 10 },
    nativeDocumentInputs: ["pdf"],
    describeImage: async (...args) =>
      await (await loadGoogleRequiredMediaUnderstandingProvider()).describeImage(...args),
    describeImages: async (...args) =>
      await (await loadGoogleRequiredMediaUnderstandingProvider()).describeImages(...args),
    transcribeAudio: async (...args) =>
      await (await loadGoogleRequiredMediaUnderstandingProvider()).transcribeAudio(...args),
    describeVideo: async (...args) =>
      await (await loadGoogleRequiredMediaUnderstandingProvider()).describeVideo(...args),
  };
}

export default definePluginEntry({
  id: "google",
  name: "Google Plugin",
  description: "Bundled Google plugin",
  register(api) {
    api.registerCliBackend(buildGoogleGeminiCliBackend());
    registerGoogleGeminiCliProvider(api);
    registerGoogleProvider(api);
    api.registerImageGenerationProvider(createLazyGoogleImageGenerationProvider());
    api.registerMediaUnderstandingProvider(createLazyGoogleMediaUnderstandingProvider());
    api.registerMusicGenerationProvider(buildGoogleMusicGenerationProvider());
    api.registerVideoGenerationProvider(buildGoogleVideoGenerationProvider());
    api.registerWebSearchProvider(createGeminiWebSearchProvider());
    api.registerProvider({
      id: "google-vertex",
      label: "Google Vertex AI",
      docsPath: "/providers/models",
      auth: [],
      catalog: {
        order: "simple",
        run: async (ctx) => {
          if (!hasGoogleVertexAvailableAuth(ctx.env)) {
            return null;
          }
          const implicit = buildGoogleVertexProvider({ env: ctx.env });
          return {
            provider: mergeImplicitGoogleVertexProvider({
              existing: ctx.config.models?.providers?.["google-vertex"],
              implicit,
            }),
          };
        },
      },
      resolveConfigApiKey: ({ env }) => resolveGoogleVertexConfigApiKey(env),
      // Format stored OAuth credentials as the JSON blob that parseGeminiAuth
      // expects: { token, projectId }. Without this, buildOAuthApiKey falls back
      // to cred.access (the raw token) which parseGeminiAuth treats as an API key
      // (x-goog-api-key) rather than a Bearer token, breaking Vertex AI requests.
      formatApiKey: (cred) => formatGoogleOauthApiKey(cred),
      normalizeModelId: ({ modelId }) => normalizeGoogleModelId(modelId),
      resolveDynamicModel: (ctx) =>
        resolveGoogle31ForwardCompatModel({ providerId: "google-vertex", ctx }),
      ...GOOGLE_GEMINI_PROVIDER_HOOKS_WITH_TOOL_COMPAT,
      isModernModelRef: ({ modelId }) => isModernGoogleModel(modelId),
      // Refresh expired google-vertex OAuth profiles via ADC so that stored
      // credentials (e.g. from previous OAuth-backed auth flows) do not cause
      // permanent "No credentials found" failures when the access token expires.
      refreshOAuth: async (cred) => {
        const { resolveGoogleVertexAdcToken } = await import("./vertex-adc.js");
        const token = await resolveGoogleVertexAdcToken();
        if (!token) {
          throw new Error(
            "Google Vertex AI: ADC credentials not available for token refresh. " +
              "Run `gcloud auth application-default login` and try again.",
          );
        }
        return { ...cred, access: token.accessToken, expires: token.expiresAt };
      },
      normalizeTransport: ({ provider, baseUrl }) => {
        // Guard: skip normalization for providers that are not google-vertex and
        // whose baseUrl doesn't look like a Google Vertex endpoint.
        // Without this guard the fallback loop runs this hook for every provider
        // that has no registered plugin (e.g. user-defined providers like llamacpp),
        // silently rerouting them to Google Vertex AI and breaking their requests.
        // We still allow through when provider === "google-vertex" so that pi-ai
        // template baseUrls ({location}-aiplatform.googleapis.com) are handled by
        // the env-var fallback in resolveGoogleVertexClientRegion.
        if (provider !== "google-vertex" && !resolveGoogleVertexRegionFromBaseUrl(baseUrl)) {
          return undefined;
        }
        // resolveGoogleVertexClientRegion prefers a real resolved endpoint from baseUrl,
        // but falls back to env when baseUrl is a pi-ai template like {location}-aiplatform.googleapis.com.
        const region = resolveGoogleVertexClientRegion({ baseUrl, env: process.env });
        return {
          api: "google-generative-ai" as const,
          baseUrl: resolveGoogleVertexBaseUrl(region),
        };
      },
    });
  },
});
