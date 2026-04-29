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
  MODELS,
  AGENT_IDS,
  resolveModels,
  applyModelOverrides,
  isAgentId,
  createWorktree,
  applyMergePlan,
  applyInteractiveMergePlan,
  spawnProcess,
  formatSessionsList,
  formatSessionShow,
  type SessionSummary,
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
    expect(result).toContain("autonomous engineer");
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
        soloMode: false,
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
    expect(DEFAULT_MODELS.gemini).toBe("gemini-3.1-pro-preview");
    expect(DEFAULT_MODELS.claude).toBe("claude-opus-4-7");
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

describe("Solo mode (--solo flag)", () => {
  test("--solo claude sets single agent and solo mode", () => {
    const parsed = parseArgs(["--solo", "claude", "Fix the bug"]);
    expect(parsed.soloMode).toBe(true);
    expect(parsed.activeAgents).toEqual(["claude"]);
    expect(parsed.reviewerAgent).toBe("claude");
    expect(parsed.rounds).toBe(1);
    expect(parsed.task).toBe("Fix the bug");
  });

  test("--solo gemini sets gemini as sole agent", () => {
    const parsed = parseArgs(["--solo", "gemini", "Add tests"]);
    expect(parsed.soloMode).toBe(true);
    expect(parsed.activeAgents).toEqual(["gemini"]);
    expect(parsed.reviewerAgent).toBe("gemini");
  });

  test("--solo codex sets codex as sole agent", () => {
    const parsed = parseArgs(["--solo", "codex", "Refactor module"]);
    expect(parsed.soloMode).toBe(true);
    expect(parsed.activeAgents).toEqual(["codex"]);
    expect(parsed.reviewerAgent).toBe("codex");
  });

  test("--solo with invalid agent throws", () => {
    expect(() => parseArgs(["--solo", "gpt4", "Task"])).toThrow('Invalid solo agent "gpt4"');
  });

  test("--solo missing agent throws", () => {
    expect(() => parseArgs(["--solo"])).toThrow("--solo requires an agent name");
  });

  test("--solo works with other flags", () => {
    const parsed = parseArgs(["--solo", "claude", "--timeout", "10m", "--dry-run", "Task"]);
    expect(parsed.soloMode).toBe(true);
    expect(parsed.activeAgents).toEqual(["claude"]);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.timeoutMs).toBe(10 * 60 * 1000);
  });

  test("default soloMode is false", () => {
    const parsed = parseArgs(["Task"]);
    expect(parsed.soloMode).toBe(false);
    expect(parsed.activeAgents).toEqual(["gemini", "claude", "codex"]);
  });
});

describe("isAgentId", () => {
  test("returns true for valid agent ids", () => {
    expect(isAgentId("gemini")).toBe(true);
    expect(isAgentId("claude")).toBe(true);
    expect(isAgentId("codex")).toBe(true);
  });

  test("returns false for invalid agent ids", () => {
    expect(isAgentId("gpt4")).toBe(false);
    expect(isAgentId("")).toBe(false);
    expect(isAgentId("CLAUDE")).toBe(false);
  });
});

