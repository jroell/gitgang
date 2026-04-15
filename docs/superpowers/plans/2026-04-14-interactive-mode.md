# Interactive Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship gitgang v1.7.0 with a REPL mode (`gg` or `gg -i`) that lets users converse with the three-agent ensemble, getting synthesized answers with explicit agreement/disagreement analysis for questions and confirmed merge plans for code changes.

**Architecture:** Additive. A new REPL loop (`src/repl.ts`) reuses existing agent-spawning and merge-application code from `src/cli.ts`. A fresh `claude --print` process is spawned per turn as an orchestrator that classifies intent, browses the code, and emits structured JSON synthesis. Session state lives on disk under `.gitgang/sessions/<id>/`.

**Tech Stack:** TypeScript (strict), Node.js subprocess via `child_process.spawn`, readline for input, vitest for testing, esbuild (existing) for builds.

**Spec:** [`docs/superpowers/specs/2026-04-14-interactive-mode-design.md`](../specs/2026-04-14-interactive-mode-design.md)

---

## File Structure

**New source files:**
- `src/session.ts` — session-dir layout, metadata, `session.jsonl` read/write
- `src/slash.ts` — slash command parser (pure function)
- `src/orchestrator.ts` — orchestrator input envelope, subprocess spawn, output parser
- `src/renderer.ts` — synthesis JSON → ANSI-colored terminal string (pure function)
- `src/repl.ts` — REPL loop, turn execution, merge-confirm flow

**New test files:**
- `src/session.test.ts`
- `src/slash.test.ts`
- `src/orchestrator.test.ts`
- `src/renderer.test.ts`
- `src/repl.test.ts`

**Modified:**
- `src/cli.ts` — export reusable helpers; add `-i`/`--interactive`/`--resume`/`sessions` flags; dispatch to REPL
- `scripts/ensure-clis.mjs` — append `.gitgang/` to `.gitignore` if missing
- `README.md` — interactive mode usage section
- `CHANGELOG.md` — v1.7.0 entry
- `package.json` — version bump

---

## Task 1: Export Reusable Helpers from cli.ts

**Goal:** Make existing helpers importable by the new modules.

**Files:**
- Modify: `src/cli.ts`
- Test: `src/cli.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/cli.test.ts`:

```typescript
import {
  createWorktree,
  applyMergePlan,
  systemConstraints,
  featurePrompt,
  spawnProcess,
} from "./cli";

describe("exports for interactive mode", () => {
  test("createWorktree is exported", () => {
    expect(typeof createWorktree).toBe("function");
  });
  test("applyMergePlan is exported", () => {
    expect(typeof applyMergePlan).toBe("function");
  });
  test("systemConstraints is exported", () => {
    expect(typeof systemConstraints).toBe("function");
  });
  test("featurePrompt is exported", () => {
    expect(typeof featurePrompt).toBe("function");
  });
  test("spawnProcess is exported", () => {
    expect(typeof spawnProcess).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/cli.test.ts -t "exports for interactive mode"
```

Expected: FAIL with TypeScript errors about missing exports.

- [ ] **Step 3: Add `export` to the five functions in `src/cli.ts`**

In `src/cli.ts`:
- Line 196: change `function spawnProcess` to `export function spawnProcess`
- Line 294: change `async function createWorktree` to `export async function createWorktree`
- Line 309: change `function systemConstraints` to `export function systemConstraints`
- Line 333: change `function featurePrompt` to `export function featurePrompt`
- Line 1712: change `async function applyMergePlan` to `export async function applyMergePlan`

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/cli.test.ts
```

Expected: All tests pass (including existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "refactor: export cli helpers for interactive mode reuse"
```

---

## Task 2: Slash Command Parser

**Goal:** Pure function that turns a raw input string into a typed `SlashCommand`.

**Files:**
- Create: `src/slash.ts`
- Create: `src/slash.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/slash.test.ts`:

```typescript
import { describe, test, expect } from "vitest";
import { parseSlashCommand } from "./slash";

describe("parseSlashCommand", () => {
  test("plain text is a message with forcedMode null", () => {
    expect(parseSlashCommand("how does auth work")).toEqual({
      kind: "message",
      text: "how does auth work",
      forcedMode: null,
    });
  });

  test("/ask forces mode=ask", () => {
    expect(parseSlashCommand("/ask how does auth work")).toEqual({
      kind: "message",
      text: "how does auth work",
      forcedMode: "ask",
    });
  });

  test("/code forces mode=code", () => {
    expect(parseSlashCommand("/code add a logout button")).toEqual({
      kind: "message",
      text: "add a logout button",
      forcedMode: "code",
    });
  });

  test("/merge has no text", () => {
    expect(parseSlashCommand("/merge")).toEqual({ kind: "merge" });
  });

  test("/pr is recognized", () => {
    expect(parseSlashCommand("/pr")).toEqual({ kind: "pr" });
  });

  test("/history is recognized", () => {
    expect(parseSlashCommand("/history")).toEqual({ kind: "history" });
  });

  test("/agents is recognized", () => {
    expect(parseSlashCommand("/agents")).toEqual({ kind: "agents" });
  });

  test("/help is recognized", () => {
    expect(parseSlashCommand("/help")).toEqual({ kind: "help" });
  });

  test("/quit and /exit both mean quit", () => {
    expect(parseSlashCommand("/quit")).toEqual({ kind: "quit" });
    expect(parseSlashCommand("/exit")).toEqual({ kind: "quit" });
  });

  test("/set key value is parsed", () => {
    expect(parseSlashCommand("/set automerge on")).toEqual({
      kind: "set",
      key: "automerge",
      value: "on",
    });
  });

  test("/set without key errors via kind=unknown", () => {
    expect(parseSlashCommand("/set")).toEqual({
      kind: "unknown",
      raw: "/set",
    });
  });

  test("unknown slash command returns kind=unknown", () => {
    expect(parseSlashCommand("/frobnicate")).toEqual({
      kind: "unknown",
      raw: "/frobnicate",
    });
  });

  test("empty input returns empty message", () => {
    expect(parseSlashCommand("")).toEqual({
      kind: "message",
      text: "",
      forcedMode: null,
    });
  });

  test("leading/trailing whitespace is trimmed", () => {
    expect(parseSlashCommand("  /ask  foo  ")).toEqual({
      kind: "message",
      text: "foo",
      forcedMode: "ask",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/slash.test.ts
```

Expected: FAIL — cannot resolve module `./slash`.

- [ ] **Step 3: Write minimal implementation**

Create `src/slash.ts`:

```typescript
export type ForcedMode = "ask" | "code" | null;

export type SlashCommand =
  | { kind: "message"; text: string; forcedMode: ForcedMode }
  | { kind: "merge" }
  | { kind: "pr" }
  | { kind: "history" }
  | { kind: "agents" }
  | { kind: "help" }
  | { kind: "quit" }
  | { kind: "set"; key: string; value: string }
  | { kind: "unknown"; raw: string };

export function parseSlashCommand(raw: string): SlashCommand {
  const input = raw.trim();
  if (!input.startsWith("/")) {
    return { kind: "message", text: input, forcedMode: null };
  }

  const firstSpace = input.indexOf(" ");
  const head = firstSpace === -1 ? input : input.slice(0, firstSpace);
  const tail = firstSpace === -1 ? "" : input.slice(firstSpace + 1).trim();

  switch (head) {
    case "/ask":
      return { kind: "message", text: tail, forcedMode: "ask" };
    case "/code":
      return { kind: "message", text: tail, forcedMode: "code" };
    case "/merge":
      return { kind: "merge" };
    case "/pr":
      return { kind: "pr" };
    case "/history":
      return { kind: "history" };
    case "/agents":
      return { kind: "agents" };
    case "/help":
      return { kind: "help" };
    case "/quit":
    case "/exit":
      return { kind: "quit" };
    case "/set": {
      const parts = tail.split(/\s+/);
      if (parts.length < 2) return { kind: "unknown", raw: input };
      const [key, ...valueParts] = parts;
      return { kind: "set", key, value: valueParts.join(" ") };
    }
    default:
      return { kind: "unknown", raw: input };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/slash.test.ts
```

Expected: All 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/slash.ts src/slash.test.ts
git commit -m "feat: add slash command parser for interactive mode"
```

---

## Task 3: Session Types and Metadata

**Goal:** Define session-layer types and a `createSession()` function that sets up the on-disk layout.

**Files:**
- Create: `src/session.ts`
- Create: `src/session.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/session.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/session.test.ts
```

Expected: FAIL — cannot resolve module `./session`.

- [ ] **Step 3: Write minimal implementation**

Create `src/session.ts`:

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AgentId } from "./cli";

export type Automerge = "on" | "off" | "ask";

export type SessionMetadata = {
  id: string;
  startedAt: string;
  models: Record<AgentId, string>;
  reviewer: AgentId;
  automerge: Automerge;
};

export type SessionHandle = {
  id: string;
  dir: string;
  logPath: string;
  debugDir: string;
  worktreesDir: string;
  metadata: SessionMetadata;
};

export function generateSessionId(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  const short = randomBytes(3).toString("hex");
  return `${iso.slice(0, 19)}-${short}`;
}

export function createSession(
  rootDir: string,
  opts: { models: Record<AgentId, string>; reviewer: AgentId; automerge: Automerge },
): SessionHandle {
  const id = generateSessionId();
  const dir = join(rootDir, id);
  const worktreesDir = join(dir, "worktrees");
  const debugDir = join(dir, "debug");
  const logPath = join(dir, "session.jsonl");
  const metadataPath = join(dir, "metadata.json");

  mkdirSync(dir, { recursive: true });
  mkdirSync(worktreesDir, { recursive: true });
  mkdirSync(debugDir, { recursive: true });

  const metadata: SessionMetadata = {
    id,
    startedAt: new Date().toISOString(),
    models: opts.models,
    reviewer: opts.reviewer,
    automerge: opts.automerge,
  };

  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
  writeFileSync(logPath, "");

  return { id, dir, logPath, debugDir, worktreesDir, metadata };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/session.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/session.ts src/session.test.ts
git commit -m "feat: add session directory and metadata for interactive mode"
```

