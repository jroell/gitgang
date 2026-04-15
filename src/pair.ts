import { spawn, type ChildProcess } from "node:child_process";
import {
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";

const C = chalk;

// ─── Types ────────────────────────────────────────────────

export type PairAgentId = "claude" | "codex";

export interface PairOpts {
  coder: PairAgentId;
  reviewer: PairAgentId;
  task: string;
  repoRoot: string;
  baseBranch: string;
  yolo: boolean;
  timeoutMs: number;
  reviewIntervalMs: number;
  maxInterventions: number;
  maxReviewOutputLines: number;
}

type ReviewVerdict =
  | { action: "continue" }
  | { action: "pause"; concern: string; suggestion: string }
  | { action: "complete"; summary: string };

interface ConversationTurn {
  role: "reviewer" | "coder";
  message: string;
}

interface Intervention {
  timestamp: string;
  round: number;
  transcript: ConversationTurn[];
  agreed: boolean;
  direction: string;
}

export interface PairSummary {
  task: string;
  coder: PairAgentId;
  reviewer: PairAgentId;
  whatAttempted: string;
  whatChanged: string[];
  majorDecisions: string[];
  disagreements: { topic: string; resolution: string }[];
  assumptions: string[];
  followUpItems: string[];
  interventionCount: number;
  roundCount: number;
  durationMs: number;
  finalVerdict: string;
}

type CoderRoundResult =
  | { outcome: "natural"; exitCode: number }
  | { outcome: "needs_restart"; direction: string; sessionId: string | null }
  | { outcome: "aborted" }
  | { outcome: "timeout" };

const MAX_CONVERSATION_TURNS = 6;

// ─── Agent Backend Interface ──────────────────────────────

interface AgentBackend {
  id: PairAgentId;
  buildCoderCommand(opts: {
    prompt: string;
    cwd: string;
    yolo: boolean;
  }): { command: string; args: string[] };
  buildResumeCommand(opts: {
    sessionId: string;
    message: string;
    cwd: string;
    yolo: boolean;
    maxTurns?: number;
  }): { command: string; args: string[] } | null;
  buildReviewerCommand(opts: {
    prompt: string;
    cwd: string;
    yolo: boolean;
  }): { command: string; args: string[] };
  formatOutputLine(rawLine: string): string | null;
  extractSessionId(rawLine: string): string | null;
}

// ─── Backend Implementations ──────────────────────────────

const DEFAULT_PAIR_MODELS: Record<PairAgentId, string> = {
  claude: process.env.GITGANG_CLAUDE_MODEL || "claude-opus-4-6",
  codex: process.env.GITGANG_CODEX_MODEL || "gpt-5.4",
};

function createClaudeBackend(): AgentBackend {
  return {
    id: "claude",
    buildCoderCommand({ prompt, cwd, yolo }) {
      const promptFile = join(cwd, ".pair-coder-prompt.txt");
      writeFileSync(promptFile, prompt);
      const args = [
        "--print",
        "--model", DEFAULT_PAIR_MODELS.claude,
        "--output-format", "stream-json",
        "--verbose",
      ];
      if (yolo) args.push("--dangerously-skip-permissions");
      const maxTurns = process.env.GITGANG_MAX_TURNS;
      if (maxTurns) args.push("--max-turns", maxTurns);
      return { command: "bash", args: ["-c", `cat "${promptFile}" | claude ${args.join(" ")}`] };
    },
    buildResumeCommand({ sessionId, message, cwd, yolo, maxTurns }) {
      const promptFile = join(cwd, ".pair-resume-prompt.txt");
      writeFileSync(promptFile, message);
      const args = [
        "--resume", sessionId,
        "--print",
        "--model", DEFAULT_PAIR_MODELS.claude,
        "--output-format", "stream-json",
        "--verbose",
      ];
      if (yolo) args.push("--dangerously-skip-permissions");
      if (maxTurns) args.push("--max-turns", String(maxTurns));
      return { command: "bash", args: ["-c", `cat "${promptFile}" | claude ${args.join(" ")}`] };
    },
    buildReviewerCommand({ prompt, cwd, yolo }) {
      const promptFile = join(cwd, ".pair-reviewer-prompt.txt");
      writeFileSync(promptFile, prompt);
      const args = [
        "--print",
        "--model", DEFAULT_PAIR_MODELS.claude,
        "--output-format", "stream-json",
        "--verbose",
        "--max-turns", "10",
      ];
      if (yolo) args.push("--dangerously-skip-permissions");
      return { command: "bash", args: ["-c", `cat "${promptFile}" | claude ${args.join(" ")}`] };
    },
    formatOutputLine(rawLine: string): string | null {
      try {
        const msg = JSON.parse(rawLine);
        return formatStreamMessage(msg);
      } catch {
        const trimmed = rawLine.trim();
        if (!trimmed) return null;
        if (trimmed.includes("session id:") || trimmed.includes("provider:") || trimmed.includes("approval:")) return null;
        return trimmed;
      }
    },
    extractSessionId(rawLine: string): string | null {
      try {
        const msg = JSON.parse(rawLine);
        if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
          return msg.session_id as string;
        }
      } catch { /* not JSON */ }
      return null;
    },
  };
}

function createCodexBackend(): AgentBackend {
  return {
    id: "codex",
    buildCoderCommand({ prompt, yolo }) {
      const args = [
        "exec", prompt,
        "--model", DEFAULT_PAIR_MODELS.codex,
        "--config", 'model_reasoning_effort="xhigh"',
      ];
      args.push(yolo ? "--yolo" : "--full-auto");
      return { command: "codex", args };
    },
    buildResumeCommand() {
      return null;
    },
    buildReviewerCommand({ prompt, yolo }) {
      const args = [
        "exec", prompt,
        "--model", DEFAULT_PAIR_MODELS.codex,
        "--config", 'model_reasoning_effort="xhigh"',
      ];
      args.push(yolo ? "--yolo" : "--full-auto");
      return { command: "codex", args };
    },
    formatOutputLine(rawLine: string): string | null {
      const trimmed = rawLine.trim();
      return trimmed || null;
    },
    extractSessionId(): string | null {
      return null;
    },
  };
}

function getBackend(id: PairAgentId): AgentBackend {
  switch (id) {
    case "claude": return createClaudeBackend();
    case "codex": return createCodexBackend();
  }
}

