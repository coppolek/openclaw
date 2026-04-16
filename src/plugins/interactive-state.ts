import { createDedupeCache, resolveGlobalDedupeCache } from "../infra/dedupe.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type { PluginInteractiveHandlerRegistration } from "./types.js";

export type RegisteredInteractiveHandler = PluginInteractiveHandlerRegistration & {
  pluginId: string;
  pluginName?: string;
  pluginRoot?: string;
};

type InteractiveState = {
  interactiveHandlers: Map<string, RegisteredInteractiveHandler>;
  callbackDedupe: ReturnType<typeof createDedupeCache>;
  inflightCallbackDedupe: Set<string>;
};

const PLUGIN_INTERACTIVE_STATE_KEY = Symbol.for("openclaw.pluginInteractiveState");

function createFreshInteractiveState(): InteractiveState {
  return {
    interactiveHandlers: new Map<string, RegisteredInteractiveHandler>(),
    callbackDedupe: resolveGlobalDedupeCache(
      Symbol.for("openclaw.pluginInteractiveCallbackDedupe"),
      {
        ttlMs: 5 * 60_000,
        maxSize: 4096,
      },
    ),
    inflightCallbackDedupe: new Set<string>(),
  };
}

function getState(): InteractiveState {
  const state = resolveGlobalSingleton<InteractiveState>(
    PLUGIN_INTERACTIVE_STATE_KEY,
    createFreshInteractiveState,
  );
  // Older processes (or partial init) may have left a shape without dedupe fields; repair
  // before touching .clear() to avoid doctor / plugin reload crashes (#67525).
  if (!state.callbackDedupe) {
    state.callbackDedupe = resolveGlobalDedupeCache(
      Symbol.for("openclaw.pluginInteractiveCallbackDedupe"),
      {
        ttlMs: 5 * 60_000,
        maxSize: 4096,
      },
    );
  }
  if (!state.inflightCallbackDedupe) {
    state.inflightCallbackDedupe = new Set<string>();
  }
  return state;
}

export function getPluginInteractiveHandlersState() {
  return getState().interactiveHandlers;
}

export function getPluginInteractiveCallbackDedupeState() {
  return getState().callbackDedupe;
}

export function claimPluginInteractiveCallbackDedupe(
  dedupeKey: string | undefined,
  now = Date.now(),
): boolean {
  if (!dedupeKey) {
    return true;
  }
  const state = getState();
  if (state.inflightCallbackDedupe.has(dedupeKey) || state.callbackDedupe.peek(dedupeKey, now)) {
    return false;
  }
  state.inflightCallbackDedupe.add(dedupeKey);
  return true;
}

export function commitPluginInteractiveCallbackDedupe(
  dedupeKey: string | undefined,
  now = Date.now(),
): void {
  if (!dedupeKey) {
    return;
  }
  const state = getState();
  state.inflightCallbackDedupe.delete(dedupeKey);
  state.callbackDedupe.check(dedupeKey, now);
}

export function releasePluginInteractiveCallbackDedupe(dedupeKey: string | undefined): void {
  if (!dedupeKey) {
    return;
  }
  getState().inflightCallbackDedupe.delete(dedupeKey);
}

export function clearPluginInteractiveHandlersState(): void {
  getPluginInteractiveHandlersState().clear();
  getPluginInteractiveCallbackDedupeState().clear();
  getState().inflightCallbackDedupe.clear();
}
