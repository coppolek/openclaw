import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const watcherInstances = vi.hoisted(
  () =>
    [] as Array<{
      on: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      handlers: Map<string, (changedPath: string) => void>;
    }>,
);

const watchMock = vi.hoisted(() =>
  vi.fn(() => {
    const handlers = new Map<string, (changedPath: string) => void>();
    const instance = {
      on: vi.fn((event: string, handler: (changedPath: string) => void) => {
        handlers.set(event, handler);
        return instance;
      }),
      close: vi.fn(async () => undefined),
      handlers,
    };
    watcherInstances.push(instance);
    return instance;
  }),
);

let refreshModule: typeof import("./refresh.js");

vi.mock("chokidar", () => ({
  default: { watch: watchMock },
}));

vi.mock("./plugin-skills.js", () => ({
  resolvePluginSkillDirs: vi.fn(() => []),
}));

describe("ensureSkillsWatcher", () => {
  beforeAll(async () => {
    refreshModule = await import("./refresh.js");
  });

  beforeEach(() => {
    vi.useRealTimers();
    watchMock.mockClear();
    watcherInstances.length = 0;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await refreshModule.resetSkillsRefreshForTest();
  });

  it("watches skill roots directly and ignores unrelated files by default", async () => {
    refreshModule.ensureSkillsWatcher({ workspaceDir: "/tmp/workspace" });

    expect(watchMock).toHaveBeenCalledTimes(1);
    const firstCall = (
      watchMock.mock.calls as unknown as Array<
        [
          string[],
          {
            depth?: number;
            ignored?:
              | ((candidatePath: string, stats?: { isDirectory?: () => boolean }) => boolean)
              | unknown;
          },
        ]
      >
    )[0];
    const targets = firstCall?.[0] ?? [];
    const opts = firstCall?.[1] ?? {};

    const posix = (p: string) => p.replaceAll("\\", "/");
    expect(targets).toEqual(
      expect.arrayContaining([
        posix(path.join("/tmp/workspace", "skills")),
        posix(path.join("/tmp/workspace", ".agents", "skills")),
        posix(path.join(os.homedir(), ".agents", "skills")),
      ]),
    );
    expect(targets.every((target) => !target.includes("*"))).toBe(true);
    expect(opts.depth).toBe(1);
    expect(typeof opts.ignored).toBe("function");

    const ignored = opts.ignored as (
      candidatePath: string,
      stats?: { isDirectory?: () => boolean },
    ) => boolean;
    const dirStats = { isDirectory: () => true };
    const fileStats = { isDirectory: () => false };

    // Node/JS paths
    expect(ignored("/tmp/workspace/skills/node_modules/pkg/index.js", fileStats)).toBe(true);
    expect(ignored("/tmp/workspace/skills/dist/index.js", fileStats)).toBe(true);
    expect(ignored("/tmp/workspace/skills/.git/config", fileStats)).toBe(true);

    // Python virtual environments and caches
    expect(ignored("/tmp/workspace/skills/scripts/.venv/bin/python", fileStats)).toBe(true);
    expect(ignored("/tmp/workspace/skills/venv/lib/python3.10/site.py", fileStats)).toBe(true);
    expect(ignored("/tmp/workspace/skills/__pycache__/module.pyc", fileStats)).toBe(true);
    expect(ignored("/tmp/workspace/skills/.mypy_cache/3.10/foo.json", fileStats)).toBe(true);
    expect(ignored("/tmp/workspace/skills/.pytest_cache/v/cache", fileStats)).toBe(true);

    // Build artifacts and caches
    expect(ignored("/tmp/workspace/skills/build/output.js", fileStats)).toBe(true);
    expect(ignored("/tmp/workspace/skills/.cache/data.json", fileStats)).toBe(true);

    // Should NOT ignore supported skill paths, including newly created
    // directories before chokidar has resolved stats.
    expect(ignored("/tmp/workspace/skills", dirStats)).toBe(false);
    expect(ignored("/tmp/workspace/skills/my-skill", dirStats)).toBe(false);
    expect(ignored("/tmp/workspace/skills/my-skill")).toBe(false);
    expect(ignored("/tmp/workspace/skills/SKILL.md", fileStats)).toBe(false);
    expect(ignored("/tmp/workspace/skills/my-skill/SKILL.md", fileStats)).toBe(false);

    // Ignore unrelated files and deeper descendants under a skill directory.
    expect(ignored("/tmp/.hidden/skills/index.md", fileStats)).toBe(false);
    expect(ignored("/tmp/workspace/skills/README.md", fileStats)).toBe(true);
    expect(ignored("/tmp/workspace/skills/my-skill/notes.md", fileStats)).toBe(true);
    expect(ignored("/tmp/workspace/skills/my-skill/assets/icon.png", fileStats)).toBe(true);
  });

  it("bumps the snapshot only for supported skill file changes", async () => {
    vi.useFakeTimers();
    const events: Array<{ workspaceDir?: string; changedPath?: string }> = [];
    const unregister = refreshModule.registerSkillsChangeListener((event) => {
      events.push(event);
    });

    refreshModule.ensureSkillsWatcher({
      workspaceDir: "/tmp/workspace",
      config: {
        skills: {
          load: {
            watchDebounceMs: 25,
          },
        },
      },
    });

    const watcher = watcherInstances.at(-1);
    expect(watcher).toBeDefined();

    watcher?.handlers.get("add")?.("/tmp/workspace/skills/my-skill/SKILL.md");
    await vi.advanceTimersByTimeAsync(25);
    expect(events).toEqual([
      {
        workspaceDir: "/tmp/workspace",
        reason: "watch",
        changedPath: "/tmp/workspace/skills/my-skill/SKILL.md",
      },
    ]);

    watcher?.handlers.get("change")?.("/tmp/workspace/skills/another-skill/SKILL.md");
    await vi.advanceTimersByTimeAsync(25);
    expect(events).toEqual([
      {
        workspaceDir: "/tmp/workspace",
        reason: "watch",
        changedPath: "/tmp/workspace/skills/my-skill/SKILL.md",
      },
      {
        workspaceDir: "/tmp/workspace",
        reason: "watch",
        changedPath: "/tmp/workspace/skills/another-skill/SKILL.md",
      },
    ]);

    watcher?.handlers.get("unlink")?.("/tmp/workspace/skills/third-skill/SKILL.md");
    await vi.advanceTimersByTimeAsync(25);
    expect(events).toEqual([
      {
        workspaceDir: "/tmp/workspace",
        reason: "watch",
        changedPath: "/tmp/workspace/skills/my-skill/SKILL.md",
      },
      {
        workspaceDir: "/tmp/workspace",
        reason: "watch",
        changedPath: "/tmp/workspace/skills/another-skill/SKILL.md",
      },
      {
        workspaceDir: "/tmp/workspace",
        reason: "watch",
        changedPath: "/tmp/workspace/skills/third-skill/SKILL.md",
      },
    ]);

    watcher?.handlers.get("add")?.("/tmp/workspace/skills/my-skill/notes.md");
    watcher?.handlers.get("change")?.("/tmp/workspace/skills/my-skill/assets/icon.png");
    watcher?.handlers.get("unlink")?.("/tmp/workspace/skills/README.md");
    await vi.advanceTimersByTimeAsync(25);
    expect(events).toHaveLength(3);

    unregister();
  });
});