// ─── Premium TUI Formatting ───────────────────────────────
//
// Visual hierarchy:
//   System      → dim, inline
//   Thinking    → dim italic, │ left border in gray
//   Text        → clean white, breathing room
//   Read        → cyan header bar + dim content
//   Edit        → orange header bar + red/green diff
//   Write       → green header bar + dim preview
//   Bash        → yellow header bar + dim output
//   Grep/Glob   → cyan header bar
//   Insight     → purple rounded box
//   Error       → red

const PW = 78;
const RESULT_MAX_LINES = 50;
const DIFF_MAX_LINES = 30;
const WRITE_MAX_LINES = 25;

const COLORS = {
  read:    C.hex("#8be9fd"),
  edit:    C.hex("#ffb86c"),
  write:   C.hex("#50fa7b"),
  bash:    C.hex("#f1fa8c"),
  search:  C.hex("#8be9fd"),
  insight: C.hex("#bd93f9"),
  think:   C.hex("#6272a4"),
  text:    C.hex("#f8f8f2"),
  dim:     C.hex("#6272a4"),
  err:     C.hex("#ff5555"),
  tool:    C.hex("#bd93f9"),
};

function toolBar(icon: string, label: string, detail: string, color: typeof C.cyan): string {
  const inner = `${icon} ${label}${detail ? `  ${detail}` : ""}`;
  const padLen = Math.max(3, PW - inner.length - 4);
  return "\n" + color(`  ── ${inner} ${"─".repeat(padLen)}`) + "\n";
}

function bordered(lines: string[], color: typeof C.dim, maxLines: number): string {
  const show = lines.slice(0, maxLines);
  const result = show.map(l => color("  │ ") + C.hex("#f8f8f2")(l)).join("\n");
  if (lines.length > maxLines) {
    return result + "\n" + color(`  │ … ${lines.length - maxLines} more lines`);
  }
  return result;
}

function borderedDim(lines: string[], maxLines: number): string {
  const show = lines.slice(0, maxLines);
  const result = show.map(l => COLORS.dim(`  │ ${l}`)).join("\n");
  if (lines.length > maxLines) {
    return result + "\n" + COLORS.dim(`  │ … ${lines.length - maxLines} more lines`);
  }
  return result;
}

function insightBox(contentLines: string[]): string {
  const color = COLORS.insight;
  const w = PW - 4;
  const lines: string[] = [];
  lines.push("");
  lines.push(color(`  ╭── ★ Insight ${"─".repeat(w - 14)}╮`));
  lines.push(color(`  │${" ".repeat(w)}│`));
  for (const l of contentLines) {
    const trimmed = l.trim();
    if (!trimmed) continue;
    const padded = trimmed.length < w - 2
      ? trimmed + " ".repeat(w - 2 - trimmed.length)
      : trimmed.slice(0, w - 2);
    lines.push(color("  │ ") + padded + color(" │"));
  }
  lines.push(color(`  │${" ".repeat(w)}│`));
  lines.push(color(`  ╰${"─".repeat(w)}╯`));
  lines.push("");
  return lines.join("\n");
}

function formatToolUse(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read": {
      const path = input.file_path || input.path || "";
      return toolBar("📖", "Read", String(path), COLORS.read);
    }
    case "Edit": {
      const path = input.file_path || "";
      const lines: string[] = [toolBar("✏️ ", "Edit", String(path), COLORS.edit)];
      if (input.old_string) {
        const old = String(input.old_string).split("\n").slice(0, DIFF_MAX_LINES);
        for (const l of old) lines.push(C.red(`  │ - ${l}`));
        const total = String(input.old_string).split("\n").length;
        if (total > DIFF_MAX_LINES) lines.push(C.red.dim(`  │ … ${total - DIFF_MAX_LINES} more lines removed`));
      }
      if (input.new_string) {
        const nw = String(input.new_string).split("\n").slice(0, DIFF_MAX_LINES);
        for (const l of nw) lines.push(C.green(`  │ + ${l}`));
        const total = String(input.new_string).split("\n").length;
        if (total > DIFF_MAX_LINES) lines.push(C.green.dim(`  │ … ${total - DIFF_MAX_LINES} more lines added`));
      }
      return lines.join("\n");
    }
    case "Write": {
      const path = input.file_path || "";
      const lines: string[] = [toolBar("📝", "Write", String(path), COLORS.write)];
      if (input.content) {
        const cl = String(input.content).split("\n");
        lines.push(borderedDim(cl, WRITE_MAX_LINES));
      }
      return lines.join("\n");
    }
    case "Bash": {
      const cmd = input.command || input.description || "";
      return toolBar("$", "Bash", String(cmd), COLORS.bash);
    }
    case "Glob": {
      const pattern = input.pattern || "";
      const path = input.path || "";
      return toolBar("🔍", "Glob", `${pattern}${path ? ` in ${path}` : ""}`, COLORS.search);
    }
    case "Grep": {
      const pattern = input.pattern || "";
      const path = input.path || "";
      return toolBar("🔍", "Grep", `${pattern}${path ? ` in ${path}` : ""}`, COLORS.search);
    }
    case "Agent": {
      const desc = input.description || input.prompt || "";
      return toolBar("🤖", "Agent", String(desc).slice(0, 60), COLORS.tool);
    }
    default: {
      const desc = input.description || input.file_path || "";
      return toolBar("🔧", name, String(desc).slice(0, 60), COLORS.tool);
    }
  }
}

function formatToolResult(content: string): string {
  const lines = content.split("\n");
  return borderedDim(lines, RESULT_MAX_LINES);
}

function formatAssistantText(text: string): string {
  if (text.includes("★ Insight")) {
    return formatInsightText(text);
  }
  return `\n  ${COLORS.text(text)}\n`;
}

