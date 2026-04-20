import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
import {
  asFiniteNumber,
  normalizeLanguageCode,
  trimToUndefined,
  type SpeechDirectiveTokenParseContext,
  type SpeechProviderConfig,
  type SpeechProviderOverrides,
  type SpeechProviderPlugin,
} from "openclaw/plugin-sdk/speech";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/text-runtime";
import {
  isValidXaiTtsVoice,
  normalizeXaiTtsBaseUrl,
  XAI_BASE_URL,
  XAI_TTS_VOICES,
  xaiTTS,
} from "./tts.js";

const XAI_SPEECH_RESPONSE_FORMATS = ["mp3", "opus", "wav", "pcm"] as const;

type XaiSpeechResponseFormat = (typeof XAI_SPEECH_RESPONSE_FORMATS)[number];

type XaiTtsProviderConfig = {
  apiKey?: string;
  baseUrl: string;
  voiceId: string;
  language?: string;
  speed?: number;
  responseFormat?: XaiSpeechResponseFormat;
};

type XaiTtsProviderOverrides = {
  voiceId?: string;
  language?: string;
  speed?: number;
};

function normalizeXaiSpeechResponseFormat(value: unknown): XaiSpeechResponseFormat | undefined {
  const next = normalizeLowercaseStringOrEmpty(value);
  if (!next) {
    return undefined;
  }
  if (XAI_SPEECH_RESPONSE_FORMATS.some((format) => format === next)) {
    return next as XaiSpeechResponseFormat;
  }
  throw new Error(`Invalid xAI speech responseFormat: ${next}`);
}

function resolveSpeechResponseFormat(
  target: "audio-file" | "voice-note",
  configuredFormat?: XaiSpeechResponseFormat,
): XaiSpeechResponseFormat {
  if (configuredFormat) {
    return configuredFormat;
  }
  return target === "voice-note" ? "opus" : "mp3";
}

function responseFormatToFileExtension(
  format: XaiSpeechResponseFormat,
): ".mp3" | ".pcm" | ".opus" | ".wav" {
  switch (format) {
    case "opus":
      return ".opus";
    case "wav":
      return ".wav";
    case "pcm":
      return ".pcm";
    default:
      return ".mp3";
  }
}

function normalizeXaiProviderConfig(rawConfig: Record<string, unknown>): XaiTtsProviderConfig {
  return {
    apiKey: normalizeResolvedSecretInputString({
      value: rawConfig?.apiKey,
      path: "messages.tts.providers.xai.apiKey",
    }),
    baseUrl: normalizeXaiTtsBaseUrl(
      trimToUndefined(rawConfig?.baseUrl) ??
        trimToUndefined(process.env.XAI_BASE_URL) ??
        XAI_BASE_URL,
    ),
    voiceId: trimToUndefined(rawConfig?.voiceId ?? rawConfig?.voice) ?? "eve",
    language: normalizeLanguageCode(
      trimToUndefined(rawConfig?.language ?? rawConfig?.languageCode),
    ),
    speed: asFiniteNumber(rawConfig?.speed),
    responseFormat: normalizeXaiSpeechResponseFormat(rawConfig?.responseFormat),
  };
}

function readXaiProviderConfig(config: SpeechProviderConfig): XaiTtsProviderConfig {
  const normalized = normalizeXaiProviderConfig({});
  return {
    apiKey: trimToUndefined(config.apiKey) ?? normalized.apiKey,
    baseUrl: trimToUndefined(config.baseUrl) ?? normalized.baseUrl,
    voiceId: trimToUndefined(config.voiceId ?? config.voice) ?? normalized.voiceId,
    language:
      normalizeLanguageCode(trimToUndefined(config.language ?? config.languageCode)) ??
      normalized.language,
    speed: asFiniteNumber(config.speed) ?? normalized.speed,
    responseFormat:
      normalizeXaiSpeechResponseFormat(config.responseFormat) ?? normalized.responseFormat,
  };
}

function readXaiOverrides(overrides: SpeechProviderOverrides | undefined): XaiTtsProviderOverrides {
  if (!overrides) {
    return {};
  }
  return {
    voiceId: trimToUndefined(overrides.voiceId ?? overrides.voice),
    language: normalizeLanguageCode(trimToUndefined(overrides.language)),
    speed: asFiniteNumber(overrides.speed),
  };
}

