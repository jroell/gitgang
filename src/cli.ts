// GitGang - The gang's all here to code!
// Hardened orchestration CLI for autonomous multi-agent development.

import { spawn, type SpawnOptions, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  chmodSync,
  realpathSync,
} from "node:fs";
import type { Readable, Writable } from "node:stream";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import * as readline from "node:readline";
import chalk from "chalk";
import ora from "ora";
import { renderSidebar } from "./sidebar.js";
import {
  runRepl,
  createRealFanOut,
  createRealOrchestrator,
  executeTurn,
  cancelActiveChildren,
  activeChildCount,
  type ExecuteTurnDeps,
} from "./repl.js";
import type { MergePlan as OrchestratorMergePlan } from "./orchestrator.js";
import {
  createSession,
  loadSession,
  appendEvent,
  findPendingMergePlan,
  findLastMergedBranch,
  findLastAgentBranch,
  findLastPickedBranch,
  formatPrContent,
  formatSessionExport,
  type LoadedSession,
  type SessionEvent,
} from "./session.js";

const VERSION = "1.7.1";
const REQUIRED_BINARIES = ["git", "gemini", "claude", "codex"] as const;
const DEFAULT_AGENT_IDLE_TIMEOUT_MS = Number(
  process.env.GITGANG_AGENT_IDLE_TIMEOUT ?? 7 * 60 * 1000,
);
const AGENT_HEARTBEAT_INTERVAL_MS = 30_000;
const NUDGE_AFTER_MS = 3 * 60 * 1000; // Nudge after 3 minutes of inactivity
const MAX_CONSECUTIVE_ERRORS = 3; // Consider stuck after 3 consecutive errors
const MAX_AGENT_RESTARTS = 3;
const INITIAL_AGENT_BACKOFF_MS = 2_500;
const ROUND_COMPLETION_TIMEOUT_MS = 15 * 60 * 1000; // Force reviewer after 15 min even if agents still running
const POST_TIMEOUT_GRACE_MS = 3 * 1000; // Allow short grace after round timeout for just-landing results
const MAX_AGENT_BACKOFF_MS = 2 * 60 * 1000;
const REVIEWER_MAX_RETRIES = 3;
const REVIEWER_TIMEOUT_MS = Number(process.env.GITGANG_REVIEWER_TIMEOUT_MS ?? 15 * 60 * 1000); // 15 minutes default, override via env
const DEFAULT_POST_MERGE_CHECKS: string[] = [];
const GLOBAL_TIMEOUT_GRACE_MS = 15_000;

const supportsColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
chalk.level = supportsColor ? (process.env.COLORTERM === "truecolor" ? 3 : 2) : 0;

type AgentId = "gemini" | "claude" | "codex";
const AGENT_IDS: AgentId[] = ["gemini", "claude", "codex"];

interface AgentStats {
  filesChanged: number;
  additions: number;
  deletions: number;
  commits: number;
  errors: number;
  lastFile?: string;
}

interface Opts {
  task: string;
  repoRoot: string;
  baseBranch: string;
  workRoot: string;
  rounds: number;
  timeoutMs: number;
  yolo: boolean;
  autoPR: boolean;
  dryRun: boolean;
  activeAgents: AgentId[];
  reviewerAgent: AgentId;
  postMergeChecks: string[];
  soloMode: boolean;
}

interface Worktree {
  agent: AgentId;
  branch: string;
  dir: string;
  log: string;
}

interface ProcWrap {
  proc: SpawnedProcess;
  log: string;
  stdinWriter?: Writable | null;
}

interface StreamMessage {
  type:
    | "message"
    | "tool_use"
    | "tool_result"
    | "system"
    | "assistant"
    | "user"
    | "thinking"
    | "exec";
  role?: string;
  content?: string;
  delta?: boolean;
  message?: { content?: Array<{ type: string; text?: string; input?: any; name?: string }> };
  subtype?: string;
  model?: string;
  tool_name?: string;
  name?: string;
  parameters?: Record<string, unknown>;
  input?: Record<string, unknown>;
  command?: string;
  [key: string]: any;
}

interface StreamCallbacks {
  onActivity?: () => void;
  onMessage?: (msg: StreamMessage | null, raw: string) => void;
}

interface AgentRunResult {
  status: "success" | "dnf";
  exitCode: number;
  restarts: number;
  reason?: string;
}

interface MergePlan {
  order?: string[];
  notes?: string;
  postMergeChecks?: string[];
}

interface ReviewerDecision {
  status: "approve" | "revise";
  mergePlan?: MergePlan;
  revisions?: Array<{ agent: AgentId; instructions: string }>;
}

const DEFAULT_MODELS: Record<AgentId, string> = {
  gemini: "gemini-3.1-pro-preview",
  claude: "claude-opus-4-6",
  codex: "gpt-5.4",
};

/**
 * Resolve the model for each agent, allowing overrides via environment
 * variables: GITGANG_GEMINI_MODEL, GITGANG_CLAUDE_MODEL, GITGANG_CODEX_MODEL.
 */
function resolveModels(): Record<AgentId, string> {
  return {
    gemini: process.env.GITGANG_GEMINI_MODEL || DEFAULT_MODELS.gemini,
    claude: process.env.GITGANG_CLAUDE_MODEL || DEFAULT_MODELS.claude,
    codex: process.env.GITGANG_CODEX_MODEL || DEFAULT_MODELS.codex,
  };
}

const MODELS: Record<AgentId, string> = resolveModels();

const C = {
  b: (s: string) => chalk.bold(s),
  dim: (s: string) => chalk.hex("#6272a4")(s),
  red: (s: string) => chalk.hex("#ff5555")(s),
  green: (s: string) => chalk.hex("#50fa7b")(s),
  yellow: (s: string) => chalk.hex("#f1fa8c")(s),
  blue: (s: string) => chalk.hex("#8be9fd")(s),
  magenta: (s: string) => chalk.hex("#bd93f9")(s),
  cyan: (s: string) => chalk.hex("#8be9fd")(s),
  gray: (s: string) => chalk.hex("#6272a4")(s),
  purple: (s: string) => chalk.hex("#bd93f9")(s),
  orange: (s: string) => chalk.hex("#ffb86c")(s),
  pink: (s: string) => chalk.hex("#ff79c6")(s),
  background: chalk.bgHex("#282a36"),
  currentLine: chalk.bgHex("#44475a"),
};

const TAG = (name: string) => {
  const agentColors: Record<string, { bg: string; fg: string }> = {
    gemini: { bg: "#bd93f9", fg: "#282a36" },
    claude: { bg: "#f1fa8c", fg: "#282a36" },
    codex: { bg: "#50fa7b", fg: "#282a36" },
    review: { bg: "#8be9fd", fg: "#282a36" },
  };
  const colors = agentColors[name] || { bg: "#6272a4", fg: "#f8f8f2" };
  return chalk.bgHex(colors.bg).hex(colors.fg).bold(` ${name.toUpperCase()} `);
};

const line = (n = 84) => "".padEnd(n, "═");

const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*m/g;
function stripAnsi(text: string) {
  return text.replace(ANSI_ESCAPE_REGEX, "");
}

function normalizeStreamRaw(text: string) {
  return stripAnsi(text).trim();
}

type SpawnedProcess = ChildProcess & { exited: Promise<number> };

function spawnProcess(cmd: [string, ...string[]], options?: SpawnOptions): SpawnedProcess {
  const [command, ...args] = cmd;
  const proc = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });

  const exited = new Promise<number>((resolve, reject) => {
    proc.once("error", reject);
    proc.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });

  (proc as SpawnedProcess).exited = exited;
  return proc as SpawnedProcess;
}

async function readStream(stream?: Readable | null): Promise<string> {
  if (!stream) return "";
  return new Promise((resolve, reject) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.on("error", (err) => reject(err));
    stream.on("end", () => resolve(data));
  });
}

async function runCommand(
  cmd: [string, ...string[]],
  options?: SpawnOptions,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = spawnProcess(cmd, options);
  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function box(title: string, color: (s: string) => string = C.cyan, width = 84) {
  const contentWidth = width - 4;
  const titlePadded = ` ${title} `;
  const titleLen = titlePadded.length;
  const leftPad = Math.max(0, Math.floor((contentWidth - titleLen) / 2));
  const rightPad = Math.max(0, contentWidth - titleLen - leftPad);

  const top = color(`╭${"─".repeat(width - 2)}╮`);
  const middle =
    color("│") +
    " ".repeat(leftPad) +
    C.b(titlePadded) +
    " ".repeat(rightPad) +
    color("│");
  const bottom = color(`╰${"─".repeat(width - 2)}╯`);

  console.log(`\n${top}\n${middle}\n${bottom}`);
}

function banner(title: string, color: (s: string) => string = C.cyan) {
  box(title, color);
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout, stderr, exitCode } = await runCommand(["git", ...args], { cwd });
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${exitCode}): ${stderr || stdout}`,
    );
  }
  return stdout.trim();
}

async function ensureCleanTree(cwd: string) {
  const diff = await git(cwd, "status", "--porcelain");
  if (diff) {
    throw new Error("Working tree not clean. Commit or stash first.");
  }
}

async function repoRoot(): Promise<string> {
  const { stdout, exitCode } = await runCommand(["git", "rev-parse", "--show-toplevel"]);
  if (exitCode !== 0) throw new Error("Not in a git repository");
  return stdout.trim();
}

async function currentBranch(cwd: string): Promise<string> {
  return await git(cwd, "rev-parse", "--abbrev-ref", "HEAD");
}

const ts = () => {
  const d = new Date();
  const p = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

async function createWorktree(
  cwd: string,
  base: string,
  agent: AgentId,
  rootFolder: string,
): Promise<Worktree> {
  const branch = `agents/${agent}/${ts()}-${randomUUID().slice(0, 6)}`;
  const dir = resolve(cwd, rootFolder, `${agent}-${branch.replaceAll("/", "_")}`);
  mkdirSync(dir, { recursive: true });
  await git(cwd, "worktree", "add", "-b", branch, dir, base);
  const logs = resolve(dir, ".logs");
  mkdirSync(logs, { recursive: true });
  return { agent, branch, dir, log: join(logs, `${agent}.log`) };
}

function systemConstraints(agent: AgentId) {
  const timeBudget = process.env.GITGANG_TIME_BUDGET_SECONDS
    ? parseInt(process.env.GITGANG_TIME_BUDGET_SECONDS, 10)
    : null;
  const timeLines = timeBudget
    ? [
        "",
        "## Time Management",
        `Time budget: You have approximately ${timeBudget} seconds total to complete this task.`,
        `Strategy: commit a minimal working solution within the first ${Math.floor(timeBudget / 3)} seconds, then improve iteratively.`,
        "A committed partial solution is far better than a perfect solution that never gets committed.",
        "Do not spend more than 20% of your budget on exploration/planning before writing and committing real code.",
        `After ${Math.floor(timeBudget * 0.8)} seconds, stop adding features and focus on committing and verifying what you have.`,
      ]
    : [];
  return [
    "You are an autonomous senior engineer with full authorization to edit files, run shell commands, install dependencies, and run tests.",
    "Do not ask for permission. Decide and proceed.",
    "",
    "## Execution Strategy",
    "Follow this workflow: Observe → Plan → Implement → Verify → Commit",
    "",
    "### Phase 1: Observe (brief)",
    "Before writing any code, spend 30-60 seconds understanding the environment:",
    "- List the directory structure (ls, find) to understand the project layout.",
    "- Check what languages, frameworks, and tools are available (python3 --version, node --version, gcc --version, etc.).",
    "- Read any existing task description files (TASK.md, README.md, etc.).",
    "- Identify existing code, tests, and configuration files relevant to the task.",
    "- Check for a Makefile, package.json, requirements.txt, or similar build configuration.",
    "",
    "### Phase 2: Plan (brief)",
    "Mentally categorize the task and choose an appropriate strategy:",
    "- For coding tasks: identify the language, write a minimal working solution first, then refine.",
    "- For ML/training tasks: start with a small test run (few epochs, small data) to verify the pipeline works before scaling up.",
    "- For security/crypto tasks: ground your approach with exact commands before running destructive operations.",
    "- For system administration tasks: check current state before modifying configuration.",
    "- For optimization tasks: get a correct baseline first, then optimize.",
    "",
    "### Phase 3: Implement",
    "- Work in small, verifiable steps.",
    "- Commit early and often with clear messages — a committed partial solution beats an uncommitted perfect one.",
    "- Write complete files rather than making many small edits when creating new code.",
    "- When writing files with heredoc, ensure proper escaping and indentation.",
    "- If a command fails, read the error carefully, fix the root cause, and retry.",
    "- Install missing dependencies promptly (pip install, apt-get install, npm install, etc.).",
    "",
    "### Phase 4: Verify",
    "- Run any existing tests or validation scripts before declaring done.",
    "- If the task specifies expected output or behavior, verify against it.",
    "- Check for common errors: syntax errors, import failures, missing files, wrong paths.",
    "- If tests fail, debug and fix — do not stop at the first error.",
    "",
    "### Phase 5: Commit",
    "- Ensure all changes are committed with a clear, descriptive message.",
    "- Add or update tests to cover the change when applicable.",
    "",
    "## Error Recovery",
    "- If a tool or command is not found, try installing it or finding an alternative.",
    "- If you get stuck in a loop of the same error, step back and try a fundamentally different approach.",
    "- If a file write produces malformed content, read the file back to verify and fix.",
    "- If something fails, debug and keep going until complete.",
    "- Prefer writing files with cat <<'EOF' heredocs or direct file writes; the 'replace' tool can fail when paths include extra whitespace.",
    "At the end, summarize what changed.",
    ...timeLines,
  ].join("\n");
}

function featurePrompt(agent: AgentId, base: string, task: string) {
  return `Task: ${task}

