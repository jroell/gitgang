import { describe, test, expect, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import {
  reviewerSpawnConfig,
  MODELS,
} from "./cli";

describe("Reviewer spawn config by agent", () => {
  const tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = join(tmpdir(), `gitgang-reviewer-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tmpDirs) {
      if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  test("codex reviewer config uses codex command with exec", () => {
    const dir = makeTmpDir();
    const config = reviewerSpawnConfig(
      dir,
      "main",
      { gemini: "g-branch", claude: "c-branch" },
      "Test task",
      true,
      "all good",
      undefined,
      ["gemini", "claude"],
      "codex",
    );

    expect(config.command).toBe("codex");
    expect(config.args[0]).toBe("exec");
    expect(config.args).toContain("--model");
    expect(config.args).toContain(MODELS.codex);
  });

  test("claude reviewer config uses bash piping", () => {
    const dir = makeTmpDir();
    const config = reviewerSpawnConfig(
      dir,
      "main",
      { gemini: "g-branch" },
      "Test task",
      true,
      "ok",
      undefined,
      ["gemini"],
      "claude",
    );

    expect(config.command).toBe("bash");
    expect(config.args[0]).toBe("-c");
    expect(config.args[1]).toContain("claude");
    expect(config.args[1]).toContain("--print");
    expect(config.args[1]).toContain(MODELS.claude);

    // Prompt file should have been created
    const promptFile = join(dir, ".ai-worktrees", "reviewer-prompt.txt");
    expect(existsSync(promptFile)).toBe(true);
  });

  test("gemini reviewer config uses bash piping", () => {
    const dir = makeTmpDir();
    const config = reviewerSpawnConfig(
      dir,
      "main",
      { codex: "x-branch" },
      "Test task",
      false,
      "summary",
      undefined,
      ["codex"],
      "gemini",
    );

    expect(config.command).toBe("bash");
    expect(config.args[0]).toBe("-c");
    expect(config.args[1]).toContain("gemini");
    expect(config.args[1]).toContain(MODELS.gemini);

    // Prompt file should have been created
    const promptFile = join(dir, ".ai-worktrees", "reviewer-prompt.txt");
    expect(existsSync(promptFile)).toBe(true);
  });

  test("claude reviewer includes --dangerously-skip-permissions when yolo", () => {
    const dir = makeTmpDir();
    const config = reviewerSpawnConfig(
      dir, "main", { gemini: "g" }, "task", true, undefined, undefined, ["gemini"], "claude",
    );
    expect(config.args[1]).toContain("--dangerously-skip-permissions");
  });

  test("claude reviewer omits --dangerously-skip-permissions when not yolo", () => {
    const dir = makeTmpDir();
    const config = reviewerSpawnConfig(
      dir, "main", { gemini: "g" }, "task", false, undefined, undefined, ["gemini"], "claude",
    );
    expect(config.args[1]).not.toContain("--dangerously-skip-permissions");
  });

  test("gemini reviewer includes --yolo when yolo", () => {
    const dir = makeTmpDir();
    const config = reviewerSpawnConfig(
      dir, "main", { gemini: "g" }, "task", true, undefined, undefined, ["gemini"], "gemini",
    );
    expect(config.args[1]).toContain("--yolo");
  });

  test("defaults to codex when no reviewer agent specified", () => {
    const dir = makeTmpDir();
    const config = reviewerSpawnConfig(
      dir, "main", { gemini: "g" }, "task", true,
    );
    expect(config.command).toBe("codex");
  });
});
