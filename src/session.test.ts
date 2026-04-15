import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSession, generateSessionId } from "./session";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "gitgang-session-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("generateSessionId", () => {
  test("returns ISO-timestamp-shortid format", () => {
    const id = generateSessionId();
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[a-f0-9]{6}$/);
  });
  test("two calls produce different ids", () => {
    expect(generateSessionId()).not.toBe(generateSessionId());
  });
});

describe("createSession", () => {
  test("creates session dir with expected subdirs and files", () => {
    const session = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    expect(existsSync(session.dir)).toBe(true);
    expect(existsSync(join(session.dir, "worktrees"))).toBe(true);
    expect(existsSync(join(session.dir, "debug"))).toBe(true);
    expect(existsSync(join(session.dir, "metadata.json"))).toBe(true);
    expect(existsSync(join(session.dir, "session.jsonl"))).toBe(true);
  });

  test("writes metadata.json with correct shape", () => {
    const session = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    const meta = JSON.parse(readFileSync(join(session.dir, "metadata.json"), "utf8"));
    expect(meta).toMatchObject({
      id: session.id,
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    expect(meta.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("session.jsonl starts empty", () => {
    const session = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    expect(readFileSync(session.logPath, "utf8")).toBe("");
  });
});
