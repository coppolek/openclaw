import { describe, expect, it } from "vitest";
import { buildPrivateQaCliModuleSpecifiers } from "./private-qa-cli.js";

describe("private qa cli loader", () => {
  it("prefers dist-local plugin-sdk artifacts from bundled root modules", () => {
    expect(buildPrivateQaCliModuleSpecifiers("file:///repo/dist/subcli-descriptors.js")).toEqual([
      "file:///repo/dist/plugin-sdk/qa-lab.js",
    ]);
  });

  it("resolves dist artifacts from built cli program modules", () => {
    expect(
      buildPrivateQaCliModuleSpecifiers("file:///repo/dist/cli/program/private-qa-cli.js"),
    ).toEqual(["file:///repo/dist/plugin-sdk/qa-lab.js"]);
  });

  it("resolves source-tree artifacts for tests and tsx execution", () => {
    expect(
      buildPrivateQaCliModuleSpecifiers("file:///repo/src/cli/program/private-qa-cli.ts"),
    ).toEqual(["file:///repo/src/plugin-sdk/qa-lab.js"]);
  });
});
