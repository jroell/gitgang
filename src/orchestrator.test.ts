import { describe, test, expect } from "vitest";
import { buildOrchestratorInput, type AgentResult } from "./orchestrator";

describe("buildOrchestratorInput", () => {
  test("assembles envelope with history and agent results", () => {
    const agents: AgentResult[] = [
      {
        id: "gemini",
        model: "gemini-3.1-pro-preview",
        status: "ok",
        branch: "agents/gemini/turn-3",
        stdoutTail: "gemini says X",
        diffSummary: "",
        diffPaths: [],
      },
      {
        id: "claude",
        model: "claude-opus-4-6",
        status: "ok",
        branch: "agents/claude/turn-3",
        stdoutTail: "claude says Y",
        diffSummary: " src/auth.ts | 5 +-",
        diffPaths: ["src/auth.ts"],
      },
      {
        id: "codex",
        model: "gpt-5.4",
        status: "failed",
        branch: "agents/codex/turn-3",
        stdoutTail: "error",
        diffSummary: "",
        diffPaths: [],
      },
    ];

    const input = buildOrchestratorInput({
      turn: 3,
      repoRoot: "/repo",
      userMessage: "how does auth work",
      forcedMode: null,
      history: [
        { turn: 1, user: "hi", assistant: "hello" },
        { turn: 2, user: "what next", assistant: "this" },
      ],
      agents,
    });

    expect(input.turn).toBe(3);
    expect(input.repoRoot).toBe("/repo");
    expect(input.userMessage).toBe("how does auth work");
    expect(input.forcedMode).toBeNull();
    expect(input.history).toHaveLength(2);
    expect(input.agents).toHaveLength(3);
    expect(input.agents[0].id).toBe("gemini");
    expect(input.agents[2].status).toBe("failed");
  });

  test("empty history produces empty array", () => {
    const input = buildOrchestratorInput({
      turn: 1,
      repoRoot: "/repo",
      userMessage: "hi",
      forcedMode: "ask",
      history: [],
      agents: [],
    });
    expect(input.history).toEqual([]);
    expect(input.agents).toEqual([]);
    expect(input.forcedMode).toBe("ask");
  });
});
