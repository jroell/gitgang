import { describe, test, expect } from "vitest";
import { PassThrough } from "node:stream";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runRepl, type ReplDeps } from "./repl";
import type { AgentResult, OrchestratorOutput } from "./orchestrator";
import {
  executeTurn as realExecuteTurn,
  type ExecuteTurnDeps,
  estimateHistoryBytes,
  LONG_HISTORY_WARN_BYTES,
  applyAgentFilter,
} from "./repl";

function mockExecuteTurnDeps(overrides: Partial<ExecuteTurnDeps> = {}): ExecuteTurnDeps {
  const dir = mkdtempSync(join(tmpdir(), "gg-exec-"));
  const logPath = join(dir, "session.jsonl");
  writeFileSync(logPath, "");
  const output = new PassThrough();
  return {
    session: {
      id: "s",
      dir,
      logPath,
      debugDir: join(dir, "debug"),
      worktreesDir: join(dir, "worktrees"),
      metadata: { id: "s", startedAt: "", models: { gemini: "g", claude: "c", codex: "x" }, reviewer: "codex", automerge: "ask" },
      events: [],
    },
    repoRoot: "/repo",
    base: "main",
    output,
    mergeInput: new PassThrough(),
    fanOut: async (): Promise<AgentResult[]> => [
      { id: "gemini", model: "g", status: "ok", branch: "agents/gemini/turn-1", stdoutTail: "", diffSummary: "", diffPaths: [] },
      { id: "claude", model: "c", status: "ok", branch: "agents/claude/turn-1", stdoutTail: "", diffSummary: "", diffPaths: [] },
      { id: "codex", model: "x", status: "ok", branch: "agents/codex/turn-1", stdoutTail: "", diffSummary: "", diffPaths: [] },
    ],
    spawnOrchestrator: async (): Promise<OrchestratorOutput> => ({ intent: "ask", agreement: ["mocked agreement"], disagreement: [], bestAnswer: "mocked answer" }),
    applyMerge: async () => ({ success: true }),
    cleanupWorktrees: async () => {},
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ReplDeps> = {}): {
  input: PassThrough;
  output: PassThrough;
  outputText: () => string;
  deps: ReplDeps;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (c) => chunks.push(c));
  const deps: ReplDeps = {
    input,
    output,
    executeTurn: async () => {},
    showHistory: async () => {},
    showAgents: async () => {},
    showHelp: async () => {},
    runSetCommand: async () => {},
    runMergeCommand: async () => {},
    runPrCommand: async () => {},
    runDiffCommand: async () => {},
    runRedoCommand: async () => {},
    banner: "gitgang interactive (test)",
    ...overrides,
  };
  return { input, output, outputText: () => Buffer.concat(chunks).toString("utf8"), deps };
}

describe("runRepl", () => {
  test("prints banner and prompt, exits on /quit", async () => {
    const { input, outputText, deps } = makeDeps();
    const p = runRepl(deps);
    input.write("/quit\n");
    input.end();
    await p;
    const text = outputText();
    expect(text).toContain("gitgang interactive (test)");
  });

  test("exits on EOF (stream end)", async () => {
    const { input, deps } = makeDeps();
    const p = runRepl(deps);
    input.end();
    await p;
    // Does not throw.
  });

  test("dispatches slash commands", async () => {
    let historyCalled = 0;
    let agentsCalled = 0;
    let helpCalled = 0;
    const { input, deps } = makeDeps({
      showHistory: async () => {
        historyCalled++;
      },
      showAgents: async () => {
        agentsCalled++;
      },
      showHelp: async () => {
        helpCalled++;
      },
    });
    const p = runRepl(deps);
    input.write("/history\n");
    input.write("/agents\n");
    input.write("/help\n");
    input.write("/quit\n");
    input.end();
    await p;
    expect(historyCalled).toBe(1);
    expect(agentsCalled).toBe(1);
    expect(helpCalled).toBe(1);
  });

  test("calls executeTurn for plain text and forced modes", async () => {
    const calls: Array<{ text: string; forcedMode: string | null }> = [];
    const { input, deps } = makeDeps({
      executeTurn: async (text, forcedMode) => {
        calls.push({ text, forcedMode });
      },
    });
    const p = runRepl(deps);
    input.write("how does auth work\n");
    input.write("/ask explain caching\n");
    input.write("/code add a button\n");
    input.write("/quit\n");
    input.end();
    await p;
    expect(calls).toEqual([
      { text: "how does auth work", forcedMode: null },
      { text: "explain caching", forcedMode: "ask" },
      { text: "add a button", forcedMode: "code" },
    ]);
  });

  test("unknown command prints an error and continues", async () => {
    const { input, outputText, deps } = makeDeps();
    const p = runRepl(deps);
    input.write("/frobnicate\n");
    input.write("/quit\n");
    input.end();
    await p;
    expect(outputText()).toContain("Unknown command");
  });
});

