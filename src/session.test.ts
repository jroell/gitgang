import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSession, generateSessionId, appendEvent, readEvents, loadSession, reconstructHistory, type SessionEvent } from "./session";

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

describe("session event log", () => {
  test("appendEvent writes one JSON line per call", () => {
    const session = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    appendEvent(session.logPath, {
      ts: "2026-04-14T20:00:00.000Z",
      turn: 1,
      type: "user",
      text: "hello",
      forcedMode: null,
    });
    const contents = readFileSync(session.logPath, "utf8");
    expect(contents.split("\n").filter(Boolean)).toHaveLength(1);
    const parsed = JSON.parse(contents.trim());
    expect(parsed.type).toBe("user");
    expect(parsed.text).toBe("hello");
  });

  test("readEvents returns typed events in order", () => {
    const session = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    const evts: SessionEvent[] = [
      { ts: "t1", turn: 1, type: "user", text: "first", forcedMode: null },
      { ts: "t2", turn: 1, type: "agent_start", agent: "gemini", branch: "agents/gemini/turn-1" },
      { ts: "t3", turn: 1, type: "agent_end", agent: "gemini", status: "ok", diffSummary: "" },
    ];
    for (const e of evts) appendEvent(session.logPath, e);
    const read = readEvents(session.logPath);
    expect(read).toHaveLength(3);
    expect(read[0].type).toBe("user");
    expect(read[1].type).toBe("agent_start");
    expect(read[2].type).toBe("agent_end");
  });

  test("readEvents skips malformed lines", () => {
    const session = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    writeFileSync(
      session.logPath,
      '{"ts":"t1","turn":1,"type":"user","text":"ok","forcedMode":null}\n' +
        "not json\n" +
        '{"ts":"t2","turn":1,"type":"user","text":"ok2","forcedMode":null}\n',
    );
    const events = readEvents(session.logPath);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("user");
    expect(events[1].type).toBe("user");
  });
});

describe("loadSession / reconstructHistory", () => {
  test("loadSession reads metadata and events", () => {
    const session = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    appendEvent(session.logPath, {
      ts: "t1",
      turn: 1,
      type: "user",
      text: "hi",
      forcedMode: null,
    });
    const loaded = loadSession(session.dir);
    expect(loaded.id).toBe(session.id);
    expect(loaded.events).toHaveLength(1);
  });

  test("reconstructHistory pairs user + orchestrator messages by turn", () => {
    const session = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    appendEvent(session.logPath, {
      ts: "t1",
      turn: 1,
      type: "user",
      text: "first",
      forcedMode: null,
    });
    appendEvent(session.logPath, {
      ts: "t2",
      turn: 1,
      type: "orchestrator",
      payload: {
        intent: "ask",
        agreement: [],
        disagreement: [],
        bestAnswer: "answer one",
      },
    });
    appendEvent(session.logPath, {
      ts: "t3",
      turn: 2,
      type: "user",
      text: "second",
      forcedMode: null,
    });
    appendEvent(session.logPath, {
      ts: "t4",
      turn: 2,
      type: "orchestrator",
      payload: {
        intent: "ask",
        agreement: [],
        disagreement: [],
        bestAnswer: "answer two",
      },
    });

    const history = reconstructHistory(readEvents(session.logPath));
    expect(history).toEqual([
      { turn: 1, user: "first", assistant: "answer one" },
      { turn: 2, user: "second", assistant: "answer two" },
    ]);
  });

  test("reconstructHistory drops incomplete trailing turn", () => {
    const session = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    appendEvent(session.logPath, {
      ts: "t1",
      turn: 1,
      type: "user",
      text: "started",
      forcedMode: null,
    });
    const history = reconstructHistory(readEvents(session.logPath));
    expect(history).toHaveLength(0);
  });
});
