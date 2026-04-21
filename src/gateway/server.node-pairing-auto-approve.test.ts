import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { type OpenClawConfig, writeConfigFile } from "../config/config.js";
import {
  approveDevicePairing,
  getPairedDevice,
  listDevicePairing,
  requestDevicePairing,
} from "../infra/device-pairing.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { loadDeviceIdentity, pairDeviceIdentity } from "./device-authz.test-helpers.js";
import {
  connectReq,
  installGatewayTestHooks,
  startConnectedServerWithClient,
  trackConnectChallengeNonce,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

const TOKEN = "secret";
const TRUSTED_PROXY_HEADERS = {
  "x-forwarded-for": "203.0.113.10",
} as const;
const NON_MATCHING_PROXY_HEADERS = {
  "x-forwarded-for": "198.51.100.10",
} as const;

const NODE_CLIENT = {
  id: GATEWAY_CLIENT_NAMES.NODE_HOST,
  version: "1.0.0",
  platform: "ios",
  mode: GATEWAY_CLIENT_MODES.NODE,
};

const OPERATOR_CLIENT = {
  id: GATEWAY_CLIENT_NAMES.TEST,
  version: "1.0.0",
  platform: "test",
  mode: GATEWAY_CLIENT_MODES.TEST,
};

const CONTROL_UI_NODE_CLIENT = {
  id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
  version: "1.0.0",
  platform: "web",
  mode: GATEWAY_CLIENT_MODES.WEBCHAT,
};
let started: Awaited<ReturnType<typeof startConnectedServerWithClient>> | null = null;

function pairingReasonFromResponse(
  res: Awaited<ReturnType<typeof connectReq>>,
): string | undefined {
  const details = res.error?.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return undefined;
  }
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
}

function pendingForDevice(
  pairing: Awaited<ReturnType<typeof listDevicePairing>>,
  deviceId: string,
) {
  return pairing.pending.filter((entry) => entry.deviceId === deviceId);
}

async function writeGatewayConfig(gateway: OpenClawConfig["gateway"]): Promise<void> {
  await writeConfigFile({ gateway });
}

async function openGatewayWs(port: number, headers?: Record<string, string>): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, headers ? { headers } : undefined);
  trackConnectChallengeNonce(ws);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for ws open")), 10_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return ws;
}

async function connectGatewayDevice(params: {
  port: number;
  identityPath: string;
  headers?: Record<string, string>;
  role: "node" | "operator";
  scopes: string[];
  client: NonNullable<Parameters<typeof connectReq>[1]>["client"];
}) {
  const ws = await openGatewayWs(params.port, params.headers);
  try {
    const res = await connectReq(ws, {
      token: TOKEN,
      role: params.role,
      scopes: params.scopes,
      client: params.client,
      deviceIdentityPath: params.identityPath,
    });
    return { ws, res };
  } catch (error) {
    ws.close();
    throw error;
  }
}

