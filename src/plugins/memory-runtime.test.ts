import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveRuntimePluginRegistryMock =
  vi.fn<typeof import("./loader.js").resolveRuntimePluginRegistry>();
const resolvePluginRuntimeLoadContextMock =
  vi.fn<typeof import("./runtime/load-context.js").resolvePluginRuntimeLoadContext>();
const buildPluginRuntimeLoadOptionsMock =
  vi.fn<typeof import("./runtime/load-context.js").buildPluginRuntimeLoadOptions>();
const getMemoryRuntimeMock = vi.fn<typeof import("./memory-state.js").getMemoryRuntime>();

vi.mock("./runtime/load-context.js", () => ({
  resolvePluginRuntimeLoadContext: resolvePluginRuntimeLoadContextMock,
  buildPluginRuntimeLoadOptions: buildPluginRuntimeLoadOptionsMock,
}));

vi.mock("./loader.js", () => ({
  resolveRuntimePluginRegistry: resolveRuntimePluginRegistryMock,
}));

vi.mock("./memory-state.js", () => ({
  getMemoryRuntime: () => getMemoryRuntimeMock(),
}));

let getActiveMemorySearchManager: typeof import("./memory-runtime.js").getActiveMemorySearchManager;
let resolveActiveMemoryBackendConfig: typeof import("./memory-runtime.js").resolveActiveMemoryBackendConfig;
let closeActiveMemorySearchManagers: typeof import("./memory-runtime.js").closeActiveMemorySearchManagers;