describe("Per-agent model override flags (--model-*)", () => {
  const originalGemini = MODELS.gemini;
  const originalClaude = MODELS.claude;
  const originalCodex = MODELS.codex;

  afterEach(() => {
    // Restore MODELS after each test since applyModelOverrides mutates it
    MODELS.gemini = originalGemini;
    MODELS.claude = originalClaude;
    MODELS.codex = originalCodex;
  });

  test("--model-gemini overrides the gemini model in parsed args", () => {
    const parsed = parseArgs(["--model-gemini", "gemini-2.5-flash", "Task"]);
    expect(parsed.modelOverrides?.gemini).toBe("gemini-2.5-flash");
    expect(parsed.task).toBe("Task");
  });

  test("--model-claude overrides the claude model in parsed args", () => {
    const parsed = parseArgs(["--model-claude", "claude-sonnet-4-6", "Task"]);
    expect(parsed.modelOverrides?.claude).toBe("claude-sonnet-4-6");
  });

  test("--model-codex overrides the codex model in parsed args", () => {
    const parsed = parseArgs(["--model-codex", "gpt-5.4-mini", "Task"]);
    expect(parsed.modelOverrides?.codex).toBe("gpt-5.4-mini");
  });

  test("all three --model-* flags can be used together", () => {
    const parsed = parseArgs([
      "--model-gemini", "gemini-2.5-pro",
      "--model-claude", "claude-sonnet-4-6",
      "--model-codex", "gpt-5.4-mini",
      "Task",
    ]);
    expect(parsed.modelOverrides?.gemini).toBe("gemini-2.5-pro");
    expect(parsed.modelOverrides?.claude).toBe("claude-sonnet-4-6");
    expect(parsed.modelOverrides?.codex).toBe("gpt-5.4-mini");
  });

  test("--model-gemini missing value throws", () => {
    expect(() => parseArgs(["--model-gemini"])).toThrow("--model-gemini requires a model name");
  });

  test("--model-claude missing value throws", () => {
    expect(() => parseArgs(["--model-claude"])).toThrow("--model-claude requires a model name");
  });

  test("--model-codex missing value throws", () => {
    expect(() => parseArgs(["--model-codex"])).toThrow("--model-codex requires a model name");
  });

  test("modelOverrides defaults to empty object when no --model-* flags", () => {
    const parsed = parseArgs(["Task"]);
    expect(parsed.modelOverrides).toEqual({});
  });

  test("applyModelOverrides updates MODELS for specified agents", () => {
    applyModelOverrides({ gemini: "gemini-2.5-flash", codex: "gpt-5.4-mini" });
    expect(MODELS.gemini).toBe("gemini-2.5-flash");
    expect(MODELS.codex).toBe("gpt-5.4-mini");
    expect(MODELS.claude).toBe(originalClaude); // unchanged
  });

  test("applyModelOverrides ignores empty/whitespace model strings", () => {
    applyModelOverrides({ gemini: "  " });
    expect(MODELS.gemini).toBe(originalGemini); // not mutated
  });

  test("applyModelOverrides trims whitespace from model names", () => {
    applyModelOverrides({ claude: "  claude-sonnet-4-6  " });
    expect(MODELS.claude).toBe("claude-sonnet-4-6");
  });

  test("--model-* flags work alongside other flags", () => {
    const parsed = parseArgs([
      "--model-gemini", "gemini-3.1-pro",
      "--rounds", "2",
      "--dry-run",
      "--agents", "gemini,claude",
      "Build it",
    ]);
    expect(parsed.modelOverrides?.gemini).toBe("gemini-3.1-pro");
    expect(parsed.rounds).toBe(2);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.activeAgents).toEqual(["gemini", "claude"]);
    expect(parsed.task).toBe("Build it");
  });
});

describe("exports for interactive mode", () => {
  test("createWorktree is exported", () => {
    expect(typeof createWorktree).toBe("function");
  });
  test("applyMergePlan is exported", () => {
    expect(typeof applyMergePlan).toBe("function");
  });
  test("applyInteractiveMergePlan is exported", () => {
    expect(typeof applyInteractiveMergePlan).toBe("function");
    expect(applyInteractiveMergePlan.length).toBe(3);
  });
  test("applyInteractiveMergePlan rejects empty branches", async () => {
    await expect(
      applyInteractiveMergePlan("/tmp", "main", {
        pick: "claude",
        branches: [],
        rationale: "none",
        followups: [],
      }),
    ).rejects.toThrow(/no branches/);
  });
  test("applyInteractiveMergePlan merges hybrid plan across multiple branches", async () => {
    const { execSync } = await import("node:child_process");
    const repo = createTempDir();
    const run = (cmd: string) => execSync(cmd, { cwd: repo, stdio: "pipe" }).toString();
    try {
      run("git init -q -b main");
      run("git config user.email test@test.com");
      run("git config user.name Test");
      run("git commit --allow-empty -q -m 'init'");
      // Create two non-conflicting feature branches
      run("git checkout -q -b feat-a");
      execSync("echo a > a.txt && git add a.txt && git commit -q -m 'add a'", {
        cwd: repo,
        stdio: "pipe",
        shell: "/bin/bash",
      });
      run("git checkout -q main");
      run("git checkout -q -b feat-b");
      execSync("echo b > b.txt && git add b.txt && git commit -q -m 'add b'", {
        cwd: repo,
        stdio: "pipe",
        shell: "/bin/bash",
      });
      run("git checkout -q main");

      await applyInteractiveMergePlan(repo, "main", {
        pick: "hybrid",
        branches: ["feat-a", "feat-b"],
        rationale: "combine",
        followups: [],
      });

      // Both files should now exist on main
      expect(existsSync(join(repo, "a.txt"))).toBe(true);
      expect(existsSync(join(repo, "b.txt"))).toBe(true);
      // Two merge commits + original "init" + commits on feature branches
      const log = run("git log main --oneline --merges").trim().split("\n");
      expect(log.length).toBe(2);
    } finally {
      cleanup(repo);
    }
  });
  test("systemConstraints is exported", () => {
    expect(typeof systemConstraints).toBe("function");
  });
  test("featurePrompt is exported", () => {
    expect(typeof featurePrompt).toBe("function");
  });
  test("spawnProcess is exported", () => {
    expect(typeof spawnProcess).toBe("function");
  });
});

