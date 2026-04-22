import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth-api-key";
import { readConfiguredProviderCatalogEntries } from "openclaw/plugin-sdk/provider-catalog-shared";
import {
  applyAstraflowCnConfig,
  applyAstraflowConfig,
  ASTRAFLOW_CN_DEFAULT_MODEL_REF,
  ASTRAFLOW_DEFAULT_MODEL_REF,
} from "./onboard.js";
import { buildAstraflowCnProvider, buildAstraflowProvider } from "./provider-catalog.js";

const GLOBAL_PROVIDER_ID = "astraflow";
const CN_PROVIDER_ID = "astraflow-cn";

export default definePluginEntry({
  id: "astraflow",
  name: "UCloud AstraFlow",
  description: "Bundled UCloud AstraFlow provider plugin (Global + China)",
  register(api) {
    api.registerProvider({
      id: GLOBAL_PROVIDER_ID,
      label: "UCloud AstraFlow",
      docsPath: "/providers/astraflow",
      envVars: ["ASTRAFLOW_API_KEY"],
      auth: [
        createProviderApiKeyAuthMethod({
          providerId: GLOBAL_PROVIDER_ID,
          methodId: "api-key",
          label: "UCloud AstraFlow API key (Global)",
          hint: "Global endpoint - api-us-ca.umodelverse.ai",
          optionKey: "astraflowApiKey",
          flagName: "--astraflow-api-key",
          envVar: "ASTRAFLOW_API_KEY",
          promptMessage:
            "Enter UCloud AstraFlow API key\nhttps://astraflow.ucloud-global.com/en-us/modelverse/api-keys",
          defaultModel: ASTRAFLOW_DEFAULT_MODEL_REF,
          expectedProviders: [GLOBAL_PROVIDER_ID],
          applyConfig: (cfg) => applyAstraflowConfig(cfg),
          wizard: {
            choiceId: "astraflow-api-key",
            choiceLabel: "UCloud AstraFlow API key (Global)",
            choiceHint: "Global endpoint - api-us-ca.umodelverse.ai",
            groupId: "astraflow",
            groupLabel: "UCloud AstraFlow",
            groupHint: "200+ curated models, pay-as-you-go",
          },
        }),
      ],
      catalog: {
        order: "simple",
        run: async (ctx) => {
          const apiKey = ctx.resolveProviderApiKey(GLOBAL_PROVIDER_ID).apiKey;
          if (!apiKey) {
            return null;
          }
          return {
            provider: {
              ...buildAstraflowProvider(),
              apiKey,
            },
          };
        },
      },
      augmentModelCatalog: ({ config }) =>
        readConfiguredProviderCatalogEntries({
          config,
          providerId: GLOBAL_PROVIDER_ID,
        }),
    });

    api.registerProvider({
      id: CN_PROVIDER_ID,
      label: "UCloud AstraFlow (China)",
      docsPath: "/providers/astraflow",
      envVars: ["ASTRAFLOW_CN_API_KEY"],
      auth: [
        createProviderApiKeyAuthMethod({
          providerId: CN_PROVIDER_ID,
          methodId: "api-key",
          label: "UCloud AstraFlow API key (China)",
          hint: "China endpoint - api.modelverse.cn",
          optionKey: "astraflowCnApiKey",
          flagName: "--astraflow-cn-api-key",
          envVar: "ASTRAFLOW_CN_API_KEY",
          promptMessage:
            "Enter UCloud AstraFlow China API key\nhttps://astraflow.ucloud.cn/modelverse/api-keys",
          defaultModel: ASTRAFLOW_CN_DEFAULT_MODEL_REF,
          expectedProviders: [CN_PROVIDER_ID],
          applyConfig: (cfg) => applyAstraflowCnConfig(cfg),
          wizard: {
            choiceId: "astraflow-cn-api-key",
            choiceLabel: "UCloud AstraFlow API key (China)",
            choiceHint: "China endpoint - api.modelverse.cn",
            groupId: "astraflow",
            groupLabel: "UCloud AstraFlow",
            groupHint: "200+ curated models, pay-as-you-go",
          },
        }),
      ],
      catalog: {
        order: "simple",
        run: async (ctx) => {
          const apiKey = ctx.resolveProviderApiKey(CN_PROVIDER_ID).apiKey;
          if (!apiKey) {
            return null;
          }
          return {
            provider: {
              ...buildAstraflowCnProvider(),
              apiKey,
            },
          };
        },
      },
      augmentModelCatalog: ({ config }) =>
        readConfiguredProviderCatalogEntries({
          config,
          providerId: CN_PROVIDER_ID,
        }),
    });
  },
});
