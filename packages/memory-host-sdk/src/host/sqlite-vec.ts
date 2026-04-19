import type { DatabaseSync } from "node:sqlite";
import { formatErrorMessage } from "../../../../src/infra/errors.js";
import { normalizeOptionalString } from "../../../../src/shared/string-coerce.js";

type SqliteVecModule = {
  getLoadablePath: () => string;
  load: (db: DatabaseSync) => void;
};

const SQLITE_VEC_MODULE_ID = "sqlite-vec";

async function loadSqliteVecModule(): Promise<SqliteVecModule> {
  return import(SQLITE_VEC_MODULE_ID) as Promise<SqliteVecModule>;
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
          params.db.loadExtension(extensionPath.slice(0, -4));
        } else {
          throw firstErr;
        }
      }
    }

    return { ok: true, extensionPath };
  } catch (err) {
    const message = formatErrorMessage(err);
    return { ok: false, error: message };
  }
}
