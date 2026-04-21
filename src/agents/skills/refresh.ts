import os from "node:os";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { resolvePluginSkillDirs } from "./plugin-skills.js";
import {
  type SkillsChangeEvent,
  bumpSkillsSnapshotVersion,
  getSkillsSnapshotVersion,
  registerSkillsChangeListener,
  resetSkillsRefreshStateForTest,
  setSkillsChangeListenerErrorHandler,
  shouldRefreshSnapshotForVersion,
} from "./refresh-state.js";

export {
  bumpSkillsSnapshotVersion,
  getSkillsSnapshotVersion,
  registerSkillsChangeListener,
  shouldRefreshSnapshotForVersion,
  type SkillsChangeEvent,
} from "./refresh-state.js";

type SkillsWatchState = {
  watcher: FSWatcher;
  pathsKey: string;
  debounceMs: number;
  timer?: ReturnType<typeof setTimeout>;
  pendingPath?: string;
};

type WatchPathStats = {
  isDirectory?: () => boolean;
};

const log = createSubsystemLogger("gateway/skills");
const watchers = new Map<string, SkillsWatchState>();

setSkillsChangeListenerErrorHandler((err) => {
  log.warn(`skills change listener failed: ${String(err)}`);
});

export const DEFAULT_SKILLS_WATCH_IGNORED: RegExp[] = [
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])dist([\\/]|$)/,
  // Python virtual environments and caches
  /(^|[\\/])\.venv([\\/]|$)/,
  /(^|[\\/])venv([\\/]|$)/,
  /(^|[\\/])__pycache__([\\/]|$)/,
  /(^|[\\/])\.mypy_cache([\\/]|$)/,
  /(^|[\\/])\.pytest_cache([\\/]|$)/,
  // Build artifacts and caches
  /(^|[\\/])build([\\/]|$)/,
  /(^|[\\/])\.cache([\\/]|$)/,
];

function resolveWatchPaths(workspaceDir: string, config?: OpenClawConfig): string[] {
  const paths: string[] = [];
  if (workspaceDir.trim()) {
    paths.push(path.join(workspaceDir, "skills"));
    paths.push(path.join(workspaceDir, ".agents", "skills"));
  }
  paths.push(path.join(CONFIG_DIR, "skills"));
  paths.push(path.join(os.homedir(), ".agents", "skills"));
  const extraDirsRaw = config?.skills?.load?.extraDirs ?? [];
  const extraDirs = extraDirsRaw
    .map((d) => normalizeOptionalString(d) ?? "")
    .filter(Boolean)
    .map((dir) => resolveUserPath(dir));
  paths.push(...extraDirs);
  const pluginSkillDirs = resolvePluginSkillDirs({ workspaceDir, config });
  paths.push(...pluginSkillDirs);
  return paths;
}

function resolveWatchRoots(workspaceDir: string, config?: OpenClawConfig): string[] {
  return Array.from(
    new Set(resolveWatchPaths(workspaceDir, config).map((root) => path.resolve(root))),
  ).toSorted();
}

function resolveRelativeWatchPath(candidatePath: string, watchRoots: string[]): string | null {
  const resolvedCandidate = path.resolve(candidatePath);
  for (const watchRoot of watchRoots) {
    const relative = path.relative(watchRoot, resolvedCandidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      continue;
    }
    return relative.replaceAll("\\", "/");
  }
  return null;
}

function isWatchedSkillFilePath(candidatePath: string, watchRoots: string[]): boolean {
  const relative = resolveRelativeWatchPath(candidatePath, watchRoots);
  if (relative === null) {
    return false;
  }
  const segments = relative.split("/").filter(Boolean);
  return (
    path.basename(candidatePath) === "SKILL.md" &&
    (segments.length === 1 || (segments.length === 2 && segments[1] === "SKILL.md"))
  );
}

function shouldIgnoreSkillsWatchPath(
  candidatePath: string,
  watchRoots: string[],
  stats?: WatchPathStats,
): boolean {
  if (DEFAULT_SKILLS_WATCH_IGNORED.some((pattern) => pattern.test(candidatePath))) {
    return true;
  }

  const relative = resolveRelativeWatchPath(candidatePath, watchRoots);
  if (relative === null || !relative) {
    return false;
  }

  const segments = relative.split("/").filter(Boolean);
  if (segments.length === 1) {
    if (segments[0] === "SKILL.md") {
      return false;
    }
    return stats !== undefined && stats.isDirectory?.() !== true;
  }
  if (segments.length === 2 && segments[1] === "SKILL.md") {
    return false;
  }
  return true;
}

export function ensureSkillsWatcher(params: { workspaceDir: string; config?: OpenClawConfig }) {
  const workspaceDir = params.workspaceDir.trim();
  if (!workspaceDir) {
    return;
  }
  const watchEnabled = params.config?.skills?.load?.watch !== false;
  const debounceMsRaw = params.config?.skills?.load?.watchDebounceMs;
  const debounceMs =
    typeof debounceMsRaw === "number" && Number.isFinite(debounceMsRaw)
      ? Math.max(0, debounceMsRaw)
      : 250;

  const existing = watchers.get(workspaceDir);
  if (!watchEnabled) {
    if (existing) {
      watchers.delete(workspaceDir);
      if (existing.timer) {
        clearTimeout(existing.timer);
      }
      void existing.watcher.close().catch(() => {});
    }
    return;
  }

  const watchRoots = resolveWatchRoots(workspaceDir, params.config);
  const pathsKey = watchRoots.join("|");
  if (existing && existing.pathsKey === pathsKey && existing.debounceMs === debounceMs) {
    return;
  }
  if (existing) {
    watchers.delete(workspaceDir);
    if (existing.timer) {
      clearTimeout(existing.timer);
    }
    void existing.watcher.close().catch(() => {});
  }

  const watcher = chokidar.watch(watchRoots, {
    ignoreInitial: true,
    depth: 1,
    awaitWriteFinish: {
      stabilityThreshold: debounceMs,
      pollInterval: 100,
    },
    // Chokidar v4 no longer expands globs. Watch roots directly and constrain
    // traversal so only SKILL.md files at the supported depths can trigger.
    ignored: (candidatePath, stats) =>
      shouldIgnoreSkillsWatchPath(candidatePath, watchRoots, stats),
  });

  const state: SkillsWatchState = { watcher, pathsKey, debounceMs };

  const schedule = (changedPath?: string) => {
    if (changedPath && !isWatchedSkillFilePath(changedPath, watchRoots)) {
      return;
    }
    state.pendingPath = changedPath ?? state.pendingPath;
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = setTimeout(() => {
      const pendingPath = state.pendingPath;
      state.pendingPath = undefined;
      state.timer = undefined;
      bumpSkillsSnapshotVersion({
        workspaceDir,
        reason: "watch",
        changedPath: pendingPath,
      });
    }, debounceMs);
  };

  watcher.on("add", (p) => schedule(p));
  watcher.on("change", (p) => schedule(p));
  watcher.on("unlink", (p) => schedule(p));
  watcher.on("error", (err) => {
    log.warn(`skills watcher error (${workspaceDir}): ${String(err)}`);
  });

  watchers.set(workspaceDir, state);
}

export async function resetSkillsRefreshForTest(): Promise<void> {
  resetSkillsRefreshStateForTest();

  const active = Array.from(watchers.values());
  watchers.clear();
  await Promise.all(
    active.map(async (state) => {
      if (state.timer) {
        clearTimeout(state.timer);
      }
      try {
        await state.watcher.close();
      } catch {
        // Best-effort test cleanup.
      }
    }),
  );
}
