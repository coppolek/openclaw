import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("openai plugin manifest", () => {
  it("labels providerAuthChoices for API key vs Codex OAuth", () => {
    const manifestPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "openclaw.plugin.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      providerAuthChoices: Array<{
        provider: string;
        method: string;
        choiceLabel?: string;
        groupHint?: string;
      }>;
    };
    const codex = manifest.providerAuthChoices.find((row) => row.provider === "openai-codex");
    const apiKey = manifest.providerAuthChoices.find(
      (row) => row.provider === "openai" && row.method === "api-key",
    );
    expect(codex?.choiceLabel).toBe("OpenAI Codex (Codex OAuth)");
    expect(codex?.groupHint).toBe("Codex OAuth");
    expect(apiKey?.groupHint).toBe("API key");
  });
});