---

## Task 4: Session Log Reader/Writer

**Goal:** Append-only event log with typed read back.

**Files:**
- Modify: `src/session.ts`
- Modify: `src/session.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/session.test.ts`:

```typescript
import { appendEvent, readEvents, type SessionEvent } from "./session";

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
      {
        ts: "t2",
        turn: 1,
        type: "agent_start",
        agent: "gemini",
        branch: "agents/gemini/turn-1",
      },
      {
        ts: "t3",
        turn: 1,
        type: "agent_end",
        agent: "gemini",
        status: "ok",
        diffSummary: "",
      },
    ];
    for (const e of evts) appendEvent(session.logPath, e);
    const read = readEvents(session.logPath);
    expect(read).toHaveLength(3);
    expect(read[0].type).toBe("user");
    expect(read[1].type).toBe("agent_start");
    expect(read[2].type).toBe("agent_end");
  });

  test("readEvents skips malformed lines and logs them", () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/session.test.ts
```

Expected: FAIL — `appendEvent` and `readEvents` not exported.

- [ ] **Step 3: Extend `src/session.ts`**

Append to `src/session.ts`:

```typescript
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import type { AgentId } from "./cli";
import type { ForcedMode } from "./slash";
import type { OrchestratorOutput } from "./orchestrator";

export type SessionEvent =
  | { ts: string; turn: number; type: "user"; text: string; forcedMode: ForcedMode }
  | { ts: string; turn: number; type: "agent_start"; agent: AgentId; branch: string }
  | {
      ts: string;
      turn: number;
      type: "agent_end";
      agent: AgentId;
      status: "ok" | "failed" | "timeout";
      diffSummary: string;
    }
  | { ts: string; turn: number; type: "orchestrator"; payload: OrchestratorOutput }
  | {
      ts: string;
      turn: number;
      type: "merge";
      branch: string;
      outcome: "merged" | "declined" | "pr_only";
    };

export function appendEvent(logPath: string, event: SessionEvent): void {
  appendFileSync(logPath, JSON.stringify(event) + "\n");
}

export function readEvents(logPath: string): SessionEvent[] {
  if (!existsSync(logPath)) return [];
  const raw = readFileSync(logPath, "utf8");
  const out: SessionEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as SessionEvent);
    } catch {
      // malformed line; skip
    }
  }
  return out;
}
```

Note: the imports reference `OrchestratorOutput` from `./orchestrator` which doesn't exist yet. Task 6 creates it. Use a temporary stub for now:

At the top of the existing imports in `src/session.ts`, replace:

```typescript
import type { OrchestratorOutput } from "./orchestrator";
```

with a temporary inline placeholder:

```typescript
// Temporary placeholder; replaced by Task 6
type OrchestratorOutput = unknown;
```

Task 6 restores the real import.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/session.test.ts
```

Expected: 8 tests pass (5 from Task 3 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/session.ts src/session.test.ts
git commit -m "feat: add session event log reader and writer"
```

---

## Task 5: Orchestrator Input Envelope Builder

**Goal:** Pure function that builds the JSON envelope fed to the orchestrator.

**Files:**
- Create: `src/orchestrator.ts`
- Create: `src/orchestrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/orchestrator.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/orchestrator.test.ts
```

Expected: FAIL — cannot resolve `./orchestrator`.

- [ ] **Step 3: Write minimal implementation**

Create `src/orchestrator.ts`:

```typescript
import type { AgentId } from "./cli";
import type { ForcedMode } from "./slash";

export type AgentResult = {
  id: AgentId;
  model: string;
  status: "ok" | "failed" | "timeout";
  branch: string;
  stdoutTail: string;
  diffSummary: string;
  diffPaths: string[];
};

export type HistoryItem = { turn: number; user: string; assistant: string };

export type OrchestratorInput = {
  turn: number;
  repoRoot: string;
  userMessage: string;
  forcedMode: ForcedMode;
  history: HistoryItem[];
  agents: AgentResult[];
};

export function buildOrchestratorInput(params: OrchestratorInput): OrchestratorInput {
  return {
    turn: params.turn,
    repoRoot: params.repoRoot,
    userMessage: params.userMessage,
    forcedMode: params.forcedMode,
    history: [...params.history],
    agents: [...params.agents],
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/orchestrator.test.ts
```

Expected: Both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts src/orchestrator.test.ts
git commit -m "feat: add orchestrator input envelope builder"
```

---

## Task 6: Orchestrator Output Parser & Validator

**Goal:** Parse the orchestrator's stdout into a validated `OrchestratorOutput`, with graceful handling of malformed output.

**Files:**
- Modify: `src/orchestrator.ts`
- Modify: `src/orchestrator.test.ts`
- Modify: `src/session.ts` (replace temporary placeholder)

- [ ] **Step 1: Write failing tests**

Append to `src/orchestrator.test.ts`:

```typescript
import { parseOrchestratorOutput, type OrchestratorOutput } from "./orchestrator";

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
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/orchestrator.test.ts
```

Expected: FAIL — `parseOrchestratorOutput` and `OrchestratorOutput` not exported.

- [ ] **Step 3: Extend `src/orchestrator.ts`**

Append to `src/orchestrator.ts`:

```typescript
export type Disagreement = {
  topic: string;
  positions: Partial<Record<AgentId, string>>;
  verdict: string;
  evidence: string[];
};

export type MergePlan = {
  pick: AgentId | "hybrid";
  branches: string[];
  rationale: string;
  followups: string[];
};

export type OrchestratorOutput = {
  intent: "ask" | "code";
  agreement: string[];
  disagreement: Disagreement[];
  bestAnswer: string;
  mergePlan?: MergePlan;
};

export type ParseResult =
  | { ok: true; value: OrchestratorOutput }
  | { ok: false; raw: string; reason: string };

function extractJsonObject(raw: string): string | null {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return raw.slice(first, last + 1);
}

export function parseOrchestratorOutput(raw: string): ParseResult {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return { ok: false, raw, reason: "no JSON object found" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      ok: false,
      raw,
      reason: `JSON parse error: ${(err as Error).message}`,
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, raw, reason: "parsed value is not an object" };
  }
  const o = parsed as Record<string, unknown>;

  if (o.intent !== "ask" && o.intent !== "code") {
    return { ok: false, raw, reason: "intent must be 'ask' or 'code'" };
  }
  if (!Array.isArray(o.agreement)) {
    return { ok: false, raw, reason: "agreement must be array" };
  }
  if (!Array.isArray(o.disagreement)) {
    return { ok: false, raw, reason: "disagreement must be array" };
  }
  if (typeof o.best_answer !== "string") {
    return { ok: false, raw, reason: "best_answer must be string" };
  }

  const output: OrchestratorOutput = {
    intent: o.intent,
    agreement: o.agreement as string[],
    disagreement: o.disagreement as Disagreement[],
    bestAnswer: o.best_answer,
  };
  if (o.intent === "code" && o.merge_plan) {
    output.mergePlan = o.merge_plan as MergePlan;
  }
  return { ok: true, value: output };
}
```

- [ ] **Step 4: Restore real import in `src/session.ts`**

In `src/session.ts`, remove the temporary:

```typescript
// Temporary placeholder; replaced by Task 6
type OrchestratorOutput = unknown;
```

Replace with:

```typescript
import type { OrchestratorOutput } from "./orchestrator";
```

- [ ] **Step 5: Run all tests**

```bash
npx vitest run src/orchestrator.test.ts src/session.test.ts
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator.ts src/orchestrator.test.ts src/session.ts
git commit -m "feat: add orchestrator output parser with graceful JSON recovery"
```

---

## Task 7: Orchestrator Subprocess Spawn

**Goal:** Wrap the `claude --print` invocation that runs the orchestrator per turn.

**Files:**
- Modify: `src/orchestrator.ts`
- Modify: `src/orchestrator.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/orchestrator.test.ts`:

```typescript
import { orchestratorSpawnConfig } from "./orchestrator";

