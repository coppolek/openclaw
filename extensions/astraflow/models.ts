import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";

export const ASTRAFLOW_BASE_URL = "https://api-us-ca.umodelverse.ai/v1";
export const ASTRAFLOW_CN_BASE_URL = "https://api.modelverse.cn/v1";

// Anthropic pricing (per 1M tokens)
const CLAUDE_OPUS_46_COST = { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } as const;
const CLAUDE_SONNET_46_COST = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } as const;
const CLAUDE_HAIKU_45_COST = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 } as const;

// OpenAI pricing (per 1M tokens)
const GPT_54_COST = { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 } as const;
const GPT_54_MINI_COST = { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 } as const;
const GPT_54_NANO_COST = { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 } as const;
const GPT_53_COST = { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 } as const;
const GPT_52_COST = { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 } as const;

// DeepSeek pricing (per 1M tokens)
const DEEPSEEK_V32_COST = { input: 0.28, output: 0.42, cacheRead: 0.028, cacheWrite: 0 } as const;

// GLM pricing (per 1M tokens)
const GLM_51_COST = { input: 1.2, output: 4, cacheRead: 0.24, cacheWrite: 0 } as const;
const GLM_5_COST = { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 } as const;
const GLM_5_TURBO_COST = { input: 1.2, output: 4, cacheRead: 0.24, cacheWrite: 0 } as const;

// MiniMax pricing (per 1M tokens)
const MINIMAX_M27_COST = { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 } as const;
const MINIMAX_M27_HS_COST = {
  input: 0.6,
  output: 2.4,
  cacheRead: 0.06,
  cacheWrite: 0.375,
} as const;
const MINIMAX_M25_COST = { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.375 } as const;
const MINIMAX_M25_LN_COST = {
  input: 0.6,
  output: 2.4,
  cacheRead: 0.03,
  cacheWrite: 0.375,
} as const;

// Gemini pricing (per 1M tokens, converted from CNY at ~7.2 CNY/USD)
const GEMINI_31_PRO_COST = { input: 1.98, output: 11.87, cacheRead: 0.2, cacheWrite: 0 } as const;
const GEMINI_31_FLASH_LITE_COST = {
  input: 0.25,
  output: 1.48,
  cacheRead: 0.024,
  cacheWrite: 0.49,
} as const;

// Zero cost for models without public pricing
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export const ASTRAFLOW_MODEL_CATALOG: ModelDefinitionConfig[] = [
  // Claude 4.6
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1000000,
    maxTokens: 128000,
    cost: CLAUDE_OPUS_46_COST,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1000000,
    maxTokens: 64000,
    cost: CLAUDE_SONNET_46_COST,
  },
  // Claude Haiku 4.5
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 200000,
    maxTokens: 64000,
    cost: CLAUDE_HAIKU_45_COST,
  },
  // GPT 5.2+
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1050000,
    maxTokens: 128000,
    cost: GPT_54_COST,
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 400000,
    maxTokens: 128000,
    cost: GPT_54_MINI_COST,
  },
  {
    id: "gpt-5.4-nano",
    name: "GPT-5.4 Nano",
    reasoning: false,
    input: ["text"],
    contextWindow: 400000,
    maxTokens: 128000,
    cost: GPT_54_NANO_COST,
  },
  {
    id: "gpt-5.3-chat-latest",
    name: "GPT-5.3 Chat",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 16384,
    cost: GPT_53_COST,
  },
  {
    id: "gpt-5.2",
    name: "GPT-5.2",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 128000,
    maxTokens: 16384,
    cost: GPT_52_COST,
  },
  // DeepSeek V3.2
  {
    id: "deepseek-ai/DeepSeek-V3.2",
    name: "DeepSeek V3.2",
    reasoning: false,
    input: ["text"],
    contextWindow: 131072,
    maxTokens: 8192,
    cost: DEEPSEEK_V32_COST,
  },
  // GLM-5+
  {
    id: "glm-5.1",
    name: "GLM 5.1",
    reasoning: true,
    input: ["text"],
    contextWindow: 202800,
    maxTokens: 131100,
    cost: GLM_51_COST,
  },
  {
    id: "glm-5-turbo",
    name: "GLM 5 Turbo",
    reasoning: true,
    input: ["text"],
    contextWindow: 202800,
    maxTokens: 131100,
    cost: GLM_5_TURBO_COST,
  },
  {
    id: "glm-5v-turbo",
    name: "GLM 5V Turbo",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 202800,
    maxTokens: 131100,
    cost: GLM_5_TURBO_COST,
  },
  {
    id: "zai-org/glm-5",
    name: "GLM 5",
    reasoning: true,
    input: ["text"],
    contextWindow: 202800,
    maxTokens: 131100,
    cost: GLM_5_COST,
  },
  // Kimi K2.5+
  {
    id: "moonshot/kimi-k2.5",
    name: "Kimi K2.5",
    reasoning: false,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 32768,
    cost: ZERO_COST,
  },
  {
    id: "moonshotai/kimi-k2.5",
    name: "Kimi K2.5 (MoonshotAI)",
    reasoning: false,
    input: ["text"],
    contextWindow: 262144,
    maxTokens: 32768,
    cost: ZERO_COST,
  },
  // Qwen 3.5+
  {
    id: "qwen3.6-plus",
    name: "Qwen 3.6 Plus",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1000000,
    maxTokens: 65536,
    cost: ZERO_COST,
  },
  {
    id: "qwen3.5-plus",
    name: "Qwen 3.5 Plus",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1000000,
    maxTokens: 65536,
    cost: ZERO_COST,
  },
  // MiniMax M2.5+
  {
    id: "MiniMax-M2.7",
    name: "MiniMax M2.7",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 204800,
    maxTokens: 131072,
    cost: MINIMAX_M27_COST,
  },
  {
    id: "MiniMax-M2.7-highspeed",
    name: "MiniMax M2.7 Highspeed",
    reasoning: true,
    input: ["text"],
    contextWindow: 204800,
    maxTokens: 131072,
    cost: MINIMAX_M27_HS_COST,
  },
  {
    id: "MiniMax-M2.5",
    name: "MiniMax M2.5",
    reasoning: true,
    input: ["text"],
    contextWindow: 204800,
    maxTokens: 131072,
    cost: MINIMAX_M25_COST,
  },
  {
    id: "MiniMax-M2.5-lightning",
    name: "MiniMax M2.5 HighSpeed",
    reasoning: true,
    input: ["text"],
    contextWindow: 204800,
    maxTokens: 131072,
    cost: MINIMAX_M25_LN_COST,
  },
  // Gemini 3.1+
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    cost: GEMINI_31_PRO_COST,
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    name: "Gemini 3.1 Flash Lite",
    reasoning: false,
    input: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 65536,
    cost: GEMINI_31_FLASH_LITE_COST,
  },
];

// CN catalog: domestic models only (no GPT/Claude/Gemini)
export const ASTRAFLOW_CN_MODEL_CATALOG: ModelDefinitionConfig[] = ASTRAFLOW_MODEL_CATALOG.filter(
  (m) => !m.id.startsWith("claude-") && !m.id.startsWith("gpt-") && !m.id.startsWith("gemini-"),
);

export function buildAstraflowModelDefinition(model: ModelDefinitionConfig): ModelDefinitionConfig {
  return {
    ...model,
    api: "openai-completions",
  };
}
