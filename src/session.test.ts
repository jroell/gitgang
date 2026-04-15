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

import { readEventsWithErrors, readEventsLogged } from "./session";

describe("readEventsWithErrors", () => {
  test("returns empty arrays for missing file", () => {
    const result = readEventsWithErrors("/nonexistent/path/xyz.jsonl");
    expect(result.events).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("separates valid events from malformed lines with line numbers", () => {
    const session = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    writeFileSync(
      session.logPath,
      '{"ts":"t1","turn":1,"type":"user","text":"ok","forcedMode":null}\n' +
        "not json\n" +
        '{"ts":"t2","turn":1,"type":"user","text":"ok2","forcedMode":null}\n' +
        "{broken\n",
    );
    const result = readEventsWithErrors(session.logPath);
    expect(result.events).toHaveLength(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].lineNumber).toBe(2);
    expect(result.errors[0].raw).toBe("not json");
    expect(result.errors[1].lineNumber).toBe(4);
  });
});

describe("readEventsLogged", () => {
  test("writes resume-errors.log when malformed lines found", () => {
    const session = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    writeFileSync(
      session.logPath,
      '{"ts":"t1","turn":1,"type":"user","text":"ok","forcedMode":null}\n' +
        "not json\n",
    );
    const events = readEventsLogged(session.logPath, session.debugDir);
    expect(events).toHaveLength(1);
    const errLog = join(session.debugDir, "resume-errors.log");
    expect(existsSync(errLog)).toBe(true);
    const contents = readFileSync(errLog, "utf8");
    expect(contents).toContain("malformed line");
    expect(contents).toContain("line 2");
    expect(contents).toContain("not json");
  });

  test("does not write log when no errors", () => {
    const session = createSession(tmp, {
      models: { gemini: "g", claude: "c", codex: "x" },
      reviewer: "codex",
      automerge: "ask",
    });
    writeFileSync(
      session.logPath,
      '{"ts":"t1","turn":1,"type":"user","text":"ok","forcedMode":null}\n',
    );
    readEventsLogged(session.logPath, session.debugDir);
    expect(existsSync(join(session.debugDir, "resume-errors.log"))).toBe(false);
  });
});

import { findPendingMergePlan, findLastMergedBranch } from "./session";

describe("findPendingMergePlan", () => {
  const mkOrch = (turn: number, withPlan: boolean): SessionEvent => ({
    ts: "t",
    turn,
    type: "orchestrator",
    payload: {
      intent: withPlan ? "code" : "ask",
      agreement: [],
      disagreement: [],
      bestAnswer: "a",
      ...(withPlan
        ? {
            mergePlan: {
              pick: "claude" as const,
              branches: [`b-${turn}`],
              rationale: "r",
              followups: [],
            },
          }
        : {}),
    },
  });
  const mkMerge = (
    turn: number,
    outcome: "merged" | "declined",
  ): SessionEvent => ({
    ts: "t",
    turn,
    type: "merge",
    branch: `b-${turn}`,
    outcome,
  });

  test("returns null for empty log", () => {
    expect(findPendingMergePlan([])).toBeNull();
  });

  test("returns null when no orchestrator events have mergePlan", () => {
    expect(findPendingMergePlan([mkOrch(1, false)])).toBeNull();
  });

  test("returns most recent unmerged plan", () => {
    const result = findPendingMergePlan([
      mkOrch(1, true),
      mkMerge(1, "merged"),
      mkOrch(2, true),
      mkMerge(2, "declined"),
      mkOrch(3, true),
    ]);
    expect(result?.turn).toBe(3);
  });

  test("returns declined plan when newer", () => {
    const result = findPendingMergePlan([
      mkOrch(1, true),
      mkMerge(1, "merged"),
      mkOrch(2, true),
      mkMerge(2, "declined"),
    ]);
    expect(result?.turn).toBe(2);
  });

  test("skips merged turns", () => {
    const result = findPendingMergePlan([
      mkOrch(1, true),
      mkMerge(1, "merged"),
    ]);
    expect(result).toBeNull();
  });
});

describe("findLastMergedBranch", () => {
  test("returns null when no merges", () => {
    expect(findLastMergedBranch([])).toBeNull();
  });
  test("returns most recent merged branch", () => {
    const events: SessionEvent[] = [
      { ts: "t", turn: 1, type: "merge", branch: "b1", outcome: "merged" },
      { ts: "t", turn: 2, type: "merge", branch: "b2", outcome: "declined" },
      { ts: "t", turn: 3, type: "merge", branch: "b3", outcome: "merged" },
    ];
    expect(findLastMergedBranch(events)).toBe("b3");
  });
  test("ignores declined merges", () => {
    const events: SessionEvent[] = [
      { ts: "t", turn: 1, type: "merge", branch: "b1", outcome: "declined" },
    ];
    expect(findLastMergedBranch(events)).toBeNull();
  });
});

import { findLastAgentBranch, findLastPickedBranch } from "./session";

describe("findLastAgentBranch", () => {
  test("returns null when agent never started", () => {
    expect(findLastAgentBranch([], "gemini")).toBeNull();
  });
  test("returns branch from most recent agent_start for that agent", () => {
    const events: SessionEvent[] = [
      { ts: "t", turn: 1, type: "agent_start", agent: "gemini", branch: "agents/gemini/turn-1" },
      { ts: "t", turn: 1, type: "agent_start", agent: "claude", branch: "agents/claude/turn-1" },
      { ts: "t", turn: 2, type: "agent_start", agent: "gemini", branch: "agents/gemini/turn-2" },
    ];
    expect(findLastAgentBranch(events, "gemini")).toBe("agents/gemini/turn-2");
    expect(findLastAgentBranch(events, "claude")).toBe("agents/claude/turn-1");
    expect(findLastAgentBranch(events, "codex")).toBeNull();
  });
  test("falls back to orchestrator mergePlan branches when no agent_start", () => {
    const events: SessionEvent[] = [
      {
        ts: "t",
        turn: 1,
        type: "orchestrator",
        payload: {
          intent: "code",
          agreement: [],
          disagreement: [],
          bestAnswer: "a",
          mergePlan: {
            pick: "claude",
            branches: ["agents/claude/turn-1"],
            rationale: "r",
            followups: [],
          },
        },
      },
    ];
    expect(findLastAgentBranch(events, "claude")).toBe("agents/claude/turn-1");
    expect(findLastAgentBranch(events, "gemini")).toBeNull();
  });
});

describe("findLastPickedBranch", () => {
  test("returns null when no merge plan proposed", () => {
    expect(findLastPickedBranch([])).toBeNull();
  });
  test("returns first branch from most recent mergePlan", () => {
    const events: SessionEvent[] = [
      {
        ts: "t",
        turn: 1,
        type: "orchestrator",
        payload: {
          intent: "code",
          agreement: [],
          disagreement: [],
          bestAnswer: "a",
          mergePlan: {
            pick: "gemini",
            branches: ["agents/gemini/turn-1"],
            rationale: "r",
            followups: [],
          },
        },
      },
      {
        ts: "t",
        turn: 2,
        type: "orchestrator",
        payload: {
          intent: "code",
          agreement: [],
          disagreement: [],
          bestAnswer: "a",
          mergePlan: {
            pick: "claude",
            branches: ["agents/claude/turn-2", "agents/gemini/turn-2"],
            rationale: "r",
            followups: [],
          },
        },
      },
    ];
    expect(findLastPickedBranch(events)).toBe("agents/claude/turn-2");
  });
  test("ignores orchestrator events without mergePlan", () => {
    const events: SessionEvent[] = [
      {
        ts: "t",
        turn: 1,
        type: "orchestrator",
        payload: {
          intent: "ask",
          agreement: [],
          disagreement: [],
          bestAnswer: "a",
        },
      },
    ];
    expect(findLastPickedBranch(events)).toBeNull();
  });
});

import { formatPrContent } from "./session";

describe("formatPrContent", () => {
  const baseOpts = { mergedBranch: "agents/claude/turn-3", sessionId: "s1", gitgangVersion: "1.7.1" };
  const mkUser = (turn: number, text: string): SessionEvent => ({
    ts: "t",
    turn,
    type: "user",
    text,
    forcedMode: null,
  });
  const mkOrch = (turn: number, payload: Partial<{
    bestAnswer: string;
    mergePlan: { pick: "claude" | "gemini" | "codex" | "hybrid"; branches: string[]; rationale: string; followups: string[] };
    disagreement: Array<{ topic: string; positions: Record<string, string>; verdict: string; evidence: string[] }>;
  }>): SessionEvent => ({
    ts: "t",
    turn,
    type: "orchestrator",
    payload: {
      intent: payload.mergePlan ? "code" : "ask",
      agreement: [],
      disagreement: payload.disagreement ?? [],
      bestAnswer: payload.bestAnswer ?? "",
      ...(payload.mergePlan ? { mergePlan: payload.mergePlan } : {}),
    },
  });

  test("title is the first user message", () => {
    const result = formatPrContent(
      [mkUser(1, "Add OAuth login flow"), mkOrch(1, { bestAnswer: "done" })],
      baseOpts,
    );
    expect(result.title).toBe("Add OAuth login flow");
  });

  test("title truncates at 72 chars with ellipsis", () => {
    const long = "a".repeat(100);
    const result = formatPrContent([mkUser(1, long), mkOrch(1, {})], baseOpts);
    expect(result.title).toHaveLength(72);
    expect(result.title.endsWith("...")).toBe(true);
  });

  test("title falls back to placeholder when no user message", () => {
    const result = formatPrContent([], baseOpts);
    expect(result.title).toBe("gitgang interactive session");
  });

  test("body always includes Summary section with last bestAnswer", () => {
    const result = formatPrContent(
      [
        mkUser(1, "do thing"),
        mkOrch(1, { bestAnswer: "first answer" }),
        mkUser(2, "now this"),
        mkOrch(2, { bestAnswer: "final synthesis" }),
      ],
      baseOpts,
    );
    expect(result.body).toContain("## Summary");
    expect(result.body).toContain("final synthesis");
    expect(result.body).not.toContain("first answer");
  });

  test("body shows merge plan when intent was code", () => {
    const result = formatPrContent(
      [
        mkUser(1, "add feature"),
        mkOrch(1, {
          bestAnswer: "done",
          mergePlan: {
            pick: "claude",
            branches: ["agents/claude/turn-1"],
            rationale: "cleanest diff",
            followups: ["add tests"],
          },
        }),
      ],
      baseOpts,
    );
    expect(result.body).toContain("## Merge plan");
    expect(result.body).toContain("`claude`");
    expect(result.body).toContain("agents/claude/turn-1");
    expect(result.body).toContain("cleanest diff");
    expect(result.body).toContain("- add tests");
  });

  test("body shows disagreement with verdict and evidence", () => {
    const result = formatPrContent(
      [
        mkUser(1, "fix bug"),
        mkOrch(1, {
          bestAnswer: "fixed",
          disagreement: [
            {
              topic: "validation strategy",
              positions: { gemini: "throw early", claude: "return null" },
              verdict: "code throws everywhere",
              evidence: ["src/auth.ts:42"],
            },
          ],
        }),
      ],
      baseOpts,
    );
    expect(result.body).toContain("## Where the agents disagreed");
    expect(result.body).toContain("### validation strategy");
    expect(result.body).toContain("**gemini**: throw early");
    expect(result.body).toContain("**claude**: return null");
    expect(result.body).toContain("**Verdict:** code throws everywhere");
    expect(result.body).toContain("`src/auth.ts:42`");
  });

  test("body omits Disagreement section when empty", () => {
    const result = formatPrContent(
      [mkUser(1, "x"), mkOrch(1, { bestAnswer: "y" })],
      baseOpts,
    );
    expect(result.body).not.toContain("## Where the agents disagreed");
  });

  test("body shows Conversation section only when 2+ user messages", () => {
    const single = formatPrContent(
      [mkUser(1, "one"), mkOrch(1, {})],
      baseOpts,
    );
    expect(single.body).not.toContain("## Conversation");

    const multi = formatPrContent(
      [
        mkUser(1, "one"),
        mkOrch(1, {}),
        mkUser(2, "two"),
        mkOrch(2, {}),
      ],
      baseOpts,
    );
    expect(multi.body).toContain("## Conversation");
    expect(multi.body).toContain("Turn 1: one");
    expect(multi.body).toContain("Turn 2: two");
  });

  test("Conversation section shows only the most recent 5 user messages", () => {
    const events: SessionEvent[] = [];
    for (let i = 1; i <= 8; i++) {
      events.push(mkUser(i, `message ${i}`));
      events.push(mkOrch(i, { bestAnswer: "ok" }));
    }
    const result = formatPrContent(events, baseOpts);
    expect(result.body).not.toContain("Turn 1: message 1");
    expect(result.body).not.toContain("Turn 2: message 2");
    expect(result.body).toContain("Turn 4: message 4");
    expect(result.body).toContain("Turn 8: message 8");
  });

  test("Conversation section truncates long user messages to 200 chars", () => {
    const long = "x".repeat(500);
    const result = formatPrContent(
      [mkUser(1, "first"), mkOrch(1, {}), mkUser(2, long), mkOrch(2, {})],
      baseOpts,
    );
    const turn2Line = result.body.split("\n").find((l) => l.startsWith("- Turn 2:"));
    expect(turn2Line).toBeDefined();
    if (turn2Line) {
      expect(turn2Line.length).toBeLessThan(220);
      expect(turn2Line.endsWith("...")).toBe(true);
    }
  });

  test("body always ends with gitgang signature", () => {
    const result = formatPrContent([mkUser(1, "x"), mkOrch(1, {})], baseOpts);
    expect(result.body).toContain("Generated by [gitgang]");
    expect(result.body).toContain("v1.7.1");
    expect(result.body).toContain("`s1`");
    expect(result.body).toContain("`agents/claude/turn-3`");
  });

  test("works on session with no orchestrator events", () => {
    const result = formatPrContent([mkUser(1, "x")], baseOpts);
    expect(result.body).toContain("(no synthesis available)");
    expect(result.body).not.toContain("## Merge plan");
  });
});

import { formatSessionExport } from "./session";

describe("formatSessionExport", () => {
  const META: SessionMetadata = {
    id: "2026-04-15T03-00-00-aaaaaa",
    startedAt: "2026-04-15T03:00:00.000Z",
    models: { gemini: "gem-3.1", claude: "claude-opus-4-6", codex: "gpt-5.4" },
    reviewer: "codex",
    automerge: "ask",
  };

  test("renders metadata table", () => {
    const out = formatSessionExport([], META);
    expect(out).toContain("# gitgang session `2026-04-15T03-00-00-aaaaaa`");
    expect(out).toContain("| started_at | `2026-04-15T03:00:00.000Z` |");
    expect(out).toContain("| reviewer | `codex` |");
    expect(out).toContain("| automerge | `ask` |");
    expect(out).toContain("| gemini model | `gem-3.1` |");
    expect(out).toContain("| claude model | `claude-opus-4-6` |");
    expect(out).toContain("| codex model | `gpt-5.4` |");
  });

  test("empty session shows placeholder", () => {
    const out = formatSessionExport([], META);
    expect(out).toContain("_(empty session — no turns yet)_");
  });

  test("renders one full turn end-to-end", () => {
    const events: SessionEvent[] = [
      {
        ts: "t1",
        turn: 1,
        type: "user",
        text: "How does authentication work in this project?",
        forcedMode: null,
      },
      {
        ts: "t2",
        turn: 1,
        type: "agent_end",
        agent: "gemini",
        status: "ok",
        diffSummary: "",
      },
      {
        ts: "t3",
        turn: 1,
        type: "agent_end",
        agent: "claude",
        status: "ok",
        diffSummary: " src/auth.ts | 5 +-",
      },
      {
        ts: "t4",
        turn: 1,
        type: "agent_end",
        agent: "codex",
        status: "failed",
        diffSummary: "",
      },
      {
        ts: "t5",
        turn: 1,
        type: "orchestrator",
        payload: {
          intent: "ask",
          agreement: ["uses passport.js", "sessions in redis"],
          disagreement: [
            {
              topic: "error handling",
              positions: { gemini: "throw", claude: "return null" },
              verdict: "code throws everywhere",
              evidence: ["src/auth.ts:42"],
            },
          ],
          bestAnswer: "Auth uses **passport.js** with redis sessions.",
        },
      },
    ];
    const out = formatSessionExport(events, META);
    expect(out).toContain("## Turn 1 — How does authentication work in this project?");
    expect(out).toContain("### You asked");
    expect(out).toContain("How does authentication work");
    expect(out).toContain("### Agents");
    expect(out).toContain("| `gemini` | ok | — |");
    expect(out).toContain("| `claude` | ok | `src/auth.ts | 5 +-` |");
    expect(out).toContain("| `codex` | failed | — |");
    expect(out).toContain("### Synthesis");
    expect(out).toContain("Auth uses **passport.js**");
    expect(out).toContain("#### Agreement");
    expect(out).toContain("- uses passport.js");
    expect(out).toContain("#### Disagreement");
    expect(out).toContain("**error handling**");
    expect(out).toContain("- `gemini`: throw");
    expect(out).toContain("> Verdict: code throws everywhere");
    expect(out).toContain("> Evidence: `src/auth.ts:42`");
  });

  test("forced mode is annotated when set", () => {
    const events: SessionEvent[] = [
      { ts: "t", turn: 1, type: "user", text: "explain", forcedMode: "ask" },
    ];
    const out = formatSessionExport(events, META);
    expect(out).toContain("*(forced mode: `ask`)*");
  });

  test("turn headline truncates at 80 chars and uses first line", () => {
    const long = "a".repeat(200);
    const events: SessionEvent[] = [
      { ts: "t", turn: 1, type: "user", text: `first line of long thing\n${long}`, forcedMode: null },
    ];
    const out = formatSessionExport(events, META);
    expect(out).toContain("## Turn 1 — first line of long thing");
  });

  test("merge plan section with rationale and branches", () => {
    const events: SessionEvent[] = [
      { ts: "t1", turn: 1, type: "user", text: "fix it", forcedMode: null },
      {
        ts: "t2",
        turn: 1,
        type: "orchestrator",
        payload: {
          intent: "code",
          agreement: [],
          disagreement: [],
          bestAnswer: "done",
          mergePlan: {
            pick: "claude",
            branches: ["agents/claude/turn-1"],
            rationale: "cleanest diff",
            followups: [],
          },
        },
      },
    ];
    const out = formatSessionExport(events, META);
    expect(out).toContain("#### Merge plan: `claude`");
    expect(out).toContain("Branches: `agents/claude/turn-1`");
    expect(out).toContain("Rationale: cleanest diff");
  });

  test("outcome lists all merge events for a turn", () => {
    const events: SessionEvent[] = [
      { ts: "t1", turn: 1, type: "user", text: "x", forcedMode: null },
      { ts: "t2", turn: 1, type: "merge", branch: "agents/claude/turn-1", outcome: "merged" },
    ];
    const out = formatSessionExport(events, META);
    expect(out).toContain("### Outcome");
    expect(out).toContain("- `merged`: `agents/claude/turn-1`");
  });

  test("turns are emitted in numeric order", () => {
    const events: SessionEvent[] = [
      { ts: "t", turn: 3, type: "user", text: "third", forcedMode: null },
      { ts: "t", turn: 1, type: "user", text: "first", forcedMode: null },
      { ts: "t", turn: 2, type: "user", text: "second", forcedMode: null },
    ];
    const out = formatSessionExport(events, META);
    const idx1 = out.indexOf("Turn 1 — first");
    const idx2 = out.indexOf("Turn 2 — second");
    const idx3 = out.indexOf("Turn 3 — third");
    expect(idx1).toBeGreaterThan(0);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });

  test("agreement and disagreement sections are omitted when empty", () => {
    const events: SessionEvent[] = [
      { ts: "t1", turn: 1, type: "user", text: "x", forcedMode: null },
      {
        ts: "t2",
        turn: 1,
        type: "orchestrator",
        payload: {
          intent: "ask",
          agreement: [],
          disagreement: [],
          bestAnswer: "ok",
        },
      },
    ];
    const out = formatSessionExport(events, META);
    expect(out).not.toContain("#### Agreement");
    expect(out).not.toContain("#### Disagreement");
    expect(out).toContain("### Synthesis");
  });

  test("output is deterministic across repeated calls", () => {
    const events: SessionEvent[] = [
      { ts: "t1", turn: 1, type: "user", text: "x", forcedMode: null },
      {
        ts: "t2",
        turn: 1,
        type: "orchestrator",
        payload: { intent: "ask", agreement: [], disagreement: [], bestAnswer: "y" },
      },
    ];
    expect(formatSessionExport(events, META)).toBe(formatSessionExport(events, META));
  });
});

import { findLastUserMessage } from "./session";

describe("findLastUserMessage", () => {
  test("returns null on empty log", () => {
    expect(findLastUserMessage([])).toBeNull();
  });

  test("returns null when no user events present", () => {
    const events: SessionEvent[] = [
      { ts: "t", turn: 1, type: "agent_start", agent: "gemini", branch: "b" },
    ];
    expect(findLastUserMessage(events)).toBeNull();
  });

  test("returns most recent user message verbatim", () => {
    const events: SessionEvent[] = [
      { ts: "t", turn: 1, type: "user", text: "first", forcedMode: null },
      { ts: "t", turn: 2, type: "user", text: "second", forcedMode: "ask" },
      { ts: "t", turn: 3, type: "user", text: "third", forcedMode: "code" },
    ];
    expect(findLastUserMessage(events)).toEqual({
      text: "third",
      forcedMode: "code",
      turn: 3,
    });
  });

  test("preserves original forcedMode and turn number", () => {
    const events: SessionEvent[] = [
      { ts: "t", turn: 1, type: "user", text: "explain auth", forcedMode: "ask" },
      {
        ts: "t",
        turn: 1,
        type: "orchestrator",
        payload: { intent: "ask", agreement: [], disagreement: [], bestAnswer: "..." },
      },
    ];
    const result = findLastUserMessage(events);
    expect(result?.forcedMode).toBe("ask");
    expect(result?.turn).toBe(1);
  });

  test("scans backwards — skips non-user events to find the user one", () => {
    const events: SessionEvent[] = [
      { ts: "t", turn: 1, type: "user", text: "hello", forcedMode: null },
      { ts: "t", turn: 1, type: "agent_start", agent: "gemini", branch: "b" },
      { ts: "t", turn: 1, type: "agent_end", agent: "gemini", status: "ok", diffSummary: "" },
      {
        ts: "t",
        turn: 1,
        type: "orchestrator",
        payload: { intent: "ask", agreement: [], disagreement: [], bestAnswer: "y" },
      },
      { ts: "t", turn: 1, type: "merge", branch: "b", outcome: "merged" },
    ];
    const result = findLastUserMessage(events);
    expect(result?.text).toBe("hello");
  });
});

import { parseDurationMs, selectSessionsToPrune } from "./session";

describe("parseDurationMs", () => {
  test("parses Nd", () => {
    expect(parseDurationMs("30d")).toBe(30 * 86_400_000);
    expect(parseDurationMs("1d")).toBe(86_400_000);
  });
  test("parses Nh", () => {
    expect(parseDurationMs("12h")).toBe(12 * 3_600_000);
  });
  test("parses Nm", () => {
    expect(parseDurationMs("90m")).toBe(90 * 60_000);
  });
  test("parses Ns", () => {
    expect(parseDurationMs("45s")).toBe(45_000);
  });
  test("ignores leading/trailing whitespace", () => {
    expect(parseDurationMs("  7d  ")).toBe(7 * 86_400_000);
  });
  test("allows whitespace between number and unit", () => {
    expect(parseDurationMs("7 d")).toBe(7 * 86_400_000);
  });
  test("returns null for invalid input", () => {
    expect(parseDurationMs("")).toBeNull();
    expect(parseDurationMs("d")).toBeNull();
    expect(parseDurationMs("7y")).toBeNull(); // year not supported
    expect(parseDurationMs("0d")).toBeNull(); // zero not allowed
    expect(parseDurationMs("-1d")).toBeNull();
    expect(parseDurationMs("abc")).toBeNull();
  });
});

describe("selectSessionsToPrune", () => {
  const NOW = Date.parse("2026-04-15T05:00:00Z");

  test("returns empty when all sessions are recent", () => {
    const result = selectSessionsToPrune(
      [
        { id: "a", startedAt: "2026-04-15T04:50:00Z" },
        { id: "b", startedAt: "2026-04-15T04:30:00Z" },
      ],
      30 * 60_000, // older-than 30 minutes
      NOW,
    );
    expect(result).toEqual([]);
  });

  test("returns ids older than cutoff", () => {
    const result = selectSessionsToPrune(
      [
        { id: "recent", startedAt: "2026-04-15T04:50:00Z" }, // 10m ago
        { id: "old", startedAt: "2026-04-14T05:00:00Z" }, // 24h ago
        { id: "ancient", startedAt: "2026-04-01T05:00:00Z" }, // 14d ago
      ],
      86_400_000, // older-than 1 day
      NOW,
    );
    // 'old' is exactly 24h ago which is NOT strictly older than 1d cutoff
    expect(result).toEqual(["ancient"]);
  });

  test("oldest-first ordering", () => {
    const result = selectSessionsToPrune(
      [
        { id: "older", startedAt: "2026-03-01T00:00:00Z" },
        { id: "oldest", startedAt: "2026-01-01T00:00:00Z" },
        { id: "old", startedAt: "2026-04-01T00:00:00Z" },
      ],
      7 * 86_400_000,
      NOW,
    );
    expect(result).toEqual(["oldest", "older", "old"]);
  });

  test("skips sessions with unparseable startedAt", () => {
    const result = selectSessionsToPrune(
      [
        { id: "good", startedAt: "2026-01-01T00:00:00Z" },
        { id: "bad", startedAt: "not a date" },
      ],
      7 * 86_400_000,
      NOW,
    );
    expect(result).toEqual(["good"]);
  });

  test("empty input → empty result", () => {
    expect(selectSessionsToPrune([], 86_400_000, NOW)).toEqual([]);
  });
});

import { searchSessionEvents } from "./session";

describe("searchSessionEvents", () => {
  test("returns empty for empty query", () => {
    expect(
      searchSessionEvents(
        [{ ts: "t", turn: 1, type: "user", text: "hello", forcedMode: null }],
        "",
      ),
    ).toEqual([]);
  });

  test("returns empty when no matches", () => {
    expect(
      searchSessionEvents(
        [{ ts: "t", turn: 1, type: "user", text: "hello world", forcedMode: null }],
        "xyz",
      ),
    ).toEqual([]);
  });

  test("matches user messages case-insensitively", () => {
    const hits = searchSessionEvents(
      [
        { ts: "t", turn: 1, type: "user", text: "How does AUTH work?", forcedMode: null },
      ],
      "auth",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].turn).toBe(1);
    expect(hits[0].source).toBe("user");
    expect(hits[0].snippet).toContain("AUTH");
  });

  test("matches orchestrator bestAnswer", () => {
    const hits = searchSessionEvents(
      [
        {
          ts: "t",
          turn: 1,
          type: "orchestrator",
          payload: {
            intent: "ask",
            agreement: [],
            disagreement: [],
            bestAnswer: "Auth uses passport.js with sessions.",
          },
        },
      ],
      "passport",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].source).toBe("assistant");
    expect(hits[0].snippet).toContain("passport");
  });

  test("snippet centered on match with ellipses", () => {
    const long = "a".repeat(200) + " NEEDLE " + "b".repeat(200);
    const hits = searchSessionEvents(
      [{ ts: "t", turn: 1, type: "user", text: long, forcedMode: null }],
      "NEEDLE",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain("NEEDLE");
    expect(hits[0].snippet.startsWith("…")).toBe(true);
    expect(hits[0].snippet.endsWith("…")).toBe(true);
  });

  test("collapses whitespace in snippet so it stays on one line", () => {
    const hits = searchSessionEvents(
      [
        {
          ts: "t",
          turn: 1,
          type: "user",
          text: "before\n\nthe match here\n\nafter",
          forcedMode: null,
        },
      ],
      "match",
    );
    expect(hits[0].snippet).not.toContain("\n");
  });

  test("respects maxHits limit", () => {
    const events: SessionEvent[] = [];
    for (let i = 1; i <= 10; i++) {
      events.push({ ts: "t", turn: i, type: "user", text: `match number ${i}`, forcedMode: null });
    }
    const hits = searchSessionEvents(events, "match", 3);
    expect(hits).toHaveLength(3);
    expect(hits[0].turn).toBe(1);
    expect(hits[2].turn).toBe(3);
  });

  test("ignores agent_start, agent_end, merge events", () => {
    const events: SessionEvent[] = [
      { ts: "t", turn: 1, type: "agent_start", agent: "gemini", branch: "match-branch" },
      { ts: "t", turn: 1, type: "agent_end", agent: "gemini", status: "ok", diffSummary: "match" },
      { ts: "t", turn: 1, type: "merge", branch: "match-branch", outcome: "merged" },
    ];
    expect(searchSessionEvents(events, "match")).toEqual([]);
  });

  test("returns matches for both user and assistant on same turn", () => {
    const events: SessionEvent[] = [
      { ts: "t", turn: 1, type: "user", text: "is auth right?", forcedMode: null },
      {
        ts: "t",
        turn: 1,
        type: "orchestrator",
        payload: {
          intent: "ask",
          agreement: [],
          disagreement: [],
          bestAnswer: "yes auth works",
        },
      },
    ];
    const hits = searchSessionEvents(events, "auth");
    expect(hits).toHaveLength(2);
    expect(hits[0].source).toBe("user");
    expect(hits[1].source).toBe("assistant");
  });
});
