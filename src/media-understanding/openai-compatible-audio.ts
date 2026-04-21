import path from "node:path";
import { extensionForMime } from "../media/mime.js";
import {
  assertOkOrThrowHttpError,
  postTranscriptionRequest,
  resolveProviderHttpRequestConfig,
  requireTranscriptionText,
} from "./shared.js";
import type { AudioTranscriptionRequest, AudioTranscriptionResult } from "./types.js";

type OpenAiCompatibleAudioParams = AudioTranscriptionRequest & {
  defaultBaseUrl: string;
  defaultModel: string;
  provider?: string;
};

function resolveModel(model: string | undefined, fallback: string): string {
  const trimmed = model?.trim();
  return trimmed || fallback;
}

function resolveAudioUploadFileName(
  fileName: string | undefined,
  mime: string | undefined,
): string {
  const trimmed = fileName?.trim() || "audio";
  const parsed = path.parse(trimmed);
  const mimeExt = extensionForMime(mime);
  if (!mimeExt || parsed.ext.toLowerCase() === mimeExt) {
    return trimmed;
  }
  return path.format({
    ...parsed,
    base: "",
    ext: mimeExt,
    name: parsed.name || parsed.base || "audio",
  });
}

export async function transcribeOpenAiCompatibleAudio(
  params: OpenAiCompatibleAudioParams,
): Promise<AudioTranscriptionResult> {
  const fetchFn = params.fetchFn ?? fetch;
  const { baseUrl, allowPrivateNetwork, headers, dispatcherPolicy } =
    resolveProviderHttpRequestConfig({
      baseUrl: params.baseUrl,
      defaultBaseUrl: params.defaultBaseUrl,
      headers: params.headers,
      request: params.request,
      defaultHeaders: {
        authorization: `Bearer ${params.apiKey}`,
      },
      provider: params.provider,
      api: "openai-audio-transcriptions",
      capability: "audio",
      transport: "media-understanding",
    });
  const url = `${baseUrl}/audio/transcriptions`;

  const model = resolveModel(params.model, params.defaultModel);
  const form = new FormData();
  const fileName = resolveAudioUploadFileName(params.fileName, params.mime);
  const bytes = new Uint8Array(params.buffer);
  const blob = new Blob([bytes], {
    type: params.mime ?? "application/octet-stream",
  });
  form.append("file", blob, fileName);
  form.append("model", model);
  if (params.language?.trim()) {
    form.append("language", params.language.trim());
  }
  if (params.prompt?.trim()) {
    form.append("prompt", params.prompt.trim());
  }

  const { response: res, release } = await postTranscriptionRequest({
    url,
    headers,
    body: form,
    timeoutMs: params.timeoutMs,
    fetchFn,
    pinDns: false,
    allowPrivateNetwork,
    dispatcherPolicy,
  });

  try {
    await assertOkOrThrowHttpError(res, "Audio transcription failed");

    const payload = (await res.json()) as { text?: string };
    const text = requireTranscriptionText(
      payload.text,
      "Audio transcription response missing text",
    );
    return { text, model };
  } finally {
    await release();
  }
}
