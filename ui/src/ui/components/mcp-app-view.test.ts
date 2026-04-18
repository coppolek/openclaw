/* @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { buildMcpAppHostContext } from "./mcp-app-view.ts";

describe("mcp-app-view helpers", () => {
  it("includes safe host context for MCP Apps", () => {
    const context = buildMcpAppHostContext({
      width: 320,
      height: 600,
    });

    expect(context.toolInfo).toBeUndefined();
    expect(context.displayMode).toBe("inline");
    expect(context.availableDisplayModes).toEqual(["inline"]);
    expect(context.containerDimensions).toMatchObject({ width: 320, height: 600 });
    expect(context.locale).toBeTruthy();
    expect(context.timeZone).toBeTruthy();
  });
});