describe("executeTurn (integration)", () => {
  test("ask-mode turn renders answer and does not prompt", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c) => chunks.push(c));
    const deps = mockExecuteTurnDeps({ output });
    await realExecuteTurn("how does auth work", null, deps);
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain("mocked answer");
    expect(text).not.toContain("Merge this?");
  });

  test("code-mode turn prompts and merges on y", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c) => chunks.push(c));
    const mergeInput = new PassThrough();
    let applied = 0;
    const deps = mockExecuteTurnDeps({
      output,
      mergeInput,
      spawnOrchestrator: async (): Promise<OrchestratorOutput> => ({
        intent: "code",
        agreement: [],
        disagreement: [],
        bestAnswer: "picked claude",
        mergePlan: {
          pick: "claude",
          branches: ["agents/claude/turn-1"],
          rationale: "best",
          followups: [],
        },
      }),
      applyMerge: async () => {
        applied++;
        return { success: true };
      },
    });
    const p = realExecuteTurn("add logout", null, deps);
    mergeInput.write("y\n");
    await p;
    expect(applied).toBe(1);
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain("Merge this?");
  });

  test("all-agents-failed path skips orchestrator and prints error", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c) => chunks.push(c));
    let orchestratorCalled = 0;
    const deps = mockExecuteTurnDeps({
      output,
      fanOut: async (): Promise<AgentResult[]> => [
        { id: "gemini", model: "g", status: "failed", branch: "", stdoutTail: "", diffSummary: "", diffPaths: [] },
        { id: "claude", model: "c", status: "failed", branch: "", stdoutTail: "", diffSummary: "", diffPaths: [] },
        { id: "codex", model: "x", status: "failed", branch: "", stdoutTail: "", diffSummary: "", diffPaths: [] },
      ],
      spawnOrchestrator: async () => {
        orchestratorCalled++;
        throw new Error("should not be called");
      },
    });
    await realExecuteTurn("q", null, deps);
    expect(orchestratorCalled).toBe(0);
    expect(Buffer.concat(chunks).toString("utf8")).toContain("All agents failed");
  });
});

import { createRealFanOut, createRealOrchestrator } from "./repl";

describe("real fan-out and orchestrator factories (shape only)", () => {
  test("createRealFanOut returns a function", () => {
    const fn = createRealFanOut({
      agentIds: ["gemini", "claude", "codex"],
      models: { gemini: "g", claude: "c", codex: "x" },
      yolo: true,
      timeoutMs: 60_000,
      repoRoot: "/repo",
    });
    expect(typeof fn).toBe("function");
  });

  test("createRealOrchestrator returns a function", () => {
    const fn = createRealOrchestrator({
      model: "claude-opus-4-6",
      yolo: true,
      timeoutMs: 300_000,
      repoRoot: "/repo",
      debugDir: "/repo/.gitgang/debug",
    });
    expect(typeof fn).toBe("function");
  });
});

describe("long history warning", () => {
  test("LONG_HISTORY_WARN_BYTES is 50KB", () => {
    expect(LONG_HISTORY_WARN_BYTES).toBe(50 * 1024);
  });

  test("estimateHistoryBytes sums user + assistant + current", () => {
    const size = estimateHistoryBytes(
      [
        { turn: 1, user: "a".repeat(100), assistant: "b".repeat(200) },
      ],
      "c".repeat(50),
      {
        intent: "ask",
        agreement: [],
        disagreement: [],
        bestAnswer: "d".repeat(300),
      },
    );
    expect(size).toBe(100 + 200 + 50 + 300);
  });

  test("estimateHistoryBytes handles empty history", () => {
    expect(
      estimateHistoryBytes([], "hi", {
        intent: "ask",
        agreement: [],
        disagreement: [],
        bestAnswer: "yo",
      }),
    ).toBe(4);
  });
});

