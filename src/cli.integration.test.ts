import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawn } from "bun";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  applyMergePlan,
  reviewerSpawnConfig,
  type Opts,
  type ReviewerDecision,
} from "./cli";

type GitArgs = [string, ...string[]];

async function runGit(cwd: string, ...args: string[]) {
  const proc = spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`);
  }
  return stdout.trim();
}

describe("applyMergePlan integration", () => {
  let repo: string;

  beforeEach(async () => {
    repo = join(tmpdir(), `gitgang-merge-${randomUUID()}`);
    mkdirSync(repo, { recursive: true });
    await runGit(repo, "init");
    await runGit(repo, "config", "user.name", "Test User");
    await runGit(repo, "config", "user.email", "test@example.com");
    writeFileSync(join(repo, "README.md"), "# Base\n");
    await runGit(repo, "add", ".");
    await runGit(repo, "commit", "-m", "initial");
    await runGit(repo, "branch", "-M", "main");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  function makeOpts(): Opts {
    return {
      task: "Test",
      repoRoot: repo,
      baseBranch: "main",
      workRoot: ".ai-worktrees",
      rounds: 1,
      timeoutMs: 1_000,
      yolo: true,
      autoPR: false,
    };
  }

  async function createAgentBranch(name: string, file: string, contents: string) {
    const branch = `agents/${name}/demo`;
    await runGit(repo, "checkout", "-b", branch, "main");
    writeFileSync(join(repo, file), contents);
    await runGit(repo, "add", file);
    await runGit(repo, "commit", "-m", `${name} change`);
    await runGit(repo, "checkout", "main");
    return branch;
  }

  test("merges agent branches and runs checks", async () => {
    const geminiBranch = await createAgentBranch("gemini", "g.txt", "gemini");
    const claudeBranch = await createAgentBranch("claude", "c.txt", "claude");
    const codexBranch = await createAgentBranch("codex", "x.txt", "codex");

    const opts = makeOpts();
    const decision: ReviewerDecision = {
      status: "approve",
      mergePlan: {
        order: [geminiBranch, claudeBranch, codexBranch],
        postMergeChecks: ["git status --short"],
      },
    };

    const result = await applyMergePlan(opts, {
      gemini: { agent: "gemini", branch: geminiBranch, dir: "", log: "" },
      claude: { agent: "claude", branch: claudeBranch, dir: "", log: "" },
      codex: { agent: "codex", branch: codexBranch, dir: "", log: "" },
    }, decision);

    expect(result.ok).toBe(true);
    expect(result.branch).toMatch(/^ai-merge-/);
    const current = await runGit(repo, "rev-parse", "--abbrev-ref", "HEAD");
    expect(current).toBe(result.branch);
  });

  test("returns failure details when merge conflicts", async () => {
    const file = "shared.txt";
    const basePath = join(repo, file);
    writeFileSync(basePath, "base\n");
    await runGit(repo, "add", file);
    await runGit(repo, "commit", "-m", "base shared file");

    const geminiBranch = await createAgentBranch("gemini", file, "gemini\n");
    const claudeBranch = await createAgentBranch("claude", file, "claude\n");
    const codexBranch = await createAgentBranch("codex", "neutral.txt", "ok\n");

    const opts = makeOpts();
    const decision: ReviewerDecision = {
      status: "approve",
      mergePlan: {
        order: [geminiBranch, claudeBranch, codexBranch],
        postMergeChecks: ["git status --short"],
      },
    };

    const result = await applyMergePlan(opts, {
      gemini: { agent: "gemini", branch: geminiBranch, dir: "", log: "" },
      claude: { agent: "claude", branch: claudeBranch, dir: "", log: "" },
      codex: { agent: "codex", branch: codexBranch, dir: "", log: "" },
    }, decision);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Merge conflict");
  });
});

describe("reviewer spawn config", () => {
  const branches = {
    gemini: "agents/gemini/demo",
    claude: "agents/claude/demo",
    codex: "agents/codex/demo",
  };

  test("requests its own stdin pipe for the reviewer", () => {
    const config = reviewerSpawnConfig("/tmp/repo", "main", branches, "Test task", true);
    expect(config.options.stdin).toBe("pipe");
    expect(config.options.cwd).toBe("/tmp/repo");
    expect(config.args).toContain("--yolo");
  });

  test("falls back to full-auto when not yolo", () => {
    const config = reviewerSpawnConfig("/tmp/repo", "main", branches, "Test task", false);
    expect(config.args).toContain("--full-auto");
  });
});
