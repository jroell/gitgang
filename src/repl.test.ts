import { describe, test, expect } from "vitest";
import { PassThrough } from "node:stream";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runRepl, type ReplDeps } from "./repl";
import type { AgentResult, OrchestratorOutput } from "./orchestrator";
import { executeTurn as realExecuteTurn, type ExecuteTurnDeps } from "./repl";

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