function parseDirectiveToken(ctx: SpeechDirectiveTokenParseContext): {
  handled: boolean;
  overrides?: SpeechProviderOverrides;
  warnings?: string[];
} {
  const providerConfig = ctx.providerConfig as Record<string, unknown> | undefined;
  const baseUrl = trimToUndefined(providerConfig?.baseUrl);
  switch (ctx.key) {
    case "voice":
    case "voice_id":
    case "voiceid":
    case "xai_voice":
    case "xaivoice":
      if (!ctx.policy.allowVoice) {
        return { handled: true };
      }
      if (!isValidXaiTtsVoice(ctx.value, baseUrl)) {
        return { handled: true, warnings: [`invalid xAI voice "${ctx.value}"`] };
      }
      return { handled: true, overrides: { voiceId: ctx.value } };
    default:
      return { handled: false };
  }
}

export function buildXaiSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "xai",
    label: "xAI",
    autoSelectOrder: 25,
    models: [],
    voices: XAI_TTS_VOICES,
    resolveConfig: ({ rawConfig }) => normalizeXaiProviderConfig(rawConfig),
    parseDirectiveToken,
    resolveTalkConfig: ({ baseTtsConfig, talkProviderConfig }) => {
      const base = normalizeXaiProviderConfig(baseTtsConfig);
      const responseFormat = normalizeXaiSpeechResponseFormat(talkProviderConfig.responseFormat);
      return {
        ...base,
        ...(talkProviderConfig.apiKey === undefined
          ? {}
          : {
              apiKey: normalizeResolvedSecretInputString({
                value: talkProviderConfig.apiKey,
                path: "talk.providers.xai.apiKey",
              }),
            }),
        ...(trimToUndefined(talkProviderConfig.baseUrl) == null
          ? {}
          : { baseUrl: normalizeXaiTtsBaseUrl(trimToUndefined(talkProviderConfig.baseUrl)) }),
        ...(trimToUndefined(talkProviderConfig.voiceId) == null
          ? {}
          : { voiceId: trimToUndefined(talkProviderConfig.voiceId) }),
        ...(normalizeLanguageCode(
          trimToUndefined(talkProviderConfig.language ?? talkProviderConfig.languageCode),
        ) == null
          ? {}
          : {
              language: normalizeLanguageCode(
                trimToUndefined(talkProviderConfig.language ?? talkProviderConfig.languageCode),
              ),
            }),
        ...(asFiniteNumber(talkProviderConfig.speed) == null
          ? {}
          : { speed: asFiniteNumber(talkProviderConfig.speed) }),
        ...(responseFormat == null ? {} : { responseFormat }),
      };
    },
    resolveTalkOverrides: ({ params }) => ({
      ...(trimToUndefined(params.voiceId ?? params.voice) == null
        ? {}
        : { voiceId: trimToUndefined(params.voiceId ?? params.voice) }),
      ...(normalizeLanguageCode(trimToUndefined(params.language ?? params.languageCode)) == null
        ? {}
        : {
            language: normalizeLanguageCode(
              trimToUndefined(params.language ?? params.languageCode),
            ),
          }),
      ...(asFiniteNumber(params.speed) == null ? {} : { speed: asFiniteNumber(params.speed) }),
    }),
    listVoices: async () => XAI_TTS_VOICES.map((voice) => ({ id: voice, name: voice })),
    isConfigured: ({ providerConfig }) =>
      Boolean(readXaiProviderConfig(providerConfig).apiKey || process.env.XAI_API_KEY),
    synthesize: async (req) => {
      const config = readXaiProviderConfig(req.providerConfig);
      const overrides = readXaiOverrides(req.providerOverrides);
      const apiKey = config.apiKey || process.env.XAI_API_KEY;
      if (!apiKey) {
        throw new Error("xAI API key missing");
      }
      const responseFormat = resolveSpeechResponseFormat(
        req.target,
        config.responseFormat,
      );
      const audioBuffer = await xaiTTS({
        text: req.text,
        apiKey,
        baseUrl: config.baseUrl,
        voiceId: overrides.voiceId ?? config.voiceId,
        language: overrides.language ?? config.language,
        speed: overrides.speed ?? config.speed,
        responseFormat,
        timeoutMs: req.timeoutMs,
      });
      return {
        audioBuffer,
        outputFormat: responseFormat,
        fileExtension: responseFormatToFileExtension(responseFormat),
        voiceCompatible: req.target === "voice-note" && responseFormat === "opus",
      };
    },
    synthesizeTelephony: async (req) => {
      const config = readXaiProviderConfig(req.providerConfig);
      const apiKey = config.apiKey || process.env.XAI_API_KEY;
      if (!apiKey) {
        throw new Error("xAI API key missing");
      }
      const outputFormat = "pcm" as const;
      const sampleRate = 24000;
      const audioBuffer = await xaiTTS({
        text: req.text,
        apiKey,
        baseUrl: config.baseUrl,
        voiceId: config.voiceId,
        language: config.language,
        speed: config.speed,
        responseFormat: outputFormat,
        timeoutMs: req.timeoutMs,
      });
      return { audioBuffer, outputFormat, sampleRate };
    },
  };
}