Base branch: ${base}
You are in a dedicated git worktree and branch for ${agent}.

Objectives (in priority order):
1) Produce a correct, working solution to the task. Correctness is the top priority.
2) Commit your solution so it is captured in git history.
3) Verify your solution works by running any available tests, scripts, or validation.
4) Add or update tests if appropriate.
5) Ensure the project builds and tests pass.

Rules:
- You have full authorization to modify files and run commands in this workspace.
- Do not prompt for confirmation.
- Start by observing the workspace: list files, read task descriptions, check available tools.
- If the task references specific files, read them before modifying.
- If blocked, try a different approach rather than repeating the same failing strategy.
- When creating files, write the complete file content rather than patching incrementally.
- Always commit your work. An imperfect committed solution is better than no committed solution.
- Keep going until done.`;
}

function reviewerPromptJSON(
  base: string,
  branches: Partial<Record<AgentId, string>>,
  task: string,
  statusSummary?: string,
  diffSummaries?: Partial<Record<AgentId, string>>,
  successfulAgents?: AgentId[],
) {
  // Only include branches from agents that actually ran
  const activeBranches = AGENT_IDS.filter((id) => branches[id]);
  const branchList = activeBranches
    .map((id) => `- ${branches[id]}${successfulAgents && !successfulAgents.includes(id) ? " (FAILED - do not merge)" : ""}`)
    .join("\n");

  const diffSection = diffSummaries
    ? `\nDiff summaries vs ${base}:\n${activeBranches
        .map((id) => `--- ${id}${successfulAgents && !successfulAgents.includes(id) ? " (FAILED)" : ""} ---\n${diffSummaries[id] ?? "(no data)"}`)
        .join("\n\n")}\n`
    : "";

  const failedNote = successfulAgents && successfulAgents.length < activeBranches.length
    ? `\nIMPORTANT: Only these agents completed successfully: ${successfulAgents.join(", ")}. Only include their branches in your merge plan. Do NOT include failed agents' branches.\n`
    : "";

  const agentList = activeBranches.map((id) => `"${id}"`).join(" | ");

  return `You are the final reviewer. Compare these branches against ${base}:
${branchList}

Task: ${task}

Goal: Pick the best parts from each successful agent and integrate into a new merge branch off ${base}. If none are satisfactory, produce concrete fix instructions per agent and keep the loop going.
${failedNote}
Status summary:
${statusSummary || activeBranches.map((id) => `- ${id}: pending`).join("\n")}
${diffSection}
Output JSON only with this schema:
{
  "status": "approve" | "revise",
  "mergePlan": { "order": ["branchName", ...], "notes": "why this order", "postMergeChecks": ["command", ...] },
  "revisions": [{ "agent": ${agentList}, "instructions": "actionable steps" }]
}`;
}

export async function collectDiffSummaries(
  repoRoot: string,
  baseBranch: string,
  branches: Partial<Record<AgentId, string>>,
): Promise<Partial<Record<AgentId, string>>> {
  const summaries: Partial<Record<AgentId, string>> = {};
  for (const id of AGENT_IDS) {
    const branch = branches[id];
    if (!branch) {
      summaries[id] = "(branch not available)";
      continue;
    }
    try {
      const { stdout, exitCode } = await runCommand(
        ["git", "diff", "--stat", `${baseBranch}...${branch}`],
        { cwd: repoRoot },
      );
      summaries[id] = exitCode === 0 && stdout.trim() ? stdout.trim() : "(no changes)";
    } catch {
      summaries[id] = "(could not compute diff)";
    }
  }
  return summaries;
}

function parseStreamLine(line: string): StreamMessage | null {
  // Be tolerant of prefixes like "data: { ... }" or other text before the JSON
  const firstJson = parseFirstJson(line);
  if (!firstJson || typeof firstJson !== "object") return null;
  return firstJson as StreamMessage;
}

function shouldDisplayLine(msg: StreamMessage | null, rawLine: string): boolean {
  if (!msg) return !rawLine.includes('"type"');
  const skipTypes = ["init"];
  if (skipTypes.includes(msg.type)) return false;
  return true;
}

function formatMessage(
  msg: StreamMessage | null,
  rawLine: string,
  color: (s: string) => string,
): string {
  if (!msg) {
    if (rawLine.includes("Both GOOGLE_API_KEY and GEMINI_API_KEY")) return "";
    if (
      rawLine.includes("workdir:") ||
      rawLine.includes("model:") ||
      rawLine.includes("provider:")
    )
      return "";
    if (rawLine.includes("session id:") || rawLine.includes("approval:")) return "";
    return color(rawLine.trim());
  }

  switch (msg.type) {
    case "message":
      if (msg.role === "user" && msg.content) {
        return C.dim(`└─ Task: ${msg.content.split("\n")[0].slice(0, 80)}...`);
      }
      if (msg.role === "assistant" && msg.content) {
        const text = msg.content.trim();
        if (text) return color(`  ${text}`);
      }
      break;

    case "thinking":
      if (msg.content) return C.dim(`  💭 ${msg.content}`);
      break;

    case "tool_use": {
      const toolName = msg.tool_name || msg.name || "unknown";
      const desc = msg.parameters?.description || msg.input?.description || "";
      if (desc) return color(`  🔧 ${toolName}: ${desc}`);
      return color(`  🔧 ${toolName}`);
    }

    case "tool_result": {
      // Show tool results with success/error indicator
      const toolName = msg.tool_name || msg.name || "result";
      if (msg.is_error || msg.error) {
        return C.red(`  ✗ ${toolName} failed`);
      }
      // Only show success for significant results, suppress verbose output
      if (msg.content && typeof msg.content === "string" && msg.content.length < 100) {
        return C.dim(`  ✓ ${toolName}: ${msg.content.slice(0, 60)}`);
      }
      return C.dim(`  ✓ ${toolName}`);
    }

    case "exec":
      if (msg.command) return C.dim(`  $ ${msg.command}`);
      break;

    case "assistant":
      if (msg.message?.content) {
        for (const item of msg.message.content) {
          if (item.type === "text" && item.text) {
            return color(`  ${item.text}`);
          }
          if (item.type === "tool_use") {
            const name = item.name || "unknown";
            const desc = item.input?.description || "";
            if (desc) return color(`  🔧 ${name}: ${desc}`);
            return color(`  🔧 ${name}`);
          }
        }
      }
      break;

    case "user":
      return "";

    case "system":
      if (msg.subtype === "init") {
        const model = msg.model || "unknown";
        return C.dim(`  ⚙️  Initialized (${model})`);
      }
      break;
  }

  return "";
}

function streamToLog(
  prefix: string,
  logFile: string,
  color: (s: string) => string,
  stream: Readable,
  callbacks: StreamCallbacks = {},
) {
  const dec = new TextDecoder();
  let buffer = "";

  (async () => {
    try {
      for await (const chunk of stream) {
        const text =
          typeof chunk === "string"
            ? chunk
            : dec.decode(chunk as Buffer, { stream: true });
        buffer += text;

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          appendFileSync(logFile, line + "\n");
          callbacks.onActivity?.();

          const msg = parseStreamLine(trimmed);
          callbacks.onMessage?.(msg, trimmed);

          if (!shouldDisplayLine(msg, trimmed)) continue;

          const formatted = formatMessage(msg, trimmed, color);
          if (formatted) {
            console.log(`${prefix} ${formatted}`);
          }
        }
      }

      if (buffer.trim()) {
        appendFileSync(logFile, buffer + "\n");
        callbacks.onActivity?.();
        const msg = parseStreamLine(buffer.trim());
        callbacks.onMessage?.(msg, buffer);
        if (shouldDisplayLine(msg, buffer)) {
          const formatted = formatMessage(msg, buffer, color);
          if (formatted) {
            console.log(`${prefix} ${formatted}`);
          }
        }
      }
    } catch (e) {
      console.error(C.red(`Stream error: ${e}`));
    }
  })();
}

async function runGemini(
  w: Worktree,
  base: string,
  task: string,
  yolo: boolean,
  callbacks: StreamCallbacks = {},
): Promise<ProcWrap> {
  const prompt = `${systemConstraints("gemini")}\n\n${featurePrompt("gemini", base, task)}`;
  // Write prompt to a temp file to avoid shell escaping issues
  const promptFile = join(w.dir, ".logs", "gemini-prompt.txt");
  writeFileSync(promptFile, prompt);
  const args = [
    "-m", MODELS.gemini,
    "--output-format", "stream-json",
  ];
  if (yolo) args.push("--yolo");
  // Wrap in bash to pipe prompt file to gemini to avoid shell escaping issues
  const bashCmd = `cat "${promptFile}" | gemini ${args.join(" ")}`;
  const proc = spawnProcess(["bash", "-c", bashCmd], {
    cwd: w.dir,
  });
  if (!proc.stdout || !proc.stderr) {
    throw new Error("Failed to get stdout/stderr from gemini process");
  }
  const stdinWriter = proc.stdin;
  streamToLog(TAG("gemini"), w.log, C.purple, proc.stdout, callbacks);
  streamToLog(TAG("gemini"), w.log, C.purple, proc.stderr, callbacks);
  return { proc, log: w.log, stdinWriter };
}

