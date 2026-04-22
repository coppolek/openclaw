import type { DatabaseSync } from "node:sqlite";
import { formatErrorMessage } from "../../infra/errors.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";

type SqliteVecModule = {
  getLoadablePath: () => string;
  load: (db: DatabaseSync) => void;
};

const SQLITE_VEC_MODULE_ID = "sqlite-vec";
let sqliteVecModulePromise: Promise<SqliteVecModule> | null = null;

async function loadSqliteVecModule(): Promise<SqliteVecModule> {
  sqliteVecModulePromise ??= import(SQLITE_VEC_MODULE_ID) as Promise<SqliteVecModule>;
  return sqliteVecModulePromise;
}

export async function loadSqliteVecExtension(params: {
  db: DatabaseSync;
  extensionPath?: string;
}): Promise<{ ok: boolean; extensionPath?: string; error?: string }> {
  try {
    const sqliteVec = await loadSqliteVecModule();
    const resolvedPath = normalizeOptionalString(params.extensionPath);
    const extensionPath = resolvedPath ?? sqliteVec.getLoadablePath();

    params.db.enableLoadExtension(true);
    // loadedPath tracks the effective path used so we can return it to callers.
    // Callers (e.g. manager-sync-ops) persist the returned extensionPath and
    // pass it back as params.extensionPath on subsequent loads, routing through
    // the resolvedPath branch. Returning the suffixless path here ensures that
    // branch also works on Windows environments that need the suffix stripped.
    let loadedPath = extensionPath;
    if (resolvedPath) {
      params.db.loadExtension(extensionPath);
    } else {
      try {
        sqliteVec.load(params.db);
      } catch (firstErr) {
        // On Windows, node:sqlite's loadExtension() may require the path
        // without the .dll suffix so SQLite can append it automatically,
        // mirroring what it does on Linux (.so) and macOS (.dylib).
        // If the bundled load() call fails and the resolved path ends with
        // .dll, retry by passing the path directly without the suffix.
        if (process.platform === "win32" && extensionPath.toLowerCase().endsWith(".dll")) {
          const suffixlessPath = extensionPath.slice(0, -4);
          try {
            params.db.loadExtension(suffixlessPath);
            loadedPath = suffixlessPath;
          } catch (retryErr) {
            const combined = new Error(
              `sqlite-vec: both load attempts failed on Windows. Retry error: ${formatErrorMessage(retryErr)}`,
              { cause: firstErr },
            );
            throw combined;
          }
        } else {
          throw firstErr;
        }
      }
    }

    return { ok: true, extensionPath: loadedPath };
  } catch (err) {
    const message = formatErrorMessage(err);
    return { ok: false, error: message };
  }
}
