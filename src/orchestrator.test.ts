import { describe, test, expect } from "vitest";
import { parseOrchestratorOutput } from "./orchestrator";

describe("parseOrchestratorOutput", () => {
  test("parses a valid question-mode response", () => {
    const raw = JSON.stringify({
      intent: "ask",
      agreement: ["uses passport.js"],
      disagreement: [],
      best_answer: "Auth works via passport.js sessions.",
    });
    const result = parseOrchestratorOutput(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.intent).toBe("ask");
      expect(result.value.agreement).toEqual(["uses passport.js"]);
      expect(result.value.bestAnswer).toBe("Auth works via passport.js sessions.");
      expect(result.value.mergePlan).toBeUndefined();
    }
  });

  test("parses a valid code-mode response with merge_plan", () => {
    const raw = JSON.stringify({
      intent: "code",
      agreement: [],
      disagreement: [
        {
          topic: "error handling",
          positions: { gemini: "throw", claude: "return null", codex: "log" },
          verdict: "existing code throws",
          evidence: ["src/auth.ts:42"],
        },
      ],
      best_answer: "I picked claude's branch.",
      merge_plan: {
        pick: "claude",
        branches: ["agents/claude/turn-3"],
        rationale: "cleanest diff",
        followups: [],
      },
    });
    const result = parseOrchestratorOutput(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.intent).toBe("code");
      expect(result.value.mergePlan?.pick).toBe("claude");
      expect(result.value.disagreement).toHaveLength(1);
      expect(result.value.disagreement[0].positions.gemini).toBe("throw");
    }
  });

  test("returns error for non-JSON input", () => {
    const result = parseOrchestratorOutput("definitely not JSON");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.raw).toBe("definitely not JSON");
  });

  test("returns error for missing required fields", () => {
    const result = parseOrchestratorOutput(JSON.stringify({ intent: "ask" }));
    expect(result.ok).toBe(false);
  });

  test("returns error for invalid intent value", () => {
    const result = parseOrchestratorOutput(
      JSON.stringify({
        intent: "bogus",
        agreement: [],
        disagreement: [],
        best_answer: "x",
      }),
    );
    expect(result.ok).toBe(false);
  });

  test("extracts JSON from mixed output (leading/trailing noise)", () => {
    const payload = JSON.stringify({
      intent: "ask",
      agreement: [],
      disagreement: [],
      best_answer: "ok",
    });
    const raw = "some preamble\n" + payload + "\ntrailing noise";
    const result = parseOrchestratorOutput(raw);
    expect(result.ok).toBe(true);
  });
});
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