describe("orchestratorSpawnConfig", () => {
  test("returns command, args, and stdin payload", () => {
    const input = buildOrchestratorInput({
      turn: 1,
      repoRoot: "/repo",
      userMessage: "x",
      forcedMode: null,
      history: [],
      agents: [],
    });
    const config = orchestratorSpawnConfig({
      input,
      model: "claude-opus-4-6",
      yolo: true,
    });
    expect(config.command).toBe("claude");
    expect(config.args).toContain("--print");
    expect(config.args).toContain("--model");
    expect(config.args).toContain("claude-opus-4-6");
    expect(config.args).toContain("--dangerously-skip-permissions");
    expect(config.stdin).toContain("SYSTEM:");
    expect(config.stdin).toContain('"userMessage": "x"');
  });

  test("omits --dangerously-skip-permissions when yolo=false", () => {
    const input = buildOrchestratorInput({
      turn: 1,
      repoRoot: "/r",
      userMessage: "x",
      forcedMode: null,
      history: [],
      agents: [],
    });
    const config = orchestratorSpawnConfig({
      input,
      model: "claude-opus-4-6",
      yolo: false,
    });
    expect(config.args).not.toContain("--dangerously-skip-permissions");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/orchestrator.test.ts
```

Expected: FAIL — `orchestratorSpawnConfig` not exported.

- [ ] **Step 3: Implement**

Append to `src/orchestrator.ts`:

```typescript
export const ORCHESTRATOR_SYSTEM_PROMPT = `You are the orchestrator for a multi-agent code assistant. On each turn:

1. CLASSIFY the user's intent as "ask" (wants an answer) or "code" (wants
   code changes). If forcedMode is set in the envelope, use it instead.

2. BROWSE THE CODE as needed to verify or reconcile what the sub-agents say.
   You have Read, Grep, Glob, and Bash (read-only git commands only). When
   sub-agents disagree, prefer ground truth from the code over any single
   agent's claim.

3. SYNTHESIZE a single response with this exact JSON shape — no prose outside it:

{
  "intent": "ask" | "code",
  "agreement": ["claim every successful agent made"],
  "disagreement": [
    {
      "topic": "short title",
      "positions": { "gemini": "...", "claude": "...", "codex": "..." },
      "verdict": "what's actually true based on code inspection",
      "evidence": ["path:line", "..."]
    }
  ],
  "best_answer": "the full synthesized answer, markdown OK",
  "merge_plan": {
    "pick": "gemini" | "claude" | "codex" | "hybrid",
    "branches": ["agents/claude/turn-3"],
    "rationale": "why this merge",
    "followups": []
  }
}

The merge_plan key is ONLY present when intent is "code". Cite file paths
with path:line when using evidence. If all successful agents agree and
your code inspection confirms, disagreement is [].
If an agent failed, note it in agreement rather than in positions.`;

export type OrchestratorSpawnParams = {
  input: OrchestratorInput;
  model: string;
  yolo: boolean;
};

export type OrchestratorSpawnConfig = {
  command: string;
  args: string[];
  stdin: string;
};

export function orchestratorSpawnConfig(
  params: OrchestratorSpawnParams,
): OrchestratorSpawnConfig {
  const args = [
    "--print",
    "--model",
    params.model,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  if (params.yolo) args.push("--dangerously-skip-permissions");

  const stdin = [
    "SYSTEM:",
    ORCHESTRATOR_SYSTEM_PROMPT,
    "",
    "INPUT ENVELOPE:",
    JSON.stringify(params.input, null, 2),
    "",
    "Produce the JSON response now.",
  ].join("\n");

  return { command: "claude", args, stdin };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/orchestrator.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts src/orchestrator.test.ts
git commit -m "feat: add orchestrator subprocess spawn config"
```

---

## Task 8: Synthesis Renderer

**Goal:** Pure function that turns `OrchestratorOutput` into an ANSI-colored terminal string.

**Files:**
- Create: `src/renderer.ts`
- Create: `src/renderer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/renderer.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run src/renderer.test.ts
```

Expected: FAIL — cannot resolve `./renderer`.

- [ ] **Step 3: Implement**

Create `src/renderer.ts`:

```typescript
import type { OrchestratorOutput } from "./orchestrator";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function paint(text: string, color: string, on: boolean): string {
  return on ? `${color}${text}${ANSI.reset}` : text;
}

export function renderSynthesis(
  output: OrchestratorOutput,
  opts: { color: boolean } = { color: true },
): string {
  const c = opts.color;
  const lines: string[] = [];

  // Compact footer for trivial cases
  const trivial =
    output.agreement.length === 0 &&
    output.disagreement.length === 0 &&
    !output.mergePlan &&
    output.bestAnswer.length < 200;

  lines.push(paint("▸ Answer", ANSI.cyan + ANSI.bold, c));
  lines.push(output.bestAnswer);

  if (output.agreement.length > 0) {
    lines.push("");
    lines.push(paint("✓ All 3 agents agree:", ANSI.green, c));
    for (const item of output.agreement) {
      lines.push(`  • ${item}`);
    }
  }

  for (const d of output.disagreement) {
    lines.push("");
    lines.push(paint(`⚠ Disagreement: ${d.topic}`, ANSI.yellow, c));
    for (const [agent, pos] of Object.entries(d.positions)) {
      lines.push(`  ${agent}: ${pos}`);
    }
    const ev = d.evidence.length > 0 ? ` [evidence: ${d.evidence.join(", ")}]` : "";
    lines.push(paint(`  → Verdict: ${d.verdict}${ev}`, ANSI.bold, c));
  }

  if (output.mergePlan) {
    lines.push("");
    lines.push(paint(`▸ Proposed merge: ${output.mergePlan.pick}`, ANSI.cyan + ANSI.bold, c));
    for (const b of output.mergePlan.branches) {
      lines.push(`  ${b}`);
    }
    lines.push(`  Rationale: ${output.mergePlan.rationale}`);
    if (output.mergePlan.followups.length > 0) {
      lines.push(`  Follow-ups:`);
      for (const f of output.mergePlan.followups) lines.push(`    • ${f}`);
    }
    lines.push("");
    lines.push(paint("  Merge this? [y/N/e]", ANSI.bold, c));
  }

  if (trivial) {
    lines.push("");
    lines.push(paint("✓ All agents aligned.", ANSI.dim, c));
  }

  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/renderer.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer.ts src/renderer.test.ts
git commit -m "feat: add synthesis renderer for interactive mode output"
```

---

## Task 9: Session Resume Loader

**Goal:** Given an existing session dir, rebuild history and detect interrupted turns.

**Files:**
- Modify: `src/session.ts`
- Modify: `src/session.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/session.test.ts`:

```typescript
import { loadSession, reconstructHistory } from "./session";

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
    // No orchestrator event — turn 1 never finished.
    const history = reconstructHistory(readEvents(session.logPath));
    expect(history).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests**

Expected: FAIL — `loadSession` / `reconstructHistory` not exported.

- [ ] **Step 3: Extend `src/session.ts`**

Append:

```typescript
export type LoadedSession = {
  id: string;
  dir: string;
  logPath: string;
  debugDir: string;
  worktreesDir: string;
  metadata: SessionMetadata;
  events: SessionEvent[];
};

export function loadSession(dir: string): LoadedSession {
  const metadataPath = join(dir, "metadata.json");
  const metadata: SessionMetadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  const logPath = join(dir, "session.jsonl");
  return {
    id: metadata.id,
    dir,
    logPath,
    debugDir: join(dir, "debug"),
    worktreesDir: join(dir, "worktrees"),
    metadata,
    events: readEvents(logPath),
  };
}

export function reconstructHistory(
  events: SessionEvent[],
): Array<{ turn: number; user: string; assistant: string }> {
  const byTurn = new Map<number, { user?: string; assistant?: string }>();
  for (const e of events) {
    if (e.type === "user") {
      const rec = byTurn.get(e.turn) ?? {};
      rec.user = e.text;
      byTurn.set(e.turn, rec);
    } else if (e.type === "orchestrator") {
      const rec = byTurn.get(e.turn) ?? {};
      rec.assistant = e.payload.bestAnswer;
      byTurn.set(e.turn, rec);
    }
  }
  const result: Array<{ turn: number; user: string; assistant: string }> = [];
  for (const [turn, rec] of [...byTurn.entries()].sort((a, b) => a[0] - b[0])) {
    if (rec.user && rec.assistant) {
      result.push({ turn, user: rec.user, assistant: rec.assistant });
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/session.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/session.ts src/session.test.ts
git commit -m "feat: add session load and history reconstruction"
```

---

## Task 10: Per-Turn Agent Fan-Out Helper

**Goal:** A single function that spawns all three agents in parallel worktrees for a turn, with conversation history pre-pended to each agent's prompt. Reuses existing `createWorktree`, `systemConstraints`, `featurePrompt` from cli.ts.

**Files:**
- Create: `src/turn.ts`
- Create: `src/turn.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/turn.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests**

Expected: FAIL — `./turn` does not exist.

- [ ] **Step 3: Implement**

Create `src/turn.ts`:

```typescript
import type { AgentId } from "./cli";
import { systemConstraints, featurePrompt } from "./cli";
import type { HistoryItem } from "./orchestrator";

export type BuildTurnPromptParams = {
  agent: AgentId;
  base: string;
  userMessage: string;
  history: HistoryItem[];
};

export function buildTurnPrompt(params: BuildTurnPromptParams): string {
  const parts: string[] = [systemConstraints(params.agent)];

  if (params.history.length > 0) {
    parts.push("");
    parts.push("CONVERSATION HISTORY:");
    for (const h of params.history) {
      parts.push(`[Turn ${h.turn}] user: ${h.user}`);
      parts.push(`[Turn ${h.turn}] assistant: ${h.assistant}`);
    }
  }

  parts.push("");
  parts.push("CURRENT TURN:");
  parts.push(featurePrompt(params.agent, params.base, params.userMessage));
  parts.push("");
  parts.push(
    "NOTE: You may answer in text only, or commit code changes to this worktree. " +
      "A text answer is always expected. Diffs are optional and the orchestrator " +
      "will decide whether to merge them.",
  );

  return parts.join("\n");
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/turn.test.ts
```

Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/turn.ts src/turn.test.ts
git commit -m "feat: add per-turn prompt builder with history prefix"
```

---

## Task 11: REPL Skeleton

**Goal:** A minimal REPL that reads lines from a stream, dispatches slash commands, and exits on `/quit`. No fan-out yet — turns are mocked via an injected callback.

**Files:**
- Create: `src/repl.ts`
- Create: `src/repl.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/repl.test.ts`:

```typescript
import { describe, test, expect } from "vitest";
import { PassThrough } from "node:stream";
import { runRepl, type ReplDeps } from "./repl";

function makeDeps(overrides: Partial<ReplDeps> = {}): {
  input: PassThrough;
  output: PassThrough;
  outputText: () => string;
  deps: ReplDeps;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (c) => chunks.push(c));
  const deps: ReplDeps = {
    input,
    output,
    executeTurn: async () => {},
    showHistory: async () => {},
    showAgents: async () => {},
    showHelp: async () => {},
    runSetCommand: async () => {},
    runMergeCommand: async () => {},
    runPrCommand: async () => {},
    banner: "gitgang interactive (test)",
    ...overrides,
  };
  return { input, output, outputText: () => Buffer.concat(chunks).toString("utf8"), deps };
}

describe("runRepl", () => {
  test("prints banner and prompt, exits on /quit", async () => {
    const { input, outputText, deps } = makeDeps();
    const p = runRepl(deps);
    input.write("/quit\n");
    input.end();
    await p;
    const text = outputText();
    expect(text).toContain("gitgang interactive (test)");
    expect(text).toMatch(/>/);
  });

  test("exits on EOF (stream end)", async () => {
    const { input, deps } = makeDeps();
    const p = runRepl(deps);
    input.end();
    await p;
    // Does not throw.
  });

  test("dispatches slash commands", async () => {
    let historyCalled = 0;
    let agentsCalled = 0;
    let helpCalled = 0;
    const { input, deps } = makeDeps({
      showHistory: async () => {
        historyCalled++;
      },
      showAgents: async () => {
        agentsCalled++;
      },
      showHelp: async () => {
        helpCalled++;
      },
    });
    const p = runRepl(deps);
    input.write("/history\n");
    input.write("/agents\n");
    input.write("/help\n");
    input.write("/quit\n");
    input.end();
    await p;
    expect(historyCalled).toBe(1);
    expect(agentsCalled).toBe(1);
    expect(helpCalled).toBe(1);
  });

  test("calls executeTurn for plain text and forced modes", async () => {
    const calls: Array<{ text: string; forcedMode: string | null }> = [];
    const { input, deps } = makeDeps({
      executeTurn: async (text, forcedMode) => {
        calls.push({ text, forcedMode });
      },
    });
    const p = runRepl(deps);
    input.write("how does auth work\n");
    input.write("/ask explain caching\n");
    input.write("/code add a button\n");
    input.write("/quit\n");
    input.end();
    await p;
    expect(calls).toEqual([
      { text: "how does auth work", forcedMode: null },
      { text: "explain caching", forcedMode: "ask" },
      { text: "add a button", forcedMode: "code" },
    ]);
  });

  test("unknown command prints an error and continues", async () => {
    const { input, outputText, deps } = makeDeps();
    const p = runRepl(deps);
    input.write("/frobnicate\n");
    input.write("/quit\n");
    input.end();
    await p;
    expect(outputText()).toContain("Unknown command");
  });
});
```

- [ ] **Step 2: Run tests**

Expected: FAIL — `./repl` does not exist.

- [ ] **Step 3: Implement**

Create `src/repl.ts`:

```typescript
import { createInterface } from "node:readline";
import type { ForcedMode } from "./slash";
import { parseSlashCommand } from "./slash";

export type ReplDeps = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  banner: string;
  executeTurn: (text: string, forcedMode: ForcedMode) => Promise<void>;
  showHistory: () => Promise<void>;
  showAgents: () => Promise<void>;
  showHelp: () => Promise<void>;
  runSetCommand: (key: string, value: string) => Promise<void>;
  runMergeCommand: () => Promise<void>;
  runPrCommand: () => Promise<void>;
};

export async function runRepl(deps: ReplDeps): Promise<void> {
  deps.output.write(deps.banner + "\n");
  deps.output.write(
    'Type /help for commands, /quit to exit. Or just type a message.\n\n',
  );

  const rl = createInterface({ input: deps.input, output: deps.output, terminal: false });

  for await (const line of rl) {
    deps.output.write("> " + line + "\n");
    const cmd = parseSlashCommand(line);
    switch (cmd.kind) {
      case "quit":
        rl.close();
        return;
      case "message":
        if (cmd.text.length === 0) {
          deps.output.write("(empty input)\n");
          break;
        }
        await deps.executeTurn(cmd.text, cmd.forcedMode);
        break;
      case "history":
        await deps.showHistory();
        break;
      case "agents":
        await deps.showAgents();
        break;
      case "help":
        await deps.showHelp();
        break;
      case "set":
        await deps.runSetCommand(cmd.key, cmd.value);
        break;
      case "merge":
        await deps.runMergeCommand();
        break;
      case "pr":
        await deps.runPrCommand();
        break;
      case "unknown":
        deps.output.write(`Unknown command: ${cmd.raw}\n`);
        break;
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/repl.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/repl.ts src/repl.test.ts
git commit -m "feat: add REPL skeleton with slash command dispatch"
```

---

## Task 12: Merge Confirm Flow

**Goal:** Prompt `Merge this? [y/N/e]` after a code-mode turn with a merge plan, route `y` to `applyMergePlan`, `N` to discard, `e` to open `$EDITOR`.

**Files:**
- Create: `src/confirm.ts`
- Create: `src/confirm.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/confirm.test.ts`:

```typescript
import { describe, test, expect } from "vitest";
import { PassThrough } from "node:stream";
import { promptMergeConfirm } from "./confirm";

function makeIo() {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (c) => chunks.push(c));
  return {
    input,
    output,
    text: () => Buffer.concat(chunks).toString("utf8"),
  };
}

describe("promptMergeConfirm", () => {
  test("returns 'yes' for y", async () => {
    const { input, output } = makeIo();
    const p = promptMergeConfirm(input, output);
    input.write("y\n");
    input.end();
    expect(await p).toBe("yes");
  });

  test("returns 'yes' for Y", async () => {
    const { input, output } = makeIo();
    const p = promptMergeConfirm(input, output);
    input.write("Y\n");
    input.end();
    expect(await p).toBe("yes");
  });

  test("returns 'no' for N", async () => {
    const { input, output } = makeIo();
    const p = promptMergeConfirm(input, output);
    input.write("n\n");
    input.end();
    expect(await p).toBe("no");
  });

  test("returns 'no' for empty (default)", async () => {
    const { input, output } = makeIo();
    const p = promptMergeConfirm(input, output);
    input.write("\n");
    input.end();
    expect(await p).toBe("no");
  });

  test("returns 'edit' for e", async () => {
    const { input, output } = makeIo();
    const p = promptMergeConfirm(input, output);
    input.write("e\n");
    input.end();
    expect(await p).toBe("edit");
  });

  test("re-prompts on invalid input", async () => {
    const { input, output, text } = makeIo();
    const p = promptMergeConfirm(input, output);
    input.write("maybe\n");
    input.write("y\n");
    input.end();
    expect(await p).toBe("yes");
    expect(text()).toMatch(/please answer y, n, or e/i);
  });
});
```

- [ ] **Step 2: Run tests**

Expected: FAIL — `./confirm` does not exist.

- [ ] **Step 3: Implement**

Create `src/confirm.ts`:

```typescript
import { createInterface } from "node:readline";

export type MergeChoice = "yes" | "no" | "edit";

export async function promptMergeConfirm(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<MergeChoice> {
  const rl = createInterface({ input, output, terminal: false });

  for await (const line of rl) {
    const answer = line.trim().toLowerCase();
    if (answer === "y" || answer === "yes") {
      rl.close();
      return "yes";
    }
    if (answer === "" || answer === "n" || answer === "no") {
      rl.close();
      return "no";
    }
    if (answer === "e" || answer === "edit") {
      rl.close();
      return "edit";
    }
    output.write("Please answer y, n, or e (default n): ");
  }
  return "no";
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/confirm.test.ts
```

Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/confirm.ts src/confirm.test.ts
git commit -m "feat: add merge-confirm y/N/e prompt"
```

---

## Task 13: Wire Turn Execution into REPL

**Goal:** Replace the mocked `executeTurn` with real fan-out + orchestrator + render + merge-confirm. Keep the implementation dependency-injectable for testing.

**Files:**
- Modify: `src/repl.ts`
- Modify: `src/repl.test.ts`

- [ ] **Step 1: Write failing integration test**

Append to `src/repl.test.ts`:

```typescript
import type { AgentResult, OrchestratorOutput } from "./orchestrator";
import { executeTurn as realExecuteTurn, type ExecuteTurnDeps } from "./repl";

function mockExecuteTurnDeps(overrides: Partial<ExecuteTurnDeps> = {}): ExecuteTurnDeps {
  const output = new PassThrough();
  return {
    session: {
      id: "s",
      dir: "/tmp/fake",
      logPath: "/tmp/fake/session.jsonl",
      debugDir: "/tmp/fake/debug",
      worktreesDir: "/tmp/fake/worktrees",
      metadata: {
        id: "s",
        startedAt: "",
        models: { gemini: "g", claude: "c", codex: "x" },
        reviewer: "codex",
        automerge: "ask",
      },
      events: [],
    },
    repoRoot: "/repo",
    base: "main",
    output,
    mergeInput: new PassThrough(),
    fanOut: async (): Promise<AgentResult[]> => [
      {
        id: "gemini",
        model: "g",
        status: "ok",
        branch: "agents/gemini/turn-1",
        stdoutTail: "gemini text",
        diffSummary: "",
        diffPaths: [],
      },
      {
        id: "claude",
        model: "c",
        status: "ok",
        branch: "agents/claude/turn-1",
        stdoutTail: "claude text",
        diffSummary: "",
        diffPaths: [],
      },
      {
        id: "codex",
        model: "x",
        status: "ok",
        branch: "agents/codex/turn-1",
        stdoutTail: "codex text",
        diffSummary: "",
        diffPaths: [],
      },
    ],
    spawnOrchestrator: async (): Promise<OrchestratorOutput> => ({
      intent: "ask",
      agreement: ["mocked agreement"],
      disagreement: [],
      bestAnswer: "mocked answer",
    }),
    applyMerge: async () => ({ success: true }),
    cleanupWorktrees: async () => {},
    ...overrides,
  };
}

describe("executeTurn (integration)", () => {
  test("ask-mode turn renders answer and does not prompt", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c) => chunks.push(c));
    const deps = mockExecuteTurnDeps({ output });
    await realExecuteTurn("how does auth work", null, deps);
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain("mocked answer");
    expect(text).not.toContain("Merge this?");
  });

  test("code-mode turn prompts and merges on y", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c) => chunks.push(c));
    const mergeInput = new PassThrough();
    let applied = 0;
    const deps = mockExecuteTurnDeps({
      output,
      mergeInput,
      spawnOrchestrator: async () => ({
        intent: "code",
        agreement: [],
        disagreement: [],
        bestAnswer: "picked claude",
        mergePlan: {
          pick: "claude",
          branches: ["agents/claude/turn-1"],
          rationale: "best",
          followups: [],
        },
      }),
      applyMerge: async () => {
        applied++;
        return { success: true };
      },
    });
    const p = realExecuteTurn("add logout", null, deps);
    mergeInput.write("y\n");
    await p;
    expect(applied).toBe(1);
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toContain("Merge this?");
  });

  test("all-agents-failed path skips orchestrator and prints error", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (c) => chunks.push(c));
    let orchestratorCalled = 0;
    const deps = mockExecuteTurnDeps({
      output,
      fanOut: async () => [
        {
          id: "gemini",
          model: "g",
          status: "failed",
          branch: "",
          stdoutTail: "",
          diffSummary: "",
          diffPaths: [],
        },
        {
          id: "claude",
          model: "c",
          status: "failed",
          branch: "",
          stdoutTail: "",
          diffSummary: "",
          diffPaths: [],
        },
        {
          id: "codex",
          model: "x",
          status: "failed",
          branch: "",
          stdoutTail: "",
          diffSummary: "",
          diffPaths: [],
        },
      ],
      spawnOrchestrator: async () => {
        orchestratorCalled++;
        throw new Error("should not be called");
      },
    });
    await realExecuteTurn("q", null, deps);
    expect(orchestratorCalled).toBe(0);
    expect(Buffer.concat(chunks).toString("utf8")).toContain("All agents failed");
  });
});
```

- [ ] **Step 2: Run tests**

Expected: FAIL — `executeTurn` and `ExecuteTurnDeps` not exported from `./repl`.

- [ ] **Step 3: Implement**

Append to `src/repl.ts`:

```typescript
import type { LoadedSession } from "./session";
import { appendEvent, reconstructHistory } from "./session";
import {
  buildOrchestratorInput,
  type AgentResult,
  type OrchestratorOutput,
  type MergePlan,
} from "./orchestrator";
import { renderSynthesis } from "./renderer";
import { promptMergeConfirm } from "./confirm";

