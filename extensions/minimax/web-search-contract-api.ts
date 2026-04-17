import {
  createWebSearchProviderContractFields,
  type WebSearchProviderPlugin,
} from "openclaw/plugin-sdk/provider-web-search-config-contract";

const MINIMAX_CODING_PLAN_ENV_VARS = ["MINIMAX_CODE_PLAN_KEY", "MINIMAX_CODING_API_KEY"] as const;

export function createMiniMaxWebSearchProvider(): WebSearchProviderPlugin {
  const credentialPath = "plugins.entries.minimax.config.webSearch.apiKey";

  return {
    id: "minimax",
    label: "MiniMax Search",
    hint: "Native MiniMax web search · requires Token Plan",
    onboardingScopes: ["text-inference"],
    credentialLabel: "MiniMax API key",
    envVars: [...MINIMAX_CODING_PLAN_ENV_VARS, "MINIMAX_API_KEY"],
    placeholder: "sk-...",
    signupUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
    docsUrl: "https://docs.openclaw.ai/tools/minimax-search",
    autoDetectOrder: 15,
    credentialPath,
    ...createWebSearchProviderContractFields({
      credentialPath,
      searchCredential: { type: "top-level" },
      configuredCredential: { pluginId: "minimax" },
    }),
    createTool: () => null,
  };
}