describe("interactive mode flag parsing", () => {
  test("bare gg defaults to pair mode with claude coder + codex reviewer", () => {
    const p = parseArgs([]);
    expect(p.subcommand?.kind).toBe("pair");
    if (p.subcommand?.kind === "pair") {
      expect(p.subcommand.coder).toBe("claude");
      expect(p.subcommand.reviewer).toBe("codex");
      expect(p.subcommand.task).toBeUndefined();
    }
  });

  test("gg pair with no flags uses the same defaults", () => {
    const p = parseArgs(["pair"]);
    expect(p.subcommand?.kind).toBe("pair");
    if (p.subcommand?.kind === "pair") {
      expect(p.subcommand.coder).toBe("claude");
      expect(p.subcommand.reviewer).toBe("codex");
      expect(p.subcommand.task).toBeUndefined();
    }
  });

  test("gg pair with task but no coder/reviewer still defaults", () => {
    const p = parseArgs(["pair", "ship the feature"]);
    expect(p.subcommand?.kind).toBe("pair");
    if (p.subcommand?.kind === "pair") {
      expect(p.subcommand.coder).toBe("claude");
      expect(p.subcommand.reviewer).toBe("codex");
      expect(p.subcommand.task).toBe("ship the feature");
    }
  });

  test("gg pair --coder codex --reviewer claude overrides defaults", () => {
    const p = parseArgs(["pair", "--coder", "codex", "--reviewer", "claude", "task"]);
    expect(p.subcommand?.kind).toBe("pair");
    if (p.subcommand?.kind === "pair") {
      expect(p.subcommand.coder).toBe("codex");
      expect(p.subcommand.reviewer).toBe("claude");
    }
  });

  test("-i flag enables interactive", () => {
    const p = parseArgs(["-i"]);
    expect(p.interactive).toBe(true);
  });

  test("--interactive enables interactive", () => {
    const p = parseArgs(["--interactive"]);
    expect(p.interactive).toBe(true);
  });

  test("gg 'task' stays one-shot", () => {
    const p = parseArgs(["do thing"]);
    expect(p.interactive).toBe(false);
    expect(p.task).toBe("do thing");
  });

  test("-i 'opener' sets first message", () => {
    const p = parseArgs(["-i", "opener text"]);
    expect(p.interactive).toBe(true);
    expect(p.opener).toBe("opener text");
  });

  test("--resume without value resumes most recent", () => {
    const p = parseArgs(["-i", "--resume"]);
    expect(p.resume).toEqual({ mode: "latest" });
  });

  test("--resume with id resumes specific", () => {
    const p = parseArgs(["-i", "--resume", "2026-04-14T20-00-00-abc123"]);
    expect(p.resume).toEqual({ mode: "id", id: "2026-04-14T20-00-00-abc123" });
  });

  test("--automerge on|off|ask parses", () => {
    expect(parseArgs(["-i", "--automerge", "on"]).automerge).toBe("on");
    expect(parseArgs(["-i", "--automerge", "off"]).automerge).toBe("off");
    expect(parseArgs(["-i", "--automerge", "ask"]).automerge).toBe("ask");
  });

  test("sessions list subcommand", () => {
    const p = parseArgs(["sessions", "list"]);
    expect(p.subcommand).toEqual({ kind: "sessions_list", json: false });
  });

  test("sessions show ID subcommand", () => {
    const p = parseArgs(["sessions", "show", "abc"]);
    expect(p.subcommand).toEqual({ kind: "sessions_show", id: "abc" });
  });
});

describe("main dispatch", () => {
  test("exports dispatchMain wrapper", async () => {
    const mod = await import("./cli");
    expect(typeof mod.dispatchMain).toBe("function");
  });
});

