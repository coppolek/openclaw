import { describe, expect, it } from "vitest";
import { parseGeminiAuth } from "./gemini-auth.js";

describe("parseGeminiAuth", () => {
  it("returns bearer auth for OAuth JSON tokens", () => {
    expect(parseGeminiAuth('{"token":"oauth-token","projectId":"demo"}')).toEqual({
      headers: {
        Authorization: "Bearer oauth-token",
        "Content-Type": "application/json",
      },
      projectId: "demo",
      location: undefined,
    });
  });

  it("returns location from OAuth JSON when present", () => {
    expect(parseGeminiAuth('{"token":"t","projectId":"p","location":"europe-west4"}')).toEqual({
      headers: {
        Authorization: "Bearer t",
        "Content-Type": "application/json",
      },
      projectId: "p",
      location: "europe-west4",
    });
  });

  it.each(['{"token":"","projectId":"demo"}', "{not-json}", ' {"token":"oauth-token"}'])(
    "falls back to API key auth for %j",
    (value) => {
      expect(parseGeminiAuth(value)).toEqual({
        headers: {
          "x-goog-api-key": value,
          "Content-Type": "application/json",
        },
      });
    },
  );
});
