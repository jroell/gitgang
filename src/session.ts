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
    }
  | { ts: string; turn: number; type: "clear" };

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
  // /clear appends a "clear" event; reconstructHistory honors only the events
  // that arrive strictly AFTER the most recent clear. Prior turns remain on
  // disk (visible in `sessions show` / `sessions export`) but don't feed the
  // next turn's context.
  const scoped = eventsAfterLastClear(events);
  const byTurn = new Map<number, { user?: string; assistant?: string }>();
  for (const e of scoped) {
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
 * Return events strictly after the most recent "clear" event in the log.
 * Pure function. If no clear event exists, returns the full array.
 */
export function eventsAfterLastClear(events: SessionEvent[]): SessionEvent[] {
  let lastClearIndex = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "clear") {
      lastClearIndex = i;
      break;
    }
  }
  return lastClearIndex === -1 ? events : events.slice(lastClearIndex + 1);
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

/**
 * Build a structured markdown PR body from the session log. Surfaces the
 * user's actual question, the orchestrator's synthesis, and the merge
 * rationale — far richer than the generic "git log" body that
 * `gh pr create --fill` would produce.
 *
 * Returns { title, body }. Title is the first user message of the session,
 * truncated to 72 chars. Body is multi-section markdown.
 *
 * Pure function — no I/O.
 */
export function formatPrContent(
  events: SessionEvent[],
  options: { mergedBranch: string; sessionId: string; gitgangVersion: string },
): { title: string; body: string } {
  const userMsgs = events.filter((e): e is Extract<SessionEvent, { type: "user" }> => e.type === "user");
  const orchestratorEvents = events.filter(
    (e): e is Extract<SessionEvent, { type: "orchestrator" }> => e.type === "orchestrator",
  );

  const firstUser = userMsgs[0]?.text ?? "gitgang interactive session";
  const title = firstUser.length > 72 ? firstUser.slice(0, 69) + "..." : firstUser;

  const lastOrch = orchestratorEvents[orchestratorEvents.length - 1];
  const summary = lastOrch?.payload.bestAnswer ?? "(no synthesis available)";
  const lastPlan = lastOrch?.payload.mergePlan;

  const sections: string[] = [];
  sections.push("## Summary");
  sections.push("");
  sections.push(summary);
  sections.push("");

  if (lastPlan) {
    sections.push("## Merge plan");
    sections.push("");
    sections.push(`Picked: \`${lastPlan.pick}\``);
    sections.push("");
    sections.push(`Branches merged: ${lastPlan.branches.map((b) => `\`${b}\``).join(", ")}`);
    sections.push("");
    if (lastPlan.rationale) {
      sections.push(`Rationale: ${lastPlan.rationale}`);
      sections.push("");
    }
    if (lastPlan.followups.length > 0) {
      sections.push("Follow-ups:");
      for (const f of lastPlan.followups) sections.push(`- ${f}`);
      sections.push("");
    }
  }

  const lastDisagreement =
    lastOrch?.payload.disagreement && lastOrch.payload.disagreement.length > 0
      ? lastOrch.payload.disagreement
      : null;
  if (lastDisagreement) {
    sections.push("## Where the agents disagreed");
    sections.push("");
    for (const d of lastDisagreement) {
      sections.push(`### ${d.topic}`);
      sections.push("");
      for (const [agent, position] of Object.entries(d.positions)) {
        sections.push(`- **${agent}**: ${position}`);
      }
      sections.push("");
      sections.push(`**Verdict:** ${d.verdict}`);
      if (d.evidence.length > 0) {
        sections.push("");
        sections.push(`Evidence: ${d.evidence.map((e) => `\`${e}\``).join(", ")}`);
      }
      sections.push("");
    }
  }

  if (userMsgs.length > 1) {
    sections.push("## Conversation");
    sections.push("");
    const recent = userMsgs.slice(-5);
    for (const msg of recent) {
      const oneliner =
        msg.text.length > 200 ? msg.text.slice(0, 197) + "..." : msg.text;
      sections.push(`- Turn ${msg.turn}: ${oneliner}`);
    }
    sections.push("");
  }

  sections.push("---");
  sections.push("");
  sections.push(
    `🤘 Generated by [gitgang](https://github.com/jasonroell/gitgang) v${options.gitgangVersion} interactive session \`${options.sessionId}\` from branch \`${options.mergedBranch}\`.`,
  );
  sections.push("");

  return { title, body: sections.join("\n") };
}