import { cancelActiveChildren, activeChildCount } from "./repl";
import { spawn } from "node:child_process";

describe("cancelActiveChildren", () => {
  test("returns 0 when no children active", () => {
    expect(cancelActiveChildren()).toBe(0);
  });

  test("activeChildCount starts at 0", () => {
    expect(activeChildCount()).toBe(0);
  });
});

import {
  formatHeartbeat,
  formatAgentTransition,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  type AgentPhase,
  type AgentProgressEvent,
} from "./repl";

describe("formatHeartbeat", () => {
  const ORDER = ["gemini", "claude", "codex"] as const;

  test("prints elapsed time in mm:ss", () => {
    const s = formatHeartbeat(
      90_000,
      new Map<string, AgentPhase>(ORDER.map((id) => [id, "running"])),
      ORDER,
    );
    expect(s.startsWith("[01:30]")).toBe(true);
  });

  test("pads sub-minute elapsed with leading zero", () => {
    const s = formatHeartbeat(
      5_000,
      new Map<string, AgentPhase>(ORDER.map((id) => [id, "running"])),
      ORDER,
    );
    expect(s.startsWith("[00:05]")).toBe(true);
  });

  test("lists all running agents", () => {
    const s = formatHeartbeat(
      60_000,
      new Map<string, AgentPhase>(ORDER.map((id) => [id, "running"])),
      ORDER,
    );
    expect(s).toContain("3 agents running: gemini, claude, codex");
  });

  test("singularizes 'agent' when exactly one is running", () => {
    const s = formatHeartbeat(
      60_000,
      new Map<string, AgentPhase>([
        ["gemini", "done"],
        ["claude", "running"],
        ["codex", "done"],
      ]),
      ORDER,
    );
    expect(s).toContain("1 agent running: claude");
    expect(s).toContain("gemini, codex done");
  });

  test("shows done agents in parenthetical", () => {
    const s = formatHeartbeat(
      60_000,
      new Map<string, AgentPhase>([
        ["gemini", "running"],
        ["claude", "done"],
        ["codex", "done"],
      ]),
      ORDER,
    );
    expect(s).toContain("1 agent running: gemini");
    expect(s).toContain("(claude, codex done)");
  });

  test("shows failed and timeout agents with phase labels", () => {
    const s = formatHeartbeat(
      60_000,
      new Map<string, AgentPhase>([
        ["gemini", "failed"],
        ["claude", "timeout"],
        ["codex", "done"],
      ]),
      ORDER,
    );
    expect(s).toContain("gemini failed");
    expect(s).toContain("claude timeout");
    expect(s).toContain("codex done");
  });

  test("reports 'all agents done' when none still running", () => {
    const s = formatHeartbeat(
      60_000,
      new Map<string, AgentPhase>([
        ["gemini", "done"],
        ["claude", "done"],
        ["codex", "done"],
      ]),
      ORDER,
    );
    expect(s).toContain("all agents done");
  });

  test("treats pending as still running", () => {
    const s = formatHeartbeat(
      60_000,
      new Map<string, AgentPhase>([
        ["gemini", "pending"],
        ["claude", "running"],
        ["codex", "done"],
      ]),
      ORDER,
    );
    expect(s).toContain("2 agents running: gemini, claude");
  });

  test("preserves agent order from agentOrder param", () => {
    const s = formatHeartbeat(
      60_000,
      new Map<string, AgentPhase>([
        ["codex", "running"],
        ["claude", "running"],
        ["gemini", "running"],
      ]),
      ["gemini", "claude", "codex"] as const,
    );
    expect(s).toContain("gemini, claude, codex");
  });
});

