import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupBundleMcpHarness,
  makeTempDir,
  waitForFileText,
  writeBundleProbeMcpServer,
  writeClaudeBundle,
} from "./pi-bundle-mcp-test-harness.js";
import {
  __testing,
  disposeSessionMcpRuntime,
  getOrCreateSessionMcpRuntime,
  materializeBundleMcpToolsForRun,
} from "./pi-bundle-mcp-tools.js";
import type { SessionMcpRuntime } from "./pi-bundle-mcp-types.js";

type RuntimeFactoryOptions = NonNullable<
  Parameters<typeof __testing.createSessionMcpRuntimeManager>[0]
>;
type RuntimeFactory = NonNullable<RuntimeFactoryOptions["createRuntime"]>;

function makeRuntime(
  tools: Array<{ toolName: string; description: string }>,
  serverName = "bundleProbe",
): SessionMcpRuntime {
  return {
    sessionId: "session-colliding-tools",
    workspaceDir: "/tmp",
    configFingerprint: "fingerprint",
    createdAt: 0,
    lastUsedAt: 0,
    markUsed: () => {},
    getCatalog: async () => ({
      version: 1,
      generatedAt: 0,
      servers: {
        [serverName]: {
          serverName,
          launchSummary: serverName,
          toolCount: tools.length,
        },
      },
      tools: tools.map((tool) => ({
        serverName,
        safeServerName: serverName,
        toolName: tool.toolName,
        description: tool.description,
        inputSchema: {
          type: "object",
          properties: {
            toolName: { type: "string", const: tool.toolName },
          },
        },
        fallbackDescription: tool.description,
      })),
    }),
    callTool: async (_serverName, toolName) => ({
      content: [{ type: "text", text: toolName }],
      isError: false,
    }),
    listResources: async () => ({ resources: [] }),
    listResourceTemplates: async () => ({ resourceTemplates: [] }),
    readResource: async () => ({ contents: [] }),
    dispose: async () => {},
  };
}

afterEach(async () => {
  await cleanupBundleMcpHarness();
});

