import { describe, expect, it } from "vitest";
import { shouldAutoApproveNodePairingFromTrustedCidrs } from "./node-pairing-auto-approve.js";

describe("shouldAutoApproveNodePairingFromTrustedCidrs", () => {
  it("accepts a node from a matching IPv4 CIDR", () => {
    expect(
      shouldAutoApproveNodePairingFromTrustedCidrs({
        role: "node",
        reason: "not-paired",
        scopes: [],
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reportedClientIpSource: "direct",
        reportedClientIp: "192.168.1.42",
        autoApproveCidrs: ["192.168.1.0/24"],
      }),
    ).toBe(true);
  });

  it("accepts a node from an exact IP entry", () => {
    expect(
      shouldAutoApproveNodePairingFromTrustedCidrs({
        role: "node",
        reason: "not-paired",
        scopes: [],
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reportedClientIpSource: "direct",
        reportedClientIp: "192.168.1.42",
        autoApproveCidrs: ["192.168.1.42"],
      }),
    ).toBe(true);
  });

  it("accepts a node from a matching IPv6 CIDR via a trusted proxy", () => {
    expect(
      shouldAutoApproveNodePairingFromTrustedCidrs({
        role: "node",
        reason: "not-paired",
        scopes: [],
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reportedClientIpSource: "trusted-proxy",
        reportedClientIp: "fd00:1234:5678::9",
        autoApproveCidrs: ["fd00:1234:5678::/64"],
      }),
    ).toBe(true);
  });

  it("rejects non-matching CIDRs", () => {
    expect(
      shouldAutoApproveNodePairingFromTrustedCidrs({
        role: "node",
        reason: "not-paired",
        scopes: [],
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reportedClientIpSource: "direct",
        reportedClientIp: "192.168.2.42",
        autoApproveCidrs: ["192.168.1.0/24"],
      }),
    ).toBe(false);
  });

  it("rejects missing client IPs", () => {
    expect(
      shouldAutoApproveNodePairingFromTrustedCidrs({
        role: "node",
        reason: "not-paired",
        scopes: [],
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reportedClientIpSource: "none",
        reportedClientIp: undefined,
        autoApproveCidrs: ["192.168.1.0/24"],
      }),
    ).toBe(false);
  });

  it("rejects operator role clients", () => {
    expect(
      shouldAutoApproveNodePairingFromTrustedCidrs({
        role: "operator",
        reason: "not-paired",
        scopes: [],
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reportedClientIpSource: "direct",
        reportedClientIp: "192.168.1.42",
        autoApproveCidrs: ["192.168.1.0/24"],
      }),
    ).toBe(false);
  });

  it("rejects browser-origin node clients", () => {
    expect(
      shouldAutoApproveNodePairingFromTrustedCidrs({
        role: "node",
        reason: "not-paired",
        scopes: [],
        hasBrowserOriginHeader: true,
        isControlUi: false,
        isWebchat: false,
        reportedClientIpSource: "direct",
        reportedClientIp: "192.168.1.42",
        autoApproveCidrs: ["192.168.1.0/24"],
      }),
    ).toBe(false);
  });

  it("rejects control-ui node clients", () => {
    expect(
      shouldAutoApproveNodePairingFromTrustedCidrs({
        role: "node",
        reason: "not-paired",
        scopes: [],
        hasBrowserOriginHeader: false,
        isControlUi: true,
        isWebchat: false,
        reportedClientIpSource: "direct",
        reportedClientIp: "192.168.1.42",
        autoApproveCidrs: ["192.168.1.0/24"],
      }),
    ).toBe(false);
  });

  it("rejects webchat node clients", () => {
    expect(
      shouldAutoApproveNodePairingFromTrustedCidrs({
        role: "node",
        reason: "not-paired",
        scopes: [],
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: true,
        reportedClientIpSource: "direct",
        reportedClientIp: "192.168.1.42",
        autoApproveCidrs: ["192.168.1.0/24"],
      }),
    ).toBe(false);
  });

  it("rejects loopback trusted-proxy reported IPs", () => {
    expect(
      shouldAutoApproveNodePairingFromTrustedCidrs({
        role: "node",
        reason: "not-paired",
        scopes: [],
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reportedClientIpSource: "loopback-trusted-proxy",
        reportedClientIp: "192.168.1.42",
        autoApproveCidrs: ["192.168.1.0/24"],
      }),
    ).toBe(false);
  });

  it.each(["role-upgrade", "scope-upgrade", "metadata-upgrade"] as const)(
    "rejects %s requests",
    (reason) => {
      expect(
        shouldAutoApproveNodePairingFromTrustedCidrs({
          role: "node",
          reason,
          scopes: [],
          hasBrowserOriginHeader: false,
          isControlUi: false,
          isWebchat: false,
          reportedClientIpSource: "direct",
          reportedClientIp: "192.168.1.42",
          autoApproveCidrs: ["192.168.1.0/24"],
        }),
      ).toBe(false);
    },
  );

  it("rejects non-empty scopes", () => {
    expect(
      shouldAutoApproveNodePairingFromTrustedCidrs({
        role: "node",
        reason: "not-paired",
        scopes: ["operator.read"],
        hasBrowserOriginHeader: false,
        isControlUi: false,
        isWebchat: false,
        reportedClientIpSource: "direct",
        reportedClientIp: "192.168.1.42",
        autoApproveCidrs: ["192.168.1.0/24"],
      }),
    ).toBe(false);
  });
});
