import type { ImageGenerationProvider } from "openclaw/plugin-sdk/image-generation";
import { isProviderApiKeyConfigured } from "openclaw/plugin-sdk/provider-auth";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth-runtime";
import {
  assertOkOrThrowHttpError,
  postJsonRequest,
  resolveProviderHttpRequestConfig,
} from "openclaw/plugin-sdk/provider-http";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "google/gemini-3-pro-image-preview";
const DEFAULT_OUTPUT_MIME = "image/png";

const SUPPORTED_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

// OpenRouter returns generated images in a separate `message.images`
// array (NOT inside `message.content`). Each entry has `image_url.url`
// containing a base64 data-URL.
// Ref: https://openrouter.ai/docs/guides/overview/multimodal/image-generation

type ImageEntry = {
  type?: string;
  image_url?: { url?: string };
  imageUrl?: { url?: string };
};

type ChatCompletionChoice = {
  message?: {
    content?: string | unknown[] | null;
    images?: ImageEntry[];
  };
};

type ChatCompletionResponse = {
  choices?: ChatCompletionChoice[];
};

function extractBase64FromDataUrl(dataUrl: string): { data: string; mimeType: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return { mimeType: match[1]!, data: match[2]! };
}

function fileExtForMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return mime.split("/")[1] ?? "png";
}

function extractImagesFromResponse(body: ChatCompletionResponse): {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}[] {
  const images: { buffer: Buffer; mimeType: string; fileName: string }[] = [];

  for (const choice of body.choices ?? []) {
    const msg = choice.message;
    if (!msg) continue;

    // Primary: message.images array (OpenRouter documented format).
    for (const entry of msg.images ?? []) {
      const url = entry.image_url?.url ?? entry.imageUrl?.url;
      if (typeof url !== "string") continue;
      const parsed = extractBase64FromDataUrl(url);
      if (parsed) {
        images.push({
          buffer: Buffer.from(parsed.data, "base64"),
          mimeType: parsed.mimeType,
          fileName: `image-${images.length + 1}.${fileExtForMime(parsed.mimeType)}`,
        });
      }
    }

    // Fallback: scan string content for embedded base64 data-URLs.
    const content = msg.content;
    if (typeof content === "string" && content.length > 0) {
      const dataUrlRe = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g;
      for (const match of content.matchAll(dataUrlRe)) {
        const parsed = extractBase64FromDataUrl(match[0]);
        if (parsed) {
          images.push({
            buffer: Buffer.from(parsed.data, "base64"),
            mimeType: parsed.mimeType,
            fileName: `image-${images.length + 1}.${fileExtForMime(parsed.mimeType)}`,
          });
        }
      }
    }

    // Fallback: content is an array of parts.
    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;

        if (p.type === "image_url") {
          const iu = (p.image_url ?? p.imageUrl) as Record<string, unknown> | undefined;
          const url = typeof iu?.url === "string" ? iu.url : undefined;
          if (url) {
            const parsed = extractBase64FromDataUrl(url);
            if (parsed) {
              images.push({
                buffer: Buffer.from(parsed.data, "base64"),
                mimeType: parsed.mimeType,
                fileName: `image-${images.length + 1}.${fileExtForMime(parsed.mimeType)}`,
              });
              continue;
            }
          }
        }

        // Raw b64_json part (OpenAI images/generations style).
        const b64 = typeof p.b64_json === "string" ? p.b64_json : undefined;
        if (b64) {
          images.push({
            buffer: Buffer.from(b64, "base64"),
            mimeType: DEFAULT_OUTPUT_MIME,
            fileName: `image-${images.length + 1}.png`,
          });
          continue;
        }

        const inlineData = (p.inlineData ?? p.inline_data) as Record<string, unknown> | undefined;
        if (inlineData && typeof inlineData === "object") {
          const data = typeof inlineData.data === "string" ? inlineData.data.trim() : undefined;
          if (data) {
            const mime =
              (typeof inlineData.mimeType === "string" ? inlineData.mimeType : undefined) ??
              (typeof inlineData.mime_type === "string" ? inlineData.mime_type : undefined) ??
              DEFAULT_OUTPUT_MIME;
            images.push({
              buffer: Buffer.from(data, "base64"),
              mimeType: mime,
              fileName: `image-${images.length + 1}.${fileExtForMime(mime)}`,
            });
          }
        }
      }
    }
  }

  return images;
}