describe("session MCP runtime", () => {
  it("advertises MCP Apps support only when enabled", () => {
    expect(__testing.buildMcpClientCapabilities(false)).toEqual({});
    expect(__testing.buildMcpClientCapabilities(true)).toEqual({
      extensions: {
        "io.modelcontextprotocol/ui": {
          mimeTypes: ["text/html;profile=mcp-app"],
        },
      },
    });
  });

  it("keeps colliding sanitized tool definitions stable across catalog order changes", async () => {
    const catalogA = [
      { toolName: "alpha?", description: "question" },
      { toolName: "alpha!", description: "bang" },
    ];
    const catalogB = catalogA.toReversed();

    const materializedA = await materializeBundleMcpToolsForRun({
      runtime: makeRuntime(catalogA, "collision"),
    });
    const materializedB = await materializeBundleMcpToolsForRun({
      runtime: makeRuntime(catalogB, "collision"),
    });

    const summarizeTools = (runtime: Awaited<ReturnType<typeof materializeBundleMcpToolsForRun>>) =>
      runtime.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));

    expect(summarizeTools(materializedA)).toEqual(summarizeTools(materializedB));
    expect(summarizeTools(materializedA)).toEqual([
      {
        name: "collision__alpha-",
        description: "bang",
        parameters: {
          type: "object",
          properties: {
            toolName: { type: "string", const: "alpha!" },
          },
        },
      },
      {
        name: "collision__alpha--2",
        description: "question",
        parameters: {
          type: "object",
          properties: {
            toolName: { type: "string", const: "alpha?" },
          },
        },
      },
    ]);
  });

  it("does not materialize app-only MCP Apps tools for the model", async () => {
    const runtime: SessionMcpRuntime = {
      sessionId: "session-app-tools",
      sessionKey: "agent:test:session-app-tools",
      workspaceDir: "/tmp",
      configFingerprint: "fingerprint",
      mcpAppsEnabled: true,
      createdAt: 0,
      lastUsedAt: 0,
      markUsed: () => {},
      getCatalog: async () => ({
        version: 1,
        generatedAt: 0,
        servers: {
          appServer: {
            serverName: "appServer",
            launchSummary: "app server",
            toolCount: 2,
          },
        },
        tools: [
          {
            serverName: "appServer",
            safeServerName: "appServer",
            toolName: "model_tool",
            description: "Model-visible tool",
            inputSchema: { type: "object", properties: {} },
            fallbackDescription: "fallback",
            uiResourceUri: "ui://app/view.html",
          },
          {
            serverName: "appServer",
            safeServerName: "appServer",
            toolName: "app_tool",
            description: "App-only tool",
            inputSchema: { type: "object", properties: {} },
            fallbackDescription: "fallback",
            uiVisibility: ["app"],
          },
        ],
      }),
      callTool: async (_serverName, toolName) => ({
        content: [{ type: "text", text: `${toolName} result` }],
      }),
      listResources: async () => ({ resources: [] }),
      listResourceTemplates: async () => ({ resourceTemplates: [] }),
      readResource: async () => ({
        contents: [
          {
            uri: "ui://app/view.html",
            mimeType: "text/html;profile=mcp-app",
            text: "<!doctype html><html><body>app</body></html>",
          },
        ],
      }),
      dispose: async () => {},
    };

    const materialized = await materializeBundleMcpToolsForRun({ runtime });
    expect(materialized.tools.map((tool) => tool.name)).toEqual(["appServer__model_tool"]);

    const result = await materialized.tools[0].execute("call-model-tool", { city: "NYC" });
    const canvasContent = result.content.find(
      (item) => item.type === "text" && "text" in item && item.text.includes('"mcpApp"'),
    );
    const canvasText = canvasContent && "text" in canvasContent ? canvasContent.text : undefined;
    expect(canvasText).toBeTruthy();
    const parsed = JSON.parse(canvasText!);
    expect(parsed.mcpApp).toMatchObject({
      serverName: "appServer",
      toolName: "model_tool",
      uiResourceUri: "ui://app/view.html",
      sessionKey: "agent:test:session-app-tools",
      toolInput: { city: "NYC" },
    });
    expect(parsed.mcpApp.toolResult).toMatchObject({
      content: [{ type: "text", text: "model_tool result" }],
    });
  });

  it("uses result-level MCP App resource URIs when present", async () => {
    const readUris: string[] = [];
    const runtime: SessionMcpRuntime = {
      sessionId: "session-dynamic-app-tools",
      sessionKey: "agent:test:session-dynamic-app-tools",
      workspaceDir: "/tmp",
      configFingerprint: "fingerprint",
      mcpAppsEnabled: true,
      createdAt: 0,
      lastUsedAt: 0,
      markUsed: () => {},
      getCatalog: async () => ({
        version: 1,
        generatedAt: 0,
        servers: {
          appServer: {
            serverName: "appServer",
            launchSummary: "app server",
            toolCount: 1,
          },
        },
        tools: [
          {
            serverName: "appServer",
            safeServerName: "appServer",
            toolName: "dynamic_tool",
            description: "Dynamic app tool",
            inputSchema: { type: "object", properties: {} },
            fallbackDescription: "fallback",
          },
        ],
      }),
      callTool: async () => ({
        content: [{ type: "text", text: "dynamic result" }],
        _meta: {
          ui: {
            resourceUri: "ui://app/dynamic.html",
          },
        },
      }),
      listResources: async () => ({ resources: [] }),
      listResourceTemplates: async () => ({ resourceTemplates: [] }),
      readResource: async (_serverName, uri) => {
        readUris.push(uri);
        return {
          contents: [
            {
              uri,
              mimeType: "text/html;profile=mcp-app",
              text: "<!doctype html><html><body>dynamic</body></html>",
            },
          ],
        };
      },
      dispose: async () => {},
    };

    const materialized = await materializeBundleMcpToolsForRun({ runtime });
    const result = await materialized.tools[0].execute("call-dynamic-tool", { city: "NYC" });
    const canvasContent = result.content.find(
      (item) => item.type === "text" && "text" in item && item.text.includes('"mcpApp"'),
    );
    const canvasText = canvasContent && "text" in canvasContent ? canvasContent.text : undefined;
    expect(readUris).toEqual(["ui://app/dynamic.html"]);
    expect(canvasText).toBeTruthy();
    expect(JSON.parse(canvasText!).mcpApp).toMatchObject({
      serverName: "appServer",
      toolName: "dynamic_tool",
      uiResourceUri: "ui://app/dynamic.html",
      sessionKey: "agent:test:session-dynamic-app-tools",
    });
  });

  it("does not fetch MCP Apps views unless enabled", async () => {
    const runtime: SessionMcpRuntime = {
      sessionId: "session-app-tools-disabled",
      sessionKey: "agent:test:session-app-tools-disabled",
      workspaceDir: "/tmp",
      configFingerprint: "fingerprint",
      mcpAppsEnabled: false,
      createdAt: 0,
      lastUsedAt: 0,
      markUsed: () => {},
      getCatalog: async () => ({
        version: 1,
        generatedAt: 0,
        servers: {
          appServer: {
            serverName: "appServer",
            launchSummary: "app server",
            toolCount: 2,
          },
        },
        tools: [
          {
            serverName: "appServer",
            safeServerName: "appServer",
            toolName: "model_tool",
            description: "Model-visible tool",
            inputSchema: { type: "object", properties: {} },
            fallbackDescription: "fallback",
            uiResourceUri: "ui://app/view.html",
          },
          {
            serverName: "appServer",
            safeServerName: "appServer",
            toolName: "app_tool",
            description: "App-only tool",
            inputSchema: { type: "object", properties: {} },
            fallbackDescription: "fallback",
            uiVisibility: ["app"],
          },
        ],
      }),
      callTool: async (_serverName, toolName) => ({
        content: [{ type: "text", text: `${toolName} result` }],
      }),
      listResources: async () => ({ resources: [] }),
      listResourceTemplates: async () => ({ resourceTemplates: [] }),
      readResource: async () => {
        throw new Error("readResource should not be called");
      },
      dispose: async () => {},
    };

    const materialized = await materializeBundleMcpToolsForRun({ runtime });
    expect(materialized.tools.map((tool) => tool.name)).toEqual(["appServer__model_tool"]);

    const result = await materialized.tools[0].execute("call-model-tool", { city: "NYC" });
    expect(result.content).toEqual([{ type: "text", text: "model_tool result" }]);
  });

  it("reuses repeated materialization and recreates after explicit disposal", async () => {
    const created: SessionMcpRuntime[] = [];
    const createRuntime: RuntimeFactory = (params) => {
      const runtime = makeRuntime([{ toolName: "bundle_probe", description: "Bundle MCP probe" }]);
      created.push(runtime);
      return {
        ...runtime,
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        workspaceDir: params.workspaceDir,
        configFingerprint: params.configFingerprint ?? "fingerprint",
      };
    };
    const manager = __testing.createSessionMcpRuntimeManager({ createRuntime });

    const runtimeA = await manager.getOrCreate({
      sessionId: "session-a",
      sessionKey: "agent:test:session-a",
      workspaceDir: "/workspace",
    });
    const runtimeB = await manager.getOrCreate({
      sessionId: "session-a",
      sessionKey: "agent:test:session-a",
      workspaceDir: "/workspace",
    });

    const materializedA = await materializeBundleMcpToolsForRun({ runtime: runtimeA });
    const materializedB = await materializeBundleMcpToolsForRun({
      runtime: runtimeB,
      reservedToolNames: ["builtin_tool"],
    });

    expect(runtimeA).toBe(runtimeB);
    expect(materializedA.tools.map((tool) => tool.name)).toEqual(["bundleProbe__bundle_probe"]);
    expect(materializedB.tools.map((tool) => tool.name)).toEqual(["bundleProbe__bundle_probe"]);
    expect(created).toHaveLength(1);
    expect(manager.listSessionIds()).toEqual(["session-a"]);

    await manager.disposeSession("session-a");

    const runtimeC = await manager.getOrCreate({
      sessionId: "session-a",
      sessionKey: "agent:test:session-a",
      workspaceDir: "/workspace",
    });
    await materializeBundleMcpToolsForRun({ runtime: runtimeC });

    expect(runtimeC).not.toBe(runtimeA);
    expect(created).toHaveLength(2);
  });

  it("recreates the session runtime when MCP config changes", async () => {
    const createRuntime: RuntimeFactory = (params) => {
      const probeText = String(
        params.cfg?.mcp?.servers?.configuredProbe?.env?.BUNDLE_PROBE_TEXT ?? "FROM-CONFIG",
      );
      return {
        ...makeRuntime([{ toolName: "bundle_probe", description: "Bundle MCP probe" }]),
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        workspaceDir: params.workspaceDir,
        configFingerprint: params.configFingerprint ?? "fingerprint",
        callTool: async () => ({
          content: [{ type: "text", text: probeText }],
          isError: false,
        }),
      };
    };
    const manager = __testing.createSessionMcpRuntimeManager({ createRuntime });

    const runtimeA = await manager.getOrCreate({
      sessionId: "session-c",
      sessionKey: "agent:test:session-c",
      workspaceDir: "/workspace",
      cfg: {
        mcp: {
          servers: {
            configuredProbe: {
              command: "node",
              args: ["server-a.mjs"],
              env: {
                BUNDLE_PROBE_TEXT: "FROM-CONFIG-A",
              },
            },
          },
        },
      },
    });
    const toolsA = await materializeBundleMcpToolsForRun({ runtime: runtimeA });
    const resultA = await toolsA.tools[0].execute(
      "call-configured-probe-a",
      {},
      undefined,
      undefined,
    );

    const runtimeB = await manager.getOrCreate({
      sessionId: "session-c",
      sessionKey: "agent:test:session-c",
      workspaceDir: "/workspace",
      cfg: {
        mcp: {
          servers: {
            configuredProbe: {
              command: "node",
              args: ["server-b.mjs"],
              env: {
                BUNDLE_PROBE_TEXT: "FROM-CONFIG-B",
              },
            },
          },
        },
      },
    });
    const toolsB = await materializeBundleMcpToolsForRun({ runtime: runtimeB });
    const resultB = await toolsB.tools[0].execute(
      "call-configured-probe-b",
      {},
      undefined,
      undefined,
    );

    expect(runtimeA).not.toBe(runtimeB);
    expect(resultA.content[0]).toMatchObject({ type: "text", text: "FROM-CONFIG-A" });
    expect(resultB.content[0]).toMatchObject({ type: "text", text: "FROM-CONFIG-B" });
  });

  it("disposes startup-in-flight runtimes without leaking MCP processes", async () => {
    vi.useRealTimers();
    const workspaceDir = await makeTempDir("openclaw-bundle-mcp-tools-");
    const startupCounterPath = path.join(workspaceDir, "bundle-starts.txt");
    const pidPath = path.join(workspaceDir, "bundle.pid");
    const exitMarkerPath = path.join(workspaceDir, "bundle.exit");
    const pluginRoot = path.join(workspaceDir, ".openclaw", "extensions", "bundle-probe");
    const serverScriptPath = path.join(pluginRoot, "servers", "bundle-probe.mjs");
    await writeBundleProbeMcpServer(serverScriptPath, {
      startupCounterPath,
      startupDelayMs: 10,
      pidPath,
      exitMarkerPath,
    });
    await writeClaudeBundle({ pluginRoot, serverScriptPath });

    const runtime = await getOrCreateSessionMcpRuntime({
      sessionId: "session-d",
      sessionKey: "agent:test:session-d",
      workspaceDir,
      cfg: {
        plugins: {
          entries: {
            "bundle-probe": { enabled: true },
          },
        },
      },
    });

    const materializeResult = materializeBundleMcpToolsForRun({ runtime }).then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await waitForFileText(pidPath);
    await disposeSessionMcpRuntime("session-d");

    const result = await materializeResult;
    if (result.status !== "rejected") {
      throw new Error("Expected bundle MCP materialization to reject after disposal");
    }
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toMatch(/disposed/);
    expect(await waitForFileText(exitMarkerPath)).toBe("exited");
    expect(await fs.readFile(startupCounterPath, "utf8")).toBe("1");
    expect(__testing.getCachedSessionIds()).not.toContain("session-d");
  });

  it("materialized disposal can retire a manager-owned runtime", async () => {
    const disposed: string[] = [];
    const created: SessionMcpRuntime[] = [];
    const createRuntime: RuntimeFactory = (params) => {
      const runtime = {
        ...makeRuntime([{ toolName: "bundle_probe", description: "Bundle MCP probe" }]),
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        workspaceDir: params.workspaceDir,
        configFingerprint: params.configFingerprint ?? "fingerprint",
        dispose: async () => {
          disposed.push(params.sessionId);
        },
      };
      created.push(runtime);
      return runtime;
    };
    const manager = __testing.createSessionMcpRuntimeManager({ createRuntime });

    const runtimeA = await manager.getOrCreate({
      sessionId: "session-e",
      sessionKey: "agent:test:session-e",
      workspaceDir: "/workspace",
    });
    const materialized = await materializeBundleMcpToolsForRun({
      runtime: runtimeA,
      disposeRuntime: async () => {
        await manager.disposeSession("session-e");
      },
    });

    expect(materialized.tools.map((tool) => tool.name)).toEqual(["bundleProbe__bundle_probe"]);

    await materialized.dispose();

    expect(disposed).toEqual(["session-e"]);
    expect(manager.listSessionIds()).not.toContain("session-e");

    const runtimeB = await manager.getOrCreate({
      sessionId: "session-e",
      sessionKey: "agent:test:session-e",
      workspaceDir: "/workspace",
    });

    expect(runtimeB).not.toBe(runtimeA);
    await materializeBundleMcpToolsForRun({ runtime: runtimeB });
    expect(created).toHaveLength(2);
  });
});
