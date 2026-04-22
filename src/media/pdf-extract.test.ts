import { describe, expect, it } from "vitest";

import { extractPdfContent } from "./pdf-extract.ts";

// A 518-byte PDF that uses Helvetica (one of the 14 standard PDF fonts).
// This is the exact code path that previously emitted
// `UnknownErrorException: Ensure that the standardFontDataUrl API parameter
// is provided` and yielded empty text. Embedded inline so the test does not
// rely on a binary fixture file.
//
// Generated with a deterministic builder:
//   %PDF-1.4 catalog -> pages -> page (Helvetica F1) -> content stream
//   "BT /F1 24 Tf 100 700 Td (Hello PDF World) Tj ET"
const HELLO_PDF_BASE64 =
  "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA2MTIgNzkyXS9Db250ZW50cyA0IDAgUi9SZXNvdXJjZXM8PC9Gb250PDwvRjE8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+Pj4+Pj4+PgplbmRvYmoKNCAwIG9iago8PC9MZW5ndGggNDc+PnN0cmVhbQpCVCAvRjEgMjQgVGYgMTAwIDcwMCBUZCAoSGVsbG8gUERGIFdvcmxkKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA1CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDYwIDAwMDAwIG4gCjAwMDAwMDAxMTEgMDAwMDAgbiAKMDAwMDAwMDI2NCAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNS9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjM1OAolJUVPRgo=";

const helloPdfBuffer = Buffer.from(HELLO_PDF_BASE64, "base64");

describe("extractPdfContent", () => {
  it("extracts text from a PDF that uses a standard font (Helvetica)", async () => {
    // Capture warnings so we can assert pdf.js did not complain about
    // missing standardFontDataUrl. Before the fix, this PDF caused
    // `UnknownErrorException: Ensure that the standardFontDataUrl API
    // parameter is provided` and returned empty text.
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(" "));
    };

    try {
      const result = await extractPdfContent({
        buffer: helloPdfBuffer,
        maxPages: 1,
        maxPixels: 2_000_000,
        minTextChars: 5,
      });

      expect(result.text).toContain("Hello PDF World");
      expect(result.images).toHaveLength(0);

      const fontWarnings = warnings.filter((w) => w.includes("standardFontDataUrl"));
      expect(fontWarnings).toEqual([]);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("returns the extracted text even if the buffer is reused across calls", async () => {
    // Sanity check that the cached standard-font path is reusable across
    // multiple invocations and does not leak state between calls.
    const first = await extractPdfContent({
      buffer: helloPdfBuffer,
      maxPages: 1,
      maxPixels: 2_000_000,
      minTextChars: 5,
    });
    const second = await extractPdfContent({
      buffer: helloPdfBuffer,
      maxPages: 1,
      maxPixels: 2_000_000,
      minTextChars: 5,
    });

    expect(first.text).toBe(second.text);
    expect(first.text).toContain("Hello PDF World");
  });
});