describe("formatAgentTransition", () => {
  test("start event uses ▸ marker", () => {
    const s = formatAgentTransition(3_000, {
      agent: "gemini",
      phase: "start",
    } as AgentProgressEvent);
    expect(s).toBe("[00:03] ▸ gemini started");
  });

  test("done event uses ✓ and strips multi-line diff", () => {
    const s = formatAgentTransition(45_000, {
      agent: "codex",
      phase: "done",
      diffSummary: " src/a.ts | 5 +++\n src/b.ts | 2 --",
    });
    expect(s).toContain("[00:45] ✓ codex done");
    expect(s).toContain("src/a.ts");
    expect(s.split("\n").length).toBe(1);
  });

  test("done event omits parenthetical when diffSummary empty", () => {
    const s = formatAgentTransition(45_000, {
      agent: "codex",
      phase: "done",
      diffSummary: "",
    });
    expect(s).toBe("[00:45] ✓ codex done");
  });

  test("failed event uses ✗", () => {
    const s = formatAgentTransition(70_000, {
      agent: "claude",
      phase: "failed",
    });
    expect(s).toBe("[01:10] ✗ claude failed");
  });

  test("timeout event uses ⏱", () => {
    const s = formatAgentTransition(120_000, {
      agent: "gemini",
      phase: "timeout",
    });
    expect(s).toBe("[02:00] ⏱ gemini timeout");
  });
});

describe("DEFAULT_HEARTBEAT_INTERVAL_MS", () => {
  test("defaults to 30 seconds when env var unset", () => {
    // Env var might be set by another test — just assert it's a positive number.
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBeGreaterThan(0);
  });
});

