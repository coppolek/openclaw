import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const watchMock = vi.fn(() => ({
  on: vi.fn(),
  close: vi.fn(async () => undefined),
}));

let refreshModule: typeof import("./refresh.js");
let previousPollingEnv: string | undefined;
let previousPollingIntervalEnv: string | undefined;

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
    watchMock.mockClear();
    previousPollingEnv = process.env.OPENCLAW_SKILLS_WATCH_POLLING;
    previousPollingIntervalEnv = process.env.OPENCLAW_SKILLS_WATCH_POLL_INTERVAL_MS;
    delete process.env.OPENCLAW_SKILLS_WATCH_POLLING;
    delete process.env.OPENCLAW_SKILLS_WATCH_POLL_INTERVAL_MS;
  });

  afterEach(async () => {
    if (previousPollingEnv === undefined) {
      delete process.env.OPENCLAW_SKILLS_WATCH_POLLING;
    } else {
      process.env.OPENCLAW_SKILLS_WATCH_POLLING = previousPollingEnv;
    }
    if (previousPollingIntervalEnv === undefined) {
      delete process.env.OPENCLAW_SKILLS_WATCH_POLL_INTERVAL_MS;
    } else {
      process.env.OPENCLAW_SKILLS_WATCH_POLL_INTERVAL_MS = previousPollingIntervalEnv;
    }
    await refreshModule.resetSkillsRefreshForTest();
  });

  it("ignores node_modules, dist, .git, and Python venvs by default", async () => {
    refreshModule.ensureSkillsWatcher({ workspaceDir: "/tmp/workspace" });

    expect(watchMock).toHaveBeenCalledTimes(1);
    const firstCall = (
      watchMock.mock.calls as unknown as Array<[string[], { ignored?: unknown }]>
    )[0];
    const targets = firstCall?.[0] ?? [];
    const opts = firstCall?.[1] ?? {};

    expect(opts.ignored).toBe(refreshModule.DEFAULT_SKILLS_WATCH_IGNORED);
    const posix = (p: string) => p.replaceAll("\\", "/");
    expect(targets).toEqual(
      expect.arrayContaining([
        posix(path.join("/tmp/workspace", "skills", "SKILL.md")),
        posix(path.join("/tmp/workspace", "skills", "*", "SKILL.md")),
        posix(path.join("/tmp/workspace", ".agents", "skills", "SKILL.md")),
        posix(path.join("/tmp/workspace", ".agents", "skills", "*", "SKILL.md")),
        posix(path.join(os.homedir(), ".agents", "skills", "SKILL.md")),
        posix(path.join(os.homedir(), ".agents", "skills", "*", "SKILL.md")),
      ]),
    );
    expect(targets.every((target) => target.includes("SKILL.md"))).toBe(true);
    const ignored = refreshModule.DEFAULT_SKILLS_WATCH_IGNORED;

    // Node/JS paths
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/node_modules/pkg/index.js"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/dist/index.js"))).toBe(true);
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/.git/config"))).toBe(true);

    // Python virtual environments and caches
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/scripts/.venv/bin/python"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/venv/lib/python3.10/site.py"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/__pycache__/module.pyc"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/.mypy_cache/3.10/foo.json"))).toBe(
      true,
    );
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/.pytest_cache/v/cache"))).toBe(true);

    // Build artifacts and caches
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/build/output.js"))).toBe(true);
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/.cache/data.json"))).toBe(true);

    // Should NOT ignore normal skill files
    expect(ignored.some((re) => re.test("/tmp/.hidden/skills/index.md"))).toBe(false);
    expect(ignored.some((re) => re.test("/tmp/workspace/skills/my-skill/SKILL.md"))).toBe(false);
  });

  it("enables chokidar polling when requested by env", async () => {
    process.env.OPENCLAW_SKILLS_WATCH_POLLING = "1";
    process.env.OPENCLAW_SKILLS_WATCH_POLL_INTERVAL_MS = "1200";

    refreshModule.ensureSkillsWatcher({ workspaceDir: "/tmp/workspace" });

    const firstCall = (
      watchMock.mock.calls as unknown as Array<
        [
          string[],
          {
            usePolling?: boolean;
            interval?: number;
          },
        ]
      >
    )[0];
    const opts = firstCall?.[1] ?? {};

    expect(opts.usePolling).toBe(true);
    expect(opts.interval).toBe(1200);
  });

  it("ignores invalid polling interval env values", async () => {
    process.env.OPENCLAW_SKILLS_WATCH_POLLING = "1";
    process.env.OPENCLAW_SKILLS_WATCH_POLL_INTERVAL_MS = "not-a-number";

    refreshModule.ensureSkillsWatcher({ workspaceDir: "/tmp/workspace" });

    const firstCall = (
      watchMock.mock.calls as unknown as Array<
        [
          string[],
          {
            usePolling?: boolean;
            interval?: number;
          },
        ]
      >
    )[0];
    const opts = firstCall?.[1] ?? {};

    expect(opts.usePolling).toBe(true);
    expect(opts.interval).toBeUndefined();
  });

  it("recreates the watcher when polling settings change", async () => {
    refreshModule.ensureSkillsWatcher({ workspaceDir: "/tmp/workspace" });
    expect(watchMock).toHaveBeenCalledTimes(1);

    process.env.OPENCLAW_SKILLS_WATCH_POLLING = "1";
    process.env.OPENCLAW_SKILLS_WATCH_POLL_INTERVAL_MS = "1200";

    refreshModule.ensureSkillsWatcher({ workspaceDir: "/tmp/workspace" });

    expect(watchMock).toHaveBeenCalledTimes(2);
    const secondCall = (
      watchMock.mock.calls as unknown as Array<
        [
          string[],
          {
            usePolling?: boolean;
            interval?: number;
          },
        ]
      >
    )[1];
    const opts = secondCall?.[1] ?? {};

    expect(opts.usePolling).toBe(true);
    expect(opts.interval).toBe(1200);
  });
});