describe("sessions list/show formatting", () => {
  test("formatSessionsList renders one line per session", () => {
    const s = formatSessionsList([
      {
        id: "2026-04-14T20-00-00-abc",
        startedAt: "2026-04-14T20:00:00Z",
        turns: 5,
        reviewer: "codex",
      },
      {
        id: "2026-04-13T12-00-00-def",
        startedAt: "2026-04-13T12:00:00Z",
        turns: 2,
        reviewer: "codex",
      },
    ]);
    expect(s).toContain("2026-04-14T20-00-00-abc");
    expect(s).toContain("2026-04-13T12-00-00-def");
    expect(s).toContain("5");
    expect(s).toContain("2");
  });

  test("formatSessionShow prints events in order", () => {
    const s = formatSessionShow([
      { ts: "t1", turn: 1, type: "user", text: "hi", forcedMode: null },
      {
        ts: "t2",
        turn: 1,
        type: "orchestrator",
        payload: {
          intent: "ask",
          agreement: [],
          disagreement: [],
          bestAnswer: "yo",
        },
      },
    ]);
    expect(s).toContain("turn 1");
    expect(s).toContain("you: hi");
    expect(s).toContain("gitgang: yo");
  });

  test("formatSessionsList shows message when empty", () => {
    expect(formatSessionsList([])).toContain("No sessions");
  });
});

import { cleanOrphanedWorktrees } from "./cli";
import { PassThrough } from "node:stream";

describe("cleanOrphanedWorktrees", () => {
  test("removes turn-N dirs and reports count", () => {
    const dir = createTempDir();
    mkdirSync(join(dir, "turn-1"), { recursive: true });
    mkdirSync(join(dir, "turn-2"), { recursive: true });
    mkdirSync(join(dir, "not-a-turn"), { recursive: true });
    const stderr = new PassThrough();
    const chunks: Buffer[] = [];
    stderr.on("data", (c) => chunks.push(c));
    const count = cleanOrphanedWorktrees(dir, stderr);
    expect(count).toBe(2);
    expect(existsSync(join(dir, "turn-1"))).toBe(false);
    expect(existsSync(join(dir, "turn-2"))).toBe(false);
    expect(existsSync(join(dir, "not-a-turn"))).toBe(true);
    expect(Buffer.concat(chunks).toString("utf8")).toMatch(/cleaned up 2/);
    cleanup(dir);
  });

  test("returns 0 silently when no orphans", () => {
    const dir = createTempDir();
    const stderr = new PassThrough();
    const chunks: Buffer[] = [];
    stderr.on("data", (c) => chunks.push(c));
    expect(cleanOrphanedWorktrees(dir, stderr)).toBe(0);
    expect(chunks).toHaveLength(0);
    cleanup(dir);
  });

  test("returns 0 when worktreesDir does not exist", () => {
    const stderr = new PassThrough();
    expect(cleanOrphanedWorktrees("/nonexistent/path/xyz", stderr)).toBe(0);
  });
});

describe("sessions export subcommand parsing", () => {
  test("'sessions export <id>' parses to subcommand without outputPath", () => {
    const p = parseArgs(["sessions", "export", "abc123"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_export",
      id: "abc123",
      outputPath: undefined,
    });
  });

  test("'sessions export <id> --output PATH' captures path", () => {
    const p = parseArgs(["sessions", "export", "abc123", "--output", "/tmp/x.md"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_export",
      id: "abc123",
      outputPath: "/tmp/x.md",
    });
  });

  test("'sessions export <id> -o PATH' short form also works", () => {
    const p = parseArgs(["sessions", "export", "abc123", "-o", "/tmp/y.md"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_export",
      id: "abc123",
      outputPath: "/tmp/y.md",
    });
  });

  test("'sessions export' without id throws helpful usage error", () => {
    expect(() => parseArgs(["sessions", "export"])).toThrow(/usage:/);
  });

  test("'sessions list' still parses correctly (no regression)", () => {
    const p = parseArgs(["sessions", "list"]);
    expect(p.subcommand).toMatchObject({ kind: "sessions_list" });
  });

  test("'sessions show <id>' still parses correctly (no regression)", () => {
    const p = parseArgs(["sessions", "show", "abc"]);
    expect(p.subcommand).toEqual({ kind: "sessions_show", id: "abc" });
  });
});

