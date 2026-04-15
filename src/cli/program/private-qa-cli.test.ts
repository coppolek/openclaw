import { describe, expect, it } from "vitest";
import {
  buildPrivateQaCliModuleSpecifiers,
  isMissingPrivateQaCliModuleSpecifierError,
} from "./private-qa-cli.js";

describe("private qa cli loader", () => {
  it("prefers dist-local plugin-sdk artifacts after bundling", () => {
    expect(buildPrivateQaCliModuleSpecifiers("file:///repo/dist/subcli-descriptors.js")).toEqual([
      "file:///repo/dist/plugin-sdk/qa-lab.js",
      "file:///plugin-sdk/qa-lab.js",
    ]);
  });

  it("keeps a source-tree fallback for tests and tsx execution", () => {
    expect(
      buildPrivateQaCliModuleSpecifiers("file:///repo/src/cli/program/private-qa-cli.ts"),
    ).toEqual([
      "file:///repo/src/cli/program/plugin-sdk/qa-lab.js",
      "file:///repo/src/plugin-sdk/qa-lab.js",
    ]);
  });

  it("only falls back when the requested facade artifact is missing", () => {
    const missingFacade = Object.assign(
      new Error("Cannot find module '/repo/dist/plugin-sdk/qa-lab.js' imported from /repo/dist"),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    const missingNestedDependency = Object.assign(
      new Error(
        "Cannot find package 'nested-dependency' imported from /repo/dist/plugin-sdk/qa-lab.js",
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    expect(
      isMissingPrivateQaCliModuleSpecifierError(
        missingFacade,
        "file:///repo/dist/plugin-sdk/qa-lab.js",
      ),
    ).toBe(true);
    expect(
      isMissingPrivateQaCliModuleSpecifierError(
        missingNestedDependency,
        "file:///repo/dist/plugin-sdk/qa-lab.js",
      ),
    ).toBe(false);
  });
});
