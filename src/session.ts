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