async function runClaude(
  w: Worktree,
  base: string,
  task: string,
  yolo: boolean,
  callbacks: StreamCallbacks = {},
): Promise<ProcWrap> {
  const prompt = `${systemConstraints("claude")}\n\n${featurePrompt("claude", base, task)}`;
  // Write prompt to a temp file to avoid shell escaping issues
  const promptFile = join(w.dir, ".logs", "claude-prompt.txt");
  writeFileSync(promptFile, prompt);
  const args = [
    "--print",
    "--model",
    MODELS.claude,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  if (yolo) args.push("--dangerously-skip-permissions");
  // When running under a time budget, set --max-turns to prevent the agent from
  // spinning indefinitely. Empirically, most tasks complete in under 100 turns;
  // 200 is a generous ceiling that still prevents runaway loops.
  const maxTurns = process.env.GITGANG_MAX_TURNS
    ? parseInt(process.env.GITGANG_MAX_TURNS, 10)
    : (process.env.GITGANG_TIME_BUDGET_SECONDS ? 200 : 0);
  if (maxTurns > 0) args.push("--max-turns", String(maxTurns));
  // Wrap in bash to pipe prompt file to claude to avoid shell escaping issues
  // If a time budget is set, wrap with `timeout` so the agent exits gracefully
  // before an external deadline (e.g. benchmark harness) kills the container.
  const timeBudget = process.env.GITGANG_TIME_BUDGET_SECONDS
    ? parseInt(process.env.GITGANG_TIME_BUDGET_SECONDS, 10)
    : null;
  const timeoutPrefix = timeBudget ? `timeout ${timeBudget} ` : "";
  const bashCmd = `${timeoutPrefix}bash -c 'cat "${promptFile}" | claude ${args.join(" ")}'`;
  const proc = spawnProcess(["bash", "-c", bashCmd], {
    cwd: w.dir,
  });
  if (!proc.stdout || !proc.stderr) {
    throw new Error("Failed to get stdout/stderr from claude process");
  }
  const stdinWriter = proc.stdin;
  streamToLog(TAG("claude"), w.log, C.yellow, proc.stdout, callbacks);
  streamToLog(TAG("claude"), w.log, C.yellow, proc.stderr, callbacks);
  return { proc, log: w.log, stdinWriter };
}

async function runCodexCoder(
  w: Worktree,
  base: string,
  task: string,
  yolo: boolean,
  callbacks: StreamCallbacks = {},
): Promise<ProcWrap> {
  const prompt = `${systemConstraints("codex")}\n\n${featurePrompt("codex", base, task)}`;
  const args = [
    "exec",
    prompt,
    "--model",
    MODELS.codex,
    "--config",
    'model_reasoning_effort="xhigh"',
  ];
  args.push(yolo ? "--yolo" : "--full-auto");
  const proc = spawnProcess(["codex", ...args], {
    cwd: w.dir,
  });
  if (!proc.stdout || !proc.stderr) {
    throw new Error("Failed to get stdout/stderr from codex process");
  }
  const stdinWriter = proc.stdin;
  streamToLog(TAG("codex"), w.log, C.green, proc.stdout!, callbacks);
  streamToLog(TAG("codex"), w.log, C.green, proc.stderr!, callbacks);
  return { proc, log: w.log, stdinWriter };
}

interface ReviewerSpawnConfig {
  args: string[];
  options: SpawnOptions;
  command?: string;
}

export function reviewerSpawnConfig(
  cwd: string,
  base: string,
  branches: Partial<Record<AgentId, string>>,
  task: string,
  yolo: boolean,
  statusSummary?: string,
  diffSummaries?: Partial<Record<AgentId, string>>,
  successfulAgents?: AgentId[],
  reviewerAgent: AgentId = "codex",
): ReviewerSpawnConfig {
  const prompt = reviewerPromptJSON(base, branches, task, statusSummary, diffSummaries, successfulAgents);
  const options: Parameters<typeof spawn>[1] = {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  };

  switch (reviewerAgent) {
    case "claude": {
      // Write prompt to temp file to pipe into claude
      const promptFile = join(cwd, ".ai-worktrees", "reviewer-prompt.txt");
      mkdirSync(join(cwd, ".ai-worktrees"), { recursive: true });
      writeFileSync(promptFile, prompt);
      const bashCmd = `cat "${promptFile}" | claude --print --model ${MODELS.claude} --output-format stream-json --verbose${yolo ? " --dangerously-skip-permissions" : ""}`;
      return { args: ["-c", bashCmd], options: { ...options, shell: false }, command: "bash" };
    }
    case "gemini": {
      const promptFile = join(cwd, ".ai-worktrees", "reviewer-prompt.txt");
      mkdirSync(join(cwd, ".ai-worktrees"), { recursive: true });
      writeFileSync(promptFile, prompt);
      const geminiArgs = [`-m`, MODELS.gemini, `--output-format`, `stream-json`];
      if (yolo) geminiArgs.push("--yolo");
      const bashCmd = `cat "${promptFile}" | gemini ${geminiArgs.join(" ")}`;
      return { args: ["-c", bashCmd], options: { ...options, shell: false }, command: "bash" };
    }
    case "codex":
    default: {
      const args = [
        "exec",
        prompt,
        "--model",
        MODELS.codex,
        "--config",
        'model_reasoning_effort="xhigh"',
      ];
      args.push(yolo ? "--yolo" : "--full-auto");
      return { args, options, command: "codex" };
    }
  }
}

async function runReviewer(
  cwd: string,
  base: string,
  branches: Partial<Record<AgentId, string>>,
  task: string,
  yolo: boolean,
  statusSummary?: string,
  diffSummaries?: Partial<Record<AgentId, string>>,
  successfulAgents?: AgentId[],
  reviewerAgent: AgentId = "codex",
) {
  const { args, options, command } = reviewerSpawnConfig(cwd, base, branches, task, yolo, statusSummary, diffSummaries, successfulAgents, reviewerAgent);
  return spawnProcess([command || "codex", ...args], options);
}

function parseFirstJson(s: string) {
  const match = s.match(/\{[\s\S]*\}/);
  if (!match) return;
  try {
    return JSON.parse(match[0]);
  } catch {
    return;
  }
}

async function ensureDependencies(autoPR: boolean, activeAgents: AgentId[] = AGENT_IDS) {
  const missing: string[] = [];

  // Always require git; only require the CLI binaries for active agents
  const requiredBins: string[] = ["git", ...activeAgents];

  for (const bin of requiredBins) {
    const result = await runCommand(["which", bin]);
    if (result.exitCode !== 0) {
      missing.push(bin);
    }
  }

  if (missing.length) {
    throw new Error(
      `Missing required CLI tool(s): ${missing.join(", ")}. Ensure they are installed and on PATH.`,
    );
  }

  if (autoPR) {
    const ghProc = await runCommand(["which", "gh"]);
    if (ghProc.exitCode !== 0) {
      console.log(
        C.yellow(
          "GitHub CLI not found. PR automation disabled (rerun with gh installed to enable).",
        ),
      );
      return { autoPR: false };
    }
  }

  return { autoPR };
}

async function prepareRuntime(opts: Opts) {
  const depResult = await ensureDependencies(opts.autoPR, opts.activeAgents);
  return { autoPR: depResult.autoPR };
}

function parseAgentsList(value: string): AgentId[] {
  const ids = value.split(",").map((s) => s.trim().toLowerCase());
  const valid: AgentId[] = [];
  for (const id of ids) {
    if (AGENT_IDS.includes(id as AgentId)) {
      valid.push(id as AgentId);
    } else {
      console.error(C.yellow(`Warning: unknown agent "${id}" — valid agents: ${AGENT_IDS.join(", ")}`));
    }
  }
  if (!valid.length) {
    throw new Error(`No valid agents specified. Valid agents: ${AGENT_IDS.join(", ")}`);
  }
  return [...new Set(valid)]; // deduplicate
}

function parseReviewerAgent(value: string): AgentId {
  const id = value.trim().toLowerCase();
  if (AGENT_IDS.includes(id as AgentId)) {
    return id as AgentId;
  }
  throw new Error(`Invalid reviewer agent "${value}". Valid options: ${AGENT_IDS.join(", ")}`);
}

/**
 * Parse a human-friendly duration string into milliseconds.
 * Supports: "25m", "1h", "90s", "1h30m", "2h15m30s", "1500000" (raw ms).
 * Returns undefined if the string cannot be parsed.
 */
function parseDuration(value: string): number | undefined {
  const trimmed = value.trim();

  // Pure numeric → treat as milliseconds for backward compat
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const pattern = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i;
  const match = trimmed.match(pattern);
  if (!match || (!match[1] && !match[2] && !match[3])) return undefined;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

function parseArgs(raw: string[]) {
  // Sessions subcommand routing — must run before any other parsing.
  if (raw[0] === "sessions") {
    if (raw[1] === "list") {
      return { subcommand: { kind: "sessions_list" } } as unknown as ParsedArgs;
    }
    if (raw[1] === "show" && raw[2]) {
      return { subcommand: { kind: "sessions_show", id: raw[2] } } as unknown as ParsedArgs;
    }
    if (raw[1] === "export" && raw[2]) {
      // Optional --output <path>
      let outputPath: string | undefined;
      for (let j = 3; j < raw.length; j++) {
        if ((raw[j] === "-o" || raw[j] === "--output") && raw[j + 1]) {
          outputPath = raw[j + 1];
          j++;
        }
      }
      return {
        subcommand: { kind: "sessions_export", id: raw[2], outputPath },
      } as unknown as ParsedArgs;
    }
    throw new Error(
      "usage: gg sessions list | gg sessions show <id> | gg sessions export <id> [--output PATH]",
    );
  }

  let task: string | undefined;
  let rounds = 3;
  let yolo = true;
  let workRoot = ".ai-worktrees";
  let timeoutMs = 25 * 60 * 1000;
  let autoPR = true;
  let dryRun = false;
  let activeAgents: AgentId[] = [...AGENT_IDS];
  let reviewerAgent: AgentId = "codex";
  let postMergeChecks: string[] = [];
  let soloMode = false;
  let modelOverrides: Partial<Record<AgentId, string>> = {};
  let interactive = false;
  let interactiveExplicit = false;
  let opener: string | undefined;
  let resume: ParsedArgs["resume"] | undefined;
  let automerge: ParsedArgs["automerge"] | undefined;
  const positional: string[] = [];

  const bool = (v?: string) =>
    ["1", "true", "yes", "on"].includes((v || "").toLowerCase());

  for (let i = 0; i < raw.length; i++) {
    const token = raw[i];
    switch (token) {
      case "-i":
      case "--interactive":
        interactive = true;
        interactiveExplicit = true;
        break;
      case "--resume":
        if (i + 1 < raw.length && !raw[i + 1].startsWith("-")) {
          resume = { mode: "id", id: raw[++i] };
        } else {
          resume = { mode: "latest" };
        }
        break;
      case "--automerge": {
        if (i + 1 >= raw.length) throw new Error("--automerge requires on|off|ask");
        const v = raw[++i];
        if (v !== "on" && v !== "off" && v !== "ask")
          throw new Error("--automerge must be one of: on, off, ask");
        automerge = v;
        break;
      }
      case "--task":
        if (i + 1 >= raw.length) throw new Error("--task requires a value");
        task = raw[++i];
        break;
      case "--rounds":
        if (i + 1 >= raw.length) throw new Error("--rounds requires a value");
        rounds = Number(raw[++i]);
        break;
      case "--yolo":
        if (i + 1 < raw.length && !raw[i + 1].startsWith("-")) {
          yolo = bool(raw[++i]);
        } else {
          yolo = true;
        }
        break;
      case "--no-yolo":
        yolo = false;
        break;
      case "--workRoot":
        if (i + 1 >= raw.length) throw new Error("--workRoot requires a value");
        workRoot = raw[++i];
        break;
      case "--timeoutMs":
        if (i + 1 >= raw.length) throw new Error("--timeoutMs requires a value");
        timeoutMs = Number(raw[++i]);
        break;
      case "--timeout": {
        if (i + 1 >= raw.length) throw new Error("--timeout requires a value (e.g. 25m, 1h, 90s, 1h30m)");
        const parsed = parseDuration(raw[++i]);
        if (parsed === undefined) throw new Error(`Invalid duration "${raw[i]}". Use formats like 25m, 1h, 90s, 1h30m`);
        timeoutMs = parsed;
        break;
      }
      case "--no-pr":
        autoPR = false;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--agents":
        if (i + 1 >= raw.length) throw new Error("--agents requires a value (e.g. gemini,claude,codex)");
        activeAgents = parseAgentsList(raw[++i]);
        break;
      case "--reviewer":
        if (i + 1 >= raw.length) throw new Error("--reviewer requires a value (gemini, claude, or codex)");
        reviewerAgent = parseReviewerAgent(raw[++i]);
        break;
      case "--check":
        if (i + 1 >= raw.length) throw new Error("--check requires a command string");
        postMergeChecks.push(raw[++i]);
        break;
      case "--solo": {
        if (i + 1 >= raw.length) throw new Error("--solo requires an agent name (gemini, claude, or codex)");
        const soloAgent = raw[++i].toLowerCase();
        if (!isAgentId(soloAgent)) throw new Error(`Invalid solo agent "${soloAgent}". Must be one of: gemini, claude, codex`);
        activeAgents = [soloAgent as AgentId];
        reviewerAgent = soloAgent as AgentId;
        soloMode = true;
        rounds = 1;
        break;
      }
      case "--model-gemini":
        if (i + 1 >= raw.length) throw new Error("--model-gemini requires a model name");
        modelOverrides.gemini = raw[++i];
        break;
      case "--model-claude":
        if (i + 1 >= raw.length) throw new Error("--model-claude requires a model name");
        modelOverrides.claude = raw[++i];
        break;
      case "--model-codex":
        if (i + 1 >= raw.length) throw new Error("--model-codex requires a model name");
        modelOverrides.codex = raw[++i];
        break;
      default:
        if (!token.startsWith("-")) {
          positional.push(token);
          if (task === undefined) {
            task = token;
          }
        }
        break;
    }
  }

  // If interactive was requested explicitly and positional args are present,
  // treat them as the opener (not the one-shot task).
  if (interactiveExplicit && positional.length > 0) {
    opener = positional.join(" ");
    task = undefined;
  }

  // Default-to-interactive: no task, no explicit mode, no positional args.
  if (!interactive && !task && positional.length === 0) {
    interactive = true;
  }

  const normalized = normalizeParsedArgs({ task, rounds, yolo, workRoot, timeoutMs, autoPR, dryRun, activeAgents, reviewerAgent, postMergeChecks, soloMode, modelOverrides });
  normalized.interactive = interactive;
  if (opener !== undefined) normalized.opener = opener;
  if (resume !== undefined) normalized.resume = resume;
  if (automerge !== undefined) normalized.automerge = automerge;
  return normalized;
}

interface ParsedArgs {
  task?: string;
  rounds: number;
  yolo: boolean;
  workRoot: string;
  timeoutMs: number;
  autoPR: boolean;
  dryRun: boolean;
  activeAgents: AgentId[];
  reviewerAgent: AgentId;
  postMergeChecks: string[];
  soloMode: boolean;
  modelOverrides?: Partial<Record<AgentId, string>>;
  interactive?: boolean;
  opener?: string;
  resume?: { mode: "latest" } | { mode: "id"; id: string };
  automerge?: "on" | "off" | "ask";
  subcommand?:
    | { kind: "sessions_list" }
    | { kind: "sessions_show"; id: string }
    | { kind: "sessions_export"; id: string; outputPath?: string };
}

export function normalizeParsedArgs(parsed: ParsedArgs): ParsedArgs {
  const maxRounds = 10;
  const minTimeout = 60_000;
  const maxTimeout = 60 * 60 * 1000; // 1 hour

  let rounds = Number.isFinite(parsed.rounds) ? Math.round(parsed.rounds) : 3;
  if (rounds < 1) {
    console.warn(C.yellow("Rounds must be at least 1. Defaulting to 1."));
    rounds = 1;
  } else if (rounds > maxRounds) {
    console.warn(C.yellow(`Rounds capped to ${maxRounds} to keep runs manageable.`));
    rounds = maxRounds;
  }

  let timeoutMs = Number.isFinite(parsed.timeoutMs) ? parsed.timeoutMs : 25 * 60 * 1000;
  if (timeoutMs < minTimeout) {
    console.warn(C.yellow("timeoutMs too low. Using minimum of 60 seconds."));
    timeoutMs = minTimeout;
  } else if (timeoutMs > maxTimeout) {
    console.warn(C.yellow("timeoutMs too high. Capping to 60 minutes."));
    timeoutMs = maxTimeout;
  }

  const workRoot = parsed.workRoot?.trim() ? parsed.workRoot.trim() : ".ai-worktrees";

  return {
    task: parsed.task,
    rounds,
    yolo: parsed.yolo,
    workRoot,
    timeoutMs,
    autoPR: parsed.autoPR,
    dryRun: parsed.dryRun ?? false,
    activeAgents: parsed.activeAgents?.length ? parsed.activeAgents : [...AGENT_IDS],
    reviewerAgent: parsed.reviewerAgent ?? "codex",
    postMergeChecks: parsed.postMergeChecks ?? [],
    soloMode: parsed.soloMode ?? false,
    modelOverrides: parsed.modelOverrides ?? {},
  };
}

/**
 * Apply per-agent model overrides directly to the runtime MODELS object.
 * Overrides from --model-gemini / --model-claude / --model-codex CLI flags
 * take precedence over both defaults and GITGANG_*_MODEL env vars.
 */
export function applyModelOverrides(overrides: Partial<Record<AgentId, string>>): void {
  for (const id of AGENT_IDS) {
    const model = overrides[id];
    if (model && model.trim()) {
      MODELS[id] = model.trim();
    }
  }
}

const ORCHESTRATOR_LOG = "orchestrator.log";
function appendOrchestratorLog(repoRoot: string, entry: string) {
  const path = join(repoRoot, ORCHESTRATOR_LOG);
  try {
    appendFileSync(path, `[${new Date().toISOString()}] ${entry}
`);
  } catch {
    // Silently ignore logging failures to avoid interfering with the run
  }
}

function logStructuredError(opts: Opts, context: string, details?: string) {
  const entry = `${context}: ${details ?? "no additional details"}`;
  appendOrchestratorLog(opts.repoRoot, entry);
}

async function recordDNF(opts: Opts, reason: string, details?: string) {
  const path = join(opts.repoRoot, "DNF.md");
  const lines = [
    "# Did Not Finish",
    "",
    `- Timestamp: ${new Date().toISOString()}`,
    `- Task: ${opts.task}`,
    `- Base branch: ${opts.baseBranch}`,
    `- Reason: ${reason}`,
  ];
  if (details) {
    lines.push("", "Details:", "```", details.trim(), "```", "");
  } else {
    lines.push("", "");
  }
  writeFileSync(path, lines.join("\n"));
  console.log(C.red(`DNF recorded at ${path}`));
  logStructuredError(opts, "DNF recorded", `${reason}${details ? ` | ${details.trim().replace(/\n/g, " ")}` : ""}`);
  return path;
}

type AgentStreamFactory = (
  w: Worktree,
  base: string,
  task: string,
  yolo: boolean,
  callbacks: StreamCallbacks,
) => Promise<ProcWrap>;

const agentConfig: Record<
  AgentId,
  {
    color: (s: string) => string;
    spinnerColor: ora.Color;
    run: AgentStreamFactory;
  }
> = {
  gemini: { color: C.purple, spinnerColor: "magenta", run: runGemini },
  claude: { color: C.yellow, spinnerColor: "yellow", run: runClaude },
  codex: { color: C.green, spinnerColor: "green", run: runCodexCoder },
};

class AgentRunner {
  readonly id: AgentId;
  readonly worktree: Worktree;
  private readonly baseBranch: string;
  private readonly opts: Opts;
  private currentTask = "";
  private proc?: SpawnedProcess;
  private stdinWriter?: Writable | null;
  private restarts = 0;
  private backoffMs = INITIAL_AGENT_BACKOFF_MS;
  private lastActivity = Date.now();
  private lastNudge = 0;
  private consecutiveIdleRestarts = 0;
  private consecutiveErrors = 0;
  private lastErrorMessage = "";
  private lastSuccessfulAction = Date.now();
  private stats: AgentStats = {
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    commits: 0,
    errors: 0,
  };
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private completionResolver: ((result: AgentRunResult) => void) | null = null;
  private completionPromise: Promise<AgentRunResult> | null = null;
  private spinner: ora.Ora | null = null;
  private status: "idle" | "running" | "restarting" | "failed" | "completed" = "idle";
  private stopRequested = false;
  private globalTimeout = false;
  private lastError: string | undefined;
  private idleTimeoutMs = DEFAULT_AGENT_IDLE_TIMEOUT_MS;

  constructor(id: AgentId, worktree: Worktree, baseBranch: string, opts: Opts) {
    this.id = id;
    this.worktree = worktree;
    this.baseBranch = baseBranch;
    this.opts = opts;
  }

  run(task: string): Promise<AgentRunResult> {
    if (this.status === "running" || this.status === "restarting") {
      throw new Error(`${this.id} already running`);
    }

    this.currentTask = task;
    this.restarts = 0;
    this.backoffMs = INITIAL_AGENT_BACKOFF_MS;
    this.stopRequested = false;
    this.globalTimeout = false;
    this.lastError = undefined;
    this.status = "running";
    this.spinner?.stop();
    this.spinner = ora({
      text: `${TAG(this.id)} Launching…`,
      color: agentConfig[this.id].spinnerColor,
    }).start();

    this.completionPromise = new Promise<AgentRunResult>((resolve) => {
      this.completionResolver = resolve;
    });

    void this.launch();
    return this.completionPromise;
  }

  private async launch() {
    try {
      this.lastActivity = Date.now();
      const callbacks: StreamCallbacks = {
        onActivity: () => this.touch(),
        onMessage: (msg, raw) => {
          this.updateSpinnerFromMessage(msg);
          const sanitized = normalizeStreamRaw(raw);

          // Track errors vs successful tool use
          if (sanitized.includes("Error executing tool")) {
            this.consecutiveErrors++;
            this.stats.errors++;
            this.lastErrorMessage = sanitized.split(":").slice(1).join(":").trim().slice(0, 200);

            if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              this.spinner?.warn(
                `${TAG(this.id)} ${this.consecutiveErrors} consecutive errors - may be stuck`,
              );
            }
          } else if (msg?.type === "tool_use" || msg?.type === "tool_result") {
            if (!sanitized.includes("Error")) {
              this.consecutiveErrors = 0;
              this.lastSuccessfulAction = Date.now();

              if (msg?.type === "tool_use" && msg.name?.includes("edit")) {
                this.stats.filesChanged++;
              }
            }
          }

          if (sanitized.includes("git commit") || (msg?.type === "exec" && msg.command?.includes("git commit"))) {
            this.stats.commits++;
          }
        },
      };
      const wrap = await agentConfig[this.id].run(
        this.worktree,
        this.baseBranch,
        this.currentTask,
        this.opts.yolo,
        callbacks,
      );

      this.proc = wrap.proc;
      this.stdinWriter = wrap.stdinWriter;
      this.status = "running";
      if (this.spinner) {
        this.spinner.text = `${TAG(this.id)} Running…`;
      }

      this.startHeartbeat();

      wrap.proc.exited
        .then((exitCode) => this.handleExit(exitCode))
        .catch((err) => this.handleFailure(`exit error: ${err}`, 1));
    } catch (err) {
      this.handleFailure(
        `spawn failed: ${err instanceof Error ? err.message : String(err)}`,
        1,
      );
    }
  }

  private handleExit(exitCode: number) {
    this.stopHeartbeat();
    const writer = this.stdinWriter;
    this.stdinWriter = undefined;
    if (writer) {
      try {
        writer.end();
      } catch {
        /* ignore */
      }
    }
    this.proc = undefined;

    if (this.stopRequested) {
      this.status = "idle";
      this.spinner?.info(`${TAG(this.id)} stopped by user`);
      this.settle({
        status: "dnf",
        exitCode,
        restarts: this.restarts,
        reason: "Stopped manually",
      });
      this.stopRequested = false;
      return;
    }

    if (this.globalTimeout) {
      this.status = "failed";
      this.spinner?.fail(`${TAG(this.id)} aborted due to global timeout`);
      this.settle({
        status: "dnf",
        exitCode,
        restarts: this.restarts,
        reason: "Global timeout reached",
      });
      return;
    }

    if (exitCode === 0) {
      this.status = "completed";
      const msg =
        this.restarts > 0
          ? `${TAG(this.id)} Complete after ${this.restarts} restart${this.restarts === 1 ? "" : "s"}`
          : `${TAG(this.id)} Complete`;
      this.spinner?.succeed(msg);
      this.settle({ status: "success", exitCode, restarts: this.restarts });
      return;
    }

    this.handleFailure(`exit code ${exitCode}`, exitCode);
  }

  private handleFailure(reason: string, exitCode: number) {
    this.lastError = reason;

    if (this.restarts < MAX_AGENT_RESTARTS && !this.stopRequested && !this.globalTimeout) {
      const delay = Math.min(this.backoffMs, MAX_AGENT_BACKOFF_MS);
      this.restarts += 1;
      this.status = "restarting";
      this.spinner?.warn(
        `${TAG(this.id)} ${reason}. Restart ${this.restarts}/${MAX_AGENT_RESTARTS} in ${(delay / 1000).toFixed(1)}s`,
      );
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_AGENT_BACKOFF_MS);
      setTimeout(() => void this.launch(), delay).unref?.();
      return;
    }

    this.status = "failed";
    this.spinner?.fail(`${TAG(this.id)} failed: ${reason}`);
    logStructuredError(this.opts, `Agent ${this.id} failure`, `${reason} (exit ${exitCode})`);
    this.settle({
      status: "dnf",
      exitCode,
      restarts: this.restarts,
      reason,
    });
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.idleTimer = setInterval(() => {
      if (!this.proc) return;
      const idleFor = Date.now() - this.lastActivity;
      const timeSinceSuccess = Date.now() - this.lastSuccessfulAction;
      
      // Check if stuck in error loop
      if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && timeSinceSuccess > 2 * 60 * 1000) {
        this.spinner?.fail(
          `${TAG(this.id)} stuck in error loop (${this.consecutiveErrors} errors) – giving up`,
        );
        this.stopHeartbeat();
        this.stopRequested = true;
        this.proc.kill();
        
        void recordDNF(
          this.opts,
          "Agent stuck in error loop",
          `Agent had ${this.consecutiveErrors} consecutive errors. Last error: ${this.lastErrorMessage}`,
        );
        return;
      }
      
      // Nudge agent if idle for 3 minutes and haven't nudged recently
      if (idleFor > NUDGE_AFTER_MS && (Date.now() - this.lastNudge) > NUDGE_AFTER_MS) {
        this.lastNudge = Date.now();
        
        let nudgeMessage = `You seem to be stuck or idle. Please provide a status update or continue working on the task. If you're done, please provide a summary of what you've accomplished.`;
        
        // Add error context if agent has been hitting errors
        if (this.consecutiveErrors > 0) {
          nudgeMessage += `\n\nNote: You've had ${this.consecutiveErrors} recent error(s). Last error: ${this.lastErrorMessage.slice(0, 150)}`;
          if (this.lastErrorMessage.includes("File path must be within")) {
            nudgeMessage += `\n\nTip: Ensure all file paths are absolute and within your worktree directory.`;
          }
        }
        
        this.spinner.text = `${TAG(this.id)} 🔔 Nudging (idle ${(idleFor / 1000).toFixed(0)}s)...`;
        void this.nudge(nudgeMessage);
      }
      
      // Kill agent if idle for too long
      if (idleFor > this.idleTimeoutMs) {
        this.consecutiveIdleRestarts++;
        
        // If agent keeps getting stuck, record DNF instead of restarting
        if (this.consecutiveIdleRestarts >= 2) {
          this.spinner?.fail(
            `${TAG(this.id)} stuck repeatedly (${this.consecutiveIdleRestarts} idle timeouts) – giving up`,
          );
          this.stopHeartbeat();
          this.stopRequested = true; // Prevent restart
          this.proc.kill();
          
          // Record DNF
          void recordDNF(
            this.opts,
            "Agent stuck/unresponsive",
            `Agent became idle after ${(idleFor / 1000).toFixed(0)}s with no activity. Occurred ${this.consecutiveIdleRestarts} times.`,
          );
        } else {
          this.spinner?.warn(
            `${TAG(this.id)} idle for ${(idleFor / 1000).toFixed(0)}s – restarting (attempt ${this.consecutiveIdleRestarts})`,
          );
          this.proc.kill();
        }
      }
    }, AGENT_HEARTBEAT_INTERVAL_MS);
    this.idleTimer.unref?.();
  }

  private stopHeartbeat() {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private updateSpinnerFromMessage(msg: StreamMessage | null) {
    if (!msg || !this.spinner) return;
    if (msg.type === "thinking" && msg.content) {
      this.spinner.text = `${TAG(this.id)} 💭 ${msg.content.slice(0, 60)}…`;
    } else if (msg.type === "tool_use") {
      const toolName = msg.tool_name || msg.name || "tool";
      this.spinner.text = `${TAG(this.id)} 🔧 ${toolName}`;
    } else if (msg.type === "exec" && msg.command) {
      this.spinner.text = `${TAG(this.id)} $ ${msg.command.slice(0, 50)}…`;
    } else if (msg.type === "message" && msg.role === "assistant" && msg.content) {
      this.spinner.text = `${TAG(this.id)} ${msg.content.slice(0, 60)}…`;
    }
  }

  private touch() {
    this.lastActivity = Date.now();
    // Reset consecutive idle restarts on activity
    if (this.consecutiveIdleRestarts > 0) {
      this.consecutiveIdleRestarts = 0;
    }
    // Note: Don't reset consecutiveErrors here - only reset on successful tool use
  }

  private settle(result: AgentRunResult) {
    if (this.completionResolver) {
      this.completionResolver(result);
      this.completionResolver = null;
    }
    this.completionPromise = null;
  }

  async nudge(message: string) {
    const writer = this.stdinWriter;
    if (!writer || writer.destroyed) return false;
    return new Promise<boolean>((resolve) => {
      writer.write(`\nProxy: ${message}\n`, (err) => resolve(!err));
    });
  }

  terminate() {
    if (!this.proc) return false;
    this.stopRequested = true;
    this.proc.kill();
    return true;
  }

  notifyGlobalTimeout() {
    this.globalTimeout = true;
    if (this.proc) {
      this.spinner?.warn(`${TAG(this.id)} global timeout reached – stopping`);
      this.proc.kill();
    }
  }

  getStatus() {
    return this.status;
  }

  getStats(): AgentStats {
    return { ...this.stats };
  }

  getSummary() {
    switch (this.status) {
      case "running":
      case "restarting":
        return C.green("running");
      case "completed":
        return C.cyan("completed");
      case "failed":
        return C.red(`failed${this.lastError ? ` (${this.lastError})` : ""}`);
      default:
        return C.yellow("idle");
    }
  }

  getLogPath() {
    return this.worktree.log;
  }

  getLastError() {
    return this.lastError;
  }
}

