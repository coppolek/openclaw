import { describe, expect, it } from "vitest";
import { validateConfigObject } from "./config.js";

describe("gateway node pairing auto-approve config", () => {
  it.each([
    {
      name: "accepts a single IPv4 CIDR",
      value: ["192.168.1.0/24"],
    },
    {
      name: "accepts a single IPv6 CIDR",
      value: ["fd00:1234:5678::/64"],
    },
    {
      name: "accepts a single exact IP entry",
      value: ["192.168.1.42"],
    },
    {
      name: "accepts an empty array",
      value: [],
    },
  ])("$name", ({ value }) => {
    const result = validateConfigObject({
      gateway: {
        nodes: {
          pairing: {
            autoApproveCidrs: value,
          },
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-array autoApproveCidrs shape", () => {
    const result = validateConfigObject({
      gateway: {
        nodes: {
          pairing: {
            autoApproveCidrs: "192.168.1.0/24",
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some((issue) => issue.path === "gateway.nodes.pairing.autoApproveCidrs"),
      ).toBe(true);
    }
  });

  it("rejects non-string autoApproveCidrs entries", () => {
    const result = validateConfigObject({
      gateway: {
        nodes: {
          pairing: {
            autoApproveCidrs: ["192.168.1.0/24", 1234],
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some((issue) =>
          issue.path.startsWith("gateway.nodes.pairing.autoApproveCidrs"),
        ),
      ).toBe(true);
    }
  });
});
