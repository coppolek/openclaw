import {
  DEFAULT_ACCOUNT_ID,
  mergeAccountConfig,
  resolveAccountEntry,
  resolveMergedAccountConfig,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/account-core";
import {
  resolveChannelStreamingBlockEnabled,
  resolveChannelStreamingChunkMode,
} from "openclaw/plugin-sdk/channel-streaming";
import type { WhatsAppAccountConfig } from "./account-types.js";

function resolveWhatsAppDefaultAccountSharedConfig(
  cfg: OpenClawConfig,
): Partial<WhatsAppAccountConfig> | undefined {
  const defaultAccount = resolveAccountEntry(cfg.channels?.whatsapp?.accounts, DEFAULT_ACCOUNT_ID);
  if (!defaultAccount) {
    return undefined;
  }
  const {
    enabled: _ignoredEnabled,
    name: _ignoredName,
    authDir: _ignoredAuthDir,
    selfChatMode: _ignoredSelfChatMode,
    ...sharedDefaults
  } = defaultAccount;
  return sharedDefaults;
}

function _resolveWhatsAppAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): WhatsAppAccountConfig | undefined {
  return resolveAccountEntry(cfg.channels?.whatsapp?.accounts, accountId);
}

function resolveMergedNamedWhatsAppAccountConfig(params: {
  cfg: OpenClawConfig;
  accountId: string;
  omitKeys: string[];
}): WhatsAppAccountConfig {
  const rootCfg = params.cfg.channels?.whatsapp;
  const accountConfig = _resolveWhatsAppAccountConfig(params.cfg, params.accountId);
  return {
    ...mergeAccountConfig<WhatsAppAccountConfig>({
      channelConfig: rootCfg as WhatsAppAccountConfig | undefined,
      accountConfig: undefined,
      omitKeys: params.omitKeys,
    }),
    ...resolveWhatsAppDefaultAccountSharedConfig(params.cfg),
    ...accountConfig,
  };
}

export function resolveMergedWhatsAppAccountConfig(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): WhatsAppAccountConfig & { accountId: string } {
  const rootCfg = params.cfg.channels?.whatsapp;
  const accountId = params.accountId?.trim() || rootCfg?.defaultAccount || DEFAULT_ACCOUNT_ID;
  // Multi-account bots must not inherit channel-level `groups` unless explicitly set,
  // so root `channels.whatsapp.groups` does not fan out across accounts. Mirrors the
  // Telegram guard in extensions/telegram/src/account-config.ts:mergeTelegramAccountConfig.
  // Shared defaults under `channels.whatsapp.accounts.default.groups` still flow to named
  // accounts because that is an explicit opt-in, not implicit root inheritance.
  const configuredAccountIds = Object.keys(rootCfg?.accounts ?? {});
  const isMultiAccount = configuredAccountIds.length > 1;
  const omitKeys = isMultiAccount ? ["defaultAccount", "groups"] : ["defaultAccount"];
  const base = resolveMergedAccountConfig<WhatsAppAccountConfig>({
    channelConfig: rootCfg as WhatsAppAccountConfig | undefined,
    accounts: rootCfg?.accounts as Record<string, Partial<WhatsAppAccountConfig>> | undefined,
    accountId,
    omitKeys,
  });
  const merged =
    accountId === DEFAULT_ACCOUNT_ID
      ? base
      : resolveMergedNamedWhatsAppAccountConfig({ cfg: params.cfg, accountId, omitKeys });
  return {
    accountId,
    ...merged,
    chunkMode: resolveChannelStreamingChunkMode(merged) ?? merged.chunkMode,
    blockStreaming: resolveChannelStreamingBlockEnabled(merged) ?? merged.blockStreaming,
  };
}
