import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importFreshModule } from "../../test/helpers/import-fresh.ts";
import { loadBundledEntryExportSync } from "./channel-entry-contract.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.resetModules();
  vi.doUnmock("jiti");
  vi.unstubAllEnvs();
});

describe("loadBundledEntryExportSync", () => {
  it("includes importer and resolved path context when a bundled sidecar is missing", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-channel-entry-contract-"));
    tempDirs.push(tempRoot);

    const pluginRoot = path.join(tempRoot, "dist", "extensions", "telegram");
    fs.mkdirSync(pluginRoot, { recursive: true });

    const importerPath = path.join(pluginRoot, "index.js");
    fs.writeFileSync(importerPath, "export default {};\n", "utf8");

    let thrown: unknown;
    try {
      loadBundledEntryExportSync(pathToFileURL(importerPath).href, {
        specifier: "./src/secret-contract.js",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('bundled plugin entry "./src/secret-contract.js" failed to open');
    expect(message).toContain(`from "${importerPath}"`);
    expect(message).toContain(`resolved "${path.join(pluginRoot, "src", "secret-contract.js")}"`);
    expect(message).toContain(`plugin root "${pluginRoot}"`);
    expect(message).toContain('reason "path"');
    expect(message).toContain("ENOENT");
  });

  it("keeps Windows dist sidecar loads off Jiti native import", async () => {
    const createJiti = vi.fn(() => vi.fn(() => ({ load: 42 })));
    vi.doMock("jiti", () => ({
      createJiti,
    }));
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");

    try {
      const channelEntryContract = await importFreshModule<
        typeof import("./channel-entry-contract.js")
      >(import.meta.url, "./channel-entry-contract.js?scope=windows-dist-jiti");
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-channel-entry-contract-"));
      tempDirs.push(tempRoot);

      const pluginRoot = path.join(tempRoot, "dist", "extensions", "telegram");
      fs.mkdirSync(pluginRoot, { recursive: true });

      const importerPath = path.join(pluginRoot, "index.js");
      const helperPath = path.join(pluginRoot, "helper.ts");
      fs.writeFileSync(importerPath, "export default {};\n", "utf8");
      fs.writeFileSync(helperPath, "export const load = 42;\n", "utf8");

      expect(
        channelEntryContract.loadBundledEntryExportSync<number>(pathToFileURL(importerPath).href, {
          specifier: "./helper.ts",
          exportName: "load",
        }),
      ).toBe(42);
      expect(createJiti).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          tryNative: false,
        }),
      );
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("loads packaged telegram setup sidecars from dist-facing api modules", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-channel-entry-contract-"));
    tempDirs.push(tempRoot);

    const pluginRoot = path.join(tempRoot, "dist", "extensions", "telegram");
    fs.mkdirSync(pluginRoot, { recursive: true });

    const importerPath = path.join(pluginRoot, "setup-entry.js");
    const setupApiPath = path.join(pluginRoot, "setup-plugin-api.js");
    const secretsApiPath = path.join(pluginRoot, "secret-contract-api.js");

    fs.writeFileSync(importerPath, "export default {};\n", "utf8");
    fs.writeFileSync(
      setupApiPath,
      'export const telegramSetupPlugin = { id: "telegram" };\n',
      "utf8",
    );
    fs.writeFileSync(
      secretsApiPath,
      [
        "export const collectRuntimeConfigAssignments = () => [];",
        "export const secretTargetRegistryEntries = [];",
        'export const channelSecrets = { TELEGRAM_TOKEN: { env: "TELEGRAM_TOKEN" } };',
        "",
      ].join("\n"),
      "utf8",
    );

    expect(
      loadBundledEntryExportSync<{ id: string }>(pathToFileURL(importerPath).href, {
        specifier: "./setup-plugin-api.js",
        exportName: "telegramSetupPlugin",
      }),
    ).toEqual({ id: "telegram" });

    expect(
      loadBundledEntryExportSync<Record<string, unknown>>(pathToFileURL(importerPath).href, {
        specifier: "./secret-contract-api.js",
        exportName: "channelSecrets",
      }),
    ).toEqual({
      TELEGRAM_TOKEN: {
        env: "TELEGRAM_TOKEN",
      },
    });
  });

  it("can disable source-tree fallback for dist bundled entry checks", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-channel-entry-contract-"));
    tempDirs.push(tempRoot);

    fs.writeFileSync(path.join(tempRoot, "package.json"), '{"name":"openclaw"}\n', "utf8");
    const pluginRoot = path.join(tempRoot, "dist", "extensions", "telegram");
    const sourceRoot = path.join(tempRoot, "extensions", "telegram", "src");
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.mkdirSync(sourceRoot, { recursive: true });

    const importerPath = path.join(pluginRoot, "index.js");
    fs.writeFileSync(importerPath, "export default {};\n", "utf8");
    fs.writeFileSync(
      path.join(sourceRoot, "secret-contract.ts"),
      "export const sentinel = 42;\n",
      "utf8",
    );

    expect(
      loadBundledEntryExportSync<number>(pathToFileURL(importerPath).href, {
        specifier: "./src/secret-contract.js",
        exportName: "sentinel",
      }),
    ).toBe(42);

    vi.stubEnv("OPENCLAW_DISABLE_BUNDLED_ENTRY_SOURCE_FALLBACK", "1");

    expect(() =>
      loadBundledEntryExportSync<number>(pathToFileURL(importerPath).href, {
        specifier: "./src/secret-contract.js",
        exportName: "sentinel",
      }),
    ).toThrow(`resolved "${path.join(pluginRoot, "src", "secret-contract.js")}"`);
  });

  it("throws and does not cache when jiti loader returns null", async () => {
    const createJiti = vi.fn(() => vi.fn(() => null));
    vi.doMock("jiti", () => ({
      createJiti,
    }));

    const channelEntryContract = await importFreshModule<
      typeof import("./channel-entry-contract.js")
    >(import.meta.url, "./channel-entry-contract.js?scope=null-loader");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-channel-entry-contract-"));
    tempDirs.push(tempRoot);

    const pluginRoot = path.join(tempRoot, "dist", "extensions", "telegram");
    fs.mkdirSync(pluginRoot, { recursive: true });

    const importerPath = path.join(pluginRoot, "index.js");
    fs.writeFileSync(importerPath, "export default {};\n", "utf8");

    const nullModulePath = path.join(pluginRoot, "null-module.js");
    fs.writeFileSync(nullModulePath, "export default null;\n", "utf8");

    // First call should throw
    let thrown: unknown;
    try {
      channelEntryContract.loadBundledEntryExportSync(pathToFileURL(importerPath).href, {
        specifier: "./null-module.js",
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("null/undefined");

    // Subsequent call should NOT return cached null — should try to load again and throw again
    let thrownAgain: unknown;
    try {
      channelEntryContract.loadBundledEntryExportSync(pathToFileURL(importerPath).href, {
        specifier: "./null-module.js",
      });
    } catch (err) {
      thrownAgain = err;
    }
    expect(thrownAgain).toBeInstanceOf(Error);
    expect((thrownAgain as Error).message).toContain("null/undefined");
    // Both calls should have invoked jiti — confirms no caching of bad value
    expect(createJiti).toHaveBeenCalled();
  });

  it("throws and does not cache when jiti returns broken proxy with null target", async () => {
    // Create a proxy with null target - exactly the failure mode from #62844
    const brokenProxy = new Proxy(
      {},
      {
        get(_target, prop) {
          // Simulate the exact error: accessing a property throws because target is null
          throw new TypeError("Cannot read properties of undefined (reading 't')");
        },
      },
    );
    const createJiti = vi.fn(() => vi.fn(() => brokenProxy));
    vi.doMock("jiti", () => ({
      createJiti,
    }));

    const channelEntryContract = await importFreshModule<
      typeof import("./channel-entry-contract.js")
    >(import.meta.url, "./channel-entry-contract.js?scope=broken-proxy");

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-channel-entry-contract-"));
    tempDirs.push(tempRoot);

    const pluginRoot = path.join(tempRoot, "dist", "extensions", "telegram");
    fs.mkdirSync(pluginRoot, { recursive: true });

    const importerPath = path.join(pluginRoot, "index.js");
    fs.writeFileSync(importerPath, "export default {};\n", "utf8");

    const brokenModulePath = path.join(pluginRoot, "broken-module.js");
    fs.writeFileSync(brokenModulePath, "export default {};\n", "utf8");


    // First call should throw due to broken proxy validation
    let thrown: unknown;
    try {
      channelEntryContract.loadBundledEntryExportSync(pathToFileURL(importerPath).href, {
        specifier: "./broken-module.js",
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("inaccessible proxy");


    // Subsequent call should NOT return cached bad proxy — should try to load again and throw again
    let thrownAgain: unknown;
    try {
      channelEntryContract.loadBundledEntryExportSync(pathToFileURL(importerPath).href, {
        specifier: "./broken-module.js",
      });
    } catch (err) {
      thrownAgain = err;
    }
    expect(thrownAgain).toBeInstanceOf(Error);
    expect((thrownAgain as Error).message).toContain("inaccessible proxy");
    // Both calls should have invoked jiti — confirms no caching of bad proxy
    expect(createJiti).toHaveBeenCalled();
  });
});
