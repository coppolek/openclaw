import { describe, expect, it } from "vitest";
import { validateCampfireSetupInput } from "./setup-validation.js";

describe("validateCampfireSetupInput", () => {
  it("rejects bare Basecamp hosts", () => {
    const error = validateCampfireSetupInput({
      httpUrl: "https://3.basecamp.com",
      botToken: "42-AbCdEf",
    });

    expect(error).toContain("workspace");
  });
});
