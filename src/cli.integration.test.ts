import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  applyMergePlan,
  finalizeSoloRun,
  reviewerSpawnConfig,
  reviewerPromptJSON,
  collectDiffSummaries,
  type Opts,
  type ReviewerDecision,
} from "./cli";

type GitArgs = [string, ...string[]];

async function runGit(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout || "").trim();
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
      dryRun: false,
      activeAgents: ["gemini", "claude", "codex"],
      reviewerAgent: "codex",
      postMergeChecks: [],
      soloMode: false,
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

describe("finalizeSoloRun — solo-mode auto-merge exit path", () => {
  let repo: string;

  beforeEach(async () => {
    repo = join(tmpdir(), `gitgang-solo-${randomUUID()}`);
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

  function makeSoloOpts(): Opts {
    return {
      task: "Write hello",
      repoRoot: repo,
      baseBranch: "main",
      workRoot: ".ai-worktrees",
      rounds: 1,
      timeoutMs: 1_000,
      yolo: true,
      autoPR: false,
      dryRun: false,
      activeAgents: ["claude"],
      reviewerAgent: "claude",
      postMergeChecks: [],
      soloMode: true,
    };
  }

  test("returns approved + merge branch for a successful solo coder (exit 0 path)", async () => {
    // Simulate the coder's worktree: a branch with new commits diverged from main.
    const coderBranch = "agents/claude/solo";
    await runGit(repo, "checkout", "-b", coderBranch, "main");
    writeFileSync(join(repo, "hello.py"), "print('hi')\n");
    await runGit(repo, "add", "hello.py");
    await runGit(repo, "commit", "-m", "feat: add hello");
    await runGit(repo, "checkout", "main");

    const result = await finalizeSoloRun(makeSoloOpts(), {
      claude: { worktree: { agent: "claude", branch: coderBranch, dir: "", log: "" } },
    });

    expect(result.outcome).toBe("approved");
    expect(result.mergeBranch).toMatch(/^ai-merge-/);
    // The merge branch should now be checked out with the coder's file on it.
    const head = await runGit(repo, "rev-parse", "--abbrev-ref", "HEAD");
    expect(head).toBe(result.mergeBranch);
  });

  test("returns dnf with reason when the solo merge conflicts", async () => {
    // Put a conflicting change on main so the merge is unclean.
    writeFileSync(join(repo, "shared.txt"), "main version\n");
    await runGit(repo, "add", "shared.txt");
    await runGit(repo, "commit", "-m", "main shared");

    const coderBranch = "agents/claude/solo-conflict";
    await runGit(repo, "checkout", "-b", coderBranch, "HEAD~1");
    writeFileSync(join(repo, "shared.txt"), "coder version\n");
    await runGit(repo, "add", "shared.txt");
    await runGit(repo, "commit", "-m", "coder shared");
    await runGit(repo, "checkout", "main");

    const result = await finalizeSoloRun(makeSoloOpts(), {
      claude: { worktree: { agent: "claude", branch: coderBranch, dir: "", log: "" } },
    });

    expect(result.outcome).toBe("dnf");
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

  test("includes diff summaries in reviewer prompt when provided", () => {
    const diffSummaries = {
      gemini: "src/foo.ts | 20 +++++\n 1 file changed, 20 insertions(+)",
      claude: "src/bar.ts | 5 +\n 1 file changed, 5 insertions(+)",
      codex: "(no changes)",
    };
    const config = reviewerSpawnConfig(
      "/tmp/repo",
      "main",
      branches,
      "Add a widget",
      true,
      "- gemini: completed\n- claude: completed\n- codex: dnf",
      diffSummaries,
    );
    // The prompt is the first positional arg passed to codex exec
    const prompt = config.args[1];
    expect(prompt).toContain("Diff summaries vs main");
    expect(prompt).toContain("--- gemini ---");
    expect(prompt).toContain("src/foo.ts");
    expect(prompt).toContain("--- codex ---");
    expect(prompt).toContain("(no changes)");
  });

  test("reviewer prompt omits diff section when no summaries provided", () => {
    const config = reviewerSpawnConfig("/tmp/repo", "main", branches, "Add a widget", true);
    const prompt = config.args[1];
    expect(prompt).not.toContain("Diff summaries");
  });
});

describe("collectDiffSummaries integration", () => {
  let repo: string;

  beforeEach(async () => {
    repo = join(tmpdir(), `gitgang-diff-${randomUUID()}`);
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

  test("returns diff stat for a branch with changes", async () => {
    await runGit(repo, "checkout", "-b", "agents/gemini/test", "main");
    writeFileSync(join(repo, "feature.ts"), "export const x = 1;\n");
    await runGit(repo, "add", "feature.ts");
    await runGit(repo, "commit", "-m", "gemini adds feature");
    await runGit(repo, "checkout", "main");

    const summaries = await collectDiffSummaries(repo, "main", {
      gemini: "agents/gemini/test",
      claude: "agents/gemini/test",
      codex: "agents/gemini/test",
    });

    expect(summaries.gemini).toContain("feature.ts");
    expect(summaries.gemini).not.toBe("(no changes)");
  });

  test("reports no changes for a branch identical to base", async () => {
    await runGit(repo, "checkout", "-b", "agents/claude/empty", "main");
    await runGit(repo, "checkout", "main");

    const summaries = await collectDiffSummaries(repo, "main", {
      gemini: "agents/claude/empty",
      claude: "agents/claude/empty",
      codex: "agents/claude/empty",
    });

    expect(summaries.gemini).toBe("(no changes)");
  });

  test("handles missing branch gracefully", async () => {
    const summaries = await collectDiffSummaries(repo, "main", {
      gemini: undefined,
      claude: "agents/claude/nonexistent",
      codex: undefined,
    });

    expect(summaries.gemini).toBe("(branch not available)");
    expect(summaries.codex).toBe("(branch not available)");
    // nonexistent branch should return error message, not throw
    expect(typeof summaries.claude).toBe("string");
  });
});

describe("applyMergePlan with partial agents", () => {
  let repo: string;

  beforeEach(async () => {
    repo = join(tmpdir(), `gitgang-partial-${randomUUID()}`);
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

  async function createAgentBranch(name: string, file: string, contents: string) {
    const branch = `agents/${name}/partial`;
    await runGit(repo, "checkout", "-b", branch, "main");
    writeFileSync(join(repo, file), contents);
    await runGit(repo, "add", file);
    await runGit(repo, "commit", "-m", `${name} change`);
    await runGit(repo, "checkout", "main");
    return branch;
  }

  test("merges only specified subset of agents", async () => {
    const geminiBranch = await createAgentBranch("gemini", "g.txt", "gemini");
    const claudeBranch = await createAgentBranch("claude", "c.txt", "claude");

    const opts: Opts = {
      task: "Test",
      repoRoot: repo,
      baseBranch: "main",
      workRoot: ".ai-worktrees",
      rounds: 1,
      timeoutMs: 1_000,
      yolo: true,
      autoPR: false,
      dryRun: false,
      activeAgents: ["gemini", "claude"],
      reviewerAgent: "codex",
      postMergeChecks: [],
      soloMode: false,
    };

    const decision: ReviewerDecision = {
      status: "approve",
      mergePlan: {
        order: [geminiBranch, claudeBranch],
        postMergeChecks: [],
      },
    };

    const result = await applyMergePlan(opts, {
      gemini: { agent: "gemini", branch: geminiBranch, dir: "", log: "" },
      claude: { agent: "claude", branch: claudeBranch, dir: "", log: "" },
    }, decision);

    expect(result.ok).toBe(true);
    expect(result.branch).toMatch(/^ai-merge-/);
  });

  test("uses available branches for default order when no merge plan order", async () => {
    const geminiBranch = await createAgentBranch("gemini", "g.txt", "gemini only");

    const opts: Opts = {
      task: "Test",
      repoRoot: repo,
      baseBranch: "main",
      workRoot: ".ai-worktrees",
      rounds: 1,
      timeoutMs: 1_000,
      yolo: true,
      autoPR: false,
      dryRun: false,
      activeAgents: ["gemini"],
      reviewerAgent: "codex",
      postMergeChecks: [],
      soloMode: false,
    };

    const decision: ReviewerDecision = {
      status: "approve",
      mergePlan: {
        // No order specified — should fall back to available branches
        postMergeChecks: [],
      },
    };

    const result = await applyMergePlan(opts, {
      gemini: { agent: "gemini", branch: geminiBranch, dir: "", log: "" },
    }, decision);

    expect(result.ok).toBe(true);
    expect(result.branch).toMatch(/^ai-merge-/);
  });
});
