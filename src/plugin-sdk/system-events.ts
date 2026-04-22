// Public in-memory system-event helpers for channel runtimes. Keep this seam
// narrow so hot monitor paths do not pull in the broader infra-runtime barrel.

export { enqueueSystemEvent, resetSystemEventsForTest } from "../infra/system-events.js";