interface CommandPaletteState {
  agents: Record<AgentId, AgentRunner>;
  opts: Opts;
  refreshDashboard?: (reason?: string, options?: { force?: boolean }) => void;
}

function startCommandPalette(state: CommandPaletteState) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  process.stdin.resume();
  console.log(
    C.gray(
      "Type /help or @codex/@claude/@gemini/@all <message>. Agents keep running while you interact.",
    ),
  );
  rl.on("line", async (line) => {
    const s = line.trim();
    if (!s) return;
    if (s.startsWith("@")) {
      await handleAgentMentionInput(s, state);
      return;
    }
    if (!s.startsWith("/")) return;
    const parts = s.slice(1).split(/\s+/);
    const cmd = (parts.shift() || "").toLowerCase();
    try {
      switch (cmd) {
        case "help":
          console.log(
            C.cyan(
              `/status  /agents  /logs <agent>  /nudge <agent> <msg>  /kill <agent>  /help`,
            ),
          );
          break;
        case "status":
          for (const id of AGENT_IDS) {
            const runner = state.agents[id];
            console.log(`${TAG(id)} ${runner.getSummary()}`);
          }
          state.refreshDashboard?.("Manual /status request", { force: true });
          break;
        case "agents":
          console.log(
            (Object.entries(state.agents) as Array<[AgentId, AgentRunner]>)
              .map(([id, runner]) => `${id}: ${runner.worktree.branch} → ${runner.worktree.dir}`)
              .join("\n"),
          );
          break;
        case "nudge": {
          const id = parts.shift() as AgentId;
          const msg = parts.join(" ");
          if (!id || !msg) {
            console.log(C.red("Usage: /nudge <agent> <message>"));
            break;
          }
          const runner = state.agents[id];
          if (!runner) {
            console.log(C.red(`Unknown agent ${id}`));
            break;
          }
          const ok = await runner.nudge(msg);
          if (ok) console.log(C.green(`nudged ${id}`));
          else console.log(C.yellow(`${id} has no stdin or exited`));
          break;
        }
        case "logs": {
          const id = parts.shift() as AgentId;
          if (!id) {
            console.log(C.red("Usage: /logs <agent>"));
            break;
          }
          const runner = state.agents[id];
          if (!runner) {
            console.log(C.red(`Unknown agent ${id}`));
            break;
          }
          const file = runner.getLogPath();
          if (!existsSync(file)) {
            console.log(C.yellow("no log yet"));
            break;
          }
          const txt = readFileSync(file, "utf8");
          console.log(C.dim(txt.slice(-8000)));
          break;
        }
        case "kill": {
          const id = parts.shift() as AgentId;
          if (!id) {
            console.log(C.red("Usage: /kill <agent>"));
            break;
          }
          const runner = state.agents[id];
          if (!runner) {
            console.log(C.red(`Unknown agent ${id}`));
            break;
          }
          const killed = runner.terminate();
          if (killed) console.log(C.yellow(`sent SIGTERM to ${id}`));
          else console.log(C.yellow(`${id} not running`));
          break;
        }
        case "review":
          console.log(
            C.yellow(
              "Reviewer loop runs automatically once agents and revisions complete.",
            ),
          );
          break;
        default:
          console.log(C.yellow(`Unknown command: /${cmd}`));
      }
    } catch (e) {
      console.error(C.red(`Command error: ${e}`));
    }
  });
  return rl;
}