/**
 * Render a full session as portable markdown — meant for sharing,
 * pasting into tickets, or attaching to PRs/incident reports.
 *
 * Sections:
 *   # Session <id>
 *   metadata table (started, models, reviewer, automerge)
 *   ## Turn 1 — <first line of user message>
 *     ### You asked
 *     <user message>
 *     ### Agents
 *     status table per agent (with diff-stat if non-empty)
 *     ### Synthesis
 *     <bestAnswer; preserves original markdown>
 *     #### Agreement (if any)
 *     #### Disagreement (if any)
 *     ### Outcome
 *     merged|declined|pr_only branch (or none)
 *   ## Turn 2 — ...
 *
 * Pure function — no I/O, no rendering to ANSI. Output is plain markdown.
 */
export function formatSessionExport(
  events: SessionEvent[],
  metadata: SessionMetadata,
): string {
  const lines: string[] = [];

  lines.push(`# gitgang session \`${metadata.id}\``);
  lines.push("");
  lines.push("| field | value |");
  lines.push("|---|---|");
  lines.push(`| started_at | \`${metadata.startedAt}\` |`);
  lines.push(`| reviewer | \`${metadata.reviewer}\` |`);
  lines.push(`| automerge | \`${metadata.automerge}\` |`);
  for (const [agent, model] of Object.entries(metadata.models)) {
    lines.push(`| ${agent} model | \`${model}\` |`);
  }
  lines.push("");

  // Group events by turn
  const turns = new Map<number, SessionEvent[]>();
  for (const e of events) {
    const arr = turns.get(e.turn);
    if (arr) arr.push(e);
    else turns.set(e.turn, [e]);
  }

  const sortedTurns = [...turns.entries()].sort((a, b) => a[0] - b[0]);
  for (const [turn, turnEvents] of sortedTurns) {
    const userEvent = turnEvents.find(
      (e): e is Extract<SessionEvent, { type: "user" }> => e.type === "user",
    );
    const agentEvents = turnEvents.filter(
      (e): e is Extract<SessionEvent, { type: "agent_end" }> => e.type === "agent_end",
    );
    const orchEvent = turnEvents.find(
      (e): e is Extract<SessionEvent, { type: "orchestrator" }> => e.type === "orchestrator",
    );
    const mergeEvents = turnEvents.filter(
      (e): e is Extract<SessionEvent, { type: "merge" }> => e.type === "merge",
    );

    const headline = userEvent
      ? userEvent.text.split("\n")[0].slice(0, 80)
      : "(no user message)";
    lines.push(`## Turn ${turn} — ${headline}`);
    lines.push("");

    if (userEvent) {
      lines.push("### You asked");
      lines.push("");
      if (userEvent.forcedMode) {
        lines.push(`*(forced mode: \`${userEvent.forcedMode}\`)*`);
        lines.push("");
      }
      lines.push(userEvent.text);
      lines.push("");
    }

    if (agentEvents.length > 0) {
      lines.push("### Agents");
      lines.push("");
      lines.push("| agent | status | diff |");
      lines.push("|---|---|---|");
      for (const a of agentEvents) {
        const diffCell = a.diffSummary
          ? `\`${a.diffSummary.split("\n")[0].trim()}\``
          : "—";
        lines.push(`| \`${a.agent}\` | ${a.status} | ${diffCell} |`);
      }
      lines.push("");
    }

    if (orchEvent) {
      lines.push("### Synthesis");
      lines.push("");
      lines.push(orchEvent.payload.bestAnswer);
      lines.push("");

      if (orchEvent.payload.agreement.length > 0) {
        lines.push("#### Agreement");
        lines.push("");
        for (const a of orchEvent.payload.agreement) lines.push(`- ${a}`);
        lines.push("");
      }

      if (orchEvent.payload.disagreement.length > 0) {
        lines.push("#### Disagreement");
        lines.push("");
        for (const d of orchEvent.payload.disagreement) {
          lines.push(`**${d.topic}**`);
          for (const [agent, position] of Object.entries(d.positions)) {
            lines.push(`- \`${agent}\`: ${position}`);
          }
          lines.push(`> Verdict: ${d.verdict}`);
          if (d.evidence.length > 0) {
            lines.push(`> Evidence: ${d.evidence.map((e) => `\`${e}\``).join(", ")}`);
          }
          lines.push("");
        }
      }

      if (orchEvent.payload.mergePlan) {
        const plan = orchEvent.payload.mergePlan;
        lines.push(`#### Merge plan: \`${plan.pick}\``);
        lines.push("");
        lines.push(`Branches: ${plan.branches.map((b) => `\`${b}\``).join(", ")}`);
        if (plan.rationale) {
          lines.push("");
          lines.push(`Rationale: ${plan.rationale}`);
        }
        lines.push("");
      }
    }

    if (mergeEvents.length > 0) {
      lines.push("### Outcome");
      lines.push("");
      for (const m of mergeEvents) {
        lines.push(`- \`${m.outcome}\`: \`${m.branch || "(unspecified)"}\``);
      }
      lines.push("");
    }
  }

  if (sortedTurns.length === 0) {
    lines.push("_(empty session — no turns yet)_");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Find the most recent user-typed message in the session log. Used by
 * /redo to re-execute the prior turn with the same prompt and forced mode.
 * Returns null when no user message has been logged yet.
 */
export function findLastUserMessage(
  events: SessionEvent[],
): { text: string; forcedMode: ForcedMode; turn: number } | null {
  // /redo respects /clear: a user message before the most recent clear is no
  // longer "the last" for redo purposes. If you cleared, there's no prior
  // turn to redo.
  const scoped = eventsAfterLastClear(events);
  for (let i = scoped.length - 1; i >= 0; i--) {
    const e = scoped[i];
    if (e.type === "user") {
      return { text: e.text, forcedMode: e.forcedMode, turn: e.turn };
    }
  }
  return null;
}

/**
 * Parse a human duration string (Nd / Nh / Nm / Ns) into milliseconds.
 * Returns null on invalid input. Pure function.
 */
export function parseDurationMs(input: string): number | null {
  const match = input.trim().match(/^(\d+)\s*([smhd])$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  switch (match[2]) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60_000;
    case "h":
      return value * 3_600_000;
    case "d":
      return value * 86_400_000;
    default:
      return null;
  }
}

/**
 * Pick the session ids whose startedAt is older than `nowMs - olderThanMs`.
 * Returns ids in startedAt-ascending order (oldest first) so prune output is
 * stable and useful. Sessions with unparseable startedAt are skipped silently.
 *
 * Pure function — does not touch disk.
 */
export function selectSessionsToPrune(
  sessions: Array<{ id: string; startedAt: string }>,
  olderThanMs: number,
  nowMs: number,
): string[] {
  const cutoff = nowMs - olderThanMs;
  const matches: Array<{ id: string; t: number }> = [];
  for (const s of sessions) {
    const t = Date.parse(s.startedAt);
    if (!Number.isFinite(t)) continue;
    if (t < cutoff) matches.push({ id: s.id, t });
  }
  matches.sort((a, b) => a.t - b.t);
  return matches.map((m) => m.id);
}

export type SearchHit = {
  turn: number;
  /** Where the match was found. */
  source: "user" | "assistant";
  /** Snippet centered on the match, truncated to ~120 chars. */
  snippet: string;
};

/**
 * Find case-insensitive substring matches of `query` in user messages and
 * orchestrator best answers. Returns at most `maxHits` hits per session.
 *
 * Pure function — no I/O.
 */
export function searchSessionEvents(
  events: SessionEvent[],
  query: string,
  maxHits = 5,
): SearchHit[] {
  if (query.length === 0) return [];
  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];
  for (const e of events) {
    if (hits.length >= maxHits) break;
    if (e.type === "user") {
      const idx = e.text.toLowerCase().indexOf(needle);
      if (idx !== -1) {
        hits.push({ turn: e.turn, source: "user", snippet: makeSnippet(e.text, idx, query.length) });
      }
    } else if (e.type === "orchestrator") {
      const text = e.payload.bestAnswer;
      const idx = text.toLowerCase().indexOf(needle);
      if (idx !== -1) {
        hits.push({
          turn: e.turn,
          source: "assistant",
          snippet: makeSnippet(text, idx, query.length),
        });
      }
    }
  }
  return hits;
}