function formatInsightText(text: string): string {
  const clean = text.replace(/`/g, "");
  const lines = clean.split("\n");

  const startIdx = lines.findIndex(l => l.includes("★ Insight") || l.includes("★"));
  if (startIdx === -1) return `\n  ${text}\n`;

  const endIdx = lines.findIndex((l, i) => i > startIdx && /^─{5,}$/.test(l.trim()));

  const before = lines.slice(0, startIdx).filter(l => l.trim());
  const content = lines.slice(startIdx + 1, endIdx >= 0 ? endIdx : undefined);
  const after = endIdx >= 0 ? lines.slice(endIdx + 1).filter(l => l.trim()) : [];

  const result: string[] = [];
  for (const l of before) result.push(`\n  ${COLORS.text(l)}`);
  result.push(insightBox(content));
  for (const l of after) result.push(`  ${COLORS.text(l)}\n`);

  return result.join("\n");
}

function formatStreamMessage(msg: Record<string, unknown>): string | null {
  if (!msg || !msg.type) return null;

  switch (msg.type) {
    case "thinking": {
      if (!msg.content) break;
      const lines = String(msg.content).split("\n");
      return lines.map(l => COLORS.think.italic(`  │ 💭 ${l}`)).join("\n");
    }

    case "tool_use": {
      const name = (msg.tool_name || msg.name || "unknown") as string;
      const input = (msg.input || msg.parameters || {}) as Record<string, unknown>;
      return formatToolUse(name, input);
    }

    case "tool_result": {
      if (msg.content == null) break;
      const content = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? (msg.content as Array<{ text?: string }>).map(b => b.text || "").join("\n")
          : JSON.stringify(msg.content, null, 2);
      if (!content.trim()) break;
      return formatToolResult(content);
    }

    case "assistant": {
      const message = msg.message as { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> } | undefined;
      if (message?.content) {
        const parts: string[] = [];
        for (const block of message.content) {
          if (block.type === "text" && block.text) parts.push(formatAssistantText(block.text));
          if (block.type === "tool_use" && block.name) {
            parts.push(formatToolUse(block.name, (block.input || {}) as Record<string, unknown>));
          }
        }
        if (parts.length > 0) return parts.join("\n");
      }
      if (typeof msg.content === "string") return formatAssistantText(msg.content);
      break;
    }

    case "exec":
      if (msg.command) return toolBar("$", "Exec", String(msg.command), COLORS.bash);
      break;

    case "system":
      if (msg.subtype === "init") return COLORS.dim(`\n  ⚙️  Initialized (${(msg.model as string) || "unknown"})\n`);
      break;
  }
  return null;
}

function extractTextFromStreamJson(raw: string): string {
  const texts: string[] = [];
  let resultText = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      if (msg.type === "result" && msg.result) resultText = msg.result;
      if (msg.type === "assistant") {
        if (msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === "text" && block.text) texts.push(block.text);
          }
        }
        if (typeof msg.content === "string") texts.push(msg.content);
      }
    } catch { /* not JSON, skip */ }
  }

  return resultText || texts.join("\n");
}

function extractPlainText(raw: string, backend: AgentBackend): string {
  if (backend.id === "claude") return extractTextFromStreamJson(raw);
  return raw.trim();
}

// ─── Reviewer Prompts ─────────────────────────────────────

const REVIEWER_SYSTEM_PROMPT = `You are an expert pair programming navigator. You are watching a coder work on a task in real-time.

Your job is to:
1. Monitor the coder's approach, reasoning, and code changes
2. Detect when the coder is heading in the wrong direction
3. Catch bad assumptions, missed constraints, or potential issues EARLY
4. Provide corrective feedback before too much work goes in the wrong direction

DO NOT modify any files. Your role is advisory only.

Be selective. Only intervene when you see a genuine problem. False positives waste time and break flow.

Focus on:
- Wrong architectural approach for the codebase
- Missing requirements from the task
- Incorrect assumptions about how the code works
- Potential bugs or edge cases being ignored
- Unnecessary complexity or over-engineering
- Security vulnerabilities

Respond with EXACTLY one verdict block:

If the coder is on track:
VERDICT: CONTINUE

If you see a problem that needs correction:
VERDICT: PAUSE
CONCERN: <what's wrong, in 1-2 sentences>
SUGGESTION: <what the coder should do differently, concretely>

If this is a final review and everything looks good:
VERDICT: COMPLETE
SUMMARY: <brief summary of what was accomplished and quality assessment>`;

const FINAL_REVIEW_ADDENDUM = `
This is a FINAL review. The coder believes the task is complete. Be thorough.

Check:
1. Was the requested task actually completed?
2. Code quality — clean, idiomatic, maintainable?
3. Edge cases — are important ones handled?
4. Assumptions — any incorrect or unstated ones?
5. Tests — were they added or updated where appropriate?
6. Cleanup — anything half-finished or needs polishing?

If everything looks good, respond:
VERDICT: COMPLETE
SUMMARY: <what was accomplished, quality assessment, any minor notes>

If more work is needed, respond:
VERDICT: PAUSE
CONCERN: <what's missing or wrong>
SUGGESTION: <specific remaining work>`;

function buildReviewPrompt(
  task: string,
  coderOutput: string,
  isFinalReview: boolean,
  interventionHistory: Intervention[],
  gitDiffOutput?: string,
): string {
  const parts: string[] = [];

  parts.push(REVIEWER_SYSTEM_PROMPT);
  if (isFinalReview) parts.push(FINAL_REVIEW_ADDENDUM);

  parts.push("", "═══ TASK ═══", task);

  if (interventionHistory.length > 0) {
    parts.push("", "═══ PRIOR DISCUSSIONS ═══");
    for (const i of interventionHistory) {
      parts.push(`[Round ${i.round}]`);
      for (const t of i.transcript) {
        parts.push(`  ${t.role.toUpperCase()}: ${t.message.slice(0, 200)}`);
      }
      parts.push(`  OUTCOME: ${i.agreed ? "Agreed" : "Max turns reached"} — ${i.direction.slice(0, 100)}`);
    }
  }

  parts.push("", "═══ CODER OUTPUT ═══", coderOutput);

  if (gitDiffOutput?.trim()) {
    parts.push("", "═══ GIT DIFF (all changes made) ═══", gitDiffOutput);
  }

  return parts.join("\n");
}

function buildConversationReviewPrompt(
  task: string,
  transcript: ConversationTurn[],
  coderLatestResponse: string,
): string {
  const parts: string[] = [];

  parts.push(
    "You are a pair programming navigator in a discussion with a coder.",
    "You raised a concern and the coder has responded.",
    "",
    "═══ TASK ═══",
    task,
    "",
    "═══ DISCUSSION SO FAR ═══",
  );

  for (const t of transcript) {
    parts.push(`${t.role.toUpperCase()}: ${t.message}`);
    parts.push("");
  }

  parts.push("CODER (latest):", coderLatestResponse, "");

  parts.push(
    "Based on the coder's response, decide:",
    "",
    "If their reasoning is sound and you're satisfied:",
    "VERDICT: CONTINUE",
    "",
    "If you still have concerns or need to push back:",
    "VERDICT: PAUSE",
    "CONCERN: <your follow-up, concretely>",
    "SUGGESTION: <what they should do instead>",
    "",
    "Be pragmatic. If the coder's approach is reasonable even if it differs from yours, let them continue. Don't nitpick.",
  );

  return parts.join("\n");
}

function parseVerdict(rawOutput: string): ReviewVerdict {
  const text = rawOutput.includes("{") ? extractTextFromStreamJson(rawOutput) || rawOutput : rawOutput;
  const lines = text.split("\n").map(l => l.trim());

  const verdictLine = lines.find(l => l.startsWith("VERDICT:"));
  if (!verdictLine) return { action: "continue" };

  const verdict = verdictLine.replace("VERDICT:", "").trim().toUpperCase();

  if (verdict === "CONTINUE") return { action: "continue" };

  if (verdict === "COMPLETE") {
    const summaryIdx = lines.findIndex(l => l.startsWith("SUMMARY:"));
    const summary = summaryIdx >= 0
      ? lines.slice(summaryIdx).join("\n").replace(/^SUMMARY:\s*/, "").trim()
      : "Work completed.";
    return { action: "complete", summary };
  }

  if (verdict === "PAUSE") {
    const concernIdx = lines.findIndex(l => l.startsWith("CONCERN:"));
    const suggestionIdx = lines.findIndex(l => l.startsWith("SUGGESTION:"));

    const concern = concernIdx >= 0
      ? lines.slice(concernIdx, suggestionIdx >= 0 ? suggestionIdx : undefined).join("\n").replace(/^CONCERN:\s*/, "").trim()
      : "Reviewer flagged an issue.";
    const suggestion = suggestionIdx >= 0
      ? lines.slice(suggestionIdx).join("\n").replace(/^SUGGESTION:\s*/, "").trim()
      : "";

    return { action: "pause", concern, suggestion };
  }

  return { action: "continue" };
}

// ─── Coder Prompt ─────────────────────────────────────────

function buildCoderPrompt(
  task: string,
  round: number,
  direction?: string,
  interventions?: Intervention[],
): string {
  const parts = [task];

  if (round > 1) {
    parts.push(
      "",
      "═══ CONTEXT ═══",
      "Previous work on this task has already been started.",
      "Check the current state of relevant files before making changes.",
    );
  }

  if (direction) {
    parts.push(
      "",
      "═══ IMPORTANT: AGREED DIRECTION FROM REVIEWER DISCUSSION ═══",
      "You discussed your approach with a code reviewer and agreed on the following direction.",
      "Incorporate this into your work:",
      "",
      direction,
    );
  }

  if (interventions && interventions.length > 1) {
    parts.push("", "═══ PRIOR DISCUSSIONS ═══");
    for (const i of interventions.slice(0, -1)) {
      parts.push(`Round ${i.round}: ${i.direction.slice(0, 150)}`);
    }
  }

  return parts.join("\n");
}

function buildCoderConversationPrompt(reviewerMessage: string): string {
  return [
    "REVIEWER CHECKPOINT — RESPOND ONLY, DO NOT MODIFY FILES",
    "",
    "A code reviewer monitoring your work has paused to discuss your approach.",
    "Respond to their message. Explain your reasoning, ask for clarification,",
    "or acknowledge their feedback. DO NOT make any file changes or run commands.",
    "",
    "Reviewer says:",
    reviewerMessage,
  ].join("\n");
}

function buildCoderResumePrompt(transcript: ConversationTurn[], direction: string): string {
  return [
    "REVIEWER DISCUSSION COMPLETE — RESUME WORK",
    "",
    "You just had a discussion with a code reviewer. Here's the summary:",
    "",
    ...transcript.map(t => `${t.role.toUpperCase()}: ${t.message}`),
    "",
    `AGREED DIRECTION: ${direction}`,
    "",
    "Continue working on the task, incorporating this feedback.",
    "You may now modify files and run commands.",
  ].join("\n");
}

// ─── Display Helpers ──────────────────────────────────────

function renderHeader(opts: PairOpts): string {
  const coderTag = C.hex("#50fa7b").bold(opts.coder.toUpperCase());
  const reviewerTag = C.hex("#ff79c6").bold(opts.reviewer.toUpperCase());
  const taskPreview = opts.task.length > 60 ? opts.task.slice(0, 57) + "..." : opts.task;
  const w = 84;
  const bar = "═".repeat(w - 2);

  return [
    "",
    C.hex("#bd93f9").bold(`╔${bar}╗`),
    C.hex("#bd93f9").bold("║") + C.hex("#f8f8f2").bold("  🤝 PAIR MODE") + " ".repeat(w - 18) + C.hex("#bd93f9").bold("║"),
    C.hex("#bd93f9").bold("║") + `  Coder: ${coderTag}  │  Reviewer: ${reviewerTag}` + " ".repeat(Math.max(1, w - 24 - opts.coder.length - opts.reviewer.length)) + C.hex("#bd93f9").bold("║"),
    C.hex("#bd93f9").bold("║") + C.dim(`  Task: ${taskPreview}`) + " ".repeat(Math.max(1, w - 10 - taskPreview.length)) + C.hex("#bd93f9").bold("║"),
    C.hex("#bd93f9").bold(`╚${bar}╝`),
    "",
  ].join("\n");
}

function renderConversation(transcript: ConversationTurn[], round: number, agreed: boolean): string {
  const w = 84;
  const bar = "═".repeat(w - 2);
  const inner = w - 6;

  const wrapLine = (text: string): string[] => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if (current.length + word.length + 1 > inner) {
        lines.push(current);
        current = word;
      } else {
        current += (current ? " " : "") + word;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  const body: string[] = [""];
  for (const turn of transcript) {
    const color = turn.role === "reviewer" ? C.hex("#ff79c6") : C.hex("#50fa7b");
    const label = turn.role === "reviewer" ? "REVIEWER" : "CODER";
    body.push(color.bold(`  ${label}:`));
    for (const line of wrapLine(turn.message)) {
      body.push(`    ${line}`);
    }
    body.push("");
  }

  const outcomeText = agreed
    ? C.hex("#50fa7b").bold("  ✓ AGREED — coder will resume with updated approach")
    : C.hex("#ffb86c").bold("  ⚠ Max discussion turns reached — continuing with latest feedback");
  body.push(outcomeText, "");

  const B = C.hex("#8be9fd");
  const pad = (s: string) => {
    const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
    return s + " ".repeat(Math.max(1, w - 4 - visible.length));
  };

  return [
    "",
    B.bold(`╔${bar}╗`),
    B.bold("║") + C.hex("#f8f8f2").bold(pad(`  💬 PAIR DISCUSSION (round ${round})`)) + B.bold("║"),
    B.bold(`╠${bar}╣`),
    ...body.map(l => B.bold("║ ") + pad(l) + B.bold("║")),
    B.bold(`╚${bar}╝`),
    "",
  ].join("\n");
}

function renderCompletionBox(summary: string): string {
  const w = 84;
  const bar = "═".repeat(w - 2);
  const inner = w - 4;
  const pad = (s: string) => {
    const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
    return s + " ".repeat(Math.max(1, inner - visible.length));
  };

  const words = summary.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > inner) {
      lines.push(current);
      current = word;
    } else {
      current += (current ? " " : "") + word;
    }
  }
  if (current) lines.push(current);

  const G = C.hex("#50fa7b");
  return [
    "",
    G.bold(`╔${bar}╗`),
    G.bold("║") + C.hex("#f8f8f2").bold(pad("  ✅ PAIR SESSION COMPLETE")) + G.bold("║"),
    G.bold(`╠${bar}╣`),
    ...lines.map(l => G.bold("║") + pad(`  ${l}`) + G.bold("║")),
    G.bold(`╚${bar}╝`),
    "",
  ].join("\n");
}

function renderSummary(summary: PairSummary): string {
  const bar = "═".repeat(82);
  const dur = formatDuration(summary.durationMs);

  const lines = [
    "",
    C.hex("#bd93f9").bold(bar),
    C.hex("#bd93f9").bold("  SESSION SUMMARY"),
    C.hex("#bd93f9").bold(bar),
    "",
    `  ${C.dim("Task:")}           ${summary.task.slice(0, 70)}`,
    `  ${C.dim("Coder:")}          ${summary.coder} (${DEFAULT_PAIR_MODELS[summary.coder]})`,
    `  ${C.dim("Reviewer:")}       ${summary.reviewer} (${DEFAULT_PAIR_MODELS[summary.reviewer]})`,
    `  ${C.dim("Duration:")}       ${dur}`,
    `  ${C.dim("Rounds:")}         ${summary.roundCount}`,
    `  ${C.dim("Discussions:")}    ${summary.interventionCount}`,
  ];

  if (summary.whatChanged.length > 0) {
    lines.push("", `  ${C.hex("#50fa7b").bold("What Changed:")}`);
    for (const item of summary.whatChanged) lines.push(`    • ${item}`);
  }

  if (summary.majorDecisions.length > 0) {
    lines.push("", `  ${C.hex("#8be9fd").bold("Major Decisions:")}`);
    for (const item of summary.majorDecisions) lines.push(`    • ${item}`);
  }

  if (summary.disagreements.length > 0) {
    lines.push("", `  ${C.hex("#ffb86c").bold("Disagreements & Resolutions:")}`);
    for (const d of summary.disagreements) {
      lines.push(`    • ${d.topic} → ${d.resolution}`);
    }
  }

  if (summary.followUpItems.length > 0) {
    lines.push("", `  ${C.hex("#f1fa8c").bold("Follow-up Items:")}`);
    for (const item of summary.followUpItems) lines.push(`    • ${item}`);
  }

  if (summary.assumptions.length > 0) {
    lines.push("", `  ${C.dim("Assumptions:")}`);
    for (const item of summary.assumptions) lines.push(`    • ${item}`);
  }

  lines.push("", `  ${C.dim("Final Verdict:")} ${summary.finalVerdict}`);
  lines.push("", C.hex("#bd93f9").bold(bar), "");

  return lines.join("\n");
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ─── Utilities ────────────────────────────────────────────

type SpawnedProcess = ChildProcess & { exited: Promise<number> };

function spawnAgent(cmd: string, args: string[], cwd: string): SpawnedProcess {
  const proc = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd,
  });
  const exited = new Promise<number>((resolve, reject) => {
    proc.once("error", reject);
    proc.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  (proc as SpawnedProcess).exited = exited;
  return proc as SpawnedProcess;
}

const REVIEWER_TIMEOUT_MS = 120_000;

async function collectOutput(proc: SpawnedProcess, timeoutMs = 0): Promise<string> {
  let output = "";
  if (proc.stdout) {
    const dec = new TextDecoder();
    for await (const chunk of proc.stdout) {
      output += typeof chunk === "string" ? chunk : dec.decode(chunk as Buffer, { stream: true });
    }
  }
  return output;
}

async function collectOutputWithTimeout(proc: SpawnedProcess, timeoutMs: number): Promise<string> {
  return Promise.race([
    collectOutput(proc),
    new Promise<string>((_, reject) => {
      setTimeout(() => {
        proc.kill("SIGTERM");
        setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 3000);
        reject(new Error(`Reviewer timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
    }),
  ]);
}

