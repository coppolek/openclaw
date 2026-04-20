import type { EmotionMode } from "../../emotion-mode.js";
import type { ElevatedLevel, ReasoningLevel, ThinkLevel, VerboseLevel } from "../thinking.js";

export async function resolveCurrentDirectiveLevels(params: {
  sessionEntry?: {
    thinkingLevel?: unknown;
    fastMode?: unknown;
    verboseLevel?: unknown;
    emotionMode?: unknown;
    reasoningLevel?: unknown;
    elevatedLevel?: unknown;
  };
  agentEntry?: {
    emotionDefault?: unknown;
    fastModeDefault?: unknown;
    reasoningDefault?: unknown;
  };
  globalAgentDefaults?: {
    emotionDefault?: unknown;
  };
  agentCfg?: {
    thinkingDefault?: unknown;
    emotionDefault?: unknown;
    verboseDefault?: unknown;
    elevatedDefault?: unknown;
  };
  resolveDefaultThinkingLevel: () => Promise<ThinkLevel | undefined>;
}): Promise<{
  currentThinkLevel: ThinkLevel | undefined;
  currentFastMode: boolean | undefined;
  currentVerboseLevel: VerboseLevel | undefined;
  currentEmotionMode: EmotionMode;
  currentReasoningLevel: ReasoningLevel;
  currentElevatedLevel: ElevatedLevel | undefined;
}> {
  const resolvedDefaultThinkLevel =
    (params.sessionEntry?.thinkingLevel as ThinkLevel | undefined) ??
    (await params.resolveDefaultThinkingLevel()) ??
    (params.agentCfg?.thinkingDefault as ThinkLevel | undefined);
  const currentThinkLevel = resolvedDefaultThinkLevel;
  const currentFastMode =
    typeof params.sessionEntry?.fastMode === "boolean"
      ? params.sessionEntry.fastMode
      : typeof params.agentEntry?.fastModeDefault === "boolean"
        ? params.agentEntry.fastModeDefault
        : undefined;
  const currentVerboseLevel =
    (params.sessionEntry?.verboseLevel as VerboseLevel | undefined) ??
    (params.agentCfg?.verboseDefault as VerboseLevel | undefined);
  const currentEmotionMode =
    (params.sessionEntry?.emotionMode as EmotionMode | undefined) ??
    (params.agentEntry?.emotionDefault as EmotionMode | undefined) ??
    (params.agentCfg?.emotionDefault as EmotionMode | undefined) ??
    (params.globalAgentDefaults?.emotionDefault as EmotionMode | undefined) ??
    "off";
  const currentReasoningLevel =
    (params.sessionEntry?.reasoningLevel as ReasoningLevel | undefined) ??
    (params.agentEntry?.reasoningDefault as ReasoningLevel | undefined) ??
    "off";
  const currentElevatedLevel =
    (params.sessionEntry?.elevatedLevel as ElevatedLevel | undefined) ??
    (params.agentCfg?.elevatedDefault as ElevatedLevel | undefined);
  return {
    currentThinkLevel,
    currentFastMode,
    currentVerboseLevel,
    currentEmotionMode,
    currentReasoningLevel,
    currentElevatedLevel,
  };
}
