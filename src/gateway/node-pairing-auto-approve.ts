import { isTrustedProxyAddress } from "./net.js";

export type NodePairingAutoApproveReason =
  | "not-paired"
  | "role-upgrade"
  | "scope-upgrade"
  | "metadata-upgrade";

export function shouldAutoApproveNodePairingFromTrustedCidrs(params: {
  role: string;
  reason: NodePairingAutoApproveReason;
  scopes: string[];
  reportedClientIp?: string;
  autoApproveCidrs?: string[];
}): boolean {
  if (params.role !== "node") {
    return false;
  }
  if (params.reason !== "not-paired") {
    return false;
  }
  if (params.scopes.length > 0) {
    return false;
  }
  if (!params.reportedClientIp) {
    return false;
  }

  const autoApproveCidrs = params.autoApproveCidrs
    ?.map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (!autoApproveCidrs || autoApproveCidrs.length === 0) {
    return false;
  }

  return isTrustedProxyAddress(params.reportedClientIp, autoApproveCidrs);
}
