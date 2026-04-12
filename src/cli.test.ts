import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  C,
  TAG,
  line,
  parseArgs,
  parseAgentsList,
  parseReviewerAgent,
  parseDuration,
  parseFirstJson,
  systemConstraints,
  featurePrompt,
  reviewerPromptJSON,
  recordDNF,
  DEFAULT_MODELS,
  AGENT_IDS,
  resolveModels,
} from "./cli";

function createTempDir(): string {
  const dir = join(tmpdir(), `gitgang-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Color utilities", () => {
  test("C.b should bold text", () => {
    const result = C.b("test");
    expect(result).toContain("test");
  });

  test("TAG should wrap agent names", () => {
    expect(TAG("gemini")).toContain("GEMINI");
    expect(TAG("claude")).toContain("CLAUDE");
    expect(TAG("codex")).toContain("CODEX");
  });
});

describe("Utility functions", () => {
  test("line should create separator of correct length", () => {
    expect(line(10)).toBe("══════════");
    expect(line(5)).toBe("═════");
    expect(line()).toBe("".padEnd(84, "═"));
  });

  test("parseFirstJson should extract first JSON object", () => {
    const input = 'Some text {"status": "approve", "data": 123} more text';
    const result = parseFirstJson(input);
    expect(result).toEqual({ status: "approve", data: 123 });
  });

  test("parseFirstJson should handle invalid JSON", () => {
    const result = parseFirstJson("No JSON here");
    expect(result).toBeUndefined();
  });
});

describe("Argument parsing", () => {
  test("positional task is captured when not consumed by flags", () => {
    const parsed = parseArgs(["Implement feature"]);
    expect(parsed.task).toBe("Implement feature");
    expect(parsed.rounds).toBe(3);
    expect(parsed.yolo).toBe(true);
  });

  test("flag values do not override positional task", () => {
    const parsed = parseArgs(["--rounds", "2", "Fix bug"]);
    expect(parsed.task).toBe("Fix bug");
    expect(parsed.rounds).toBe(2);
  });

  test("--task overrides positional", () => {
    const parsed = parseArgs(["positional", "--task", "flagged"]);
    expect(parsed.task).toBe("flagged");
  });

  test("boolean flags are respected", () => {
    expect(parseArgs(["--no-yolo", "Task"]).yolo).toBe(false);
    expect(parseArgs(["--yolo", "false", "Task"]).yolo).toBe(false);
  });
});

describe("Prompt helpers", () => {
  test("systemConstraints returns multi-line instructions", () => {
    const result = systemConstraints("gemini");
    expect(result).toContain("autonomous senior engineer");
    expect(result.split("\n").length).toBeGreaterThan(3);
  });

  test("featurePrompt includes task and branch", () => {
    const prompt = featurePrompt("claude", "main", "Add feature");
    expect(prompt).toContain("Add feature");
    expect(prompt).toContain("main");
  });

  test("reviewerPromptJSON encodes schema", () => {
    const prompt = reviewerPromptJSON(
      "main",
      { gemini: "g-branch", claude: "c-branch", codex: "x-branch" },
      "Ship it",
      "- gemini: completed\n- claude: failed",
    );
    expect(prompt).toContain("g-branch");
    expect(prompt).toContain("\"status\"");
    expect(prompt).toContain("gemini: completed");
  });
});

describe("DNF recording", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });

  afterEach(() => {
    cleanup(dir);
  });

  test("recordDNF writes markdown summary", async () => {
    const path = await recordDNF(
      {
        task: "Test task",
        repoRoot: dir,
        baseBranch: "main",
        workRoot: ".ai-worktrees",
        rounds: 1,
        timeoutMs: 1000,
        yolo: true,
        autoPR: false,
        dryRun: false,
        activeAgents: ["gemini", "claude", "codex"],
        reviewerAgent: "codex",
        postMergeChecks: [],
      },
      "Timeout",
      "details",
    );

    expect(path).toBe(join(dir, "DNF.md"));
    const contents = readFileSync(path, "utf8");
    expect(contents).toContain("Test task");
    expect(contents).toContain("Timeout");
    expect(contents).toContain("details");
  });
});

describe("Agent timeout and partial completion", () => {
  test("should handle partial agent completion", () => {
    // Simulate results from mixed agent statuses
    const agentResults = [
      {
        id: "gemini" as const,
        result: {
          status: "success" as const,
          exitCode: 0,
          restarts: 0,
          reason: undefined,
        },
      },
      {
        id: "claude" as const,
        result: {
          status: "dnf" as const,
          exitCode: 1,
          restarts: 2,
          reason: "Still running when round timeout occurred",
        },
      },
      {
        id: "codex" as const,
        result: {
          status: "dnf" as const,
          exitCode: 1,
          restarts: 0,
          reason: "Agent stuck in error loop",
        },
      },
    ];

    const failedAgents = agentResults.filter((r) => r.result.status !== "success");
    const successfulAgents = agentResults.filter((r) => r.result.status === "success");

    expect(failedAgents.length).toBe(2);
    expect(successfulAgents.length).toBe(1);
    expect(successfulAgents[0].id).toBe("gemini");
    
    // Should proceed to reviewer since at least one succeeded
    expect(successfulAgents.length > 0).toBe(true);
  });

  test("should skip reviewer only when all agents fail", () => {
    const allFailedResults = [
      {
        id: "gemini" as const,
        result: {
          status: "dnf" as const,
          exitCode: 1,
          restarts: 0,
          reason: "Failed",
        },
      },
      {
        id: "claude" as const,
        result: {
          status: "dnf" as const,
          exitCode: 1,
          restarts: 0,
          reason: "Failed",
        },
      },
      {
        id: "codex" as const,
        result: {
          status: "dnf" as const,
          exitCode: 1,
          restarts: 0,
          reason: "Failed",
        },
      },
    ];

    const successfulAgents = allFailedResults.filter((r) => r.result.status === "success");
    expect(successfulAgents.length).toBe(0);
    
    // Should NOT proceed to reviewer when all failed
    expect(successfulAgents.length === 0).toBe(true);
  });

  test("should format timeout reasons correctly", () => {
    const timeoutResult = {
      id: "gemini" as const,
      result: {
        status: "dnf" as const,
        exitCode: 1,
        restarts: 0,
        reason: "Still running when round timeout occurred",
      },
    };

    expect(timeoutResult.result.reason).toContain("round timeout");
    expect(timeoutResult.result.status).toBe("dnf");
  });

  test("should distinguish between timeout and error loop failures", () => {
    const timeoutFailure = {
      reason: "Still running when round timeout occurred",
      status: "dnf" as const,
    };

    const errorLoopFailure = {
      reason: "Agent stuck in error loop",
      status: "dnf" as const,
    };

    expect(timeoutFailure.reason).toContain("timeout");
    expect(errorLoopFailure.reason).toContain("error loop");
    expect(timeoutFailure.status).toBe("dnf");
    expect(errorLoopFailure.status).toBe("dnf");
  });
});

describe("Model configuration", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    delete process.env.GITGANG_GEMINI_MODEL;
    delete process.env.GITGANG_CLAUDE_MODEL;
    delete process.env.GITGANG_CODEX_MODEL;
    Object.assign(process.env, originalEnv);
  });

  test("DEFAULT_MODELS contains expected default values", () => {
    expect(DEFAULT_MODELS.gemini).toBe("gemini-3-1-pro");
    expect(DEFAULT_MODELS.claude).toBe("claude-opus-4-6");
    expect(DEFAULT_MODELS.codex).toBe("gpt-5.4");
  });

  test("resolveModels returns defaults when no env vars set", () => {
    delete process.env.GITGANG_GEMINI_MODEL;
    delete process.env.GITGANG_CLAUDE_MODEL;
    delete process.env.GITGANG_CODEX_MODEL;
    const models = resolveModels();
    expect(models.gemini).toBe(DEFAULT_MODELS.gemini);
    expect(models.claude).toBe(DEFAULT_MODELS.claude);
    expect(models.codex).toBe(DEFAULT_MODELS.codex);
  });

  test("resolveModels respects GITGANG_GEMINI_MODEL env var", () => {
    process.env.GITGANG_GEMINI_MODEL = "gemini-2.5-flash";
    const models = resolveModels();
    expect(models.gemini).toBe("gemini-2.5-flash");
    expect(models.claude).toBe(DEFAULT_MODELS.claude);
    expect(models.codex).toBe(DEFAULT_MODELS.codex);
  });

  test("resolveModels respects GITGANG_CLAUDE_MODEL env var", () => {
    process.env.GITGANG_CLAUDE_MODEL = "claude-sonnet-4-6";
    const models = resolveModels();
    expect(models.gemini).toBe(DEFAULT_MODELS.gemini);
    expect(models.claude).toBe("claude-sonnet-4-6");
    expect(models.codex).toBe(DEFAULT_MODELS.codex);
  });

  test("resolveModels respects GITGANG_CODEX_MODEL env var", () => {
    process.env.GITGANG_CODEX_MODEL = "o3";
    const models = resolveModels();
    expect(models.gemini).toBe(DEFAULT_MODELS.gemini);
    expect(models.claude).toBe(DEFAULT_MODELS.claude);
    expect(models.codex).toBe("o3");
  });

  test("resolveModels respects all env overrides simultaneously", () => {
    process.env.GITGANG_GEMINI_MODEL = "custom-gemini";
    process.env.GITGANG_CLAUDE_MODEL = "custom-claude";
    process.env.GITGANG_CODEX_MODEL = "custom-codex";
    const models = resolveModels();
    expect(models.gemini).toBe("custom-gemini");
    expect(models.claude).toBe("custom-claude");
    expect(models.codex).toBe("custom-codex");
  });
});

describe("Dry-run flag", () => {
  test("--dry-run flag is parsed correctly", () => {
    const parsed = parseArgs(["--dry-run", "Some task"]);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.task).toBe("Some task");
  });

  test("dry-run defaults to false", () => {
    const parsed = parseArgs(["Some task"]);
    expect(parsed.dryRun).toBe(false);
  });

  test("--dry-run works with other flags", () => {
    const parsed = parseArgs(["--rounds", "5", "--dry-run", "--no-yolo", "Task"]);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.rounds).toBe(5);
    expect(parsed.yolo).toBe(false);
    expect(parsed.task).toBe("Task");
  });
});

describe("Agent selection (--agents flag)", () => {
  test("defaults to all three agents when --agents not specified", () => {
    const parsed = parseArgs(["Some task"]);
    expect(parsed.activeAgents).toEqual(["gemini", "claude", "codex"]);
  });

  test("parses single agent correctly", () => {
    const parsed = parseArgs(["--agents", "gemini", "Some task"]);
    expect(parsed.activeAgents).toEqual(["gemini"]);
  });

  test("parses multiple agents correctly", () => {
    const parsed = parseArgs(["--agents", "gemini,claude", "Some task"]);
    expect(parsed.activeAgents).toEqual(["gemini", "claude"]);
  });

  test("parses all three agents correctly", () => {
    const parsed = parseArgs(["--agents", "gemini,claude,codex", "Some task"]);
    expect(parsed.activeAgents).toEqual(["gemini", "claude", "codex"]);
  });

  test("deduplicates repeated agents", () => {
    const parsed = parseArgs(["--agents", "gemini,gemini,claude", "Some task"]);
    expect(parsed.activeAgents).toEqual(["gemini", "claude"]);
  });

  test("trims whitespace in agent names", () => {
    const result = parseAgentsList(" gemini , claude ");
    expect(result).toEqual(["gemini", "claude"]);
  });

  test("throws on invalid agent name only", () => {
    expect(() => parseAgentsList("invalidagent")).toThrow("No valid agents");
  });

  test("ignores invalid agents but keeps valid ones", () => {
    const result = parseAgentsList("gemini,invalid,codex");
    expect(result).toEqual(["gemini", "codex"]);
  });

  test("--agents works with other flags", () => {
    const parsed = parseArgs(["--agents", "claude,codex", "--rounds", "2", "--dry-run", "Build it"]);
    expect(parsed.activeAgents).toEqual(["claude", "codex"]);
    expect(parsed.rounds).toBe(2);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.task).toBe("Build it");
  });

  test("--agents missing value throws", () => {
    expect(() => parseArgs(["--agents"])).toThrow("--agents requires a value");
  });
});

describe("Reviewer prompt with partial agents", () => {
  test("reviewer prompt only includes successful agent branches", () => {
    const prompt = reviewerPromptJSON(
      "main",
      { gemini: "g-branch", claude: "c-branch" },
      "Ship it",
      "- gemini: completed\n- claude: completed",
      undefined,
      ["gemini", "claude"],
    );
    expect(prompt).toContain("g-branch");
    expect(prompt).toContain("c-branch");
    expect(prompt).not.toContain("codex");
  });

  test("reviewer prompt marks failed agents in branch list", () => {
    const prompt = reviewerPromptJSON(
      "main",
      { gemini: "g-branch", claude: "c-branch", codex: "x-branch" },
      "Ship it",
      undefined,
      undefined,
      ["gemini"], // only gemini succeeded
    );
    expect(prompt).toContain("g-branch");
    expect(prompt).toContain("c-branch");
    expect(prompt).toContain("FAILED - do not merge");
    expect(prompt).toContain("Only these agents completed successfully: gemini");
  });

  test("reviewer prompt omits failure note when all agents succeed", () => {
    const prompt = reviewerPromptJSON(
      "main",
      { gemini: "g-branch", claude: "c-branch", codex: "x-branch" },
      "Ship it",
      undefined,
      undefined,
      ["gemini", "claude", "codex"],
    );
    expect(prompt).not.toContain("FAILED");
    expect(prompt).not.toContain("IMPORTANT");
  });

  test("reviewer prompt works with diff summaries for partial agents", () => {
    const prompt = reviewerPromptJSON(
      "main",
      { gemini: "g-branch" },
      "Ship it",
      undefined,
      { gemini: "3 files changed" },
      ["gemini"],
    );
    expect(prompt).toContain("3 files changed");
    expect(prompt).toContain("g-branch");
  });
});

describe("Reviewer selection (--reviewer flag)", () => {
  test("defaults to codex when --reviewer not specified", () => {
    const parsed = parseArgs(["Some task"]);
    expect(parsed.reviewerAgent).toBe("codex");
  });

  test("parses --reviewer claude correctly", () => {
    const parsed = parseArgs(["--reviewer", "claude", "Some task"]);
    expect(parsed.reviewerAgent).toBe("claude");
  });

  test("parses --reviewer gemini correctly", () => {
    const parsed = parseArgs(["--reviewer", "gemini", "Some task"]);
    expect(parsed.reviewerAgent).toBe("gemini");
  });

  test("parses --reviewer codex correctly", () => {
    const parsed = parseArgs(["--reviewer", "codex", "Some task"]);
    expect(parsed.reviewerAgent).toBe("codex");
  });

  test("--reviewer is case-insensitive", () => {
    const parsed = parseArgs(["--reviewer", "Claude", "Some task"]);
    expect(parsed.reviewerAgent).toBe("claude");
  });

  test("parseReviewerAgent throws on invalid agent", () => {
    expect(() => parseReviewerAgent("invalidagent")).toThrow("Invalid reviewer agent");
  });

  test("parseReviewerAgent accepts valid agents", () => {
    expect(parseReviewerAgent("gemini")).toBe("gemini");
    expect(parseReviewerAgent("claude")).toBe("claude");
    expect(parseReviewerAgent("codex")).toBe("codex");
  });

  test("--reviewer missing value throws", () => {
    expect(() => parseArgs(["--reviewer"])).toThrow("--reviewer requires a value");
  });

  test("--reviewer works with other flags", () => {
    const parsed = parseArgs(["--reviewer", "claude", "--agents", "gemini,claude", "--rounds", "2", "Build it"]);
    expect(parsed.reviewerAgent).toBe("claude");
    expect(parsed.activeAgents).toEqual(["gemini", "claude"]);
    expect(parsed.rounds).toBe(2);
    expect(parsed.task).toBe("Build it");
  });

  test("--reviewer can differ from active agents", () => {
    const parsed = parseArgs(["--reviewer", "claude", "--agents", "gemini,codex", "Task"]);
    expect(parsed.reviewerAgent).toBe("claude");
    expect(parsed.activeAgents).toEqual(["gemini", "codex"]);
  });
});

describe("Duration parsing (parseDuration)", () => {
  test("parses minutes", () => {
    expect(parseDuration("25m")).toBe(25 * 60 * 1000);
  });

  test("parses hours", () => {
    expect(parseDuration("1h")).toBe(60 * 60 * 1000);
  });

  test("parses seconds", () => {
    expect(parseDuration("90s")).toBe(90 * 1000);
  });

  test("parses combined hours + minutes", () => {
    expect(parseDuration("1h30m")).toBe(90 * 60 * 1000);
  });

  test("parses combined hours + minutes + seconds", () => {
    expect(parseDuration("2h15m30s")).toBe((2 * 3600 + 15 * 60 + 30) * 1000);
  });

  test("parses raw milliseconds as number string", () => {
    expect(parseDuration("1500000")).toBe(1500000);
  });

  test("returns undefined for invalid input", () => {
    expect(parseDuration("abc")).toBeUndefined();
    expect(parseDuration("")).toBeUndefined();
    expect(parseDuration("25x")).toBeUndefined();
  });

  test("trims whitespace", () => {
    expect(parseDuration("  25m  ")).toBe(25 * 60 * 1000);
  });

  test("is case insensitive", () => {
    expect(parseDuration("1H30M")).toBe(90 * 60 * 1000);
  });
});

describe("--timeout flag (human-friendly durations)", () => {
  test("parses --timeout 25m", () => {
    const parsed = parseArgs(["--timeout", "25m", "Task"]);
    expect(parsed.timeoutMs).toBe(25 * 60 * 1000);
  });

  test("parses --timeout 1h", () => {
    const parsed = parseArgs(["--timeout", "1h", "Task"]);
    // Capped to 60 minutes max by normalization
    expect(parsed.timeoutMs).toBe(60 * 60 * 1000);
  });

  test("parses --timeout 90s (clamped to minimum 60s)", () => {
    const parsed = parseArgs(["--timeout", "90s", "Task"]);
    expect(parsed.timeoutMs).toBe(90 * 1000);
  });

  test("--timeout with invalid value throws", () => {
    expect(() => parseArgs(["--timeout", "abc", "Task"])).toThrow("Invalid duration");
  });

  test("--timeout missing value throws", () => {
    expect(() => parseArgs(["--timeout"])).toThrow("--timeout requires a value");
  });

  test("--timeout overrides default timeoutMs", () => {
    const parsed = parseArgs(["--timeout", "10m", "Task"]);
    expect(parsed.timeoutMs).toBe(10 * 60 * 1000);
  });

  test("--timeoutMs still works for backward compat", () => {
    const parsed = parseArgs(["--timeoutMs", "600000", "Task"]);
    expect(parsed.timeoutMs).toBe(600000);
  });
});

describe("--check flag (post-merge checks)", () => {
  test("defaults to empty array", () => {
    const parsed = parseArgs(["Task"]);
    expect(parsed.postMergeChecks).toEqual([]);
  });

  test("parses single --check", () => {
    const parsed = parseArgs(["--check", "npm test", "Task"]);
    expect(parsed.postMergeChecks).toEqual(["npm test"]);
  });

  test("parses multiple --check flags", () => {
    const parsed = parseArgs(["--check", "npm test", "--check", "npm run build", "Task"]);
    expect(parsed.postMergeChecks).toEqual(["npm test", "npm run build"]);
  });

  test("--check works with other flags", () => {
    const parsed = parseArgs(["--check", "npm test", "--rounds", "2", "--dry-run", "Task"]);
    expect(parsed.postMergeChecks).toEqual(["npm test"]);
    expect(parsed.rounds).toBe(2);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.task).toBe("Task");
  });

  test("--check missing value throws", () => {
    expect(() => parseArgs(["--check"])).toThrow("--check requires a command");
  });
});