function createMemoryRuntimeLoadFixture() {
  const rawConfig = {
    plugins: {},
    channels: { memory: { enabled: true } },
  };
  const loadContext = {
    rawConfig,
    config: {
      ...rawConfig,
      plugins: {
        entries: {
          memory: { enabled: true },
        },
      },
    },
    activationSourceConfig: rawConfig,
    autoEnabledReasons: {},
    workspaceDir: "/resolved-workspace",
    env: process.env,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
  const loadOptions = {
    config: loadContext.config,
    activationSourceConfig: rawConfig,
    autoEnabledReasons: {},
    workspaceDir: "/resolved-workspace",
    env: process.env,
    logger: loadContext.logger,
  };
  return { rawConfig, loadContext, loadOptions };
}

function createMemoryRuntimeFixture() {
  return {
    getMemorySearchManager: vi.fn(async () => ({ manager: null, error: "no index" })),
    resolveMemoryBackendConfig: vi.fn(() => ({ backend: "builtin" as const })),
  };
}

function expectMemoryRuntimeLoaded(
  rawConfig: unknown,
  loadContext: unknown,
  loadOptions: unknown,
) {
  expect(resolveRuntimePluginRegistryMock).toHaveBeenNthCalledWith(1);
  expect(resolvePluginRuntimeLoadContextMock).toHaveBeenCalledWith({ config: rawConfig });
  expect(buildPluginRuntimeLoadOptionsMock).toHaveBeenCalledWith(loadContext);
  expect(resolveRuntimePluginRegistryMock).toHaveBeenNthCalledWith(2, loadOptions);
}

function expectMemoryRuntimeLoadApplied(
  rawConfig: unknown,
  loadContext: unknown,
  loadOptions: unknown,
) {
  expectMemoryRuntimeLoaded(rawConfig, loadContext, loadOptions);
}

function setAutoEnabledMemoryRuntime() {
  const { rawConfig, loadContext, loadOptions } = createMemoryRuntimeLoadFixture();
  const runtime = createMemoryRuntimeFixture();
  resolvePluginRuntimeLoadContextMock.mockReturnValue(loadContext as never);
  buildPluginRuntimeLoadOptionsMock.mockReturnValue(loadOptions as never);
  getMemoryRuntimeMock
    .mockReturnValueOnce(undefined)
    .mockReturnValueOnce(undefined)
    .mockReturnValue(runtime);
  return { rawConfig, loadContext, loadOptions, runtime };
}

function expectNoMemoryRuntimeBootstrap() {
  expect(resolvePluginRuntimeLoadContextMock).not.toHaveBeenCalled();
  expect(buildPluginRuntimeLoadOptionsMock).not.toHaveBeenCalled();
  expect(resolveRuntimePluginRegistryMock).not.toHaveBeenCalled();
}

async function expectAutoEnabledMemoryRuntimeCase(params: {
  run: (rawConfig: unknown) => Promise<unknown>;
  expectedResult: unknown;
}) {
  const { rawConfig, loadContext, loadOptions } = setAutoEnabledMemoryRuntime();
  const result = await params.run(rawConfig);

  if (params.expectedResult !== undefined) {
    expect(result).toEqual(params.expectedResult);
  }
  expectMemoryRuntimeLoadApplied(rawConfig, loadContext, loadOptions);
}

async function expectCloseMemoryRuntimeCase(params: {
  config: unknown;
  setup: () => { closeAllMemorySearchManagers: ReturnType<typeof vi.fn> } | undefined;
}) {
  const runtime = params.setup();
  await closeActiveMemorySearchManagers(params.config as never);

  if (runtime) {
    expect(runtime.closeAllMemorySearchManagers).toHaveBeenCalledTimes(1);
  }
  expectNoMemoryRuntimeBootstrap();
}

describe("memory runtime auto-enable loading", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({
      getActiveMemorySearchManager,
      resolveActiveMemoryBackendConfig,
      closeActiveMemorySearchManagers,
    } = await import("./memory-runtime.js"));
    resolveRuntimePluginRegistryMock.mockReset();
    resolvePluginRuntimeLoadContextMock.mockReset();
    buildPluginRuntimeLoadOptionsMock.mockReset();
    getMemoryRuntimeMock.mockReset();
  });

  it.each([
    {
      name: "loads memory runtime from the auto-enabled config snapshot",
      run: async (rawConfig: unknown) =>
        getActiveMemorySearchManager({
          cfg: rawConfig as never,
          agentId: "main",
        }),
      expectedResult: undefined,
    },
    {
      name: "reuses the same auto-enabled load path for backend config resolution",
      run: async (rawConfig: unknown) =>
        resolveActiveMemoryBackendConfig({
          cfg: rawConfig as never,
          agentId: "main",
        }),
      expectedResult: { backend: "builtin" },
    },
  ] as const)("$name", async ({ run, expectedResult }) => {
    await expectAutoEnabledMemoryRuntimeCase({ run, expectedResult });
  });

  it.each([
    {
      name: "does not bootstrap the memory runtime just to close managers",
      config: {
        plugins: {},
        channels: { memory: { enabled: true } },
      },
      setup: () => {
        getMemoryRuntimeMock.mockReturnValue(undefined);
        return undefined;
      },
    },
    {
      name: "closes an already-registered memory runtime without reloading plugins",
      config: {},
      setup: () => {
        const runtime = {
          getMemorySearchManager: vi.fn(async () => ({ manager: null, error: "no index" })),
          resolveMemoryBackendConfig: vi.fn(() => ({ backend: "builtin" as const })),
          closeAllMemorySearchManagers: vi.fn(async () => {}),
        };
        getMemoryRuntimeMock.mockReturnValue(runtime);
        return runtime;
      },
    },
  ] as const)("$name", async ({ config, setup }) => {
    await expectCloseMemoryRuntimeCase({ config, setup });
  });

  it("reuses the already active plugin registry before bootstrapping a config-only reload", async () => {
    const rawConfig = {
      plugins: {},
      channels: { memory: { enabled: true } },
    };
    const runtime = createMemoryRuntimeFixture();
    getMemoryRuntimeMock.mockReturnValueOnce(undefined).mockReturnValueOnce(runtime);

    await getActiveMemorySearchManager({
      cfg: rawConfig as never,
      agentId: "main",
      purpose: "status",
    });

    expect(resolveRuntimePluginRegistryMock).toHaveBeenCalledTimes(1);
    expect(resolveRuntimePluginRegistryMock).toHaveBeenCalledWith();
    expect(resolvePluginRuntimeLoadContextMock).not.toHaveBeenCalled();
    expect(buildPluginRuntimeLoadOptionsMock).not.toHaveBeenCalled();
  });
});