const SNIPPET_RADIUS = 50;

function makeSnippet(text: string, idx: number, matchLen: number): string {
  // Replace newlines/tabs in the snippet so it stays one line.
  const flat = text.replace(/\s+/g, " ");
  // Recompute idx because flat may have shifted; fall back to substring search
  const flatLower = flat.toLowerCase();
  const matchIdx =
    flatLower.indexOf(text.slice(idx, idx + matchLen).replace(/\s+/g, " ").toLowerCase());
  const useIdx = matchIdx >= 0 ? matchIdx : 0;
  const start = Math.max(0, useIdx - SNIPPET_RADIUS);
  const end = Math.min(flat.length, useIdx + matchLen + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < flat.length ? "…" : "";
  return prefix + flat.slice(start, end).trim() + suffix;
}

export type SessionStats = {
  turns: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
  /** Wall-clock duration in ms; null if < 2 events. */
  durationMs: number | null;
  agentRuns: Record<AgentId, { ok: number; failed: number; timeout: number }>;
  merges: { merged: number; declined: number; pr_only: number };
  totalAgreements: number;
  totalDisagreements: number;
  forcedAsk: number;
  forcedCode: number;
  clears: number;
};

/**
 * Aggregate a SessionEvent list into a SessionStats summary. Pure function;
 * does not read any files. Results are stable regardless of input event
 * ordering within a turn — counts are driven by event type, not position.
 */
export function computeSessionStats(events: SessionEvent[]): SessionStats {
  const agentRuns: SessionStats["agentRuns"] = {
    gemini: { ok: 0, failed: 0, timeout: 0 },
    claude: { ok: 0, failed: 0, timeout: 0 },
    codex: { ok: 0, failed: 0, timeout: 0 },
  };
  const merges: SessionStats["merges"] = { merged: 0, declined: 0, pr_only: 0 };
  const turns = new Set<number>();
  let firstEventAt: string | null = null;
  let lastEventAt: string | null = null;
  let totalAgreements = 0;
  let totalDisagreements = 0;
  let forcedAsk = 0;
  let forcedCode = 0;
  let clears = 0;

  for (const e of events) {
    if (e.type === "user") {
      turns.add(e.turn);
      if (e.forcedMode === "ask") forcedAsk++;
      if (e.forcedMode === "code") forcedCode++;
    } else if (e.type === "agent_end") {
      agentRuns[e.agent][e.status]++;
    } else if (e.type === "orchestrator") {
      totalAgreements += e.payload.agreement.length;
      totalDisagreements += e.payload.disagreement.length;
    } else if (e.type === "merge") {
      merges[e.outcome]++;
    } else if (e.type === "clear") {
      clears++;
    }
    if (firstEventAt === null) firstEventAt = e.ts;
    lastEventAt = e.ts;
  }

  const firstMs = firstEventAt ? Date.parse(firstEventAt) : NaN;
  const lastMs = lastEventAt ? Date.parse(lastEventAt) : NaN;
  const durationMs =
    Number.isFinite(firstMs) && Number.isFinite(lastMs) && lastMs > firstMs
      ? lastMs - firstMs
      : null;

  return {
    turns: turns.size,
    firstEventAt,
    lastEventAt,
    durationMs,
    agentRuns,
    merges,
    totalAgreements,
    totalDisagreements,
    forcedAsk,
    forcedCode,
    clears,
  };
}

/**
 * Format a SessionStats summary as a human-readable block. Pure function.
 */
export function formatSessionStats(stats: SessionStats, id?: string): string {
  const lines: string[] = [];
  lines.push(`Session stats${id ? ` — ${id}` : ""}`);
  lines.push("");
  lines.push(`  Turns:         ${stats.turns}`);
  const dur = stats.durationMs
    ? humanizeMs(stats.durationMs)
    : stats.firstEventAt
      ? "(< 1 event)"
      : "—";
  lines.push(`  Duration:      ${dur}`);
  if (stats.firstEventAt) lines.push(`  First event:   ${stats.firstEventAt}`);
  if (stats.lastEventAt && stats.lastEventAt !== stats.firstEventAt) {
    lines.push(`  Last event:    ${stats.lastEventAt}`);
  }
  lines.push("");
  lines.push("  Agents:");
  for (const agent of ["gemini", "claude", "codex"] as const) {
    const r = stats.agentRuns[agent];
    const total = r.ok + r.failed + r.timeout;
    if (total === 0) {
      lines.push(`    ${agent.padEnd(8)} —`);
    } else {
      const parts: string[] = [];
      if (r.ok > 0) parts.push(`${r.ok} ok`);
      if (r.failed > 0) parts.push(`${r.failed} failed`);
      if (r.timeout > 0) parts.push(`${r.timeout} timeout`);
      lines.push(`    ${agent.padEnd(8)} ${total} run${total === 1 ? "" : "s"} (${parts.join(", ")})`);
    }
  }
  lines.push("");
  const mergeTotal = stats.merges.merged + stats.merges.declined + stats.merges.pr_only;
  if (mergeTotal > 0) {
    const parts: string[] = [];
    if (stats.merges.merged > 0) parts.push(`${stats.merges.merged} merged`);
    if (stats.merges.declined > 0) parts.push(`${stats.merges.declined} declined`);
    if (stats.merges.pr_only > 0) parts.push(`${stats.merges.pr_only} PR-only`);
    lines.push(`  Merges:        ${mergeTotal} (${parts.join(", ")})`);
  } else {
    lines.push(`  Merges:        —`);
  }
  lines.push(`  Agreements:    ${stats.totalAgreements} claim${stats.totalAgreements === 1 ? "" : "s"} across turns`);
  lines.push(`  Disagreements: ${stats.totalDisagreements} topic${stats.totalDisagreements === 1 ? "" : "s"} across turns`);
  if (stats.forcedAsk + stats.forcedCode > 0) {
    lines.push(
      `  Forced modes:  ${stats.forcedAsk} /ask, ${stats.forcedCode} /code`,
    );
  }
  if (stats.clears > 0) {
    lines.push(`  Clears:        ${stats.clears}`);
  }
  return lines.join("\n") + "\n";
}

function humanizeMs(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}
