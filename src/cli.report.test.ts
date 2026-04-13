import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  generateRunReport,
  writeRunReport,
  MODELS,
  VERSION,
  type Opts,
  type AgentRunResult,
  type RunReport,
  type AgentStats,
} from "./cli";

// Minimal mock for AgentRunner-like objects used by generateRunReport
function mockAgentRunner(id: "gemini" | "claude" | "codex", branch: string, stats: AgentStats, lastError?: string) {
  return {
    id,
    worktree: { agent: id, branch, dir: `/tmp/${id}`, log: `/tmp/${id}.log` },
    getStats: () => stats,
    getLastError: () => lastError,
  };
}

function makeOpts(overrides: Partial<Opts> = {}): Opts {
  return {
    task: "Implement feature X",
    repoRoot: "/tmp/test-repo",
    baseBranch: "main",
    workRoot: ".ai-worktrees",
    rounds: 3,
    timeoutMs: 25 * 60 * 1000,
    yolo: true,
    autoPR: false,
    dryRun: false,
    activeAgents: ["gemini", "claude", "codex"],
    reviewerAgent: "codex",
    postMergeChecks: [],
    soloMode: false,
    ...overrides,
  };
}

describe("generateRunReport", () => {
  test("generates a complete report for successful run", () => {
    const opts = makeOpts();
    const startTime = Date.now() - 120_000; // 2 minutes ago

    const agentResults: Array<{ id: "gemini" | "claude" | "codex"; result: AgentRunResult }> = [
      { id: "gemini", result: { status: "success", exitCode: 0, restarts: 0 } },
      { id: "claude", result: { status: "success", exitCode: 0, restarts: 1 } },
      { id: "codex", result: { status: "dnf", exitCode: 1, restarts: 2, reason: "timeout" } },
    ];

    const agents = {
      gemini: mockAgentRunner("gemini", "agents/gemini/test", { filesChanged: 5, additions: 100, deletions: 20, commits: 3, errors: 0 }),
      claude: mockAgentRunner("claude", "agents/claude/test", { filesChanged: 3, additions: 80, deletions: 10, commits: 2, errors: 1 }, "minor error"),
      codex: mockAgentRunner("codex", "agents/codex/test", { filesChanged: 0, additions: 0, deletions: 0, commits: 0, errors: 5 }, "stuck in loop"),
    };

    const report = generateRunReport(
      opts,
      agentResults,
      agents as any,
      "approved",
      startTime,
      "ai-merge-20260407",
    );

    expect(report.version).toBe(VERSION);
    expect(report.task).toBe("Implement feature X");
    expect(report.baseBranch).toBe("main");
    expect(report.outcome).toBe("approved");
    expect(report.mergeBranch).toBe("ai-merge-20260407");
    expect(report.durationMs).toBeGreaterThanOrEqual(120_000);
    expect(report.rounds).toBe(3);
    expect(report.agents).toHaveLength(3);
    expect(report.models).toEqual(MODELS);
  });

  test("captures per-agent stats correctly", () => {
    const opts = makeOpts();
    const startTime = Date.now();

    const agentResults: Array<{ id: "gemini" | "claude" | "codex"; result: AgentRunResult }> = [
      { id: "gemini", result: { status: "success", exitCode: 0, restarts: 0 } },
      { id: "claude", result: { status: "success", exitCode: 0, restarts: 0 } },
      { id: "codex", result: { status: "success", exitCode: 0, restarts: 0 } },
    ];

    const geminiStats: AgentStats = { filesChanged: 10, additions: 200, deletions: 50, commits: 5, errors: 0 };
    const agents = {
      gemini: mockAgentRunner("gemini", "agents/gemini/test", geminiStats),
      claude: mockAgentRunner("claude", "agents/claude/test", { filesChanged: 0, additions: 0, deletions: 0, commits: 0, errors: 0 }),
      codex: mockAgentRunner("codex", "agents/codex/test", { filesChanged: 0, additions: 0, deletions: 0, commits: 0, errors: 0 }),
    };

    const report = generateRunReport(opts, agentResults, agents as any, "approved", startTime);

    const geminiReport = report.agents.find((a) => a.agent === "gemini")!;
    expect(geminiReport.stats.filesChanged).toBe(10);
    expect(geminiReport.stats.additions).toBe(200);
    expect(geminiReport.stats.deletions).toBe(50);
    expect(geminiReport.stats.commits).toBe(5);
    expect(geminiReport.stats.errors).toBe(0);
    expect(geminiReport.model).toBe(MODELS.gemini);
    expect(geminiReport.branch).toBe("agents/gemini/test");
  });

  test("captures DNF outcome without merge branch", () => {
    const opts = makeOpts();
    const startTime = Date.now();

    const agentResults: Array<{ id: "gemini" | "claude" | "codex"; result: AgentRunResult }> = [
      { id: "gemini", result: { status: "dnf", exitCode: 1, restarts: 3, reason: "max restarts" } },
      { id: "claude", result: { status: "dnf", exitCode: 1, restarts: 0, reason: "error loop" } },
      { id: "codex", result: { status: "dnf", exitCode: 1, restarts: 0, reason: "timeout" } },
    ];

    const agents = {
      gemini: mockAgentRunner("gemini", "agents/gemini/test", { filesChanged: 0, additions: 0, deletions: 0, commits: 0, errors: 3 }, "spawn failed"),
      claude: mockAgentRunner("claude", "agents/claude/test", { filesChanged: 0, additions: 0, deletions: 0, commits: 0, errors: 5 }, "error loop"),
      codex: mockAgentRunner("codex", "agents/codex/test", { filesChanged: 0, additions: 0, deletions: 0, commits: 0, errors: 0 }),
    };

    const report = generateRunReport(opts, agentResults, agents as any, "dnf", startTime);

    expect(report.outcome).toBe("dnf");
    expect(report.mergeBranch).toBeUndefined();

    const geminiReport = report.agents.find((a) => a.agent === "gemini")!;
    expect(geminiReport.status).toBe("dnf");
    expect(geminiReport.restarts).toBe(3);
    expect(geminiReport.reason).toBe("max restarts");
    expect(geminiReport.lastError).toBe("spawn failed");
  });

  test("records correct model identifiers for each agent", () => {
    const opts = makeOpts();
    const agentResults: Array<{ id: "gemini" | "claude" | "codex"; result: AgentRunResult }> = [
      { id: "gemini", result: { status: "success", exitCode: 0, restarts: 0 } },
      { id: "claude", result: { status: "success", exitCode: 0, restarts: 0 } },
      { id: "codex", result: { status: "success", exitCode: 0, restarts: 0 } },
    ];

    const emptyStats: AgentStats = { filesChanged: 0, additions: 0, deletions: 0, commits: 0, errors: 0 };
    const agents = {
      gemini: mockAgentRunner("gemini", "g", emptyStats),
      claude: mockAgentRunner("claude", "c", emptyStats),
      codex: mockAgentRunner("codex", "x", emptyStats),
    };

    const report = generateRunReport(opts, agentResults, agents as any, "approved", Date.now());

    expect(report.models.gemini).toBe("gemini-3-1-pro");
    expect(report.models.claude).toBe("claude-opus-4-6");
    expect(report.models.codex).toBe("gpt-5.4");

    // Each agent report should also have its correct model
    for (const agent of report.agents) {
      expect(agent.model).toBe(MODELS[agent.agent]);
    }
  });
});