async function gitDiff(repoRoot: string, baseBranch: string): Promise<string> {
  const proc = spawnAgent("git", ["diff", baseBranch], repoRoot);
  const output = await collectOutput(proc);
  await proc.exited;
  return output;
}

function getBufferForReview(buffer: string[], maxLines: number): string {
  if (buffer.length <= maxLines) return buffer.join("\n");
  const omitted = buffer.length - maxLines;
  return `[... ${omitted} earlier lines omitted ...]\n` + buffer.slice(-maxLines).join("\n");
}

function sendSignal(proc: SpawnedProcess, signal: NodeJS.Signals): boolean {
  try {
    if (proc.pid && !proc.killed) {
      process.kill(proc.pid, signal);
      return true;
    }
  } catch { /* process may have already exited */ }
  return false;
}

// ─── Summary Generation ───────────────────────────────────

function buildSummary(
  opts: PairOpts,
  interventions: Intervention[],
  round: number,
  startTime: number,
  outputBuffer: string[],
  finalVerdict: string,
): PairSummary {
  const whatChanged: string[] = [];
  const majorDecisions: string[] = [];
  const assumptions: string[] = [];
  const followUpItems: string[] = [];

  for (const line of outputBuffer) {
    if (line.startsWith("🔧 Write:") || line.startsWith("🔧 Edit:")) {
      const file = line.replace(/^🔧 (Write|Edit):\s*/, "").trim();
      if (file && !whatChanged.includes(file)) whatChanged.push(file);
    }
  }

  if (whatChanged.length === 0) {
    whatChanged.push("(check git diff for details)");
  }

  const disagreements = interventions.map(i => {
    const reviewerMsg = i.transcript.find(t => t.role === "reviewer")?.message || "";
    const resolution = i.agreed ? i.direction.slice(0, 100) : "Max discussion turns — used latest feedback";
    return { topic: reviewerMsg.slice(0, 80), resolution };
  });

  for (const i of interventions) {
    if (i.agreed) {
      majorDecisions.push(i.direction.slice(0, 120));
    }
  }

  return {
    task: opts.task,
    coder: opts.coder,
    reviewer: opts.reviewer,
    whatAttempted: opts.task,
    whatChanged,
    majorDecisions,
    disagreements,
    assumptions,
    followUpItems,
    interventionCount: interventions.length,
    roundCount: round,
    durationMs: Date.now() - startTime,
    finalVerdict,
  };
}