describe("formatSessionsList — Topic column", () => {
  test("renders Topic column from session.topic", () => {
    const out = formatSessionsList([
      {
        id: "2026-04-15T03-30-00-aaa",
        startedAt: "2026-04-15T03:30:00Z",
        turns: 2,
        reviewer: "codex",
        topic: "How does auth work in this project?",
      },
    ]);
    expect(out).toContain("Topic");
    expect(out).toContain("How does auth work in this project?");
  });

  test("topic missing renders as em-dash", () => {
    const out = formatSessionsList([
      {
        id: "2026-04-15T03-30-00-bbb",
        startedAt: "2026-04-15T03:30:00Z",
        turns: 0,
        reviewer: "codex",
      },
    ]);
    const lastLine = out.split("\n").filter(Boolean).pop()!;
    expect(lastLine).toContain("—");
  });

  test("topic truncates to 50 chars with ellipsis", () => {
    const long = "a".repeat(120);
    const out = formatSessionsList([
      {
        id: "2026-04-15T03-30-00-ccc",
        startedAt: "2026-04-15T03:30:00Z",
        turns: 1,
        reviewer: "codex",
        topic: long,
      },
    ]);
    const lastLine = out.split("\n").filter(Boolean).pop()!;
    // Look for the topic portion at end of line
    expect(lastLine).toContain("…");
    // Should not contain all 120 chars
    expect(lastLine).not.toContain("a".repeat(120));
  });

  test("topic uses only first line of multi-line message", () => {
    const out = formatSessionsList([
      {
        id: "2026-04-15T03-30-00-ddd",
        startedAt: "2026-04-15T03:30:00Z",
        turns: 1,
        reviewer: "codex",
        topic: "first line\nsecond line\nthird line",
      },
    ]);
    expect(out).toContain("first line");
    expect(out).not.toContain("second line");
    expect(out).not.toContain("third line");
  });

  test("blank topic falls back to em-dash", () => {
    const out = formatSessionsList([
      {
        id: "2026-04-15T03-30-00-eee",
        startedAt: "2026-04-15T03:30:00Z",
        turns: 0,
        reviewer: "codex",
        topic: "   \n  ",
      },
    ]);
    const lastLine = out.split("\n").filter(Boolean).pop()!;
    expect(lastLine).toContain("—");
  });

  test("header uses Topic instead of Reviewer", () => {
    const out = formatSessionsList([]);
    // Empty list still says "No sessions found", not the header.
    expect(out).toContain("No sessions found");
    const out2 = formatSessionsList([
      {
        id: "x",
        startedAt: "y",
        turns: 0,
        reviewer: "codex",
        topic: "hello",
      },
    ]);
    expect(out2).toContain("Topic");
    expect(out2.split("\n")[0]).not.toContain("Reviewer");
  });
});

describe("sessions delete subcommand parsing", () => {
  test("'sessions delete <id>' parses without confirmation", () => {
    const p = parseArgs(["sessions", "delete", "abc"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_delete",
      id: "abc",
      confirmed: false,
    });
  });

  test("'sessions delete <id> --yes' marks confirmed", () => {
    const p = parseArgs(["sessions", "delete", "abc", "--yes"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_delete",
      id: "abc",
      confirmed: true,
    });
  });

  test("'sessions delete <id> -y' short form also works", () => {
    const p = parseArgs(["sessions", "delete", "abc", "-y"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_delete",
      id: "abc",
      confirmed: true,
    });
  });

  test("'sessions delete' without id throws helpful usage error", () => {
    expect(() => parseArgs(["sessions", "delete"])).toThrow(/usage:/);
  });
});

describe("sessions prune subcommand parsing", () => {
  test("'sessions prune --older-than 30d' parses without confirmation", () => {
    const p = parseArgs(["sessions", "prune", "--older-than", "30d"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_prune",
      olderThan: "30d",
      confirmed: false,
    });
  });

  test("'sessions prune --older-than 30d --yes' marks confirmed", () => {
    const p = parseArgs(["sessions", "prune", "--older-than", "30d", "--yes"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_prune",
      olderThan: "30d",
      confirmed: true,
    });
  });

  test("'sessions prune --older-than 12h -y' short form", () => {
    const p = parseArgs(["sessions", "prune", "--older-than", "12h", "-y"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_prune",
      olderThan: "12h",
      confirmed: true,
    });
  });

  test("'sessions prune' without --older-than throws helpful usage", () => {
    expect(() => parseArgs(["sessions", "prune"])).toThrow(/usage:/);
    expect(() => parseArgs(["sessions", "prune"])).toThrow(/older-than/);
  });

  test("flag order tolerated: --yes before --older-than", () => {
    const p = parseArgs(["sessions", "prune", "--yes", "--older-than", "7d"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_prune",
      olderThan: "7d",
      confirmed: true,
    });
  });
});

