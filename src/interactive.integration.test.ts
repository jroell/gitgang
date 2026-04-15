import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { createSession, loadSession, readEvents } from "./session";
import { executeTurn } from "./repl";
import type { AgentResult, OrchestratorOutput } from "./orchestrator";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "gg-e2e-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("interactive turn end-to-end (mocked)", () => {
  test("question turn writes user + orchestrator events and no merge event", async () => {
    const sess = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    const loaded = loadSession(sess.dir);
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c) => chunks.push(c));

    await executeTurn("how does auth work", null, {
      session: loaded,
      repoRoot: tmp,
      base: "main",
      output,
      mergeInput: new PassThrough(),
      fanOut: async (): Promise<AgentResult[]> => [
        { id: "gemini", model: "g", status: "ok", branch: "agents/gemini/turn-1", stdoutTail: "", diffSummary: "", diffPaths: [] },
        { id: "claude", model: "c", status: "ok", branch: "agents/claude/turn-1", stdoutTail: "", diffSummary: "", diffPaths: [] },
        { id: "codex", model: "x", status: "ok", branch: "agents/codex/turn-1", stdoutTail: "", diffSummary: "", diffPaths: [] },
      ],
      spawnOrchestrator: async (): Promise<OrchestratorOutput> => ({
        intent: "ask",
        agreement: ["all agree"],
        disagreement: [],
        bestAnswer: "auth uses passport",
      }),
      applyMerge: async () => ({ success: true }),
      cleanupWorktrees: async () => {},
    });

    const events = readEvents(loaded.logPath);
    expect(events.map((e) => e.type)).toEqual([
      "user",
      "agent_end",
      "agent_end",
      "agent_end",
      "orchestrator",
    ]);
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain("auth uses passport");
    expect(text).not.toContain("Merge this?");
  });

  test("code turn with automerge=on writes merge event", async () => {
    const sess = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "on",
    });
    const loaded = loadSession(sess.dir);
    let mergeApplied = 0;

    await executeTurn("add a button", null, {
      session: loaded,
      repoRoot: tmp,
      base: "main",
      output: new PassThrough(),
      mergeInput: new PassThrough(),
      fanOut: async (): Promise<AgentResult[]> => [
        { id: "gemini", model: "g", status: "ok", branch: "b1", stdoutTail: "", diffSummary: "", diffPaths: [] },
        { id: "claude", model: "c", status: "ok", branch: "b2", stdoutTail: "", diffSummary: "", diffPaths: [] },
        { id: "codex", model: "x", status: "ok", branch: "b3", stdoutTail: "", diffSummary: "", diffPaths: [] },
      ],
      spawnOrchestrator: async () => ({
        intent: "code",
        agreement: [],
        disagreement: [],
        bestAnswer: "ok",
        mergePlan: { pick: "claude", branches: ["b2"], rationale: "best", followups: [] },
      }),
      applyMerge: async () => {
        mergeApplied++;
        return { success: true };
      },
      cleanupWorktrees: async () => {},
    });

    expect(mergeApplied).toBe(1);
    const events = readEvents(loaded.logPath);
    const mergeEvt = events.find((e) => e.type === "merge");
    expect(mergeEvt).toBeDefined();
    if (mergeEvt && mergeEvt.type === "merge") {
      expect(mergeEvt.outcome).toBe("merged");
    }
  });

  test("code turn with automerge=off preserves branches without prompting", async () => {
    const sess = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "off",
    });
    const loaded = loadSession(sess.dir);
    let mergeApplied = 0;
    const output = new PassThrough();

    await executeTurn("add a button", null, {
      session: loaded,
      repoRoot: tmp,
      base: "main",
      output,
      mergeInput: new PassThrough(),
      fanOut: async (): Promise<AgentResult[]> => [
        { id: "gemini", model: "g", status: "ok", branch: "b1", stdoutTail: "", diffSummary: "", diffPaths: [] },
        { id: "claude", model: "c", status: "ok", branch: "b2", stdoutTail: "", diffSummary: "", diffPaths: [] },
        { id: "codex", model: "x", status: "ok", branch: "b3", stdoutTail: "", diffSummary: "", diffPaths: [] },
      ],
      spawnOrchestrator: async () => ({
        intent: "code",
        agreement: [],
        disagreement: [],
        bestAnswer: "ok",
        mergePlan: { pick: "claude", branches: ["b2"], rationale: "best", followups: [] },
      }),
      applyMerge: async () => {
        mergeApplied++;
        return { success: true };
      },
      cleanupWorktrees: async () => {},
    });

    expect(mergeApplied).toBe(0);
    const events = readEvents(loaded.logPath);
    expect(events.find((e) => e.type === "merge")).toBeUndefined();
  });

  test("all agents fail: orchestrator not invoked, error printed", async () => {
    const sess = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    const loaded = loadSession(sess.dir);
    let orchestratorCalled = 0;
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c) => chunks.push(c));

    await executeTurn("x", null, {
      session: loaded,
      repoRoot: tmp,
      base: "main",
      output,
      mergeInput: new PassThrough(),
      fanOut: async () => [
        { id: "gemini", model: "g", status: "failed", branch: "", stdoutTail: "", diffSummary: "", diffPaths: [] },
        { id: "claude", model: "c", status: "failed", branch: "", stdoutTail: "", diffSummary: "", diffPaths: [] },
        { id: "codex", model: "x", status: "failed", branch: "", stdoutTail: "", diffSummary: "", diffPaths: [] },
      ],
      spawnOrchestrator: async () => {
        orchestratorCalled++;
        throw new Error("should not be called");
      },
      applyMerge: async () => ({ success: true }),
      cleanupWorktrees: async () => {},
    });

    expect(orchestratorCalled).toBe(0);
    expect(Buffer.concat(chunks).toString("utf8")).toContain("All agents failed");
  });
});