function isAgentId(value: string): value is AgentId {
  return AGENT_IDS.includes(value as AgentId);
}

async function handleAgentMentionInput(input: string, state: CommandPaletteState) {
  const trimmed = input.slice(1).trim();
  if (!trimmed) {
    console.log(C.red("Usage: @all <message> or @codex <message>"));
    return true;
  }

  const segments = trimmed.split(/\s+/);
  const rawTarget = segments.shift() || "";
  const sanitizedTarget = rawTarget.replace(/[^a-zA-Z]/g, "").toLowerCase();
  const message = segments.join(" ").trim();

  if (!sanitizedTarget) {
    console.log(C.red("Missing agent name after @"));
    return true;
  }
  if (!message) {
    console.log(C.red("Please include a message after the mention."));
    return true;
  }

  if (sanitizedTarget === "all") {
    const entries = Object.entries(state.agents) as Array<[AgentId, AgentRunner]>;
    if (!entries.length) {
      console.log(C.yellow("No agents available for broadcast."));
      return true;
    }
    let delivered = 0;
    const skipped: AgentId[] = [];
    for (const [id, runner] of entries) {
      // Provide extra context so agents know the message is user-originated.
      const ok = await runner.nudge(`User broadcast:\n${message}`);
      if (ok) delivered++;
      else skipped.push(id);
    }
    if (delivered) {
      console.log(C.green(`Broadcast sent to ${delivered} agent(s): "${message}"`));
    } else {
      console.log(C.yellow("No running agents accepted the broadcast."));
    }
    if (skipped.length) {
      console.log(C.gray(`Skipped (no stdin): ${skipped.join(", ")}`));
    }
    state.refreshDashboard?.("User broadcast", { force: true });
    return true;
  }

  if (!isAgentId(sanitizedTarget)) {
    console.log(C.red(`Unknown agent mention @${rawTarget}`));
    return true;
  }

  const runner = state.agents[sanitizedTarget];
  if (!runner) {
    console.log(C.red(`Agent ${sanitizedTarget} is not configured.`));
    return true;
  }

  const ok = await runner.nudge(`User direct message:\n${message}`);
  if (ok) {
    console.log(C.green(`Sent message to ${sanitizedTarget}: "${message}"`));
    state.refreshDashboard?.(`User message → ${sanitizedTarget}`, { force: true });
  } else {
    console.log(C.yellow(`${sanitizedTarget} is not currently accepting input.`));
  }
  return true;
}

function startDashboardTicker(params: {
  agents: Record<AgentId, AgentRunner>;
  opts: Opts;
  intervalMs?: number;
}) {
  const intervalMs = params.intervalMs ?? 15_000;
  let lastRender = "";

  const render = (reason?: string, force = false) => {
    const snapshot = renderSidebar(params.agents, params.opts, {
      width: 52,
      showLogo: true,
    });
    if (!force && snapshot === lastRender) {
      return;
    }
    const label = reason ? `Agent dashboard — ${reason}` : "Agent dashboard update";
    console.log(C.gray(`\n${label}`));
    console.log(`${snapshot}\n`);
    lastRender = snapshot;
  };

  render("initial", true);
  const handle = setInterval(() => render(undefined, false), intervalMs);
  handle.unref?.();

  return {
    refresh: (reason?: string, options?: { force?: boolean }) => {
      render(reason, options?.force ?? false);
    },
    stop: () => clearInterval(handle),
  };
}

