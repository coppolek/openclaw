import {
  asObject,
  readResponseTextLimited,
  trimToUndefined,
  truncateErrorDetail,
} from "openclaw/plugin-sdk/speech";
import { normalizeGradiumBaseUrl } from "./shared.js";

function formatGradiumErrorPayload(payload: unknown): string | undefined {
  const root = asObject(payload);
  if (!root) {
    return undefined;
  }
  const message =
    trimToUndefined(root.message) ?? trimToUndefined(root.error) ?? trimToUndefined(root.detail);
  if (message) {
    return truncateErrorDetail(message);
  }
  return undefined;
}

async function extractGradiumErrorDetail(response: Response): Promise<string | undefined> {
  const rawBody = trimToUndefined(await readResponseTextLimited(response));
  if (!rawBody) {
    return undefined;
  }
  try {
    return formatGradiumErrorPayload(JSON.parse(rawBody)) ?? truncateErrorDetail(rawBody);
  } catch {
    return truncateErrorDetail(rawBody);
  }
}

export async function gradiumTTS(params: {
  text: string;
  apiKey: string;
  baseUrl: string;
  voiceId: string;
  outputFormat: "wav" | "opus" | "ulaw_8000" | "pcm" | "pcm_24000" | "alaw_8000";
  timeoutMs: number;
}): Promise<Buffer> {
  const { text, apiKey, baseUrl, voiceId, outputFormat, timeoutMs } = params;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${normalizeGradiumBaseUrl(baseUrl)}/api/post/speech/tts`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice_id: voiceId,
        only_audio: true,
        output_format: outputFormat,
        json_config: JSON.stringify({ padding_bonus: 0 }),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await extractGradiumErrorDetail(response);
      const requestId =
        trimToUndefined(response.headers.get("x-request-id")) ??
        trimToUndefined(response.headers.get("request-id"));
      throw new Error(
        `Gradium API error (${response.status})` +
          (detail ? `: ${detail}` : "") +
          (requestId ? ` [request_id=${requestId}]` : ""),
      );
    }

    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}
