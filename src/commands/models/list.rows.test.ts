import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../agents/model-suppression.js", () => ({
  shouldSuppressBuiltInModel: () => false,
}));

let appendDiscoveredRows: typeof import("./list.rows.js").appendDiscoveredRows;

beforeAll(async () => {
  ({ appendDiscoveredRows } = await import("./list.rows.js"));
});

type StubModel = {
  provider: string;
  id: string;
  name: string;
  input: string[];
  baseUrl?: string;
  api?: string;
  contextWindow?: number;
};

function model(provider: string, id: string): StubModel {
  return { provider, id, name: `${provider}/${id}`, input: ["text"], api: "openai" };
}

function buildContext() {
  return {
    cfg: { models: { providers: {} } },
    authStore: { version: 1, profiles: {}, order: {} },
    configuredByKey: new Map(),
    discoveredKeys: new Set<string>(),
    filter: {},
  };
}

describe("appendDiscoveredRows sort behavior", () => {
  it("sorts by provider then id by default", () => {
    const rows: Array<{ key: string }> = [];
    const models = [
      model("zulu", "m2"),
      model("alpha", "b"),
      model("alpha", "a"),
      model("mike", "x"),
    ];
    appendDiscoveredRows({
      rows: rows as never,
      models: models as never,
      context: buildContext() as never,
    });
    expect(rows.map((r) => r.key)).toEqual(["alpha/a", "alpha/b", "mike/x", "zulu/m2"]);
  });

  it("preserves input order when sortByName is false", () => {
    const rows: Array<{ key: string }> = [];
    const models = [
      model("deepinfra", "curated-top"),
      model("deepinfra", "another"),
      model("deepinfra", "aardvark-last"),
    ];
    appendDiscoveredRows({
      rows: rows as never,
      models: models as never,
      context: buildContext() as never,
      sortByName: false,
    });
    expect(rows.map((r) => r.key)).toEqual([
      "deepinfra/curated-top",
      "deepinfra/another",
      "deepinfra/aardvark-last",
    ]);
  });

  it("sorts when sortByName is true", () => {
    const rows: Array<{ key: string }> = [];
    const models = [model("deepinfra", "c"), model("deepinfra", "a"), model("deepinfra", "b")];
    appendDiscoveredRows({
      rows: rows as never,
      models: models as never,
      context: buildContext() as never,
      sortByName: true,
    });
    expect(rows.map((r) => r.key)).toEqual(["deepinfra/a", "deepinfra/b", "deepinfra/c"]);
  });

  it("preserves discovery order per-provider while still sorting other providers", () => {
    const rows: Array<{ key: string }> = [];
    const models = [
      model("deepinfra", "z-curated-first"),
      model("deepinfra", "a-second"),
      model("deepinfra", "m-third"),
      model("openai", "gpt-5.4-pro"),
      model("openai", "gpt-5.4"),
    ];
    appendDiscoveredRows({
      rows: rows as never,
      models: models as never,
      context: buildContext() as never,
      preserveDiscoveryOrderProviders: new Set(["deepinfra"]),
    });
    expect(rows.map((r) => r.key)).toEqual([
      "deepinfra/z-curated-first",
      "deepinfra/a-second",
      "deepinfra/m-third",
      "openai/gpt-5.4",
      "openai/gpt-5.4-pro",
    ]);
  });
});
