import { describe, expect, it } from "vitest";
import {
  detectOpenAICompletionsCompat,
  resolveOpenAICompletionsCompatDefaults,
} from "./openai-completions-compat.js";
// Request-time `compat.supportsUsageInStreaming` user overrides are handled in
// the transport via `getCompat()` in `openai-transport-stream.ts` and covered
// by the existing tests in `model-compat.test.ts`; this file tests only the
// auto-detected defaults resolver.

describe("resolveOpenAICompletionsCompatDefaults", () => {
  it("enables streaming usage for local ollama OpenAI-compat endpoints", () => {
    expect(
      resolveOpenAICompletionsCompatDefaults({
        provider: "ollama",
        endpointClass: "local",
        knownProviderFamily: "ollama",
      }).supportsUsageInStreaming,
    ).toBe(true);
  });

  it("keeps streaming usage enabled for custom ollama OpenAI-compat endpoints", () => {
    expect(
      resolveOpenAICompletionsCompatDefaults({
        provider: "ollama",
        endpointClass: "custom",
        knownProviderFamily: "ollama",
      }).supportsUsageInStreaming,
    ).toBe(true);
  });

  it("does not broaden streaming usage for generic custom providers", () => {
    expect(
      resolveOpenAICompletionsCompatDefaults({
        provider: "custom-cpa",
        endpointClass: "custom",
        knownProviderFamily: "custom-cpa",
      }).supportsUsageInStreaming,
    ).toBe(false);
  });

  // Regression: #47639 — vLLM on a local openai-completions endpoint needs
  // `stream_options.include_usage: true` to emit usage in stream chunks.
  // Without it, session totalTokens stays stale and `openclaw status` renders
  // `unknown/131k (?%)`.
  it("enables streaming usage for vLLM on a local endpoint", () => {
    expect(
      resolveOpenAICompletionsCompatDefaults({
        provider: "vllm",
        endpointClass: "local",
        knownProviderFamily: "vllm",
      }).supportsUsageInStreaming,
    ).toBe(true);
  });

  it.each([
    ["vllm"],
    ["localai"],
    ["sglang"],
    ["llama-cpp"],
    ["llama.cpp"],
    ["llamacpp"],
    ["jan"],
    ["lmstudio"],
    ["lm-studio"],
    ["text-generation-webui"],
    ["tabby"],
    ["tabbyapi"],
  ])("enables streaming usage for known local OpenAI-compat provider %s", (provider) => {
    expect(
      resolveOpenAICompletionsCompatDefaults({
        provider,
        endpointClass: "custom",
        knownProviderFamily: provider,
      }).supportsUsageInStreaming,
    ).toBe(true);
  });

  it("matches known-local providers case-insensitively", () => {
    expect(
      resolveOpenAICompletionsCompatDefaults({
        provider: "vLLM",
        endpointClass: "local",
        knownProviderFamily: "vllm",
      }).supportsUsageInStreaming,
    ).toBe(true);
  });
});

describe("detectOpenAICompletionsCompat", () => {
  it("enables streaming usage for a vLLM model at 127.0.0.1 (user's reported config)", () => {
    const detected = detectOpenAICompletionsCompat({
      provider: "vllm",
      baseUrl: "http://127.0.0.1:8000/v1",
      id: "Qwen/Qwen3-Coder-Next-FP8",
    });
    expect(detected.defaults.supportsUsageInStreaming).toBe(true);
  });
});
