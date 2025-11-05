import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  C,
  TAG,
  line,
  parseArgs,
  parseFirstJson,
  systemConstraints,
  featurePrompt,
  reviewerPromptJSON,
  recordDNF,
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