// ─── Main Entry Point ─────────────────────────────────────

export async function runPairMode(opts: PairOpts): Promise<number> {
  const startTime = Date.now();

  const coderBackend = getBackend(opts.coder);
  const reviewerBackend = getBackend(opts.reviewer);

  const outputBuffer: string[] = [];
  const interventions: Intervention[] = [];
  let round = 0;
  let coderSessionId: string | null = null;
  let currentCoderProc: SpawnedProcess | null = null;
  let aborted = false;

  // Session directory
  const sessionDir = join(
    opts.repoRoot,
    ".ai-worktrees",
    "pair-sessions",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  mkdirSync(sessionDir, { recursive: true });
  const logFile = join(sessionDir, "pair.jsonl");
  const rawLogFile = join(sessionDir, "coder-raw.log");

  const log = (event: Record<string, unknown>) => {
    appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n");
  };

  // Graceful shutdown (only escape valve for the human)
  const onSigint = () => {
    aborted = true;
    if (currentCoderProc) currentCoderProc.kill("SIGTERM");
  };
  process.on("SIGINT", onSigint);

  process.stdout.write(renderHeader(opts));
  log({ type: "session_start", coder: opts.coder, reviewer: opts.reviewer, task: opts.task });

  // ─── Status bar ─────────────────────────
  let statusPhase = "starting";
  let statusInterventions = 0;

  function renderStatusBar(): string {
    const elapsed = formatDuration(Date.now() - startTime);
    const cols = process.stdout.columns || 80;

    const left = ` 🤝 ${opts.coder}→coder  ${opts.reviewer}→reviewer`;
    const center = ` ${statusPhase} `;
    const right = `round ${round}  ${statusInterventions > 0 ? `💬 ${statusInterventions}  ` : ""}⏱ ${elapsed} `;

    const sepColor = C.hex("#44475a");
    const bgColor = C.bgHex("#282a36").hex("#f8f8f2");
    const phaseColor = statusPhase === "coding"
      ? C.bgHex("#282a36").hex("#50fa7b").bold
      : statusPhase === "reviewing"
        ? C.bgHex("#282a36").hex("#ff79c6").bold
        : statusPhase === "discussing"
          ? C.bgHex("#282a36").hex("#8be9fd").bold
          : C.bgHex("#282a36").hex("#6272a4");

    const gap = Math.max(0, cols - left.length - center.length - right.length);
    return sepColor("─".repeat(cols)) + "\n"
      + bgColor(left) + " ".repeat(Math.floor(gap / 2)) + phaseColor(center) + " ".repeat(Math.ceil(gap / 2)) + bgColor(right);
  }

  const statusInterval = setInterval(() => {
    if (aborted) return;
    const bar = renderStatusBar();
    process.stdout.write(`\x1b[s\x1b[${(process.stdout.rows || 24)};0H${bar}\x1b[u`);
  }, 1000);

  // ─── Invoke reviewer for a verdict ──────

  async function checkWithReviewer(isFinal: boolean): Promise<ReviewVerdict> {
    const reviewLines = isFinal ? 200 : 100;
    const outputText = getBufferForReview(outputBuffer, reviewLines);
    if (!outputText.trim() && !isFinal) return { action: "continue" };

    let diffOutput: string | undefined;
    if (isFinal) {
      try {
        const diff = await gitDiff(opts.repoRoot, opts.baseBranch);
        diffOutput = diff.length > 15000 ? diff.slice(0, 15000) + "\n… (diff truncated)" : diff;
      } catch { /* ignore */ }
    }

    const reviewPrompt = buildReviewPrompt(opts.task, outputText, isFinal, interventions, diffOutput);

    const label = isFinal ? " (final review)" : "";
    statusPhase = "reviewing";
    const spinner = ora({ text: C.hex("#ff79c6")(`Reviewer checking${label}…`), indent: 2 }).start();
    log({ type: "reviewer_start", round, isFinal });

    const { command, args } = reviewerBackend.buildReviewerCommand({
      prompt: reviewPrompt,
      cwd: opts.repoRoot,
      yolo: opts.yolo,
    });

    const proc = spawnAgent(command, args, opts.repoRoot);

    let verdict: ReviewVerdict;
    try {
      const rawOutput = await collectOutputWithTimeout(proc, REVIEWER_TIMEOUT_MS);
      await proc.exited;
      verdict = parseVerdict(rawOutput);
    } catch (err) {
      spinner.fail(C.hex("#ffb86c")(`Reviewer timed out — defaulting to CONTINUE`));
      log({ type: "reviewer_timeout", round, isFinal, error: String(err) });
      return { action: "continue" };
    }

    log({ type: "reviewer_verdict", round, isFinal, verdict: verdict.action });

    if (verdict.action === "continue") {
      spinner.succeed(C.hex("#50fa7b")("Reviewer: CONTINUE"));
    } else if (verdict.action === "complete") {
      spinner.succeed(C.hex("#50fa7b")("Reviewer: COMPLETE"));
    } else {
      spinner.warn(C.hex("#ffb86c")("Reviewer: PAUSE — starting discussion"));
    }

    return verdict;
  }

  // ─── Autonomous coder ↔ reviewer conversation ────
  //
  // When the reviewer says PAUSE, the two agents talk it out:
  //   1. Reviewer's concern is sent to the coder (via --resume)
  //   2. Coder responds (text only, no file changes)
  //   3. Reviewer evaluates the response
  //   4. Loop until CONTINUE or max turns
  //   5. Coder resumes with the agreed direction

  async function runConversation(
    initialConcern: string,
    initialSuggestion: string,
    currentRound: number,
  ): Promise<{ transcript: ConversationTurn[]; agreed: boolean; direction: string }> {
    const transcript: ConversationTurn[] = [];
    let reviewerMessage = initialConcern + (initialSuggestion ? `\n\nSuggestion: ${initialSuggestion}` : "");
    statusPhase = "discussing";

    for (let turn = 0; turn < MAX_CONVERSATION_TURNS; turn++) {
      transcript.push({ role: "reviewer", message: reviewerMessage });

      // ── Get coder's response ──
      process.stdout.write(C.hex("#50fa7b").dim(`  💬 Coder responding to reviewer...\n`));

      let coderResponse: string;

      if (coderSessionId) {
        const resumePrompt = buildCoderConversationPrompt(reviewerMessage);
        const resumeCmd = coderBackend.buildResumeCommand({
          sessionId: coderSessionId,
          message: resumePrompt,
          cwd: opts.repoRoot,
          yolo: opts.yolo,
          maxTurns: 3,
        });

        if (resumeCmd) {
          const proc = spawnAgent(resumeCmd.command, resumeCmd.args, opts.repoRoot);
          const rawOutput = await collectOutput(proc);
          await proc.exited;
          coderResponse = extractPlainText(rawOutput, coderBackend);

          // Update session ID if a new one was emitted
          for (const line of rawOutput.split("\n")) {
            const sid = coderBackend.extractSessionId(line);
            if (sid) coderSessionId = sid;
          }
        } else {
          // No resume support — use standalone prompt with context
          const prompt = [
            buildCoderConversationPrompt(reviewerMessage),
            "",
            "Context: You were working on this task:",
            opts.task,
            "",
            "Your recent work output (for reference):",
            getBufferForReview(outputBuffer, 200),
          ].join("\n");
          const cmd = coderBackend.buildCoderCommand({ prompt, cwd: opts.repoRoot, yolo: opts.yolo });
          const proc = spawnAgent(cmd.command, cmd.args, opts.repoRoot);
          const rawOutput = await collectOutput(proc);
          await proc.exited;
          coderResponse = extractPlainText(rawOutput, coderBackend);
        }
      } else {
        // No session — standalone conversation prompt
        const prompt = [
          buildCoderConversationPrompt(reviewerMessage),
          "",
          "Context: You were working on this task:",
          opts.task,
        ].join("\n");
        const cmd = coderBackend.buildCoderCommand({ prompt, cwd: opts.repoRoot, yolo: opts.yolo });
        const proc = spawnAgent(cmd.command, cmd.args, opts.repoRoot);
        const rawOutput = await collectOutput(proc);
        await proc.exited;
        coderResponse = extractPlainText(rawOutput, coderBackend);
      }

      if (!coderResponse.trim()) coderResponse = "(no response)";
      transcript.push({ role: "coder", message: coderResponse });
      log({ type: "conversation_turn", round: currentRound, turn, role: "coder", message: coderResponse.slice(0, 500) });

      // ── Get reviewer's judgment on coder's response ──
      process.stdout.write(C.hex("#ff79c6").dim(`  💬 Reviewer evaluating response...\n`));

      const judgmentPrompt = buildConversationReviewPrompt(opts.task, transcript, coderResponse);
      const { command, args } = reviewerBackend.buildReviewerCommand({
        prompt: judgmentPrompt,
        cwd: opts.repoRoot,
        yolo: opts.yolo,
      });

      const reviewerProc = spawnAgent(command, args, opts.repoRoot);
      const reviewerRaw = await collectOutput(reviewerProc);
      await reviewerProc.exited;

      const judgment = parseVerdict(reviewerRaw);
      log({ type: "conversation_turn", round: currentRound, turn, role: "reviewer_judgment", verdict: judgment.action });

      if (judgment.action === "continue" || judgment.action === "complete") {
        // Agreement reached
        const direction = coderResponse.slice(0, 300);
        process.stdout.write(renderConversation(transcript, currentRound, true));
        return { transcript, agreed: true, direction };
      }

      if (judgment.action === "pause") {
        reviewerMessage = judgment.concern + (judgment.suggestion ? `\n\nSuggestion: ${judgment.suggestion}` : "");
      }
    }

    // Max turns — use the last reviewer message as the direction
    const direction = reviewerMessage;
    process.stdout.write(renderConversation(transcript, currentRound, false));
    return { transcript, agreed: false, direction };
  }

  // ─── Run one coder round ────────────────

  async function runCoderRound(
    direction?: string,
    resumeSessionId?: string | null,
  ): Promise<CoderRoundResult> {
    round++;

    let proc: SpawnedProcess;

    if (resumeSessionId) {
      const resumeMessage = buildCoderResumePrompt(
        interventions[interventions.length - 1]?.transcript || [],
        direction || "Continue the task.",
      );
      const resumeCmd = coderBackend.buildResumeCommand({
        sessionId: resumeSessionId,
        message: resumeMessage,
        cwd: opts.repoRoot,
        yolo: opts.yolo,
      });

      if (resumeCmd) {
        process.stdout.write(
          C.hex("#50fa7b").bold(`\n  ▶ Coder (${opts.coder}) — resuming session\n\n`),
        );
        proc = spawnAgent(resumeCmd.command, resumeCmd.args, opts.repoRoot);
      } else {
        const prompt = buildCoderPrompt(opts.task, round, direction, interventions);
        const cmd = coderBackend.buildCoderCommand({ prompt, cwd: opts.repoRoot, yolo: opts.yolo });
        process.stdout.write(
          C.hex("#50fa7b").bold(`\n  ▶ Coder (${opts.coder}) — round ${round} (with feedback)\n\n`),
        );
        proc = spawnAgent(cmd.command, cmd.args, opts.repoRoot);
      }
    } else {
      const prompt = buildCoderPrompt(opts.task, round, direction, interventions);
      const cmd = coderBackend.buildCoderCommand({ prompt, cwd: opts.repoRoot, yolo: opts.yolo });
      process.stdout.write(
        C.hex("#50fa7b").bold(`\n  ▶ Coder (${opts.coder}) — round ${round}\n\n`),
      );
      proc = spawnAgent(cmd.command, cmd.args, opts.repoRoot);
    }

    currentCoderProc = proc;
    statusPhase = "coding";
    log({ type: "coder_start", round, resumed: !!resumeSessionId });

    let linesSinceLastReview = 0;
    let lastReviewTime = Date.now();
    let isReviewing = false;
    let resolved = false;

    return new Promise<CoderRoundResult>((resolve) => {
      const finish = (result: CoderRoundResult) => {
        if (resolved) return;
        resolved = true;
        resolve(result);
      };

      // Stream coder stdout
      if (proc.stdout) {
        const dec = new TextDecoder();
        let buf = "";

        proc.stdout.on("data", (chunk: Buffer | string) => {
          const text = typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
          buf += text;
          const lines = buf.split("\n");
          buf = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;

            appendFileSync(rawLogFile, line + "\n");

            if (!coderSessionId) {
              const sid = coderBackend.extractSessionId(line);
              if (sid) {
                coderSessionId = sid;
                log({ type: "session_id_captured", sessionId: sid });
              }
            }

            const formatted = coderBackend.formatOutputLine(line);
            if (formatted) {
              outputBuffer.push(formatted);
              linesSinceLastReview++;
              process.stdout.write(C.hex("#f8f8f2")(formatted) + "\n");
            }
          }
        });
      }

      if (proc.stderr) {
        proc.stderr.on("data", (chunk: Buffer | string) => {
          const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk as Buffer);
          if (text.trim()) {
            outputBuffer.push(`[stderr] ${text.trim()}`);
            process.stdout.write(C.dim(text));
          }
        });
      }

      // Periodic reviewer — runs in parallel, coder keeps running
      const reviewTimer = setInterval(async () => {
        if (resolved || isReviewing || aborted) return;

        const elapsed = Date.now() - lastReviewTime;
        if (elapsed < opts.reviewIntervalMs) return;
        if (linesSinceLastReview < 10) return;

        isReviewing = true;
        lastReviewTime = Date.now();
        linesSinceLastReview = 0;

        try {
          const verdict = await checkWithReviewer(false);

          if (verdict.action === "pause" && !resolved) {
            const pauseVerdict = verdict as ReviewVerdict & { action: "pause" };

            // Suspend the coder — all memory preserved
            process.stdout.write(C.hex("#ffb86c").dim("  ⏸ Coder suspended for discussion\n"));
            sendSignal(proc, "SIGTSTP");

            // Autonomous conversation between coder and reviewer
            const conversation = await runConversation(
              pauseVerdict.concern,
              pauseVerdict.suggestion,
              round,
            );

            interventions.push({
              timestamp: new Date().toISOString(),
              round,
              transcript: conversation.transcript,
              agreed: conversation.agreed,
              direction: conversation.direction,
            });
            statusInterventions = interventions.length;
            log({ type: "intervention", round, agreed: conversation.agreed, direction: conversation.direction.slice(0, 200) });

            // Kill the suspended coder — restart with conversation context via --resume
            clearInterval(reviewTimer);
            proc.kill("SIGTERM");
            finish({
              outcome: "needs_restart",
              direction: conversation.direction,
              sessionId: coderSessionId,
            });
          }
        } catch (err) {
          process.stdout.write(C.dim(`  ⚠ Reviewer error: ${err}\n`));
        } finally {
          isReviewing = false;
        }
      }, 5000);

      // Session timeout
      const timeoutTimer = setTimeout(() => {
        if (!resolved) {
          clearInterval(reviewTimer);
          proc.kill("SIGTERM");
          setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
          finish({ outcome: "timeout" });
        }
      }, opts.timeoutMs);

      // Process exit
      proc.exited.then((exitCode) => {
        clearInterval(reviewTimer);
        clearTimeout(timeoutTimer);
        currentCoderProc = null;
        log({ type: "coder_end", round, exitCode });

        if (aborted) {
          finish({ outcome: "aborted" });
        } else {
          finish({ outcome: "natural", exitCode });
        }
      });
    });
  }

  // ─── Main loop — fully autonomous ──────

  let finalVerdictText = "Session ended";

  try {
    let directionForNextRound: string | undefined;
    let resumeId: string | null = null;

    while (round <= opts.maxInterventions && !aborted) {
      const result = await runCoderRound(directionForNextRound, resumeId);
      directionForNextRound = undefined;
      resumeId = null;

      if (result.outcome === "aborted") {
        finalVerdictText = "Aborted (Ctrl+C)";
        break;
      }

      if (result.outcome === "timeout") {
        process.stdout.write(C.hex("#ffb86c").bold("\n  ⏰ Session timeout reached.\n"));
        finalVerdictText = "Timed out";
        break;
      }

      if (result.outcome === "needs_restart") {
        directionForNextRound = result.direction;
        resumeId = result.sessionId;
        continue;
      }

      // Coder exited naturally — final review
      process.stdout.write(
        C.hex("#50fa7b").dim("\n  ✓ Coder finished. Running final review...\n"),
      );

      const finalVerdict = await checkWithReviewer(true);

      if (finalVerdict.action === "complete") {
        process.stdout.write(renderCompletionBox(finalVerdict.summary));
        finalVerdictText = `Approved: ${finalVerdict.summary.slice(0, 120)}`;
        break;
      }

      if (finalVerdict.action === "pause") {
        const pv = finalVerdict as ReviewVerdict & { action: "pause" };

        // Final review disagreement — autonomous conversation
        const conversation = await runConversation(pv.concern, pv.suggestion, round);
        interventions.push({
          timestamp: new Date().toISOString(),
          round,
          transcript: conversation.transcript,
          agreed: conversation.agreed,
          direction: conversation.direction,
        });
        statusInterventions = interventions.length;
        log({ type: "intervention_final", round, agreed: conversation.agreed });

        directionForNextRound = conversation.direction;
        resumeId = coderSessionId;
        continue;
      }

      // CONTINUE on final review = done
      process.stdout.write(C.hex("#50fa7b").dim("  ✓ Reviewer approved (no issues found).\n"));
      finalVerdictText = "Approved — no issues found";
      break;
    }

    if (round > opts.maxInterventions && !aborted) {
      process.stdout.write(
        C.hex("#ffb86c").bold(`\n  ⚠ Max interventions (${opts.maxInterventions}) reached.\n`),
      );
      finalVerdictText = `Max interventions reached (${opts.maxInterventions})`;
    }

    const summary = buildSummary(opts, interventions, round, startTime, outputBuffer, finalVerdictText);
    process.stdout.write(renderSummary(summary));
    log({ type: "session_end", summary });
    process.stdout.write(C.dim(`\n  Session log: ${logFile}\n\n`));

    return 0;
  } catch (err) {
    process.stderr.write(C.red(`\nPair session error: ${err}\n`));
    return 1;
  } finally {
    clearInterval(statusInterval);
    // Clear the status bar area
    const rows = process.stdout.rows || 24;
    process.stdout.write(`\x1b[${rows};0H\x1b[2K\x1b[${rows - 1};0H\x1b[2K\x1b[${rows - 2};0H`);
    process.removeListener("SIGINT", onSigint);
    if (currentCoderProc) currentCoderProc.kill("SIGTERM");
  }
}

// ─── Validation ───────────────────────────────────────────

export function isPairAgentId(value: string): value is PairAgentId {
  return value === "claude" || value === "codex";
}

export const PAIR_AGENT_IDS: readonly PairAgentId[] = ["claude", "codex"];
