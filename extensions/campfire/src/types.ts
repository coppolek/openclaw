export type CampfireWebhookPayload = {
  user: {
    id: number;
    name: string;
  };
  room: {
    id: number;
    name: string;
    path: string;
  };
  message: {
    id: number;
    body: {
      html?: string;
      plain: string;
    };
    path: string;
  };
};

export type CampfireAccountConfig = {
  name?: string;
  enabled?: boolean;
  baseUrl?: string;
  botKey?: string;
  webhookSecret?: string;
  allowFrom?: string[];
  webhookPath?: string;
  textChunkLimit?: number;
};

export type CampfireChannelConfig = CampfireAccountConfig & {
  defaultAccount?: string;
  accounts?: Record<string, CampfireAccountConfig | undefined>;
};

export type ResolvedCampfireAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  baseUrl: string;
  botKey: string;
  webhookSecret?: string;
  allowFrom: string[];
  webhookPath: string;
  textChunkLimit: number;
  configured: boolean;
};
