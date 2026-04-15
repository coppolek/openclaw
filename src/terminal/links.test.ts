import { describe, expect, it } from "vitest";
import { formatDocsLink } from "./links.js";

describe("formatDocsLink", () => {
  it("does not throw when path is missing", () => {
    expect(() => formatDocsLink(undefined)).not.toThrow();
    expect(() => formatDocsLink(null)).not.toThrow();
  });

  it("resolves missing path to the docs root", () => {
    expect(formatDocsLink(undefined)).toContain("https://docs.openclaw.ai/");
    expect(formatDocsLink(null)).toContain("https://docs.openclaw.ai/");
  });

  it("still resolves normal doc paths", () => {
    const out = formatDocsLink("/channels/pairing", "pairing");
    expect(out).toContain("https://docs.openclaw.ai/channels/pairing");
  });
});