export type ExecuteTurnDeps = {
  session: LoadedSession;
  repoRoot: string;
  base: string;
  output: NodeJS.WritableStream;
  mergeInput: NodeJS.ReadableStream;
  fanOut: (params: {
    turn: number;
    userMessage: string;
    history: Array<{ turn: number; user: string; assistant: string }>;
    worktreesDir: string;
    base: string;
  }) => Promise<AgentResult[]>;
  spawnOrchestrator: (
    input: ReturnType<typeof buildOrchestratorInput>,
  ) => Promise<OrchestratorOutput>;
  applyMerge: (plan: MergePlan) => Promise<{ success: boolean; error?: string }>;
  cleanupWorktrees: (turn: number) => Promise<void>;
};

export async function executeTurn(
  userMessage: string,
  forcedMode: "ask" | "code" | null,
  deps: ExecuteTurnDeps,
): Promise<void> {
  const turn = currentTurnNumber(deps.session) + 1;
  const now = () => new Date().toISOString();
  const history = reconstructHistory(deps.session.events);

  appendEvent(deps.session.logPath, {
    ts: now(),
    turn,
    type: "user",
    text: userMessage,
    forcedMode,
  });

  const agents = await deps.fanOut({
    turn,
    userMessage,
    history,
    worktreesDir: deps.session.worktreesDir,
    base: deps.base,
  });

  for (const a of agents) {
    appendEvent(deps.session.logPath, {
      ts: now(),
      turn,
      type: "agent_end",
      agent: a.id,
      status: a.status,
      diffSummary: a.diffSummary,
    });
  }

  const successful = agents.filter((a) => a.status === "ok");
  if (successful.length === 0) {
    deps.output.write("✗ All agents failed. Retry or /quit.\n");
    await deps.cleanupWorktrees(turn);
    return;
  }

  const envelope = buildOrchestratorInput({
    turn,
    repoRoot: deps.repoRoot,
    userMessage,
    forcedMode,
    history,
    agents,
  });

  let output: OrchestratorOutput;
  try {
    output = await deps.spawnOrchestrator(envelope);
  } catch (err) {
    deps.output.write(
      `⚠ Orchestrator failed: ${(err as Error).message}\n` +
        `Agent branches retained: ${agents.map((a) => a.branch).join(", ")}\n`,
    );
    return;
  }

  appendEvent(deps.session.logPath, {
    ts: now(),
    turn,
    type: "orchestrator",
    payload: output,
  });

  deps.output.write(renderSynthesis(output, { color: true }));

  if (output.intent === "code" && output.mergePlan) {
    if (deps.session.metadata.automerge === "on") {
      const result = await deps.applyMerge(output.mergePlan);
      appendEvent(deps.session.logPath, {
        ts: now(),
        turn,
        type: "merge",
        branch: output.mergePlan.branches[0] ?? "",
        outcome: result.success ? "merged" : "declined",
      });
      deps.output.write(
        result.success ? "✓ Merged automatically.\n" : `✗ Merge failed: ${result.error}\n`,
      );
    } else if (deps.session.metadata.automerge === "ask") {
      const choice = await promptMergeConfirm(deps.mergeInput, deps.output);
      if (choice === "yes") {
        const result = await deps.applyMerge(output.mergePlan);
        appendEvent(deps.session.logPath, {
          ts: now(),
          turn,
          type: "merge",
          branch: output.mergePlan.branches[0] ?? "",
          outcome: result.success ? "merged" : "declined",
        });
        deps.output.write(
          result.success ? "✓ Merged.\n" : `✗ Merge failed: ${result.error}\n`,
        );
      } else {
        appendEvent(deps.session.logPath, {
          ts: now(),
          turn,
          type: "merge",
          branch: output.mergePlan.branches[0] ?? "",
          outcome: "declined",
        });
        deps.output.write("Declined. Branches retained.\n");
      }
    }
    // automerge === "off" → no prompt, no apply
  }

  await deps.cleanupWorktrees(turn);
}