export function buildOpenRouterImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: "openrouter",
    label: "OpenRouter",
    defaultModel: DEFAULT_MODEL,
    models: [DEFAULT_MODEL, "google/gemini-3.1-flash-image-preview"],

    isConfigured: ({ agentDir }) =>
      isProviderApiKeyConfigured({ provider: "openrouter", agentDir }),

    capabilities: {
      generate: {
        maxCount: 4,
        supportsSize: false,
        supportsAspectRatio: true,
        supportsResolution: true,
      },
      edit: {
        enabled: true,
        maxCount: 4,
        maxInputImages: 5,
        supportsSize: false,
        supportsAspectRatio: true,
        supportsResolution: true,
      },
      geometry: {
        aspectRatios: [...SUPPORTED_ASPECT_RATIOS],
        resolutions: ["1K", "2K", "4K"],
      },
    },

    async generateImage(req) {
      const auth = await resolveApiKeyForProvider({
        provider: "openrouter",
        cfg: req.cfg,
        agentDir: req.agentDir,
        store: req.authStore,
      });
      if (!auth.apiKey) {
        throw new Error("OpenRouter API key missing");
      }

      const configuredBaseUrl = req.cfg?.models?.providers?.openrouter?.baseUrl;
      const {
        baseUrl,
        allowPrivateNetwork,
        headers,
        dispatcherPolicy,
      } = resolveProviderHttpRequestConfig({
        baseUrl: configuredBaseUrl,
        defaultBaseUrl: OPENROUTER_BASE_URL,
        allowPrivateNetwork: false,
        defaultHeaders: {
          Authorization: `Bearer ${auth.apiKey}`,
          "HTTP-Referer": "https://openclaw.ai",
          "X-OpenRouter-Title": "OpenClaw",
        },
        provider: "openrouter",
        capability: "image",
        transport: "http",
      });

      const model = req.model || DEFAULT_MODEL;
      const count = req.count ?? 1;

      type ContentPart = { type: string; text?: string; image_url?: { url: string } };
      const contentParts: ContentPart[] = [{ type: "text", text: req.prompt }];
      for (const image of req.inputImages ?? []) {
        contentParts.push({
          type: "image_url",
          image_url: { url: `data:${image.mimeType};base64,${image.buffer.toString("base64")}` },
        });
      }

      const imageConfig: Record<string, string> = {};
      if (req.aspectRatio?.trim()) imageConfig.aspect_ratio = req.aspectRatio.trim();
      if (req.resolution) imageConfig.image_size = req.resolution;

      const { response: res, release } = await postJsonRequest({
        url: `${baseUrl}/chat/completions`,
        headers,
        body: {
          model,
          n: count,
          messages: [{ role: "user", content: contentParts }],
          modalities: ["image", "text"],
          max_tokens: 4096,
          ...(Object.keys(imageConfig).length > 0 ? { image_config: imageConfig } : {}),
        },
        timeoutMs: req.timeoutMs ?? 90_000,
        fetchFn: fetch,
        allowPrivateNetwork,
        dispatcherPolicy,
      });

      try {
        await assertOkOrThrowHttpError(res, "OpenRouter image generation failed");

        const payload = (await res.json()) as ChatCompletionResponse;
        const images = extractImagesFromResponse(payload);

        if (images.length === 0) {
          throw new Error("OpenRouter image generation response missing image data");
        }

        return { images, model };
      } finally {
        await release();
      }
    },
  };
}
