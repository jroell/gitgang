import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  normalizeParsedArgs,
  buildStatusSummary,
  runPostMergeCheckWithRetries,
} from "./cli";

type GitArgs = [string, ...string[]];

async function runGit(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout || "").trim();
}

describe("Parsed args normalization", () => {
  test("clamps rounds/timeouts/workRoot", () => {
    const result = normalizeParsedArgs({
      task: "test",
      rounds: -5,
      yolo: true,
      workRoot: "   ",
      timeoutMs: 10_000,
      autoPR: true,
    });
    expect(result.rounds).toBe(1);
    expect(result.workRoot).toBe(".ai-worktrees");
    expect(result.timeoutMs).toBe(60_000);
  });

  test("caps rounds and timeoutMs at limits", () => {
    const result = normalizeParsedArgs({
      task: "test",
      rounds: 100,
      yolo: false,
      workRoot: "custom",
      timeoutMs: 120 * 60 * 1000,
      autoPR: false,
    });
    expect(result.rounds).toBe(10);
    expect(result.timeoutMs).toBe(60 * 60 * 1000);
    expect(result.workRoot).toBe("custom");
  });
});

describe("Status summary helper", () => {
  test("buildStatusSummary strips ANSI and includes errors", () => {
    const agents = {
      codex: {
        getSummary: () => "\x1b[32mrunning\x1b[0m",
        getLastError: () => "fatal error",
      },
      gemini: {
        getSummary: () => "idle",
        getLastError: () => undefined,
      },
      claude: {
        getSummary: () => "completed",
        getLastError: () => undefined,
      },
    };
    const summary = buildStatusSummary(agents);
    expect(summary).toContain("codex: running (fatal error)");
    expect(summary).toContain("gemini: idle");
    expect(summary).toContain("claude: completed");
  });
});

describe("Post merge check retries", () => {
  let repo: string;

  beforeEach(async () => {
    repo = join(tmpdir(), `gitgang-utils-${randomUUID()}`);
    mkdirSync(repo, { recursive: true });
    await runGit(repo, "init");
    await runGit(repo, "config", "user.name", "Tester");
    await runGit(repo, "config", "user.email", "test@example.com");
    writeFileSync(join(repo, "README.md"), "# hi\n");
    await runGit(repo, "add", ".");
    await runGit(repo, "commit", "-m", "init");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test("succeeds when the command passes", async () => {
    const exitCode = await runPostMergeCheckWithRetries("git status --short", repo);
    expect(exitCode).toBe(0);
  });

  test("returns the final exit code when command fails", async () => {
    const exitCode = await runPostMergeCheckWithRetries("false", repo);
    expect(exitCode).toBe(1);
  });
});