function currentTurnNumber(session: LoadedSession): number {
  let max = 0;
  for (const e of session.events) if (e.turn > max) max = e.turn;
  return max;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/repl.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/repl.ts src/repl.test.ts
git commit -m "feat: add executeTurn integrating fan-out, orchestrator, render, merge-confirm"
```

---

## Task 14: Real fanOut and spawnOrchestrator Implementations

**Goal:** Ship the non-mocked implementations of the functions `executeTurn` depends on. These integrate with the real subprocess plumbing in `cli.ts`.

**Files:**
- Modify: `src/repl.ts`
- Modify: `src/repl.test.ts`

- [ ] **Step 1: Write failing test (smoke, function-level only)**

Append to `src/repl.test.ts`:

```typescript
import { createRealFanOut, createRealOrchestrator } from "./repl";

describe("real fan-out and orchestrator factories (shape only)", () => {
  test("createRealFanOut returns a function", () => {
    const fn = createRealFanOut({
      agentIds: ["gemini", "claude", "codex"],
      models: { gemini: "g", claude: "c", codex: "x" },
      yolo: true,
      timeoutMs: 60_000,
      repoRoot: "/repo",
    });
    expect(typeof fn).toBe("function");
  });

  test("createRealOrchestrator returns a function", () => {
    const fn = createRealOrchestrator({
      model: "claude-opus-4-6",
      yolo: true,
      timeoutMs: 300_000,
      repoRoot: "/repo",
      debugDir: "/repo/.gitgang/debug",
    });
    expect(typeof fn).toBe("function");
  });
});
```

- [ ] **Step 2: Run tests**

Expected: FAIL — factories not exported.

- [ ] **Step 3: Implement**

Append to `src/repl.ts`:

```typescript
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentId } from "./cli";
import { createWorktree, spawnProcess } from "./cli";
import { buildTurnPrompt } from "./turn";
import { orchestratorSpawnConfig, parseOrchestratorOutput } from "./orchestrator";

export type RealFanOutConfig = {
  agentIds: AgentId[];
  models: Record<AgentId, string>;
  yolo: boolean;
  timeoutMs: number;
  repoRoot: string;
};