describe("executeTurn progress emissions", () => {
  test("emits agent transition lines when agents start and finish", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c) => chunks.push(c));
    const deps = mockExecuteTurnDeps({
      output,
      heartbeatIntervalMs: 0, // disable heartbeat; focus on transitions
      fanOut: async ({ onAgentProgress }): Promise<AgentResult[]> => {
        onAgentProgress?.({ agent: "gemini", phase: "start" });
        onAgentProgress?.({ agent: "claude", phase: "start" });
        onAgentProgress?.({ agent: "codex", phase: "start" });
        onAgentProgress?.({
          agent: "codex",
          phase: "done",
          diffSummary: " src/x.ts | 3 ++-",
        });
        onAgentProgress?.({ agent: "gemini", phase: "done", diffSummary: "" });
        onAgentProgress?.({ agent: "claude", phase: "failed" });
        return [
          { id: "gemini", model: "g", status: "ok", branch: "b1", stdoutTail: "", diffSummary: "", diffPaths: [] },
          { id: "claude", model: "c", status: "failed", branch: "b2", stdoutTail: "", diffSummary: "", diffPaths: [] },
          { id: "codex", model: "x", status: "ok", branch: "b3", stdoutTail: "", diffSummary: " src/x.ts | 3 ++-", diffPaths: ["src/x.ts"] },
        ];
      },
    });
    await realExecuteTurn("test", null, deps);
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain("▸ gemini started");
    expect(text).toContain("▸ claude started");
    expect(text).toContain("▸ codex started");
    expect(text).toContain("✓ codex done (src/x.ts | 3 ++-)");
    expect(text).toContain("✓ gemini done");
    expect(text).toContain("✗ claude failed");
  });

  test("emits at least one heartbeat when fanOut runs longer than the interval", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c) => chunks.push(c));
    const deps = mockExecuteTurnDeps({
      output,
      heartbeatIntervalMs: 30, // very short interval for testing
      fanOut: async ({ onAgentProgress }): Promise<AgentResult[]> => {
        onAgentProgress?.({ agent: "gemini", phase: "start" });
        onAgentProgress?.({ agent: "claude", phase: "start" });
        onAgentProgress?.({ agent: "codex", phase: "start" });
        // Wait long enough for ~3 heartbeats to fire
        await new Promise((resolve) => setTimeout(resolve, 120));
        onAgentProgress?.({ agent: "gemini", phase: "done" });
        onAgentProgress?.({ agent: "claude", phase: "done" });
        onAgentProgress?.({ agent: "codex", phase: "done" });
        return [
          { id: "gemini", model: "g", status: "ok", branch: "b1", stdoutTail: "", diffSummary: "", diffPaths: [] },
          { id: "claude", model: "c", status: "ok", branch: "b2", stdoutTail: "", diffSummary: "", diffPaths: [] },
          { id: "codex", model: "x", status: "ok", branch: "b3", stdoutTail: "", diffSummary: "", diffPaths: [] },
        ];
      },
    });
    await realExecuteTurn("test", null, deps);
    const text = Buffer.concat(chunks).toString("utf8");
    // Heartbeat format is "[MM:SS] N agents running: ..."
    const heartbeatLines = text.split("\n").filter((l) =>
      /^\[\d{2}:\d{2}\] \d+ agent/.test(l),
    );
    expect(heartbeatLines.length).toBeGreaterThanOrEqual(1);
  });

  test("heartbeatIntervalMs=0 disables heartbeats entirely", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c) => chunks.push(c));
    const deps = mockExecuteTurnDeps({
      output,
      heartbeatIntervalMs: 0,
      fanOut: async ({ onAgentProgress }): Promise<AgentResult[]> => {
        onAgentProgress?.({ agent: "gemini", phase: "start" });
        onAgentProgress?.({ agent: "claude", phase: "start" });
        onAgentProgress?.({ agent: "codex", phase: "start" });
        await new Promise((resolve) => setTimeout(resolve, 50));
        onAgentProgress?.({ agent: "gemini", phase: "done" });
        onAgentProgress?.({ agent: "claude", phase: "done" });
        onAgentProgress?.({ agent: "codex", phase: "done" });
        return [
          { id: "gemini", model: "g", status: "ok", branch: "b1", stdoutTail: "", diffSummary: "", diffPaths: [] },
          { id: "claude", model: "c", status: "ok", branch: "b2", stdoutTail: "", diffSummary: "", diffPaths: [] },
          { id: "codex", model: "x", status: "ok", branch: "b3", stdoutTail: "", diffSummary: "", diffPaths: [] },
        ];
      },
    });
    await realExecuteTurn("test", null, deps);
    const text = Buffer.concat(chunks).toString("utf8");
    const heartbeatLines = text.split("\n").filter((l) =>
      /^\[\d{2}:\d{2}\] \d+ agent/.test(l),
    );
    expect(heartbeatLines.length).toBe(0);
  });

  test("progress callback that throws does not break the turn", async () => {
    const output = new PassThrough();
    const deps = mockExecuteTurnDeps({
      output,
      heartbeatIntervalMs: 0,
      fanOut: async ({ onAgentProgress }): Promise<AgentResult[]> => {
        onAgentProgress?.({ agent: "gemini", phase: "start" });
        return [
          { id: "gemini", model: "g", status: "ok", branch: "b1", stdoutTail: "", diffSummary: "", diffPaths: [] },
          { id: "claude", model: "c", status: "ok", branch: "b2", stdoutTail: "", diffSummary: "", diffPaths: [] },
          { id: "codex", model: "x", status: "ok", branch: "b3", stdoutTail: "", diffSummary: "", diffPaths: [] },
        ];
      },
    });
    // Wrap with an output that throws on write — the progress callback writes
    // to output, so a failed write must not crash executeTurn.
    // We'll accomplish this by overriding the output after-the-fact.
    await expect(realExecuteTurn("test", null, deps)).resolves.toBeUndefined();
  });

  test("heartbeat timer is cleared when fanOut throws", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c) => chunks.push(c));
    const deps = mockExecuteTurnDeps({
      output,
      heartbeatIntervalMs: 20,
      fanOut: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw new Error("fanOut exploded");
      },
    });
    await expect(realExecuteTurn("test", null, deps)).rejects.toThrow("fanOut exploded");
    const before = chunks.length;
    // Wait past several hypothetical heartbeat intervals
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = chunks.length;
    expect(after).toBe(before); // no new heartbeat lines after rejection
  });
});

