export function hasTelegramConfiguredState(params: {
  cfg?: {
    channels?: {
      telegram?: { botToken?: string; tokenFile?: string; accounts?: Record<string, unknown> };
    };
  };
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (
    typeof params.env?.TELEGRAM_BOT_TOKEN === "string" &&
    params.env.TELEGRAM_BOT_TOKEN.trim().length > 0
  ) {
    return true;
  }
  const tg = params.cfg?.channels?.telegram;
  if (tg) {
    if (typeof tg.botToken === "string" && tg.botToken.trim().length > 0) {
      return true;
    }
    if (typeof tg.tokenFile === "string" && tg.tokenFile.trim().length > 0) {
      return true;
    }
    if (tg.accounts && Object.keys(tg.accounts).length > 0) {
      return true;
    }
  }
  return false;
}