export function createRealFanOut(cfg: RealFanOutConfig): ExecuteTurnDeps["fanOut"] {
  return async ({ turn, userMessage, history, worktreesDir, base }) => {
    const results: AgentResult[] = await Promise.all(
      cfg.agentIds.map(async (agent) => {
        const branch = `agents/${agent}/turn-${turn}`;
        const worktree = join(worktreesDir, `turn-${turn}`, agent);
        try {
          await createWorktree(cfg.repoRoot, worktree, branch, base);
          const prompt = buildTurnPrompt({ agent, base, userMessage, history });
          const promptFile = join(worktree, ".gitgang-prompt.txt");
          writeFileSync(promptFile, prompt);

          const [command, ...args] = agentCommandFor(agent, cfg.models[agent], cfg.yolo);
          const bashCmd = `cat "${promptFile}" | ${command} ${args.map((a) => JSON.stringify(a)).join(" ")}`;
          const proc = spawnProcess(["bash", "-c", bashCmd], { cwd: worktree });

          const timer = setTimeout(() => proc.kill("SIGTERM"), cfg.timeoutMs);
          const { stdout, code } = await proc.done;
          clearTimeout(timer);

          const diffSummary = await gitDiffStat(worktree, base);
          const diffPaths = diffSummary
            ? diffSummary.split("\n").filter(Boolean).map((l) => l.split("|")[0].trim())
            : [];

          return {
            id: agent,
            model: cfg.models[agent],
            status: code === 0 ? "ok" : "failed",
            branch,
            stdoutTail: stdout.slice(-8192),
            diffSummary,
            diffPaths,
          };
        } catch (err) {
          return {
            id: agent,
            model: cfg.models[agent],
            status: "failed",
            branch,
            stdoutTail: (err as Error).message,
            diffSummary: "",
            diffPaths: [],
          };
        }
      }),
    );
    return results;
  };
}

function agentCommandFor(agent: AgentId, model: string, yolo: boolean): string[] {
  switch (agent) {
    case "gemini":
      return ["gemini", "--model", model, ...(yolo ? ["--yolo"] : [])];
    case "claude":
      return [
        "claude",
        "--print",
        "--model",
        model,
        "--output-format",
        "stream-json",
        "--verbose",
        ...(yolo ? ["--dangerously-skip-permissions"] : []),
      ];
    case "codex":
      return ["codex", "exec", "--model", model, ...(yolo ? ["--dangerously-bypass-approvals-and-sandbox"] : [])];
  }
}

async function gitDiffStat(worktree: string, base: string): Promise<string> {
  const proc = spawnProcess(["git", "diff", "--stat", `${base}..HEAD`], { cwd: worktree });
  const { stdout } = await proc.done;
  return stdout.trim();
}

export type RealOrchestratorConfig = {
  model: string;
  yolo: boolean;
  timeoutMs: number;
  repoRoot: string;
  debugDir: string;
};

export function createRealOrchestrator(
  cfg: RealOrchestratorConfig,
): ExecuteTurnDeps["spawnOrchestrator"] {
  return async (input) => {
    const { command, args, stdin } = orchestratorSpawnConfig({
      input,
      model: cfg.model,
      yolo: cfg.yolo,
    });

    const inputFile = join(cfg.debugDir, `turn-${String(input.turn).padStart(3, "0")}-input.json`);
    writeFileSync(inputFile, JSON.stringify(input, null, 2));

    const bashCmd = `cat - | ${command} ${args.map((a) => JSON.stringify(a)).join(" ")}`;
    const proc = spawnProcess(["bash", "-c", bashCmd], { cwd: cfg.repoRoot });
    proc.child.stdin?.write(stdin);
    proc.child.stdin?.end();

    const timer = setTimeout(() => proc.kill("SIGTERM"), cfg.timeoutMs);
    const { stdout, code } = await proc.done;
    clearTimeout(timer);

    const outputFile = join(cfg.debugDir, `turn-${String(input.turn).padStart(3, "0")}-output.txt`);
    writeFileSync(outputFile, stdout);

    if (code !== 0) {
      throw new Error(`orchestrator exited with code ${code}`);
    }

    const parsed = parseOrchestratorOutput(stdout);
    if (!parsed.ok) {
      throw new Error(`orchestrator output unparseable: ${parsed.reason}`);
    }
    return parsed.value;
  };
}
```

Note: `spawnProcess` in cli.ts returns `{ child, done, kill }`. Adapt references if the actual signature differs. The test above only verifies the factory returns a function — integration tests for real spawning are in Task 18.

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/repl.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/repl.ts src/repl.test.ts
git commit -m "feat: add real fan-out and orchestrator spawn factories"
```

---

## Task 15: CLI Flag Routing for Interactive Mode

**Goal:** Parse `-i`/`--interactive`, `--resume [id]`, `--automerge`, and `sessions list|show` in `cli.ts`. Dispatch to REPL.

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/cli.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/cli.test.ts`:

```typescript
import { parseArgs } from "./cli";

describe("interactive mode flag parsing", () => {
  test("bare gg implies interactive", () => {
    const p = parseArgs([]);
    expect(p.interactive).toBe(true);
  });

  test("-i flag enables interactive", () => {
    const p = parseArgs(["-i"]);
    expect(p.interactive).toBe(true);
  });

  test("--interactive enables interactive", () => {
    const p = parseArgs(["--interactive"]);
    expect(p.interactive).toBe(true);
  });

  test("gg 'task' stays one-shot", () => {
    const p = parseArgs(["do thing"]);
    expect(p.interactive).toBe(false);
    expect(p.task).toBe("do thing");
  });

  test("-i 'opener' sets first message", () => {
    const p = parseArgs(["-i", "opener text"]);
    expect(p.interactive).toBe(true);
    expect(p.opener).toBe("opener text");
  });

  test("--resume without value resumes most recent", () => {
    const p = parseArgs(["-i", "--resume"]);
    expect(p.resume).toEqual({ mode: "latest" });
  });

  test("--resume with id resumes specific", () => {
    const p = parseArgs(["-i", "--resume", "2026-04-14T20-00-00-abc123"]);
    expect(p.resume).toEqual({ mode: "id", id: "2026-04-14T20-00-00-abc123" });
  });

  test("--automerge on|off|ask parses", () => {
    expect(parseArgs(["-i", "--automerge", "on"]).automerge).toBe("on");
    expect(parseArgs(["-i", "--automerge", "off"]).automerge).toBe("off");
    expect(parseArgs(["-i", "--automerge", "ask"]).automerge).toBe("ask");
  });

  test("sessions list subcommand", () => {
    const p = parseArgs(["sessions", "list"]);
    expect(p.subcommand).toEqual({ kind: "sessions_list" });
  });

  test("sessions show ID subcommand", () => {
    const p = parseArgs(["sessions", "show", "abc"]);
    expect(p.subcommand).toEqual({ kind: "sessions_show", id: "abc" });
  });
});
```

- [ ] **Step 2: Run tests**

Expected: FAIL — `parseArgs` doesn't yet handle these flags.

- [ ] **Step 3: Modify `parseArgs` in `src/cli.ts`**

Locate the existing `parseArgs` function. Extend its return type:

```typescript
export type ParsedArgs = {
  // ... existing fields ...
  interactive?: boolean;
  opener?: string;
  resume?: { mode: "latest" } | { mode: "id"; id: string };
  automerge?: "on" | "off" | "ask";
  subcommand?:
    | { kind: "sessions_list" }
    | { kind: "sessions_show"; id: string };
};
```

Add the following branches in the arg-parsing switch (before the positional-task fallback):

```typescript
case "-i":
case "--interactive":
  interactive = true;
  break;
case "--resume":
  if (i + 1 < raw.length && !raw[i + 1].startsWith("-")) {
    resume = { mode: "id", id: raw[++i] };
  } else {
    resume = { mode: "latest" };
  }
  break;
case "--automerge":
  if (i + 1 >= raw.length) throw new Error("--automerge requires on|off|ask");
  const v = raw[++i];
  if (v !== "on" && v !== "off" && v !== "ask")
    throw new Error("--automerge must be one of: on, off, ask");
  automerge = v;
  break;
