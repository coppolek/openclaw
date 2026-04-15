export function isPrivateQaCliEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_ENABLE_PRIVATE_QA_CLI === "1";
}

function isCliProgramModule(importMetaUrl: string): boolean {
  try {
    return new URL(importMetaUrl).pathname.includes("/cli/program/");
  } catch {
    return false;
  }
}

export function buildPrivateQaCliModuleSpecifiers(importMetaUrl: string): string[] {
  const artifactPath = ["plugin-sdk/", "qa", "-lab.js"].join("");
  const relativePath = isCliProgramModule(importMetaUrl)
    ? `../../${artifactPath}`
    : `./${artifactPath}`;
  return [new URL(relativePath, importMetaUrl).href];
}

export function loadPrivateQaCliModule(): Promise<Record<string, unknown>> {
  const [specifier] = buildPrivateQaCliModuleSpecifiers(import.meta.url);
  return import(specifier) as Promise<Record<string, unknown>>;
}
