// Public plugin-owned conversation binding helpers used by interactive
// approval flows. Keep this seam narrow so startup paths do not import the
// broader conversation-runtime barrel.

export {
  buildPluginBindingResolvedText,
  parsePluginBindingApprovalCustomId,
  resolvePluginConversationBindingApproval,
} from "../plugins/conversation-binding.js";