describe("writeRunReport", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `gitgang-report-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("writes valid JSON report to .ai-worktrees/reports/", async () => {
    const report: RunReport = {
      version: VERSION,
      timestamp: "2026-04-07T12:00:00.000Z",
      task: "Test task",
      baseBranch: "main",
      outcome: "approved",
      mergeBranch: "ai-merge-test",
      durationMs: 60000,
      rounds: 3,
      agents: [
        {
          agent: "gemini",
          model: MODELS.gemini,
          branch: "agents/gemini/test",
          status: "success",
          exitCode: 0,
          restarts: 0,
          stats: { filesChanged: 2, additions: 50, deletions: 10, commits: 1, errors: 0 },
        },
        {
          agent: "claude",
          model: MODELS.claude,
          branch: "agents/claude/test",
          status: "success",
          exitCode: 0,
          restarts: 0,
          stats: { filesChanged: 3, additions: 80, deletions: 20, commits: 2, errors: 0 },
        },
        {
          agent: "codex",
          model: MODELS.codex,
          branch: "agents/codex/test",
          status: "dnf",
          exitCode: 1,
          restarts: 1,
          reason: "timeout",
          stats: { filesChanged: 0, additions: 0, deletions: 0, commits: 0, errors: 2 },
          lastError: "process killed",
        },
      ],
      models: { ...MODELS },
      reviewerAgent: "codex",
    };

    const filepath = await writeRunReport(dir, report);

    expect(filepath).toContain(".ai-worktrees/reports/run-");
    expect(filepath.endsWith(".json")).toBe(true);
    expect(existsSync(filepath)).toBe(true);

    const contents = readFileSync(filepath, "utf8");
    const parsed = JSON.parse(contents);
    expect(parsed.version).toBe(VERSION);
    expect(parsed.task).toBe("Test task");
    expect(parsed.outcome).toBe("approved");
    expect(parsed.agents).toHaveLength(3);
    expect(MODELS.codex).toBe("gpt-5.4");
    expect(parsed.models.gemini).toBe(MODELS.gemini);
  });

  test("creates reports directory if it does not exist", async () => {
    const reportsDir = join(dir, ".ai-worktrees", "reports");
    expect(existsSync(reportsDir)).toBe(false);

    const report: RunReport = {
      version: VERSION,
      timestamp: "2026-04-07T12:30:00.000Z",
      task: "Create reports dir",
      baseBranch: "dev",
      outcome: "dnf",
      durationMs: 5000,
      rounds: 1,
      agents: [],
      models: { ...MODELS },
      reviewerAgent: "codex",
    };

    await writeRunReport(dir, report);

    expect(existsSync(reportsDir)).toBe(true);
  });
});

describe("generateRunReport with diff summaries", () => {
  test("includes diff summaries per agent when provided", () => {
    const opts = makeOpts();
    const startTime = Date.now();
    const emptyStats: AgentStats = { filesChanged: 0, additions: 0, deletions: 0, commits: 0, errors: 0 };

    const agentResults: Array<{ id: "gemini" | "claude" | "codex"; result: AgentRunResult }> = [
      { id: "gemini", result: { status: "success", exitCode: 0, restarts: 0 } },
      { id: "claude", result: { status: "success", exitCode: 0, restarts: 0 } },
      { id: "codex", result: { status: "success", exitCode: 0, restarts: 0 } },
    ];

    const agents = {
      gemini: mockAgentRunner("gemini", "agents/gemini/test", emptyStats),
      claude: mockAgentRunner("claude", "agents/claude/test", emptyStats),
      codex: mockAgentRunner("codex", "agents/codex/test", emptyStats),
    };

    const diffSummaries = {
      gemini: " src/foo.ts | 10 +++++++---\n 1 file changed, 7 insertions(+), 3 deletions(-)",
      claude: " src/bar.ts | 5 +++++\n 1 file changed, 5 insertions(+)",
      codex: "(no changes)",
    };

    const report = generateRunReport(opts, agentResults, agents as any, "approved", startTime, "ai-merge-test", diffSummaries);

    const geminiReport = report.agents.find((a) => a.agent === "gemini")!;
    expect(geminiReport.diffSummary).toContain("src/foo.ts");

    const claudeReport = report.agents.find((a) => a.agent === "claude")!;
    expect(claudeReport.diffSummary).toContain("src/bar.ts");

    const codexReport = report.agents.find((a) => a.agent === "codex")!;
    expect(codexReport.diffSummary).toBe("(no changes)");
  });

  test("diff summaries are undefined when not provided", () => {
    const opts = makeOpts();
    const emptyStats: AgentStats = { filesChanged: 0, additions: 0, deletions: 0, commits: 0, errors: 0 };

    const agentResults: Array<{ id: "gemini" | "claude" | "codex"; result: AgentRunResult }> = [
      { id: "gemini", result: { status: "success", exitCode: 0, restarts: 0 } },
      { id: "claude", result: { status: "success", exitCode: 0, restarts: 0 } },
      { id: "codex", result: { status: "success", exitCode: 0, restarts: 0 } },
    ];

    const agents = {
      gemini: mockAgentRunner("gemini", "agents/gemini/test", emptyStats),
      claude: mockAgentRunner("claude", "agents/claude/test", emptyStats),
      codex: mockAgentRunner("codex", "agents/codex/test", emptyStats),
    };

    const report = generateRunReport(opts, agentResults, agents as any, "approved", Date.now());

    for (const agentReport of report.agents) {
      expect(agentReport.diffSummary).toBeUndefined();
    }
  });

  test("solo mode flag is recorded in the report", () => {
    const opts = makeOpts({ soloMode: true, activeAgents: ["claude"], rounds: 1 });
    const emptyStats: AgentStats = { filesChanged: 0, additions: 0, deletions: 0, commits: 0, errors: 0 };

    const agentResults: Array<{ id: "gemini" | "claude" | "codex"; result: AgentRunResult }> = [
      { id: "claude", result: { status: "success", exitCode: 0, restarts: 0 } },
    ];

    const agents = {
      claude: mockAgentRunner("claude", "agents/claude/solo", emptyStats),
    };

    const report = generateRunReport(
      opts,
      agentResults,
      agents as any,
      "approved",
      Date.now(),
      "ai-merge-solo",
      undefined,
      true,
    );

    expect(report.soloMode).toBe(true);
    expect(report.agents).toHaveLength(1);
    expect(report.agents[0].agent).toBe("claude");
  });
});
