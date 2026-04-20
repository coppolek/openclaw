import {
  asObject,
  normalizeLanguageCode,
  readResponseTextLimited,
  trimToUndefined,
  truncateErrorDetail,
} from "openclaw/plugin-sdk/speech";
import { XAI_BASE_URL } from "./api.js";
export { XAI_BASE_URL };

export const XAI_TTS_VOICES = ["eve", "ara", "rex", "sal", "leo"] as const;

type XaiTtsVoice = (typeof XAI_TTS_VOICES)[number];

export function normalizeXaiTtsBaseUrl(baseUrl?: string): string {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return XAI_BASE_URL;
  }
  return trimmed.replace(/\/+$/, "");
}

export function isValidXaiTtsVoice(voice: string, baseUrl?: string): voice is XaiTtsVoice {
  const isCustom =
    baseUrl != null
      ? normalizeXaiTtsBaseUrl(baseUrl) !== XAI_BASE_URL
      : normalizeXaiTtsBaseUrl(process.env.XAI_BASE_URL) !== XAI_BASE_URL;
  if (isCustom) {
    return true;
  }
  return XAI_TTS_VOICES.includes(voice as XaiTtsVoice);
}

function formatXaiErrorPayload(payload: unknown): string | undefined {
  const root = asObject(payload);
  const subject = asObject(root?.error) ?? root;
  if (!subject) {
    return undefined;
  }
  const message =
    trimToUndefined(subject.message) ??
    trimToUndefined(subject.detail) ??
    trimToUndefined(root?.message);
  const type = trimToUndefined(subject.type);
  const code = trimToUndefined(subject.code);
  const metadata = [type ? `type=${type}` : undefined, code ? `code=${code}` : undefined]
    .filter((value): value is string => Boolean(value))
    .join(", ");
  if (message && metadata) {
    return `${truncateErrorDetail(message)} [${metadata}]`;
  }
  if (message) {
    return truncateErrorDetail(message);
  }
  if (metadata) {
    return `[${metadata}]`;
  }
  return undefined;
}

async function extractXaiErrorDetail(response: Response): Promise<string | undefined> {
  const rawBody = trimToUndefined(await readResponseTextLimited(response));
  if (!rawBody) {
    return undefined;
  }
  try {
    return formatXaiErrorPayload(JSON.parse(rawBody)) ?? truncateErrorDetail(rawBody);
  } catch {
    return truncateErrorDetail(rawBody);
  }
}

export async function xaiTTS(params: {
  text: string;
  apiKey: string;
  baseUrl: string;
  voiceId: string;
  language?: string;
  speed?: number;
  responseFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  timeoutMs: number;
}): Promise<Buffer> {
  const {
    text,
    apiKey,
    baseUrl,
    voiceId,
    language: rawLanguage,
    speed,
    responseFormat = "mp3",
    timeoutMs,
  } = params;
  const language = normalizeLanguageCode(rawLanguage) ?? "en";

  if (!isValidXaiTtsVoice(voiceId, baseUrl)) {
    throw new Error(`Invalid voice: ${voiceId}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${normalizeXaiTtsBaseUrl(baseUrl)}/tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice_id: voiceId,
        language,
        ...(responseFormat !== "mp3" && { response_format: responseFormat }),
        ...(speed != null && { speed }),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await extractXaiErrorDetail(response);
      const requestId =
        trimToUndefined(response.headers.get("x-request-id")) ??
        trimToUndefined(response.headers.get("request-id"));
      throw new Error(
        `xAI TTS API error (${response.status})` +
          (detail ? `: ${detail}` : "") +
          (requestId ? ` [request_id=${requestId}]` : ""),
      );
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}
