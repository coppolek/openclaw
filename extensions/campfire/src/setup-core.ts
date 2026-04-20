import { createPatchedAccountSetupAdapter } from "openclaw/plugin-sdk/setup";
import {
  resolveCampfireBaseUrl,
  resolveCampfireBotKey,
  resolveOptionalCampfireSetupString,
  validateCampfireSetupInput,
} from "./setup-validation.js";

const channel = "campfire" as const;

export const campfireSetupAdapter = createPatchedAccountSetupAdapter({
  channelKey: channel,
  validateInput: ({ input }) => validateCampfireSetupInput(input),
  buildPatch: (input) => {
    const baseUrl = resolveCampfireBaseUrl(input);
    const botKey = resolveCampfireBotKey(input);
    const webhookPath = resolveOptionalCampfireSetupString(input.webhookPath);
    const webhookSecret = resolveOptionalCampfireSetupString(input.webhookSecret);
    return {
      ...(baseUrl ? { baseUrl } : {}),
      ...(botKey ? { botKey } : {}),
      ...(webhookPath ? { webhookPath } : {}),
      ...(webhookSecret ? { webhookSecret } : {}),
    };
  },
});