describe("gateway trusted CIDR node pairing auto-approve", () => {
  beforeAll(async () => {
    started = await startConnectedServerWithClient(TOKEN);
  });

  afterAll(async () => {
    started?.ws.close();
    if (started?.server) {
      await started.server.close();
    }
    started?.envSnapshot.restore();
  });

  test("does not trust loopback trusted-proxy headers for silent node pairing", async () => {
    if (!started) {
      throw new Error("expected started gateway server");
    }
    await writeGatewayConfig({
      trustedProxies: ["127.0.0.1"],
      nodes: {
        pairing: {
          autoApproveCidrs: ["203.0.113.0/24"],
        },
      },
    });
    const loaded = loadDeviceIdentity("trusted-cidr-node-first-pairing");

    const first = await connectGatewayDevice({
      port: started.port,
      headers: TRUSTED_PROXY_HEADERS,
      identityPath: loaded.identityPath,
      role: "node",
      scopes: [],
      client: NODE_CLIENT,
    });
    expect(first.res.ok).toBe(false);
    expect(first.res.error?.message).toBe("pairing required");
    expect(pairingReasonFromResponse(first.res)).toBe("not-paired");
    first.ws.close();

    const pending = pendingForDevice(await listDevicePairing(), loaded.identity.deviceId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.silent).toBe(false);
    expect(await getPairedDevice(loaded.identity.deviceId)).toBeNull();
  });

  test("keeps non-matching node CIDRs on manual approval", async () => {
    if (!started) {
      throw new Error("expected started gateway server");
    }
    await writeGatewayConfig({
      trustedProxies: ["127.0.0.1"],
      nodes: {
        pairing: {
          autoApproveCidrs: ["203.0.113.0/24"],
        },
      },
    });
    const loaded = loadDeviceIdentity("trusted-cidr-node-non-match");

    const attempt = await connectGatewayDevice({
      port: started.port,
      headers: NON_MATCHING_PROXY_HEADERS,
      identityPath: loaded.identityPath,
      role: "node",
      scopes: [],
      client: NODE_CLIENT,
    });
    expect(attempt.res.ok).toBe(false);
    expect(attempt.res.error?.message).toBe("pairing required");
    attempt.ws.close();

    const pending = pendingForDevice(await listDevicePairing(), loaded.identity.deviceId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.silent).toBe(false);
    expect(await getPairedDevice(loaded.identity.deviceId)).toBeNull();
  });

  test("does not auto-approve re-pair requests on matching CIDRs", async () => {
    if (!started) {
      throw new Error("expected started gateway server");
    }
    await writeGatewayConfig({
      trustedProxies: ["127.0.0.1"],
      nodes: {
        pairing: {
          autoApproveCidrs: ["203.0.113.0/24"],
        },
      },
    });
    const legit = loadDeviceIdentity("trusted-cidr-node-repair-legit");
    const stale = loadDeviceIdentity("trusted-cidr-node-repair-stale");

    const seeded = await requestDevicePairing({
      deviceId: legit.identity.deviceId,
      publicKey: stale.publicKey,
      role: "node",
      scopes: [],
      clientId: NODE_CLIENT.id,
      clientMode: NODE_CLIENT.mode,
    });
    const seededApproval = await approveDevicePairing(seeded.request.requestId);
    expect(seededApproval?.status).toBe("approved");
    expect((await getPairedDevice(legit.identity.deviceId))?.publicKey).toBe(stale.publicKey);

    const attempt = await connectGatewayDevice({
      port: started.port,
      headers: TRUSTED_PROXY_HEADERS,
      identityPath: legit.identityPath,
      role: "node",
      scopes: [],
      client: NODE_CLIENT,
    });
    expect(attempt.res.ok).toBe(false);
    expect(attempt.res.error?.message).toBe("pairing required");
    expect(pairingReasonFromResponse(attempt.res)).toBe("not-paired");
    attempt.ws.close();

    const pending = pendingForDevice(await listDevicePairing(), legit.identity.deviceId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.silent).toBe(false);
    expect((await getPairedDevice(legit.identity.deviceId))?.publicKey).toBe(stale.publicKey);
  });

  test("keeps operator pairing manual even on matching CIDRs", async () => {
    if (!started) {
      throw new Error("expected started gateway server");
    }
    await writeGatewayConfig({
      trustedProxies: ["127.0.0.1"],
      nodes: {
        pairing: {
          autoApproveCidrs: ["203.0.113.0/24"],
        },
      },
    });
    const loaded = loadDeviceIdentity("trusted-cidr-operator-manual");

    const attempt = await connectGatewayDevice({
      port: started.port,
      headers: TRUSTED_PROXY_HEADERS,
      identityPath: loaded.identityPath,
      role: "operator",
      scopes: ["operator.read"],
      client: OPERATOR_CLIENT,
    });
    expect(attempt.res.ok).toBe(false);
    expect(attempt.res.error?.message).toBe("pairing required");
    expect(pairingReasonFromResponse(attempt.res)).toBe("not-paired");
    attempt.ws.close();

    const pending = pendingForDevice(await listDevicePairing(), loaded.identity.deviceId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.role).toBe("operator");
    expect(await getPairedDevice(loaded.identity.deviceId)).toBeNull();
  });

  test("keeps browser control-ui node pairing manual even on matching CIDRs", async () => {
    if (!started) {
      throw new Error("expected started gateway server");
    }
    const controlUiOrigin = `http://127.0.0.1:${started.port}`;
    await writeGatewayConfig({
      trustedProxies: ["127.0.0.1"],
      controlUi: {
        allowedOrigins: [controlUiOrigin],
      },
      nodes: {
        pairing: {
          autoApproveCidrs: ["203.0.113.0/24"],
        },
      },
    });
    const loaded = loadDeviceIdentity("trusted-cidr-control-ui-node-manual");

    const attempt = await connectGatewayDevice({
      port: started.port,
      headers: {
        ...TRUSTED_PROXY_HEADERS,
        origin: controlUiOrigin,
      },
      identityPath: loaded.identityPath,
      role: "node",
      scopes: [],
      client: CONTROL_UI_NODE_CLIENT,
    });
    expect(attempt.res.ok).toBe(false);
    expect(attempt.res.error?.message).toBe("pairing required");
    expect(pairingReasonFromResponse(attempt.res)).toBe("not-paired");
    attempt.ws.close();

    const pending = pendingForDevice(await listDevicePairing(), loaded.identity.deviceId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.silent).toBe(false);
    expect(pending[0]?.role).toBe("node");
    expect(await getPairedDevice(loaded.identity.deviceId)).toBeNull();
  });

  test("does not auto-approve role upgrades on matching CIDRs", async () => {
    if (!started) {
      throw new Error("expected started gateway server");
    }
    await writeGatewayConfig({
      trustedProxies: ["127.0.0.1"],
      nodes: {
        pairing: {
          autoApproveCidrs: ["203.0.113.0/24"],
        },
      },
    });
    const loaded = await pairDeviceIdentity({
      name: "trusted-cidr-role-upgrade",
      role: "node",
      scopes: [],
      clientId: NODE_CLIENT.id,
      clientMode: NODE_CLIENT.mode,
    });

    const upgrade = await connectGatewayDevice({
      port: started.port,
      headers: TRUSTED_PROXY_HEADERS,
      identityPath: loaded.identityPath,
      role: "operator",
      scopes: ["operator.read"],
      client: {
        ...OPERATOR_CLIENT,
        platform: NODE_CLIENT.platform,
      },
    });
    expect(upgrade.res.ok).toBe(false);
    expect(upgrade.res.error?.message).toBe("pairing required");
    expect(pairingReasonFromResponse(upgrade.res)).toBe("role-upgrade");
    upgrade.ws.close();
  });

  test("does not auto-approve scope upgrades on matching CIDRs", async () => {
    if (!started) {
      throw new Error("expected started gateway server");
    }
    await writeGatewayConfig({
      trustedProxies: ["127.0.0.1"],
      nodes: {
        pairing: {
          autoApproveCidrs: ["203.0.113.0/24"],
        },
      },
    });
    const loaded = await pairDeviceIdentity({
      name: "trusted-cidr-scope-upgrade",
      role: "node",
      scopes: [],
      clientId: NODE_CLIENT.id,
      clientMode: NODE_CLIENT.mode,
    });

    const upgrade = await connectGatewayDevice({
      port: started.port,
      headers: TRUSTED_PROXY_HEADERS,
      identityPath: loaded.identityPath,
      role: "node",
      scopes: ["operator.read"],
      client: NODE_CLIENT,
    });
    expect(upgrade.res.ok).toBe(false);
    expect(upgrade.res.error?.message).toBe("pairing required");
    expect(pairingReasonFromResponse(upgrade.res)).toBe("scope-upgrade");
    upgrade.ws.close();
  });

  test("does not trust untrusted proxy headers for auto-approve", async () => {
    if (!started) {
      throw new Error("expected started gateway server");
    }
    await writeGatewayConfig({
      nodes: {
        pairing: {
          autoApproveCidrs: ["203.0.113.0/24"],
        },
      },
    });
    const loaded = loadDeviceIdentity("trusted-cidr-untrusted-proxy");

    const attempt = await connectGatewayDevice({
      port: started.port,
      headers: TRUSTED_PROXY_HEADERS,
      identityPath: loaded.identityPath,
      role: "node",
      scopes: [],
      client: NODE_CLIENT,
    });
    expect(attempt.res.ok).toBe(false);
    expect(attempt.res.error?.message).toBe("pairing required");
    expect(pairingReasonFromResponse(attempt.res)).toBe("not-paired");
    attempt.ws.close();

    const pending = pendingForDevice(await listDevicePairing(), loaded.identity.deviceId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.silent).toBe(false);
    expect(await getPairedDevice(loaded.identity.deviceId)).toBeNull();
  });
});