describe("sessions search subcommand parsing", () => {
  test("'sessions search auth' captures query", () => {
    const p = parseArgs(["sessions", "search", "auth"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_search",
      query: "auth",
      limit: 10,
    });
  });

  test("multi-word query is joined", () => {
    const p = parseArgs(["sessions", "search", "JWT", "refactor"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_search",
      query: "JWT refactor",
      limit: 10,
    });
  });

  test("--limit overrides default", () => {
    const p = parseArgs(["sessions", "search", "auth", "--limit", "3"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_search",
      query: "auth",
      limit: 3,
    });
  });

  test("-n short form for limit", () => {
    const p = parseArgs(["sessions", "search", "auth", "-n", "5"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_search",
      query: "auth",
      limit: 5,
    });
  });

  test("invalid limit value falls back to default", () => {
    const p = parseArgs(["sessions", "search", "auth", "--limit", "abc"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_search",
      query: "auth",
      limit: 10,
    });
  });

  test("zero or negative limit falls back to default", () => {
    expect(parseArgs(["sessions", "search", "auth", "--limit", "0"]).subcommand).toMatchObject({
      limit: 10,
    });
    expect(parseArgs(["sessions", "search", "auth", "--limit", "-3"]).subcommand).toMatchObject({
      limit: 10,
    });
  });
});

describe("sessions stats subcommand parsing", () => {
  test("'sessions stats <id>' parses to subcommand", () => {
    const p = parseArgs(["sessions", "stats", "abc123"]);
    expect(p.subcommand).toMatchObject({
      kind: "sessions_stats",
      id: "abc123",
    });
  });

  test("'sessions stats' without id throws helpful usage", () => {
    expect(() => parseArgs(["sessions", "stats"])).toThrow(/usage:/);
  });

  test("usage message includes stats entry after show", () => {
    try {
      parseArgs(["sessions", "bogus"]);
    } catch (e) {
      expect((e as Error).message).toContain("gg sessions stats");
    }
  });
});

describe("completions subcommand parsing", () => {
  test("'completions bash' parses", () => {
    const p = parseArgs(["completions", "bash"]);
    expect(p.subcommand).toEqual({ kind: "completions", shell: "bash" });
  });

  test("'completions zsh' parses", () => {
    const p = parseArgs(["completions", "zsh"]);
    expect(p.subcommand).toEqual({ kind: "completions", shell: "zsh" });
  });

  test("'completions fish' parses", () => {
    const p = parseArgs(["completions", "fish"]);
    expect(p.subcommand).toEqual({ kind: "completions", shell: "fish" });
  });

  test("'completions' without shell throws helpful usage", () => {
    expect(() => parseArgs(["completions"])).toThrow(/usage:/);
  });

  test("'completions bogus' throws", () => {
    expect(() => parseArgs(["completions", "bogus"])).toThrow(/bash\|zsh\|fish/);
  });
});

describe("--json flag parsing", () => {
  test("sessions list --json sets json=true", () => {
    const p = parseArgs(["sessions", "list", "--json"]);
    expect(p.subcommand).toEqual({ kind: "sessions_list", json: true });
  });

  test("sessions list without --json sets json=false", () => {
    const p = parseArgs(["sessions", "list"]);
    expect(p.subcommand).toEqual({ kind: "sessions_list", json: false });
  });

  test("sessions stats <id> --json sets json=true", () => {
    const p = parseArgs(["sessions", "stats", "abc", "--json"]);
    expect(p.subcommand).toEqual({
      kind: "sessions_stats",
      id: "abc",
      json: true,
    });
  });

  test("doctor --json sets json=true", () => {
    const p = parseArgs(["doctor", "--json"]);
    expect(p.subcommand).toEqual({ kind: "doctor", json: true });
  });

  test("doctor without --json sets json=false", () => {
    const p = parseArgs(["doctor"]);
    expect(p.subcommand).toEqual({ kind: "doctor", json: false });
  });
});
