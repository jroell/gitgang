import { describe, test, expect } from "vitest";
import { renderSynthesis } from "./renderer";
import type { OrchestratorOutput } from "./orchestrator";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("renderSynthesis", () => {
  test("renders answer section", () => {
    const out: OrchestratorOutput = {
      intent: "ask",
      agreement: [],
      disagreement: [],
      bestAnswer: "Auth uses passport.js.",
    };
    const s = stripAnsi(renderSynthesis(out, { color: false }));
    expect(s).toContain("Answer");
    expect(s).toContain("Auth uses passport.js.");
  });

  test("renders agreement bullets", () => {
    const out: OrchestratorOutput = {
      intent: "ask",
      agreement: ["uses passport", "sessions in redis"],
      disagreement: [],
      bestAnswer: "ok",
    };
    const s = stripAnsi(renderSynthesis(out, { color: false }));
    expect(s).toContain("All 3 agents agree");
    expect(s).toContain("uses passport");
    expect(s).toContain("sessions in redis");
  });

  test("renders disagreement with positions and verdict", () => {
    const out: OrchestratorOutput = {
      intent: "ask",
      agreement: [],
      disagreement: [
        {
          topic: "error handling",
          positions: { gemini: "throw", claude: "return null" },
          verdict: "code throws",
          evidence: ["src/auth.ts:42"],
        },
      ],
      bestAnswer: "ok",
    };
    const s = stripAnsi(renderSynthesis(out, { color: false }));
    expect(s).toContain("Disagreement: error handling");
    expect(s).toContain("gemini: throw");
    expect(s).toContain("claude: return null");
    expect(s).toContain("Verdict: code throws");
    expect(s).toContain("src/auth.ts:42");
  });

  test("renders merge plan when intent is code", () => {
    const out: OrchestratorOutput = {
      intent: "code",
      agreement: [],
      disagreement: [],
      bestAnswer: "picked claude",
      mergePlan: {
        pick: "claude",
        branches: ["agents/claude/turn-3"],
        rationale: "cleanest diff",
        followups: [],
      },
    };
    const s = stripAnsi(renderSynthesis(out, { color: false }));
    expect(s).toContain("Proposed merge: claude");
    expect(s).toContain("cleanest diff");
    expect(s).toContain("Merge this? [y/N/e]");
  });

  test("compact footer when everything aligns and answer is short", () => {
    const out: OrchestratorOutput = {
      intent: "ask",
      agreement: [],
      disagreement: [],
      bestAnswer: "yes",
    };
    const s = stripAnsi(renderSynthesis(out, { color: false }));
    expect(s).toContain("All agents aligned");
  });
});
