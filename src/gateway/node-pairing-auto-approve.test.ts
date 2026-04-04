import { describe, expect, it } from "vitest";
import { shouldAutoApproveNodePairingFromTrustedCidrs } from "./node-pairing-auto-approve.js";

describe("shouldAutoApproveNodePairingFromTrustedCidrs", () => {
  it("accepts a node from a matching IPv4 CIDR", () => {
    expect(
      shouldAutoApproveNodePairingFromTrustedCidrs({
        role: "node",
        reason: "not-paired",
        scopes: [],
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
        reportedClientIp: "192.168.1.42",
        autoApproveCidrs: ["192.168.1.42"],
      }),
    ).toBe(true);
  });

  it("accepts a node from a matching IPv6 CIDR", () => {
    expect(
      shouldAutoApproveNodePairingFromTrustedCidrs({
        role: "node",
        reason: "not-paired",
        scopes: [],
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
        reportedClientIp: "192.168.1.42",
        autoApproveCidrs: ["192.168.1.0/24"],
      }),
    ).toBe(false);
  });
});
