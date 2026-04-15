import { describe, test, expect } from "vitest";
import { buildTurnPrompt } from "./turn";
import { findRepoRoot } from "./cli";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

/**
 * These tests cover the v1.8.1 "non-git mode" path: buildTurnPrompt's
 * readOnly constraint and findRepoRoot's tolerant null return.
 */

describe("buildTurnPrompt readOnly flag", () => {
  test("omits read-only section by default (git mode)", () => {
    const prompt = buildTurnPrompt({
      agent: "gemini",
      base: "main",
      userMessage: "explain auth",
      history: [],
    });
    expect(prompt).not.toContain("READ-ONLY MODE");
    expect(prompt).not.toContain("You MUST NOT");
    expect(prompt).toContain("commit code changes to this worktree");
  });

  test("injects read-only constraint when readOnly=true", () => {
    const prompt = buildTurnPrompt({
      agent: "claude",
      base: "HEAD",
      userMessage: "what's in this dir",
      history: [],
      readOnly: true,
    });
    expect(prompt).toContain("READ-ONLY MODE");
    expect(prompt).toContain("You MUST NOT");
    expect(prompt).toContain("parallel agents");
  });

  test("readOnly prompt names the forbidden mutating commands", () => {
    const prompt = buildTurnPrompt({
      agent: "codex",
      base: "HEAD",
      userMessage: "x",
      history: [],
      readOnly: true,
    });
    // The prompt should explicitly call out several mutating commands so
    // agents can't rationalize around "I only ran a git command".
    for (const dangerous of ["git init", "git commit", "rm", "touch"]) {
      expect(prompt).toContain(dangerous);
    }
  });

  test("readOnly prompt allows read-only tools explicitly", () => {
    const prompt = buildTurnPrompt({
      agent: "gemini",
      base: "HEAD",
      userMessage: "x",
      history: [],
      readOnly: true,
    });
    for (const ok of ["Read", "Grep", "Glob", "ls", "cat"]) {
      expect(prompt).toContain(ok);
    }
  });

  test("readOnly trailing reminder replaces the default diff guidance", () => {
    const prompt = buildTurnPrompt({
      agent: "gemini",
      base: "HEAD",
      userMessage: "x",
      history: [],
      readOnly: true,
    });
    // The non-readonly trailer mentions "worktree"; the readonly trailer
    // shouldn't.
    expect(prompt).not.toContain("commit code changes to this worktree");
    expect(prompt).toContain("No file edits");
  });

  test("readOnly=false behaves identically to omitting the flag", () => {
    const a = buildTurnPrompt({
      agent: "gemini",
      base: "main",
      userMessage: "x",
      history: [],
    });
    const b = buildTurnPrompt({
      agent: "gemini",
      base: "main",
      userMessage: "x",
      history: [],
      readOnly: false,
    });
    expect(a).toBe(b);
  });

  test("readOnly section appears BEFORE conversation history (most salient)", () => {
    const prompt = buildTurnPrompt({
      agent: "gemini",
      base: "HEAD",
      userMessage: "x",
      history: [{ turn: 1, user: "hi", assistant: "hello" }],
      readOnly: true,
    });
    const readOnlyIdx = prompt.indexOf("READ-ONLY MODE");
    const historyIdx = prompt.indexOf("CONVERSATION HISTORY");
    expect(readOnlyIdx).toBeGreaterThan(0);
    expect(historyIdx).toBeGreaterThan(readOnlyIdx);
  });
});

describe("findRepoRoot — non-throwing git detection", () => {
  test("returns a path when cwd is inside a git repo", async () => {
    // The test process is inside the gitgang repo; findRepoRoot reads git's
    // rev-parse so this exercises the real tool.
    const result = await findRepoRoot();
    expect(typeof result).toBe("string");
    expect(result).toContain("gitgang");
  });

  test("returns null when cwd is not inside a git repo", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gg-nogit-"));
    const origCwd = process.cwd();
    try {
      process.chdir(tmp);
      const result = await findRepoRoot();
      expect(result).toBeNull();
    } finally {
      process.chdir(origCwd);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("returns the repo root (not a subdir) when cwd is a nested subdir", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gg-nested-"));
    const origCwd = process.cwd();
    try {
      execSync("git init -q", { cwd: tmp });
      const subdir = join(tmp, "deep", "nested");
      execSync(`mkdir -p ${subdir}`, { cwd: tmp });
      process.chdir(subdir);
      const result = await findRepoRoot();
      // git's --show-toplevel returns the canonical (realpath'd) root. On macOS,
      // /tmp is a symlink to /private/tmp, so the result may differ in prefix.
      // Match the basename of the temp dir instead.
      expect(result).toBeTruthy();
      expect(result!.endsWith(tmp.replace(/^\/private/, "")) || result!.endsWith(tmp)).toBe(true);
    } finally {
      process.chdir(origCwd);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
