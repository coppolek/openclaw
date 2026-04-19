import { normalizeOptionalLowercaseString } from "./shared/string-coerce.js";

export type EmotionMode = "off" | "on" | "full";

export function normalizeEmotionMode(value: unknown): EmotionMode | undefined {
  const normalized =
    typeof value === "string" ? normalizeOptionalLowercaseString(value) : undefined;
  if (normalized === "off" || normalized === "on" || normalized === "full") {
    return normalized;
  }
  return undefined;
}

export function isEmotionModeEnabled(mode: EmotionMode | undefined): boolean {
  return mode === "on" || mode === "full";
}
