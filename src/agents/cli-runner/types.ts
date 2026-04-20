import type { ImageContent } from "@mariozechner/pi-ai";
import type { ReplyOperation } from "../../auto-reply/reply/reply-run-registry.js";
import type { ThinkLevel } from "../../auto-reply/thinking.js";
import type { CliSessionBinding } from "../../config/sessions.js";
import type { SessionSystemPromptReport } from "../../config/sessions/types.js";
import type { CliBackendConfig } from "../../config/types.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { PromptImageOrderEntry } from "../../media/prompt-image-order.js";
import type { ResolvedCliBackend } from "../cli-backends.js";
import type { SkillSnapshot } from "../skills.js";

export type RunCliAgentParams = {
  sessionId: string;
  sessionKey?: string;
  agentId?: string;
  sessionFile: string;
  workspaceDir: string;
  config?: OpenClawConfig;
  prompt: string;
  provider: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  timeoutMs: number;
  runId: string;
  extraSystemPrompt?: string;
  // Stable subset of extraSystemPrompt used for CLI session-reuse hashing. Callers
  // that split volatile per-trigger metadata (e.g. inbound channel envelope) from
  // structural parts (group config, exec elevation) can pass the stable portion
  // here so a user-message → heartbeat transition does not invalidate the bound
  // CLI session just because the inbound envelope flipped. Falls back to
  // extraSystemPrompt when omitted.
  extraSystemPromptHashInput?: string;
  streamParams?: import("../command/types.js").AgentStreamParams;
  ownerNumbers?: string[];
  cliSessionId?: string;
  cliSessionBinding?: CliSessionBinding;
  authProfileId?: string;
  bootstrapPromptWarningSignaturesSeen?: string[];
  bootstrapPromptWarningSignature?: string;
  images?: ImageContent[];
  imageOrder?: PromptImageOrderEntry[];
  skillsSnapshot?: SkillSnapshot;
  messageProvider?: string;
  agentAccountId?: string;
  senderIsOwner?: boolean;
  abortSignal?: AbortSignal;
  replyOperation?: ReplyOperation;
};

export type CliPreparedBackend = {
  backend: CliBackendConfig;
  cleanup?: () => Promise<void>;
  mcpConfigHash?: string;
  env?: Record<string, string>;
};

export type CliReusableSession = {
  sessionId?: string;
  invalidatedReason?: "auth-profile" | "auth-epoch" | "system-prompt" | "mcp";
};

export type PreparedCliRunContext = {
  params: RunCliAgentParams;
  started: number;
  workspaceDir: string;
  backendResolved: ResolvedCliBackend;
  preparedBackend: CliPreparedBackend;
  reusableCliSession: CliReusableSession;
  modelId: string;
  normalizedModel: string;
  systemPrompt: string;
  systemPromptReport: SessionSystemPromptReport;
  bootstrapPromptWarningLines: string[];
  heartbeatPrompt?: string;
  authEpoch?: string;
  extraSystemPromptHash?: string;
};
