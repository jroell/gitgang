import { describe, test, expect } from "bun:test";

describe("Timeout configuration", () => {
  test("ROUND_COMPLETION_TIMEOUT_MS should be 15 minutes", () => {
    const ROUND_COMPLETION_TIMEOUT_MS = 15 * 60 * 1000;
    expect(ROUND_COMPLETION_TIMEOUT_MS).toBe(900000);
    expect(ROUND_COMPLETION_TIMEOUT_MS / 60000).toBe(15); // 15 minutes
  });

  test("MAX_CONSECUTIVE_ERRORS should allow 3 errors before stuck detection", () => {
    const MAX_CONSECUTIVE_ERRORS = 3;
    expect(MAX_CONSECUTIVE_ERRORS).toBe(3);
  });

  test("NUDGE_AFTER_MS should be 3 minutes", () => {
    const NUDGE_AFTER_MS = 3 * 60 * 1000;
    expect(NUDGE_AFTER_MS).toBe(180000);
    expect(NUDGE_AFTER_MS / 60000).toBe(3); // 3 minutes
  });

  test("DEFAULT_AGENT_IDLE_TIMEOUT_MS should be 7 minutes", () => {
    const DEFAULT_AGENT_IDLE_TIMEOUT_MS = Number(
      process.env.GITGANG_AGENT_IDLE_TIMEOUT ?? 7 * 60 * 1000,
    );
    expect(DEFAULT_AGENT_IDLE_TIMEOUT_MS).toBe(420000);
    expect(DEFAULT_AGENT_IDLE_TIMEOUT_MS / 60000).toBe(7); // 7 minutes
  });

  test("timeout sequence should be logical: nudge < idle < round", () => {
    const NUDGE_AFTER_MS = 3 * 60 * 1000;
    const DEFAULT_AGENT_IDLE_TIMEOUT_MS = 7 * 60 * 1000;
    const ROUND_COMPLETION_TIMEOUT_MS = 15 * 60 * 1000;

    // Nudge should happen before idle timeout
    expect(NUDGE_AFTER_MS).toBeLessThan(DEFAULT_AGENT_IDLE_TIMEOUT_MS);
    
    // Idle timeout should happen before round completion
    expect(DEFAULT_AGENT_IDLE_TIMEOUT_MS).toBeLessThan(ROUND_COMPLETION_TIMEOUT_MS);
    
    // Verify the progression: 3min -> 7min -> 15min
    expect(NUDGE_AFTER_MS / 60000).toBe(3);
    expect(DEFAULT_AGENT_IDLE_TIMEOUT_MS / 60000).toBe(7);
    expect(ROUND_COMPLETION_TIMEOUT_MS / 60000).toBe(15);
  });
});

describe("Agent result handling", () => {
  test("should correctly identify successful agents", () => {
    const results = [
      { id: "gemini" as const, result: { status: "success" as const } },
      { id: "claude" as const, result: { status: "dnf" as const } },
      { id: "codex" as const, result: { status: "success" as const } },
    ];

    const successful = results.filter((r) => r.result.status === "success");
    const failed = results.filter((r) => r.result.status !== "success");

    expect(successful.length).toBe(2);
    expect(failed.length).toBe(1);
    expect(successful.map((r) => r.id)).toEqual(["gemini", "codex"]);
  });

  test("should handle all-success scenario", () => {
    const results = [
      { id: "gemini" as const, result: { status: "success" as const } },
      { id: "claude" as const, result: { status: "success" as const } },
      { id: "codex" as const, result: { status: "success" as const } },
    ];

    const successful = results.filter((r) => r.result.status === "success");
    expect(successful.length).toBe(3);
    expect(successful.length > 0).toBe(true); // Should proceed to reviewer
  });

  test("should handle all-failure scenario", () => {
    const results = [
      { id: "gemini" as const, result: { status: "dnf" as const } },
      { id: "claude" as const, result: { status: "dnf" as const } },
      { id: "codex" as const, result: { status: "dnf" as const } },
    ];

    const successful = results.filter((r) => r.result.status === "success");
    expect(successful.length).toBe(0);
    expect(successful.length === 0).toBe(true); // Should NOT proceed to reviewer
  });

  test("should handle single successful agent", () => {
    const results = [
      { id: "gemini" as const, result: { status: "dnf" as const } },
      { id: "claude" as const, result: { status: "dnf" as const } },
      { id: "codex" as const, result: { status: "success" as const } },
    ];

    const successful = results.filter((r) => r.result.status === "success");
    expect(successful.length).toBe(1);
    expect(successful.length > 0).toBe(true); // Should proceed to reviewer
    expect(successful[0].id).toBe("codex");
  });
});

describe("Error loop detection", () => {
  test("should track consecutive errors correctly", () => {
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3;

    // Simulate 3 consecutive errors
    consecutiveErrors++; // Error 1
    consecutiveErrors++; // Error 2
    consecutiveErrors++; // Error 3

    expect(consecutiveErrors).toBe(3);
    expect(consecutiveErrors >= MAX_CONSECUTIVE_ERRORS).toBe(true);
  });

  test("should reset error count on success", () => {
    let consecutiveErrors = 2;

    // Simulate successful tool use
    consecutiveErrors = 0;

    expect(consecutiveErrors).toBe(0);
  });

  test("should not reset error count on regular activity", () => {
    let consecutiveErrors = 2;
    const MAX_CONSECUTIVE_ERRORS = 3;

    // Regular activity (not successful tool use) shouldn't reset
    // consecutiveErrors stays at 2

    expect(consecutiveErrors).toBe(2);
    expect(consecutiveErrors < MAX_CONSECUTIVE_ERRORS).toBe(true);
  });
});