async function runPostMergeCheck(cmd: string, repo: string) {
  console.log(C.gray(`Running post-merge check: ${cmd}`));
  const proc = spawnProcess(["bash", "-lc", cmd], {
    cwd: repo,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
  return exitCode;
}

const POST_MERGE_CHECK_ATTEMPTS = 3;
const POST_MERGE_CHECK_BACKOFF_MS = 500;

export async function runPostMergeCheckWithRetries(cmd: string, repo: string) {
  let lastExit = 1;
  for (let attempt = 1; attempt <= POST_MERGE_CHECK_ATTEMPTS; attempt++) {
    lastExit = await runPostMergeCheck(cmd, repo);
    if (lastExit === 0) {
      return 0;
    }
    if (attempt < POST_MERGE_CHECK_ATTEMPTS) {
      const waitTime = attempt * POST_MERGE_CHECK_BACKOFF_MS;
      console.log(C.gray(`Retrying post-merge check (${attempt + 1}/${POST_MERGE_CHECK_ATTEMPTS}) in ${waitTime}ms…`));
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
  return lastExit;
}

async function applyMergePlan(
  opts: Opts,
  worktrees: Partial<Record<AgentId, Worktree>>,
  decision: ReviewerDecision,
) {
  const mergeBranch = `ai-merge-${ts()}`;
  try {
    await git(opts.repoRoot, "checkout", opts.baseBranch);
    await git(opts.repoRoot, "checkout", "-b", mergeBranch, opts.baseBranch);
  } catch (err) {
    return {
      ok: false,
      reason: "Failed to create merge branch",
      details: err instanceof Error ? err.message : String(err),
    };
  }

  // Build default order from available worktrees only
  const availableBranches = opts.activeAgents
    .filter((id) => worktrees[id])
    .map((id) => worktrees[id]!.branch);

  const order =
    decision.mergePlan?.order && decision.mergePlan.order.length
      ? decision.mergePlan.order
      : availableBranches;

  for (const branch of order) {
    try {
      console.log(C.gray(`Merging ${branch}…`));
      await git(
        opts.repoRoot,
        "merge",
        "--no-ff",
        branch,
        "-m",
        `merge ${branch} per reviewer plan`,
      );
    } catch (err) {
      await git(opts.repoRoot, "merge", "--abort").catch(() => {});
      await git(opts.repoRoot, "checkout", opts.baseBranch).catch(() => {});
      return {
        ok: false,
        reason: `Merge conflict with ${branch}`,
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const checks =
    decision.mergePlan?.postMergeChecks && decision.mergePlan.postMergeChecks.length
      ? decision.mergePlan.postMergeChecks
      : opts.postMergeChecks.length
        ? opts.postMergeChecks
        : DEFAULT_POST_MERGE_CHECKS;

  for (const check of checks) {
    const exitCode = await runPostMergeCheckWithRetries(check, opts.repoRoot);
    if (exitCode !== 0) {
      await git(opts.repoRoot, "checkout", opts.baseBranch).catch(() => {});
      return {
        ok: false,
        reason: `Post-merge check failed (${check})`,
        details: `Exit code ${exitCode}`,
      };
    }
  }

  const diff = await git(opts.repoRoot, "status", "--porcelain");
  if (diff) {
    await git(opts.repoRoot, "add", "-A");
    await git(
      opts.repoRoot,
      "commit",
      "-m",
      "chore: apply reviewer adjustments",
    );
  }

  return { ok: true, branch: mergeBranch };
}

/**
 * Apply a reviewer-picked merge plan in interactive REPL context.
 *
 * Takes the orchestrator's `MergePlan` shape ({ pick, branches, rationale,
 * followups }), checks out `base`, and merges each listed branch with
 * `git merge --no-ff`. Hybrid picks merge all branches in order; any other
 * pick merges only `branches[0]`. On conflict, runs `git merge --abort` and
 * throws. Does NOT run post-merge checks or create a PR.
 */
export async function applyInteractiveMergePlan(
  repoRoot: string,
  base: string,
  plan: OrchestratorMergePlan,
): Promise<void> {
  if (!plan.branches || plan.branches.length === 0) {
    throw new Error("merge plan has no branches to apply");
  }

  await git(repoRoot, "checkout", base);

  const isHybrid = plan.pick === "hybrid" && plan.branches.length > 1;
  const branches = isHybrid ? plan.branches : [plan.branches[0]];

  for (const branch of branches) {
    try {
      await git(
        repoRoot,
        "merge",
        "--no-ff",
        branch,
        "-m",
        isHybrid
          ? `merge ${branch} (hybrid plan, ${branches.length} branches)`
          : `merge ${branch} per orchestrator plan`,
      );
    } catch (err) {
      await git(repoRoot, "merge", "--abort").catch(() => {});
      throw new Error(
        `merge conflict applying ${branch}${isHybrid ? ` (hybrid, failed at branch ${branches.indexOf(branch) + 1}/${branches.length})` : ""}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

async function runRevisionRequests(
  opts: Opts,
  revisions: Array<{ agent: AgentId; instructions: string }>,
  agents: Record<AgentId, AgentRunner>,
) {
  for (const rev of revisions) {
    const runner = agents[rev.agent];
    const addendum = `\nFollow up from reviewer: ${rev.instructions}\nKeep going until checks pass.`;
    const result = await runner.run(`${opts.task}${addendum}`);
    if (result.status !== "success") {
      return {
        ok: false,
        reason: `Agent ${rev.agent} could not complete reviewer instructions`,
        details: result.reason,
      };
    }
  }
  return { ok: true };
}

export interface AgentStatusSource {
  getSummary: () => string;
  getLastError: () => string | undefined;
}

export function buildStatusSummary(agents: Record<AgentId, AgentStatusSource>) {
  return (Object.entries(agents) as Array<[AgentId, AgentStatusSource]>)
    .map(([id, runner]) => {
      const plain = stripAnsi(runner.getSummary()).trim();
      const err = runner.getLastError();
      return `${id}: ${plain}${err ? ` (${err})` : ""}`;
    })
    .join(`
- `);
}

async function doReview(
  opts: Opts,
  agents: Partial<Record<AgentId, AgentRunner>>,
  statusSummary: string,
  successfulAgentIds?: AgentId[],
): Promise<
  | { status: "approved"; mergeBranch: string }
  | { status: "revisions" }
  | { status: "dnf"; reason: string; details?: string }
> {
  await git(opts.repoRoot, "checkout", opts.baseBranch);

  let lastError: string | undefined;

  // Build branches map from available agents only
  const branches: Partial<Record<AgentId, string>> = {};
  for (const id of opts.activeAgents) {
    if (agents[id]) branches[id] = agents[id]!.worktree.branch;
  }

  for (let attempt = 1; attempt <= REVIEWER_MAX_RETRIES; attempt++) {
    console.log(C.gray(`Starting reviewer attempt ${attempt}/${REVIEWER_MAX_RETRIES}...`));

    const diffSummaries = await collectDiffSummaries(opts.repoRoot, opts.baseBranch, branches);

    const proc = await runReviewer(
      opts.repoRoot,
      opts.baseBranch,
      branches,
      opts.task,
      opts.yolo,
      statusSummary,
      diffSummaries,
      successfulAgentIds,
      opts.reviewerAgent,
    );

    console.log(C.gray(`Reviewer process started, waiting for response (timeout: ${REVIEWER_TIMEOUT_MS / 1000}s)...`));

    // Add timeout to prevent hanging forever
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Reviewer timeout")), REVIEWER_TIMEOUT_MS);
    });

    const capture = Promise.all([
      Promise.all([readStream(proc.stdout), readStream(proc.stderr)]),
      proc.exited,
    ]).then(([[stdout, stderr], exitCode]) => ({
      stdout,
      stderr,
      exitCode,
    }));

    let stdout: string;
    let stderr: string;
    let exitCode: number;

    try {
      // Read streams and wait for exit in parallel with timeout
      ({ stdout, stderr, exitCode } = await Promise.race([
        capture,
        timeoutPromise,
      ]));
    } catch (err) {
      // Timeout or other error - kill the process
      proc.kill();
      lastError = `Reviewer timeout or error: ${err instanceof Error ? err.message : String(err)}`;
      console.log(C.red(`Reviewer attempt ${attempt} failed: ${lastError}`));
      continue;
    }

    console.log(C.gray(`Reviewer process completed with exit code ${exitCode}`));

    if (stderr.trim()) process.stderr.write(C.gray(stderr));
    if (stdout.trim()) process.stdout.write(C.dim(stdout));

    if (exitCode !== 0) {
      lastError = `Reviewer exited with code ${exitCode}`;
      console.log(C.red(`Reviewer attempt ${attempt} failed: ${lastError}`));
      continue;
    }

    const decision = parseFirstJson(stdout) as ReviewerDecision | undefined;
    if (!decision) {
      lastError = "Reviewer did not emit valid JSON";
      console.log(C.red(`Reviewer attempt ${attempt} failed: ${lastError}`));
      console.log(C.gray(`Stdout was: ${stdout.substring(0, 200)}...`));
      continue;
    }

    console.log(C.gray(`Reviewer decision: ${decision.status}`));

    if (decision.status === "approve") {
      const worktrees: Partial<Record<AgentId, Worktree>> = {};
      for (const id of opts.activeAgents) {
        if (agents[id]) worktrees[id] = agents[id]!.worktree;
      }
      const mergeResult = await applyMergePlan(opts, worktrees, decision);
      if (!mergeResult.ok) {
        return {
          status: "dnf",
          reason: mergeResult.reason,
          details: mergeResult.details,
        };
      }
      return { status: "approved", mergeBranch: mergeResult.branch! };
    }

    if (decision.status === "revise") {
      if (!decision.revisions?.length) {
        lastError = "Reviewer requested revisions but none listed";
        continue;
      }
      const revisionResult = await runRevisionRequests(
        opts,
        decision.revisions,
        agents,
      );
      if (!revisionResult.ok) {
        return {
          status: "dnf",
          reason: revisionResult.reason,
          details: revisionResult.details,
        };
      }
      return { status: "revisions" };
    }

    lastError = `Unknown reviewer status: ${decision.status}`;
  }

  return {
    status: "dnf",
    reason: "Reviewer failed to converge",
    details: lastError,
  };
}

// ────────────────────────────────────────────────────────────────
// Run report generation — structured JSON summary of each run
// ────────────────────────────────────────────────────────────────

interface AgentReport {
  agent: AgentId;
  model: string;
  branch: string;
  status: "success" | "dnf";
  exitCode: number;
  restarts: number;
  reason?: string;
  stats: AgentStats;
  lastError?: string;
  diffSummary?: string;
}

interface RunReport {
  version: string;
  timestamp: string;
  task: string;
  baseBranch: string;
  outcome: "approved" | "dnf";
  mergeBranch?: string;
  durationMs: number;
  rounds: number;
  agents: AgentReport[];
  models: Record<AgentId, string>;
  reviewerAgent: AgentId;
  soloMode?: boolean;
}

function generateRunReport(
  opts: Opts,
  agentResults: Array<{ id: AgentId; result: AgentRunResult }>,
  agents: Record<AgentId, AgentRunner>,
  outcome: "approved" | "dnf",
  startTime: number,
  mergeBranch?: string,
  diffSummaries?: Partial<Record<AgentId, string>>,
  soloMode?: boolean,
): RunReport {
  const agentReports: AgentReport[] = agentResults.map(({ id, result }) => ({
    agent: id,
    model: MODELS[id],
    branch: agents[id].worktree.branch,
    status: result.status,
    exitCode: result.exitCode,
    restarts: result.restarts,
    reason: result.reason,
    stats: agents[id].getStats(),
    lastError: agents[id].getLastError(),
    diffSummary: diffSummaries?.[id],
  }));

  return {
    version: VERSION,
    timestamp: new Date().toISOString(),
    task: opts.task,
    baseBranch: opts.baseBranch,
    outcome,
    mergeBranch,
    durationMs: Date.now() - startTime,
    rounds: opts.rounds,
    agents: agentReports,
    models: { ...MODELS },
    reviewerAgent: opts.reviewerAgent,
    soloMode,
  };
}

async function writeRunReport(repoRoot: string, report: RunReport): Promise<string> {
  const reportsDir = join(repoRoot, ".ai-worktrees", "reports");
  mkdirSync(reportsDir, { recursive: true });
  const filename = `run-${report.timestamp.replace(/[:.]/g, "-")}.json`;
  const filepath = join(reportsDir, filename);
  writeFileSync(filepath, JSON.stringify(report, null, 2) + "\n");
  console.log(C.dim(`Run report saved: ${filepath}`));
  return filepath;
}

async function cleanup(repo: string, works: Worktree[]) {
  console.log(C.gray("Cleaning up worktrees…"));
  for (const w of works) {
    try {
      await git(repo, "worktree", "remove", "--force", w.dir);
    } catch {
      if (existsSync(w.dir)) rmSync(w.dir, { recursive: true, force: true });
    }
  }
  console.log(C.green("Cleanup complete."));
}

function printHelp() {
  console.log(
    `\n${C.b(`🤘 GitGang (${VERSION})`)}\n${C.gray("The gang's all here to code!")}\n${line()}

Usage
  gg "Do this task"
  gitgang "Do this task"
  gitgang --task "Do this task" [--rounds N] [--no-yolo] [--workRoot PATH] [--timeout 25m] [--no-pr] [--dry-run] [--agents gemini,claude,codex] [--reviewer codex] [--check "npm test"]
  gitgang --solo claude "Do this task"

Interactive Mode (new in v1.7.0)
  gg                                Start interactive REPL (no task)
  gg -i                             Same as above
  gg -i "opener"                    Pre-load first turn
  gg -i --automerge on|off|ask      Session-default merge behavior (default: ask)
  gg -i --resume                    Resume most-recent session
  gg -i --resume <id>               Resume specific session

Sessions
  gg sessions list                  List recent sessions
  gg sessions show <id>             Print a session transcript

Defaults
  rounds=3, yolo=true, workRoot=.ai-worktrees, timeout=25m, agents=gemini,claude,codex, reviewer=codex

Solo Mode
  --solo <agent>  Run a single agent without reviewer (skips multi-agent comparison)

Model Overrides (CLI flags take precedence over env vars)
  --model-gemini <model>  Override Gemini model (default: ${DEFAULT_MODELS.gemini})
  --model-claude <model>  Override Claude model (default: ${DEFAULT_MODELS.claude})
  --model-codex  <model>  Override Codex model  (default: ${DEFAULT_MODELS.codex})

Environment Variables
  GITGANG_GEMINI_MODEL  Override Gemini model (default: ${DEFAULT_MODELS.gemini})
  GITGANG_CLAUDE_MODEL  Override Claude model (default: ${DEFAULT_MODELS.claude})
  GITGANG_CODEX_MODEL   Override Codex model  (default: ${DEFAULT_MODELS.codex})

While running
  /status  /agents  /logs <agent>  /nudge <agent> <msg>  /kill <agent>  /help
  @all <message>  @codex|@claude|@gemini <message>
`,
  );
}

async function existingOneShotMain(parsed: ParsedArgs): Promise<number> {
  let { task, rounds, yolo, workRoot, timeoutMs, autoPR, dryRun, activeAgents, reviewerAgent, postMergeChecks, soloMode, modelOverrides } = parsed;
  if (modelOverrides && Object.keys(modelOverrides).length > 0) {
    applyModelOverrides(modelOverrides);
  }
  if (!task) {
    printHelp();
    return 1;
  }

  const repo = await repoRoot();
  const base = await currentBranch(repo);
  await ensureCleanTree(repo);

  let opts: Opts = {
    task,
    repoRoot: repo,
    baseBranch: base,
    workRoot,
    rounds,
    timeoutMs,
    yolo,
    autoPR,
    dryRun,
    activeAgents,
    reviewerAgent,
    postMergeChecks,
    soloMode,
  };

  const runtime = await prepareRuntime(opts);
  opts = { ...opts, autoPR: runtime.autoPR };

  const runStartTime = Date.now();

  if (soloMode) {
    banner(`🤘 GitGang Solo - ${activeAgents[0]} going it alone!`, C.blue);
  } else {
    banner("🤘 GitGang - The gang's all here to code!", C.blue);
  }
  console.log(`${C.gray("Repository:")} ${C.cyan(repo)}`);
  console.log(`${C.gray("Base branch:")} ${C.cyan(base)}`);
  console.log(`${C.gray("Task:")} ${task}`);
  console.log(
    `${C.gray("Rounds:")} ${rounds}  ${C.gray("Auto-merge:")} ${yolo}  ${C.gray("Auto-PR:")} ${opts.autoPR}`,
  );
  console.log(`${C.gray("Agents:")} ${activeAgents.join(", ")}`);
  console.log(`${C.gray("Reviewer:")} ${TAG(reviewerAgent)} ${C.cyan(MODELS[reviewerAgent])}`);
  if (postMergeChecks.length) {
    console.log(`${C.gray("Post-merge checks:")} ${postMergeChecks.join(", ")}`);
  }
  console.log(`${C.gray("Models:")}`);
  for (const id of activeAgents) {
    const isOverride = MODELS[id] !== DEFAULT_MODELS[id];
    const suffix = isOverride ? C.yellow(" (override)") : "";
    console.log(`  ${TAG(id)} ${C.cyan(MODELS[id])}${suffix}`);
  }

  if (dryRun) {
    banner("Dry Run — no agents launched", C.yellow);
    console.log(C.gray("Configuration validated. Exiting without running agents."));
    return 0;
  }

  console.log(
    C.dim("Type /help or @agent/@all <msg> for interactive controls while agents run."),
  );
  if (activeAgents.length < AGENT_IDS.length) {
    const skipped = AGENT_IDS.filter((id) => !activeAgents.includes(id));
    console.log(C.yellow(`Skipping agents: ${skipped.join(", ")}`));
  }

  mkdirSync(resolve(repo, workRoot), { recursive: true });

  // Only create worktrees for active agents
  const worktreeMap: Partial<Record<AgentId, Worktree>> = {};
  for (const id of activeAgents) {
    worktreeMap[id] = await createWorktree(repo, base, id, workRoot);
  }

  const agents: Partial<Record<AgentId, AgentRunner>> = {};
  for (const id of activeAgents) {
    agents[id] = new AgentRunner(id, worktreeMap[id]!, base, opts);
  }

  // Dashboard and command palette need a full record for rendering;
  // provide stubs for inactive agents.
  const agentsForDashboard = agents as Record<AgentId, AgentRunner>;
  const dashboard = startDashboardTicker({ agents: agentsForDashboard, opts });
  const rl = startCommandPalette({
    agents: agentsForDashboard,
    opts,
    refreshDashboard: dashboard.refresh,
  });

  banner("🚀 Starting AI Agents", C.green);
  for (const id of activeAgents) {
    console.log(`${TAG(id)} → ${C.dim(worktreeMap[id]!.branch)}`);
  }
  console.log("");

  const agentEntries = activeAgents.map((id) => [id, agents[id]!] as [AgentId, AgentRunner]);
  const completionMap = new Map<AgentId, AgentRunResult>();
  const agentPromises = agentEntries.map(([id, runner]) =>
    runner.run(task).then((result) => {
      completionMap.set(id, result);
      return { id, result };
    }),
  );

  const globalTimeout = setTimeout(() => {
    console.log(C.yellow(`\n${C.b("Heads up")}: global timeout reached, shutting down agents…`));
    for (const runner of Object.values(agents)) {
      runner.notifyGlobalTimeout();
    }
  }, timeoutMs + GLOBAL_TIMEOUT_GRACE_MS);
  globalTimeout.unref?.();

  // Race agent completion against round timeout to ensure we proceed to reviewer
  let roundTimeoutId: ReturnType<typeof setTimeout> | undefined;
  const roundTimeoutPromise = new Promise<"timeout">((resolve) => {
    roundTimeoutId = setTimeout(() => {
      console.log(
        C.yellow(
          `\n${C.b("Round timeout")}: ${ROUND_COMPLETION_TIMEOUT_MS / 60000} minutes elapsed. Proceeding to reviewer with available results…`,
        ),
      );
      resolve("timeout");
    }, ROUND_COMPLETION_TIMEOUT_MS);
  });

  const raceResult = await Promise.race([Promise.all(agentPromises), roundTimeoutPromise]);
  const roundTimedOut = raceResult === "timeout";
  if (roundTimeoutId) clearTimeout(roundTimeoutId);

  if (roundTimedOut) {
    await new Promise((resolve) => setTimeout(resolve, POST_TIMEOUT_GRACE_MS));
  }

  const agentResults = agentEntries.map(([id, runner]) => {
    const cached = completionMap.get(id);
    if (cached) {
      return { id, result: cached };
    }

    const status = runner.getStatus();
    const reason =
      status === "running"
        ? "Still running when round timeout occurred"
        : "Failed to complete";
    return {
      id,
      result: {
        status: status === "completed" ? "success" : "dnf",
        exitCode: status === "completed" ? 0 : 1,
        restarts: 0,
        reason,
      },
    };
  });
  
  clearTimeout(globalTimeout);

  const failedAgents = agentResults.filter((r) => r.result.status !== "success");
  const successfulAgents = agentResults.filter((r) => r.result.status === "success");
  let finalStatus: "approved" | "dnf" | "pending" = "pending";
  let dnfDetails: string | undefined;
  let dnfReason: string | undefined;
  let mergeBranch: string | undefined;

  if (failedAgents.length) {
    console.log(C.yellow(`\n${C.b("Notice")}: ${failedAgents.length} agent(s) did not complete successfully`));
    for (const entry of failedAgents) {
      console.log(
        C.yellow(
          `  - ${entry.id}: ${entry.result.reason ?? "unknown failure"} (exit ${entry.result.exitCode})`,
        ),
      );
    }
  }

  const successfulAgentIds = successfulAgents.map((a) => a.id);

  if (!successfulAgents.length) {
    finalStatus = "dnf";
    dnfReason = "No agent completed the task";
    dnfDetails = failedAgents
      .map(({ id, result }) => `${id}: ${result.reason ?? "unknown failure"}`)
      .join("; ");
    await recordDNF(opts, dnfReason, dnfDetails);
  } else {
    banner(`Reviewer loop (${reviewerAgent.charAt(0).toUpperCase() + reviewerAgent.slice(1)})`, C.magenta);
    if (successfulAgentIds.length < activeAgents.length) {
      console.log(C.yellow(`Reviewing with ${successfulAgentIds.length}/${activeAgents.length} successful agents: ${successfulAgentIds.join(", ")}`));
    }
    for (let r = 1; r <= Math.max(1, rounds); r++) {
      console.log(C.cyan(`Round ${r}`));
      const statusSummary = buildStatusSummary(agents as Record<AgentId, AgentStatusSource>);
      const summaryBlock = `- ${statusSummary}`;
      const outcome = await doReview(opts, agents, summaryBlock, successfulAgentIds);
      if (outcome.status === "approved") {
        mergeBranch = outcome.mergeBranch;
        finalStatus = "approved";
        break;
      }
      if (outcome.status === "dnf") {
        finalStatus = "dnf";
        dnfReason = outcome.reason;
        dnfDetails = outcome.details;
        await recordDNF(opts, dnfReason, dnfDetails);
        break;
      }
      console.log(C.gray("Reviewer requested revisions. Continuing…"));
    }

    if (finalStatus === "pending") {
      finalStatus = "dnf";
      dnfReason = "Reviewer did not approve within allotted rounds";
      await recordDNF(opts, dnfReason);
    }
  }

  rl.close();
  dashboard.stop();

  // Generate and persist run report
  try {
    const report = generateRunReport(
      opts,
      agentResults,
      agents as Record<AgentId, AgentRunner>,
      finalStatus === "approved" ? "approved" : "dnf",
      runStartTime,
      mergeBranch,
    );
    await writeRunReport(repo, report);
  } catch (err) {
    console.log(C.dim(`Failed to write run report: ${err instanceof Error ? err.message : err}`));
  }

  const allWorktrees = activeAgents.map((id) => worktreeMap[id]!);
  await cleanup(repo, allWorktrees);

  if (finalStatus === "approved") {
    banner("All done", C.green);
    console.log(C.green(`Approved. Merge branch ready: ${mergeBranch}`));
    if (opts.autoPR && mergeBranch) {
      // Push the merge branch to remote for manual PR creation
      try {
        await git(opts.repoRoot, "push", "-u", "origin", mergeBranch);
        console.log(C.green(`Branch pushed to origin. Create a PR when ready:`));
        console.log(C.cyan(`  gh pr create --base ${opts.baseBranch} --head ${mergeBranch}`));
      } catch (err) {
        console.log(C.yellow(`Failed to push branch: ${err instanceof Error ? err.message : err}`));
        console.log(C.gray(`You can push manually: git push -u origin ${mergeBranch}`));
      }
    }
  } else {
    banner("DNF", C.red);
    if (dnfReason) {
      console.log(C.red(`Run ended without completion: ${dnfReason}`));
      if (dnfDetails) console.log(C.dim(dnfDetails));
    }
  }

  return finalStatus === "approved" ? 0 : 1;
}

export async function dispatchMain(parsed: ParsedArgs): Promise<number> {
  if (parsed.subcommand?.kind === "sessions_list") {
    return runSessionsList();
  }
  if (parsed.subcommand?.kind === "sessions_show") {
    return runSessionsShow(parsed.subcommand.id);
  }
  if (parsed.subcommand?.kind === "sessions_export") {
    return runSessionsExport(parsed.subcommand.id, parsed.subcommand.outputPath);
  }
  if (parsed.interactive) {
    return runInteractive(parsed);
  }
  return existingOneShotMain(parsed);
}

async function runInteractive(parsed: ParsedArgs): Promise<number> {
  const repo = await repoRoot();
  try {
    await ensureCleanTree(repo);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.stderr.write("Commit or stash changes before starting an interactive session.\n");
    return 1;
  }
  const baseBranch = await currentBranch(repo);
  const sessionsRoot = resolve(repo, ".gitgang", "sessions");
  mkdirSync(sessionsRoot, { recursive: true });
  const models = resolveModels();

  let session: LoadedSession;
  if (parsed.resume?.mode === "latest") {
    session = loadSession(mostRecentSessionDir(sessionsRoot));
  } else if (parsed.resume?.mode === "id") {
    session = loadSession(join(sessionsRoot, parsed.resume.id));
  } else {
    const created = createSession(sessionsRoot, {
      models,
      reviewer: parsed.reviewerAgent ?? "codex",
      automerge: parsed.automerge ?? "ask",
    });
    session = loadSession(created.dir);
  }

  cleanOrphanedWorktrees(session.worktreesDir, process.stderr);

  const fanOut = createRealFanOut({
    agentIds: parsed.activeAgents?.length ? parsed.activeAgents : ["gemini", "claude", "codex"],
    models,
    yolo: parsed.yolo ?? true,
    timeoutMs: parsed.timeoutMs ?? 10 * 60 * 1000,
    repoRoot: repo,
    logsDir: join(session.dir, "logs"),
  });
  const spawnOrchestrator = createRealOrchestrator({
    model: models.claude,
    yolo: parsed.yolo ?? true,
    timeoutMs: 15 * 60 * 1000,
    repoRoot: repo,
    debugDir: session.debugDir,
  });

  const executeTurnDeps: ExecuteTurnDeps = {
    session,
    repoRoot: repo,
    base: baseBranch,
    output: process.stdout,
    mergeInput: process.stdin,
    fanOut,
    spawnOrchestrator,
    applyMerge: async (plan) => {
      try {
        await applyInteractiveMergePlan(repo, baseBranch, plan);
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

  // Ctrl+C handler: first press cancels current turn (kills subprocesses);
  // a second press within 3s exits. Outside a turn, the same 2-press pattern
  // exits. Installed once per interactive session.
  let pendingExit = false;
  let pendingExitTimer: ReturnType<typeof setTimeout> | null = null;
  const armPendingExit = () => {
    pendingExit = true;
    if (pendingExitTimer) clearTimeout(pendingExitTimer);
    pendingExitTimer = setTimeout(() => {
      pendingExit = false;
      pendingExitTimer = null;
    }, 3000);
  };
  const sigintHandler = () => {
    if (pendingExit) {
      process.stdout.write("\nExiting.\n");
      process.exit(130);
    }
    if (activeChildCount() > 0) {
      const killed = cancelActiveChildren();
      process.stdout.write(
        `\n⚠ Turn cancelled. Signalled ${killed} subprocess(es). Press Ctrl+C again within 3s to exit.\n`,
      );
    } else {
      process.stdout.write("\n(Press Ctrl+C again within 3s to exit.)\n");
    }
    armPendingExit();
  };
  process.on("SIGINT", sigintHandler);

  if (parsed.opener && parsed.opener.trim().length > 0) {
    await executeTurn(parsed.opener, null, executeTurnDeps);
  }

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
        `Agents: ${Object.entries(models).map(([a, m]) => `${a}=${m}`).join(", ")}\n`,
      );
    },
    showHelp: async () => {
      process.stdout.write(
        [
          "Commands:",
          "  /ask <msg>   force question mode",
          "  /code <msg>  force code mode",
          "  /merge        apply last turn's merge plan",
          "  /pr           open PR for last merge",
          "  /diff [agent] show diff vs base for picked or named agent's branch",
          "  /history      show transcript",
          "  /agents       show agent roster",
          "  /set K V      set a runtime knob",
          "  /help         this message",
          "  /quit         exit",
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
      const pending = findPendingMergePlan(session.events);
      if (!pending) {
        process.stdout.write(
          "No pending merge plan to apply. Use /code to request a merge first.\n",
        );
        return;
      }
      process.stdout.write(
        `Applying pending plan from turn ${pending.turn} (pick: ${pending.plan.pick})...\n`,
      );
      try {
        await applyInteractiveMergePlan(repo, baseBranch, pending.plan);
        const mergeEvent: SessionEvent = {
          ts: new Date().toISOString(),
          turn: pending.turn,
          type: "merge",
          branch: pending.plan.branches[0] ?? "",
          outcome: "merged",
        };
        appendEvent(session.logPath, mergeEvent);
        session.events.push(mergeEvent);
        process.stdout.write(`✓ Merged ${pending.plan.branches.join(", ")}.\n`);
      } catch (err) {
        process.stdout.write(
          `✗ Merge failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    },
    runPrCommand: async () => {
      const merged = findLastMergedBranch(session.events);
      if (!merged) {
        process.stdout.write(
          "No merged branch in this session. Use /merge (or approve a merge prompt) first.\n",
        );
        return;
      }
      try {
        const branch = await currentBranch(repo);
        process.stdout.write(`Pushing ${branch} and opening PR...\n`);
        await git(repo, "push", "-u", "origin", branch);

        // Build a structured PR body from the session log instead of relying
        // on `gh pr create --fill`'s git-log-based generic body.
        const { title, body } = formatPrContent(session.events, {
          mergedBranch: merged,
          sessionId: session.id,
          gitgangVersion: VERSION,
        });
        const bodyFile = join(session.debugDir, "pr-body.md");
        writeFileSync(bodyFile, body);

        const ghProc = spawnProcess(
          ["gh", "pr", "create", "--title", title, "--body-file", bodyFile],
          { cwd: repo },
        );
        const exitCode = await (ghProc as SpawnedProcess).exited;
        if (exitCode !== 0) {
          process.stdout.write(
            `✗ gh pr create exited with code ${exitCode}. Is the gh CLI installed and authenticated?\n`,
          );
        } else {
          const prMarkerEvent: SessionEvent = {
            ts: new Date().toISOString(),
            turn: 0,
            type: "merge",
            branch: merged,
            outcome: "pr_only",
          };
          appendEvent(session.logPath, prMarkerEvent);
          session.events.push(prMarkerEvent);
          process.stdout.write("✓ PR created.\n");
        }
      } catch (err) {
        process.stdout.write(
          `✗ PR creation failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    },
    runDiffCommand: async (target) => {
      let branch: string | null;
      let label: string;
      if (target === "picked") {
        branch = findLastPickedBranch(session.events);
        label = "reviewer-picked branch";
      } else {
        branch = findLastAgentBranch(session.events, target);
        label = `${target}'s branch`;
      }
      if (!branch) {
        process.stdout.write(
          target === "picked"
            ? "No merge plan has been proposed yet. Run a /code turn first.\n"
            : `No branch recorded for ${target} yet. Run a turn first.\n`,
        );
        return;
      }
      try {
        const diff = await git(repo, "diff", `${baseBranch}...${branch}`);
        if (!diff.trim()) {
          process.stdout.write(
            `(${label} ${branch} has no diff vs ${baseBranch})\n`,
          );
        } else {
          process.stdout.write(
            `── diff ${baseBranch}...${branch} (${label}) ──\n${diff}\n`,
          );
        }
      } catch (err) {
        process.stdout.write(
          `✗ git diff failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    },
  });

  // Clean REPL exit (e.g., /quit) — detach the SIGINT handler so the caller
  // can process.exit(0) normally.
  process.off("SIGINT", sigintHandler);
  if (pendingExitTimer) clearTimeout(pendingExitTimer);

  return 0;
}

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
    lines.push(
      `${s.id.padEnd(38)}  ${s.startedAt.padEnd(20)}  ${String(s.turns).padStart(5)}  ${s.reviewer}`,
    );
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
      const log = existsSync(join(dir, "session.jsonl"))
        ? readFileSync(join(dir, "session.jsonl"), "utf8")
        : "";
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

function runSessionsExport(id: string, outputPath?: string): number {
  const dir = resolve(".gitgang", "sessions", id);
  if (!existsSync(dir)) {
    process.stderr.write(`Session ${id} not found.\n`);
    return 1;
  }
  const loaded = loadSession(dir);
  const markdown = formatSessionExport(loaded.events, loaded.metadata);
  if (outputPath) {
    writeFileSync(outputPath, markdown);
    process.stdout.write(`Wrote ${markdown.length} bytes to ${outputPath}\n`);
  } else {
    process.stdout.write(markdown);
  }
  return 0;
}

/**
 * Clean up any turn-N/ subdirs left behind by a crashed prior session.
 * Called at interactive session start. Best-effort — failures are logged
 * but do not abort startup.
 */
export function cleanOrphanedWorktrees(
  worktreesDir: string,
  stderr: NodeJS.WritableStream,
): number {
  if (!existsSync(worktreesDir)) return 0;
  const turnDirs = readdirSync(worktreesDir).filter((name) => name.startsWith("turn-"));
  if (turnDirs.length === 0) return 0;
  let cleaned = 0;
  for (const name of turnDirs) {
    const path = join(worktreesDir, name);
    try {
      rmSync(path, { recursive: true, force: true });
      cleaned++;
    } catch (err) {
      stderr.write(
        `⚠ could not remove orphaned worktree ${path}: ${(err as Error).message}\n`,
      );
    }
  }
  if (cleaned > 0) {
    stderr.write(
      `ℹ cleaned up ${cleaned} orphaned turn worktree${cleaned === 1 ? "" : "s"} from prior session\n`,
    );
  }
  return cleaned;
}

function mostRecentSessionDir(root: string): string {
  if (!existsSync(root)) throw new Error("no sessions exist yet");
  const entries = readdirSync(root)
    .map((name) => ({ name, path: join(root, name), mtime: statSync(join(root, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (entries.length === 0) throw new Error("no sessions found");
  return entries[0].path;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(VERSION);
    return 0;
  }
  const parsed = parseArgs(argv);
  return dispatchMain(parsed);
}

let isDirectRun = false;
if (process.argv[1]) {
  try {
    const resolvedArg = pathToFileURL(realpathSync(process.argv[1])).href;
    isDirectRun = resolvedArg === import.meta.url;
  } catch {
    isDirectRun = false;
  }
}

if (isDirectRun) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error(C.red(String(err?.stack || err)));
      process.exit(1);
    });
}

export {
  VERSION,
  MODELS,
  DEFAULT_MODELS,
  AGENT_IDS,
  resolveModels,
  C,
  TAG,
  line,
  box,
  banner,
  parseArgs,
  parseAgentsList,
  parseReviewerAgent,
  parseDuration,
  parseFirstJson,
  spawnProcess,
  createWorktree,
  systemConstraints,
  featurePrompt,
  reviewerPromptJSON,
  ensureDependencies,
  applyMergePlan,
  recordDNF,
  parseStreamLine,
  shouldDisplayLine,
  formatMessage,
  generateRunReport,
  writeRunReport,
};
export { isAgentId };
export type { AgentId, Opts, ReviewerDecision, AgentRunResult, RunReport, AgentReport, AgentStats, ParsedArgs };
