import { fileURLToPath } from "node:url";

export function isPrivateQaCliEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_ENABLE_PRIVATE_QA_CLI === "1";
}

export function buildPrivateQaCliModuleSpecifiers(importMetaUrl: string): string[] {
  const artifactPath = ["plugin-sdk/", "qa", "-lab.js"].join("");
  return [
    new URL(`./${artifactPath}`, importMetaUrl).href,
    new URL(`../../${artifactPath}`, importMetaUrl).href,
  ];
}

export function isMissingPrivateQaCliModuleSpecifierError(
  err: unknown,
  specifier: string,
): boolean {
  if (!(err instanceof Error) || (err as { code?: unknown }).code !== "ERR_MODULE_NOT_FOUND") {
    return false;
  }
  let specifierPath: string | undefined;
  try {
    specifierPath = fileURLToPath(specifier);
  } catch {
    specifierPath = undefined;
  }
  return (
    err.message.includes(`Cannot find module '${specifier}'`) ||
    err.message.includes(`Cannot find module "${specifier}"`) ||
    (!!specifierPath &&
      (err.message.includes(`Cannot find module '${specifierPath}'`) ||
        err.message.includes(`Cannot find module "${specifierPath}"`)))
  );
}

export function loadPrivateQaCliModule(): Promise<Record<string, unknown>> {
  const [builtSpecifier, sourceSpecifier] = buildPrivateQaCliModuleSpecifiers(import.meta.url);
  return (import(builtSpecifier) as Promise<Record<string, unknown>>).catch((err: unknown) => {
    if (
      !isMissingPrivateQaCliModuleSpecifierError(err, builtSpecifier) ||
      builtSpecifier === sourceSpecifier
    ) {
      throw err;
    }
    return import(sourceSpecifier) as Promise<Record<string, unknown>>;
  });
}