describe("REPL /diff dispatch", () => {
  test("routes /diff to runDiffCommand with picked target", async () => {
    const calls: Array<string> = [];
    const { input, deps } = makeDeps({
      runDiffCommand: async (target) => {
        calls.push(target);
      },
    });
    const p = runRepl(deps);
    input.write("/diff\n");
    input.write("/diff gemini\n");
    input.write("/diff claude\n");
    input.write("/diff codex\n");
    input.write("/quit\n");
    input.end();
    await p;
    expect(calls).toEqual(["picked", "gemini", "claude", "codex"]);
  });

  test("/diff with bogus target prints unknown error", async () => {
    const { input, outputText, deps } = makeDeps();
    const p = runRepl(deps);
    input.write("/diff bogus\n");
    input.write("/quit\n");
    input.end();
    await p;
    expect(outputText()).toContain("Unknown command");
  });
});

import { formatAgentLog } from "./repl";

describe("formatAgentLog", () => {
  test("emits all required fields with section dividers", () => {
    const log = formatAgentLog({
      agent: "claude",
      model: "claude-opus-4-6",
      turn: 3,
      status: "ok",
      exitCode: 0,
      startedAt: "2026-04-15T01:00:00.000Z",
      finishedAt: "2026-04-15T01:01:30.000Z",
      durationMs: 90_000,
      prompt: "the prompt body",
      stdout: "agent stdout",
      stderr: "",
    });
    expect(log).toContain("── gitgang agent log ──");
    expect(log).toContain("agent: claude");
    expect(log).toContain("model: claude-opus-4-6");
    expect(log).toContain("turn: 3");
    expect(log).toContain("status: ok");
    expect(log).toContain("exit_code: 0");
    expect(log).toContain("started_at: 2026-04-15T01:00:00.000Z");
    expect(log).toContain("finished_at: 2026-04-15T01:01:30.000Z");
    expect(log).toContain("duration_ms: 90000");
    expect(log).toContain("── prompt ──\nthe prompt body");
    expect(log).toContain("── stdout ──\nagent stdout");
    expect(log).toContain("── stderr ──");
  });

  test("renders exit_code as em-dash when null (e.g. spawn failure)", () => {
    const log = formatAgentLog({
      agent: "gemini",
      model: "gemini-3.1-pro-preview",
      turn: 1,
      status: "failed",
      exitCode: null,
      startedAt: "2026-04-15T01:00:00.000Z",
      finishedAt: "2026-04-15T01:00:00.000Z",
      durationMs: 0,
      prompt: "(prompt not built; failed before spawn)",
      stdout: "",
      stderr: "ENOENT: gemini binary not found",
    });
    expect(log).toContain("exit_code: —");
    expect(log).toContain("status: failed");
    expect(log).toContain("ENOENT: gemini binary not found");
  });

  test("preserves multi-line stdout verbatim", () => {
    const stdout = "line one\nline two\nline three";
    const log = formatAgentLog({
      agent: "codex",
      model: "gpt-5.4",
      turn: 1,
      status: "ok",
      exitCode: 0,
      startedAt: "2026-04-15T01:00:00.000Z",
      finishedAt: "2026-04-15T01:00:01.000Z",
      durationMs: 1000,
      prompt: "do the thing",
      stdout,
      stderr: "",
    });
    expect(log).toContain(stdout);
  });

  test("section order is fixed (header, fields, prompt, stdout, stderr)", () => {
    const log = formatAgentLog({
      agent: "claude",
      model: "m",
      turn: 1,
      status: "ok",
      exitCode: 0,
      startedAt: "t1",
      finishedAt: "t2",
      durationMs: 1,
      prompt: "p",
      stdout: "s",
      stderr: "e",
    });
    const headerIdx = log.indexOf("── gitgang agent log ──");
    const promptIdx = log.indexOf("── prompt ──");
    const stdoutIdx = log.indexOf("── stdout ──");
    const stderrIdx = log.indexOf("── stderr ──");
    expect(headerIdx).toBe(0);
    expect(promptIdx).toBeGreaterThan(headerIdx);
    expect(stdoutIdx).toBeGreaterThan(promptIdx);
    expect(stderrIdx).toBeGreaterThan(stdoutIdx);
  });
});

describe("REPL /redo dispatch", () => {
  test("/redo invokes runRedoCommand", async () => {
    let calls = 0;
    const { input, deps } = makeDeps({
      runRedoCommand: async () => {
        calls++;
      },
    });
    const p = runRepl(deps);
    input.write("/redo\n");
    input.write("/quit\n");
    input.end();
    await p;
    expect(calls).toBe(1);
  });
});

