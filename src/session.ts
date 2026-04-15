import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AgentId } from "./cli";
import type { ForcedMode } from "./slash";

import type { OrchestratorOutput } from "./orchestrator";

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
  return readEventsWithErrors(logPath).events;
}

export type ReadEventsResult = {
  events: SessionEvent[];
  errors: Array<{ lineNumber: number; raw: string; reason: string }>;
};

export function readEventsWithErrors(logPath: string): ReadEventsResult {
  if (!existsSync(logPath)) return { events: [], errors: [] };
  const raw = readFileSync(logPath, "utf8");
  const events: SessionEvent[] = [];
  const errors: ReadEventsResult["errors"] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as SessionEvent);
    } catch (err) {
      errors.push({
        lineNumber: i + 1,
        raw: line,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { events, errors };
}

/**
 * Read events and, if any lines are malformed, append a diagnostic record
 * to `<debugDir>/resume-errors.log`. Returns only the successfully-parsed
 * events. Use this when loading a session for resume.
 */
export function readEventsLogged(logPath: string, debugDir: string): SessionEvent[] {
  const { events, errors } = readEventsWithErrors(logPath);
  if (errors.length === 0) return events;
  try {
    if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true });
    const ts = new Date().toISOString();
    const header = `[${ts}] ${errors.length} malformed line(s) in ${logPath}\n`;
    const body = errors
      .map((e) => `  line ${e.lineNumber}: ${e.reason}\n    raw: ${e.raw}\n`)
      .join("");
    appendFileSync(join(debugDir, "resume-errors.log"), header + body + "\n");
  } catch {
    // best-effort; if we can't write the log, the event list is still valid
  }
  return events;
}

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
  const debugDir = join(dir, "debug");
  return {
    id: metadata.id,
    dir,
    logPath,
    debugDir,
    worktreesDir: join(dir, "worktrees"),
    metadata,
    events: readEventsLogged(logPath, debugDir),
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

/**
 * Find the most recent orchestrator event that proposed a merge plan but
 * has no corresponding `merge` event with outcome "merged" yet. Used by
 * the /merge slash command to apply a previously-declined plan.
 */
export function findPendingMergePlan(
  events: SessionEvent[],
): { turn: number; plan: NonNullable<OrchestratorOutput["mergePlan"]> } | null {
  const mergedTurns = new Set(
    events.filter((e) => e.type === "merge" && e.outcome === "merged").map((e) => e.turn),
  );
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "orchestrator") continue;
    const plan = e.payload.mergePlan;
    if (!plan) continue;
    if (mergedTurns.has(e.turn)) continue;
    return { turn: e.turn, plan };
  }
  return null;
}

/**
 * Find the most recent successfully-merged branch from the session log.
 * Used by /pr to know which branch to open a PR for.
 */
export function findLastMergedBranch(events: SessionEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "merge" && e.outcome === "merged" && e.branch) return e.branch;
  }
  return null;
}

/**
 * Find the most recent branch associated with a given agent for any turn.
 * Used by /diff <agent> to inspect what an agent produced, even if its plan
 * wasn't picked. Returns null if the agent never ran or never got a branch.
 */
export function findLastAgentBranch(
  events: SessionEvent[],
  agent: AgentId,
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "agent_start" && e.agent === agent && e.branch) return e.branch;
  }
  // Fall back: agent_end events don't carry branch names, but orchestrator
  // payloads may reference them.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "orchestrator") {
      const plan = e.payload.mergePlan;
      if (plan) {
        for (const branch of plan.branches) {
          if (branch.includes(`/${agent}/`)) return branch;
        }
      }
    }
  }
  return null;
}

/**
 * Find the reviewer-picked branch from the most recent orchestrator event
 * that proposed a merge plan. Used by bare /diff (no agent argument).
 * Returns null if no merge plan has been proposed yet.
 */
export function findLastPickedBranch(events: SessionEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "orchestrator") continue;
    const plan = e.payload.mergePlan;
    if (plan && plan.branches.length > 0) return plan.branches[0];
  }
  return null;
}
