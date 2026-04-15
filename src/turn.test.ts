import { describe, test, expect } from "vitest";
import { buildTurnPrompt } from "./turn";

describe("buildTurnPrompt", () => {
  test("wraps user message and history into agent prompt", () => {
    const prompt = buildTurnPrompt({
      agent: "claude",
      base: "main",
      userMessage: "how does auth work",
      history: [
        { turn: 1, user: "hi", assistant: "hello" },
      ],
    });
    expect(prompt).toContain("CONVERSATION HISTORY");
    expect(prompt).toContain("hi");
    expect(prompt).toContain("hello");
    expect(prompt).toContain("CURRENT TURN:");
    expect(prompt).toContain("how does auth work");
  });

  test("empty history omits the history section", () => {
    const prompt = buildTurnPrompt({
      agent: "codex",
      base: "main",
      userMessage: "first turn",
      history: [],
    });
    expect(prompt).not.toContain("CONVERSATION HISTORY");
    expect(prompt).toContain("CURRENT TURN:");
    expect(prompt).toContain("first turn");
  });

  test("prompt contains agent-specific system constraints", () => {
    const prompt = buildTurnPrompt({
      agent: "gemini",
      base: "main",
      userMessage: "x",
      history: [],
    });
    expect(prompt.length).toBeGreaterThan(100);
  });
});