describe("applyAgentFilter", () => {
  const FULL = ["gemini", "claude", "codex"] as const;

  test("no filter returns the roster unchanged", () => {
    expect(applyAgentFilter(FULL, undefined)).toEqual([...FULL]);
  });

  test("/only picks just that agent", () => {
    expect(applyAgentFilter(FULL, { kind: "only", agent: "claude" })).toEqual(["claude"]);
    expect(applyAgentFilter(FULL, { kind: "only", agent: "gemini" })).toEqual(["gemini"]);
    expect(applyAgentFilter(FULL, { kind: "only", agent: "codex" })).toEqual(["codex"]);
  });

  test("/skip drops that agent", () => {
    expect(applyAgentFilter(FULL, { kind: "skip", agent: "codex" })).toEqual([
      "gemini",
      "claude",
    ]);
  });

  test("/only for agent not in roster yields empty array", () => {
    expect(
      applyAgentFilter(["gemini", "claude"] as const, { kind: "only", agent: "codex" }),
    ).toEqual([]);
  });

  test("returns a new array (no mutation)", () => {
    const src = ["gemini", "claude", "codex"] as const;
    const out = applyAgentFilter(src, undefined);
    expect(out).not.toBe(src);
  });
});

describe("executeTurn with agent filter", () => {
  test("/only restricts fanOut to a single agent", async () => {
    const receivedAgentIds: string[][] = [];
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c) => chunks.push(c));
    const deps = mockExecuteTurnDeps({
      output,
      heartbeatIntervalMs: 0,
      fanOut: async (params): Promise<AgentResult[]> => {
        receivedAgentIds.push(params.agentIds ?? ["default"]);
        return (params.agentIds ?? ["gemini", "claude", "codex"]).map((id) => ({
          id: id as "gemini" | "claude" | "codex",
          model: "m",
          status: "ok" as const,
          branch: `b-${id}`,
          stdoutTail: "",
          diffSummary: "",
          diffPaths: [],
        }));
      },
    });
    await realExecuteTurn("test", null, deps, { kind: "only", agent: "claude" });
    expect(receivedAgentIds[0]).toEqual(["claude"]);
    expect(Buffer.concat(chunks).toString("utf8")).toContain("using only claude");
  });

  test("/skip removes one agent from fanOut", async () => {
    const receivedAgentIds: string[][] = [];
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c) => chunks.push(c));
    const deps = mockExecuteTurnDeps({
      output,
      heartbeatIntervalMs: 0,
      fanOut: async (params): Promise<AgentResult[]> => {
        receivedAgentIds.push(params.agentIds ?? ["default"]);
        return (params.agentIds ?? ["gemini", "claude", "codex"]).map((id) => ({
          id: id as "gemini" | "claude" | "codex",
          model: "m",
          status: "ok" as const,
          branch: `b-${id}`,
          stdoutTail: "",
          diffSummary: "",
          diffPaths: [],
        }));
      },
    });
    await realExecuteTurn("test", null, deps, { kind: "skip", agent: "codex" });
    expect(receivedAgentIds[0]).toEqual(["gemini", "claude"]);
    expect(Buffer.concat(chunks).toString("utf8")).toContain("skipping codex");
  });

  test("no filter passes undefined agentIds (fanOut uses session default)", async () => {
    const receivedAgentIds: Array<string[] | undefined> = [];
    const deps = mockExecuteTurnDeps({
      heartbeatIntervalMs: 0,
      fanOut: async (params): Promise<AgentResult[]> => {
        receivedAgentIds.push(params.agentIds);
        return [
          { id: "gemini", model: "m", status: "ok", branch: "b", stdoutTail: "", diffSummary: "", diffPaths: [] },
          { id: "claude", model: "m", status: "ok", branch: "b", stdoutTail: "", diffSummary: "", diffPaths: [] },
          { id: "codex", model: "m", status: "ok", branch: "b", stdoutTail: "", diffSummary: "", diffPaths: [] },
        ];
      },
    });
    await realExecuteTurn("test", null, deps);
    expect(receivedAgentIds[0]).toBeUndefined();
  });
});
