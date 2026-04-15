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
