/**
 * Runtime boundary for lazy-loading media-understanding description functions.
 *
 * This file re-exports the two functions needed by
 * `describeOffloadedImagesForTextOnlyModel` so that the caller can
 * dynamically import this boundary instead of inlining direct
 * `await import("../media-understanding/…")` calls, which would
 * bypass the `*.runtime.ts` convention documented in CLAUDE.md.
 */
export { resolveAutoImageModel } from "../media-understanding/runner.js";
export { describeImageFileWithModel } from "../media-understanding/runtime.js";