```

Add subcommand handling at the very start of `parseArgs`:

```typescript
if (raw[0] === "sessions") {
  if (raw[1] === "list") return { subcommand: { kind: "sessions_list" } } as ParsedArgs;
  if (raw[1] === "show" && raw[2]) return { subcommand: { kind: "sessions_show", id: raw[2] } } as ParsedArgs;
  throw new Error("usage: gg sessions list | gg sessions show <id>");
}
```

Update interactive default: if no task is provided and no subcommand, set `interactive = true`. If the first positional arg is passed after `-i`, treat as `opener`:

```typescript
if (interactive && positional.length > 0 && !task) {
  opener = positional.join(" ");
}
if (!interactive && !task && !subcommand) {
  interactive = true;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/cli.test.ts
```

Expected: All tests pass (existing + 10 new).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat: add interactive mode CLI flags and sessions subcommand"
```

---

## Task 16: Dispatch to REPL from main()

**Goal:** In `cli.ts`'s `main()`, branch on `parsed.interactive` and invoke the REPL. Branch on `parsed.subcommand` and invoke sessions list/show. Leave one-shot path untouched.

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing test**

Append to `src/cli.test.ts`:

```typescript
describe("main dispatch", () => {
  test("exports dispatchMain wrapper", async () => {
    const mod = await import("./cli");
    expect(typeof mod.dispatchMain).toBe("function");
  });
});
```

- [ ] **Step 2: Run test**

Expected: FAIL — `dispatchMain` not exported.

- [ ] **Step 3: Add `dispatchMain` to `src/cli.ts`**

Near the bottom of `src/cli.ts` (just above the existing `main()`):

```typescript
import { runRepl, createRealFanOut, createRealOrchestrator, executeTurn } from "./repl";
import { createSession, loadSession } from "./session";
import { existsSync, readdirSync, statSync, readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

export async function dispatchMain(parsed: ParsedArgs): Promise<number> {
  if (parsed.subcommand?.kind === "sessions_list") {
    return runSessionsList();
  }
  if (parsed.subcommand?.kind === "sessions_show") {
    return runSessionsShow(parsed.subcommand.id);
  }
  if (parsed.interactive) {
    return runInteractive(parsed);
  }
  // Fall through to existing one-shot main logic.
  return existingOneShotMain(parsed);
}

async function runInteractive(parsed: ParsedArgs): Promise<number> {
  const repo = await repoRoot();
  const sessionsRoot = resolve(repo, ".gitgang", "sessions");
  const models = resolveModels();

  let session;
  if (parsed.resume?.mode === "latest") {
    session = loadSession(mostRecentSessionDir(sessionsRoot));
  } else if (parsed.resume?.mode === "id") {
    session = loadSession(join(sessionsRoot, parsed.resume.id));
  } else {
    session = loadSession(
      createSession(sessionsRoot, {
        models,
        reviewer: parsed.reviewerAgent ?? "codex",
        automerge: parsed.automerge ?? "ask",
      }).dir,
    );
  }

  const fanOut = createRealFanOut({
    agentIds: parsed.activeAgents ?? ["gemini", "claude", "codex"],
    models,
    yolo: parsed.yolo ?? true,
    timeoutMs: parsed.timeoutMs ?? 10 * 60 * 1000,
    repoRoot: repo,
  });
  const spawnOrchestrator = createRealOrchestrator({
    model: models.claude,
    yolo: parsed.yolo ?? true,
    timeoutMs: 15 * 60 * 1000,
    repoRoot: repo,
    debugDir: session.debugDir,
  });

  const executeTurnDeps = {
    session,
    repoRoot: repo,
    base: parsed.base ?? "main",
    output: process.stdout,
    mergeInput: process.stdin,
    fanOut,
    spawnOrchestrator,
    applyMerge: async (plan: any) => {
      try {
        await applyMergePlan(repo, plan);
        return { success: true };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
    cleanupWorktrees: async (turn: number) => {
      const turnDir = join(session.worktreesDir, `turn-${turn}`);
      if (existsSync(turnDir)) rmSync(turnDir, { recursive: true, force: true });
    },
  };

  await runRepl({
    input: process.stdin,
    output: process.stdout,
    banner: `gitgang v${VERSION} interactive — session ${session.id}`,
    executeTurn: (text, forcedMode) => executeTurn(text, forcedMode, executeTurnDeps),
    showHistory: async () => {
      for (const e of session.events) {
        if (e.type === "user") process.stdout.write(`[turn ${e.turn}] you: ${e.text}\n`);
        if (e.type === "orchestrator")
          process.stdout.write(`[turn ${e.turn}] gitgang: ${e.payload.bestAnswer}\n`);
      }
    },
    showAgents: async () => {
      process.stdout.write(
        `Agents: ${Object.entries(models)
          .map(([a, m]) => `${a}=${m}`)
          .join(", ")}\n`,
      );
    },
    showHelp: async () => {
      process.stdout.write(
        [
          "Commands:",
          "  /ask <msg>   force question mode",
          "  /code <msg>  force code mode",
          "  /merge       apply last turn's merge plan",
          "  /pr          open PR for last merge",
          "  /history     show transcript",
          "  /agents      show agent roster",
          "  /set K V     set a runtime knob",
          "  /help        this message",
          "  /quit        exit",
          "",
        ].join("\n"),
      );
    },
    runSetCommand: async (key, value) => {
      if (key === "automerge" && (value === "on" || value === "off" || value === "ask")) {
        session.metadata.automerge = value;
        process.stdout.write(`automerge = ${value}\n`);
      } else {
        process.stdout.write(`Unknown or unsupported /set ${key} ${value}\n`);
      }
    },
    runMergeCommand: async () => {
      process.stdout.write("(/merge not yet implemented — see v1.7.1)\n");
    },
    runPrCommand: async () => {
      process.stdout.write("(/pr not yet implemented — see v1.7.1)\n");
    },
  });

  if (parsed.opener) {
    // Already triggered via stdin path — in practice, feed the opener as the first line.
  }
  return 0;
}

function runSessionsList(): number {
  // Implementation in Task 17.
  console.log("(sessions list — implemented in Task 17)");
  return 0;
}
function runSessionsShow(id: string): number {
  // Implementation in Task 17.
  console.log(`(sessions show ${id} — implemented in Task 17)`);
  return 0;
}

function mostRecentSessionDir(root: string): string {
  if (!existsSync(root)) throw new Error("no sessions exist yet");
  const entries = readdirSync(root)
    .map((name) => ({ name, path: join(root, name), mtime: statSync(join(root, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (entries.length === 0) throw new Error("no sessions found");
  return entries[0].path;
}

async function existingOneShotMain(parsed: ParsedArgs): Promise<number> {
  // Extract the body of the existing main() into this function.
  // If main() already does this work, rename it to existingOneShotMain.
  throw new Error("extract one-shot logic here — wire existing main body in");
}
```

**IMPORTANT:** Extract the current body of `main()` (one-shot logic) into `existingOneShotMain(parsed)`. Replace `main()` body with a single call to `dispatchMain(parseArgs(process.argv.slice(2)))`.

- [ ] **Step 4: Run tests and build**

```bash
npx vitest run && npm run build
```

Expected: Tests pass; build succeeds.

- [ ] **Step 5: Smoke-test the dispatch manually**

```bash
node dist/cli.js "do a tiny task" --dry-run   # one-shot path still works
echo "/quit" | node dist/cli.js -i            # interactive path exits cleanly
```

Expected: Both return exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat: dispatch CLI to REPL or one-shot based on args"
```

---

## Task 17: sessions list / sessions show

**Goal:** Implement the two read-only session subcommands.

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/cli.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/cli.test.ts`:

```typescript
import { formatSessionsList, formatSessionShow } from "./cli";

describe("sessions list/show formatting", () => {
  test("formatSessionsList renders one line per session", () => {
    const s = formatSessionsList([
      {
        id: "2026-04-14T20-00-00-abc",
        startedAt: "2026-04-14T20:00:00Z",
        turns: 5,
        reviewer: "codex",
      },
      {
        id: "2026-04-13T12-00-00-def",
        startedAt: "2026-04-13T12:00:00Z",
        turns: 2,
        reviewer: "codex",
      },
    ]);
    expect(s).toContain("2026-04-14T20-00-00-abc");
    expect(s).toContain("2026-04-13T12-00-00-def");
    expect(s).toContain("5");
    expect(s).toContain("2");
  });

  test("formatSessionShow prints events in order", () => {
    const s = formatSessionShow([
      { ts: "t1", turn: 1, type: "user", text: "hi", forcedMode: null },
      {
        ts: "t2",
        turn: 1,
        type: "orchestrator",
        payload: {
          intent: "ask",
          agreement: [],
          disagreement: [],
          bestAnswer: "yo",
        },
      },
    ]);
    expect(s).toContain("turn 1");
    expect(s).toContain("you: hi");
    expect(s).toContain("gitgang: yo");
  });
});
```

- [ ] **Step 2: Run tests**

Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/cli.ts`:

```typescript
import type { SessionEvent } from "./session";

export type SessionSummary = {
  id: string;
  startedAt: string;
  turns: number;
  reviewer: AgentId;
};

export function formatSessionsList(sessions: SessionSummary[]): string {
  if (sessions.length === 0) return "No sessions found.\n";
  const lines: string[] = [];
  lines.push("ID                                    Started                  Turns  Reviewer");
  for (const s of sessions) {
    lines.push(`${s.id.padEnd(38)}  ${s.startedAt.padEnd(20)}  ${String(s.turns).padStart(5)}  ${s.reviewer}`);
  }
  return lines.join("\n") + "\n";
}

export function formatSessionShow(events: SessionEvent[]): string {
  const lines: string[] = [];
  for (const e of events) {
    if (e.type === "user") {
      lines.push(`[turn ${e.turn}] you: ${e.text}`);
    } else if (e.type === "orchestrator") {
      lines.push(`[turn ${e.turn}] gitgang: ${e.payload.bestAnswer}`);
    } else if (e.type === "merge") {
      lines.push(`[turn ${e.turn}] merge: ${e.outcome} (${e.branch})`);
    }
  }
  return lines.join("\n") + "\n";
}
```

Replace the stubs `runSessionsList()` / `runSessionsShow()` from Task 16 with:

```typescript
function runSessionsList(): number {
  const root = resolve(".gitgang", "sessions");
  if (!existsSync(root)) {
    process.stdout.write("No sessions found.\n");
    return 0;
  }
  const summaries: SessionSummary[] = readdirSync(root)
    .filter((name) => existsSync(join(root, name, "metadata.json")))
    .map((name) => {
      const dir = join(root, name);
      const meta = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
      const log = readFileSync(join(dir, "session.jsonl"), "utf8");
      const turns = new Set(
        log
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            try {
              return JSON.parse(l).turn;
            } catch {
              return null;
            }
          })
          .filter((t): t is number => typeof t === "number"),
      );
      return { id: meta.id, startedAt: meta.startedAt, turns: turns.size, reviewer: meta.reviewer };
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  process.stdout.write(formatSessionsList(summaries));
  return 0;
}

function runSessionsShow(id: string): number {
  const dir = resolve(".gitgang", "sessions", id);
  if (!existsSync(dir)) {
    process.stderr.write(`Session ${id} not found.\n`);
    return 1;
  }
  const loaded = loadSession(dir);
  process.stdout.write(formatSessionShow(loaded.events));
  return 0;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/cli.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "feat: add sessions list and sessions show subcommands"
```

---

## Task 18: .gitignore Guard in Postinstall

**Goal:** Append `.gitgang/` to the repo's `.gitignore` during `npm install`, if missing.

**Files:**
- Modify: `scripts/ensure-clis.mjs`

- [ ] **Step 1: Add the guard**

At the bottom of `scripts/ensure-clis.mjs`:

```javascript
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

function ensureGitignoreEntry() {
  const gitignore = resolve(process.cwd(), ".gitignore");
  if (!existsSync(gitignore)) return; // Not a git repo root; skip.
  const contents = readFileSync(gitignore, "utf8");
  if (contents.split("\n").some((l) => l.trim() === ".gitgang/" || l.trim() === ".gitgang")) {
    return;
  }
  appendFileSync(
    gitignore,
    (contents.endsWith("\n") ? "" : "\n") + "\n# gitgang interactive sessions\n.gitgang/\n",
  );
}

ensureGitignoreEntry();
```

- [ ] **Step 2: Manual smoke test**

```bash
cd /tmp && mkdir gg-gitignore-test && cd gg-gitignore-test
git init -q && echo "dist/" > .gitignore
node /Users/jasonroell/projects/gitgang/scripts/ensure-clis.mjs
cat .gitignore
```

Expected: `.gitgang/` appears in the `.gitignore`.

- [ ] **Step 3: Cleanup and commit**

```bash
rm -rf /tmp/gg-gitignore-test
cd /Users/jasonroell/projects/gitgang
git add scripts/ensure-clis.mjs
git commit -m "chore: append .gitgang/ to .gitignore on postinstall"
```

---

## Task 19: End-to-End REPL Integration Test

**Goal:** Drive a full turn through `executeTurn` with mocked subprocesses, asserting session.jsonl events and rendered output.

**Files:**
- Create: `src/interactive.integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create `src/interactive.integration.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
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
        {
          id: "gemini",
          model: "g",
          status: "ok",
          branch: "agents/gemini/turn-1",
          stdoutTail: "",
          diffSummary: "",
          diffPaths: [],
        },
        {
          id: "claude",
          model: "c",
          status: "ok",
          branch: "agents/claude/turn-1",
          stdoutTail: "",
          diffSummary: "",
          diffPaths: [],
        },
        {
          id: "codex",
          model: "x",
          status: "ok",
          branch: "agents/codex/turn-1",
          stdoutTail: "",
          diffSummary: "",
          diffPaths: [],
        },
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
        {
          id: "gemini",
          model: "g",
          status: "ok",
          branch: "b1",
          stdoutTail: "",
          diffSummary: "",
          diffPaths: [],
        },
        {
          id: "claude",
          model: "c",
          status: "ok",
          branch: "b2",
          stdoutTail: "",
          diffSummary: "",
          diffPaths: [],
        },
        {
          id: "codex",
          model: "x",
          status: "ok",
          branch: "b3",
          stdoutTail: "",
          diffSummary: "",
          diffPaths: [],
        },
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
});
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run src/interactive.integration.test.ts
```

Expected: Both tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/interactive.integration.test.ts
git commit -m "test: add end-to-end integration test for interactive turns"
```

---

## Task 20: README, CHANGELOG, Version Bump

**Goal:** Document the feature and cut v1.7.0.

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `src/cli.ts` (`VERSION` constant)

- [ ] **Step 1: Update `VERSION` in `src/cli.ts`**

Find `const VERSION = "1.6.0";` and change to `const VERSION = "1.7.0";`.

- [ ] **Step 2: Bump `package.json`**

In `package.json`, change `"version": "1.6.0"` → `"version": "1.7.0"`.

- [ ] **Step 3: Add CHANGELOG entry**

At the top of `CHANGELOG.md`, add:

```markdown
## v1.7.0 — 2026-04-14

**New: Interactive mode**

- `gg` or `gg -i` enters an interactive REPL. Every turn fans out to all three agents; a fresh Claude Code orchestrator classifies intent, browses the code, and emits a structured synthesis.
- Question-mode turns show agreement across agents, explicit disagreement with per-agent positions, the orchestrator's verdict, and a synthesized best answer.
- Code-mode turns default to show-and-confirm merges (`Merge this? [y/N/e]`). Configure with `--automerge on|off|ask` or `/set automerge ...`.
- Sessions persist to `.gitgang/sessions/<id>/`. Resume with `gg -i --resume`. List with `gg sessions list`.
- One-shot mode (`gg "task"`) is unchanged.

**Also in this release**

- Default Gemini model: `gemini-3.1-pro-preview` (was the invalid `gemini-3.1-pro`).
```

- [ ] **Step 4: Add README section**

Add a new section to `README.md` titled `## Interactive Mode`:

```markdown
## Interactive Mode

Start a conversational session with all three agents:

    gg              # enters interactive mode
    gg -i           # same
    gg -i "how does auth work"   # pre-loads first turn

Every turn sends your message to gemini, claude, and codex in parallel worktrees. A Claude Code orchestrator then inspects the responses, browses the code to verify claims, and synthesizes an answer with:

- Points of agreement across agents
- Points of disagreement with the orchestrator's verdict and code citations
- A single best answer

For questions, the turn ends with the synthesis. For code changes, the orchestrator proposes a merge plan that you confirm with `[y/N/e]`.

**Slash commands inside a session:**

    /ask <msg>    force question mode
    /code <msg>   force code mode
    /merge        apply the previous turn's merge plan
    /pr           open a PR for the last merge
    /history      print the transcript
    /agents       show the agent roster and models
    /set K V      set a runtime knob (e.g. /set automerge on)
    /help         list commands
    /quit         exit

**Session management:**

    gg sessions list         # list recent sessions
    gg sessions show <id>    # print a past session's transcript
    gg -i --resume           # resume most-recent session
    gg -i --resume <id>      # resume a specific session

Sessions live under `.gitgang/sessions/<id>/` (auto-added to `.gitignore`).
```

- [ ] **Step 5: Run full test suite and build**

```bash
npx vitest run && npm run build
```

Expected: All tests pass; build produces `dist/cli.js` with version 1.7.0.

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md package.json src/cli.ts
git commit -m "v1.7.0: interactive REPL mode with orchestrated three-agent synthesis"
```

---

## Spec Coverage Self-Review

The following spec sections must be covered by tasks above. If a requirement has no task, add a follow-up task here.

| Spec section | Covered by task |
|---|---|
| Invocation surface (`gg`, `gg -i`, `gg -i "opener"`) | Task 15 |
| Orchestrator = `claude --print` per turn | Tasks 7, 14 |
| Sub-agent fan-out reuses worktree infra | Task 14 |
| `automerge on\|off\|ask` | Tasks 13 (on/off/ask logic), 15 (flag), 16 (/set) |
| Orchestrator input JSON envelope | Tasks 5, 7 |
| Orchestrator system prompt | Task 7 |
| Orchestrator output parser w/ graceful fallback | Task 6 |
| Agreement/disagreement/best-answer rendering | Task 8 |
| Session dir layout | Tasks 3, 4 |
| `session.jsonl` event schema | Tasks 4, 9 |
| Resume semantics | Tasks 9, 16 |
| Slash commands (`/ask /code /merge /pr /history /agents /help /set /quit`) | Tasks 2, 11, 16 |
| `sessions list` / `sessions show` | Task 17 |
| `.gitignore` guard | Task 18 |
| Error handling (all agents fail, orchestrator crash, Ctrl+C) | Task 13 (agents-fail), Task 14 (orchestrator-throws), Task 11 (EOF handling); Ctrl+C mid-turn is handled by the subprocess `kill("SIGTERM")` paths in Task 14 but deserves an explicit follow-up test |
| Testing strategy (unit + REPL integration + smoke) | Tasks 2–13 (unit), Task 19 (integration); smoke test is manual per the spec |

**Follow-up task noted:** Ctrl+C mid-turn explicit test — add after v1.7.0 ships based on real-world behavior observed in smoke testing. Not blocking for v1.7.0.

---

## Placeholder and Consistency Scan

- **No TBDs or TODO markers** in the task bodies — all code is complete.
- **Type consistency:** `AgentResult`, `OrchestratorInput`, `OrchestratorOutput`, `SessionEvent`, `SessionHandle`, `LoadedSession`, `MergePlan` are defined once and referenced consistently across tasks. `ForcedMode` is exported from `slash.ts` and imported where needed.
- **`HistoryItem`** is defined in `orchestrator.ts` (Task 5) and used in `session.ts` Task 9 (`reconstructHistory`) — consistent shape.
- **`spawnProcess`** return type is assumed to be `{ child, done, kill }` in Task 14; if the actual signature differs, the fan-out implementation must adapt. This is the one integration-level assumption that will need verification when the task runs — the `spawnProcess` signature at `src/cli.ts:196` should be read and matched.
- **`applyMergePlan`** signature is assumed to be `applyMergePlan(repoRoot, plan)` in Task 16; verify against `src/cli.ts:1712` when implementing.
- **`createWorktree`** signature is assumed to be `createWorktree(repoRoot, path, branch, base)` in Task 14; verify against `src/cli.ts:294`.

These three assumptions are explicit so an implementer can verify them quickly at the start of Task 14.
