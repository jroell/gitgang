// GitGang - The gang's all here to code!
// Hardened orchestration CLI for autonomous multi-agent development.

import { spawn } from "bun";
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import * as readline from "node:readline";
import chalk from "chalk";
import ora from "ora";
import { renderSidebar } from "./sidebar.js";

declare const Bun: {
  spawn: typeof spawn;
  argv: string[];
};

const VERSION = "1.4.7";
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
const REVIEWER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes timeout for reviewer process
const DEFAULT_POST_MERGE_CHECKS = ["bun test"];
const GLOBAL_TIMEOUT_GRACE_MS = 15_000;

const supportsColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
chalk.level = supportsColor ? (process.env.COLORTERM === "truecolor" ? 3 : 2) : 0;

const textEncoder = new TextEncoder();

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
}

interface Worktree {
  agent: AgentId;
  branch: string;
  dir: string;
  log: string;
}

interface ProcWrap {
  proc: ReturnType<typeof spawn>;
  log: string;
  stdinWriter?: WritableStreamDefaultWriter<Uint8Array>;
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

const MODELS = {
  gemini: "gemini-2.5-pro",
  claude: "claude-sonnet-4-5",
  codex: "gpt-5-codex",
} as const;

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
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
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
  const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
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
  return [
    "You are an autonomous senior engineer with full authorization to edit files, run shell commands, install dependencies, and run tests.",
    "Do not ask for permission. Decide and proceed.",
    "Work in small, verifiable steps and commit early with clear messages.",
    "Add or update tests to cover the change.",
    "If something fails, debug and keep going until complete.",
    "If a tool such as bun is unavailable, immediately fallback to 'npx bun …' so progress continues.",
    "Prefer editing files with apply_patch or here-doc writes; the 'replace' tool can fail when paths include extra whitespace.",
    "At the end, summarize what changed and any follow ups.",
  ].join("\n");
}

function featurePrompt(agent: AgentId, base: string, task: string) {
  return `Task: ${task}

Base branch: ${base}
You are in a dedicated git worktree and branch for ${agent}.
Objectives:
1) Implement the feature to production quality.
2) Add or update tests.
3) Update docs if needed.
4) Commit early and often with clear messages.
5) Ensure the project builds and tests pass.
Rules:
- You have full authorization to modify files and run commands in this workspace.
- Do not prompt for confirmation.
- If blocked, propose a plan, then execute it.
- Keep going until done.`;
}

function reviewerPromptJSON(
  base: string,
  branches: { gemini: string; claude: string; codex: string },
  task: string,
  statusSummary?: string,
) {
  return `You are the final reviewer. Compare these branches against ${base}:
- ${branches.gemini}
- ${branches.claude}
- ${branches.codex}

Task: ${task}

Goal: Pick the best parts from each and integrate into a new merge branch off ${base}. If none are satisfactory, produce concrete fix instructions per agent and keep the loop going.

Status summary:
${statusSummary || "- gemini: pending\n- claude: pending\n- codex: pending"}

Output JSON only with this schema:
{
  "status": "approve" | "revise",
  "mergePlan": { "order": ["branchName", ...], "notes": "why this order", "postMergeChecks": ["command", ...] },
  "revisions": [{ "agent": "gemini" | "claude" | "codex", "instructions": "actionable steps" }]
}`;
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
  stream: ReadableStream<Uint8Array>,
  callbacks: StreamCallbacks = {},
) {
  const dec = new TextDecoder();
  let buffer = "";

  (async () => {
    try {
      for await (const chunk of stream) {
        const text = dec.decode(chunk, { stream: true });
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
  // Use positional prompt argument (--prompt is deprecated)
  const args = ["-m", MODELS.gemini, "--output-format", "json"];
  if (yolo) args.push("--yolo");
  args.push(prompt);
  const proc = spawn(["gemini", ...args], {
    cwd: w.dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  if (!proc.stdout || !proc.stderr) {
    throw new Error("Failed to get stdout/stderr from gemini process");
  }
  const stdinWriter = proc.stdin?.getWriter?.();
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
  // Wrap in bash to pipe prompt file to claude (works around Bun spawn issues)
  const bashCmd = `cat "${promptFile}" | claude ${args.join(" ")}`;
  const proc = spawn(["bash", "-c", bashCmd], {
    cwd: w.dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  if (!proc.stdout || !proc.stderr) {
    throw new Error("Failed to get stdout/stderr from claude process");
  }
  const stdinWriter = proc.stdin?.getWriter?.();
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
    'model_reasoning_effort="high"',
  ];
  args.push(yolo ? "--yolo" : "--full-auto");
  const proc = spawn(["codex", ...args], {
    cwd: w.dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  if (!proc.stdout || !proc.stderr) {
    throw new Error("Failed to get stdout/stderr from codex process");
  }
  const stdinWriter = proc.stdin?.getWriter?.();
  streamToLog(TAG("codex"), w.log, C.green, proc.stdout!, callbacks);
  streamToLog(TAG("codex"), w.log, C.green, proc.stderr!, callbacks);
  return { proc, log: w.log, stdinWriter };
}

interface ReviewerSpawnConfig {
  args: string[];
  options: Parameters<typeof spawn>[1];
}

export function reviewerSpawnConfig(
  cwd: string,
  base: string,
  branches: { gemini: string; claude: string; codex: string },
  task: string,
  yolo: boolean,
  statusSummary?: string,
): ReviewerSpawnConfig {
  const prompt = reviewerPromptJSON(base, branches, task, statusSummary);
  const args = [
    "exec",
    prompt,
    "--model",
    MODELS.codex,
    "--config",
    'model_reasoning_effort="high"',
  ];
  args.push(yolo ? "--yolo" : "--full-auto");
  const options: Parameters<typeof spawn>[1] = {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  };
  return { args, options };
}

async function runCodexReviewer(
  cwd: string,
  base: string,
  branches: { gemini: string; claude: string; codex: string },
  task: string,
  yolo: boolean,
  statusSummary?: string,
) {
  const { args, options } = reviewerSpawnConfig(cwd, base, branches, task, yolo, statusSummary);
  return spawn(["codex", ...args], options);
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

async function ensureDependencies(autoPR: boolean) {
  const missing: string[] = [];

  for (const bin of REQUIRED_BINARIES) {
    const proc = Bun.spawn(["which", bin], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    if (proc.exitCode !== 0) {
      missing.push(bin);
    }
  }

  if (missing.length) {
    throw new Error(
      `Missing required CLI tool(s): ${missing.join(", ")}. Ensure they are installed and on PATH.`,
    );
  }

  if (autoPR) {
    const ghProc = Bun.spawn(["which", "gh"], { stdout: "pipe", stderr: "pipe" });
    await ghProc.exited;
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

async function ensureBunShim(repoRoot: string, workRoot: string) {
  const check = Bun.spawn(["which", "bun"], { stdout: "pipe", stderr: "pipe" });
  await check.exited;
  if (check.exitCode === 0) return undefined;

  const shimDir = resolve(repoRoot, workRoot, ".bin");
  mkdirSync(shimDir, { recursive: true });
  const shimPath = join(shimDir, "bun");
  if (!existsSync(shimPath)) {
    const shim = `#!/usr/bin/env bash\nset -euo pipefail\nif command -v bun >/dev/null 2>&1; then\n  exec bun "$@"\nfi\nexec npx --yes bun "$@"\n`;
    writeFileSync(shimPath, shim);
    try {
      chmodSync(shimPath, 0o755);
    } catch {
      // Ignore chmod failures on restrictive filesystems
    }
  }
  return shimDir;
}

async function prepareRuntime(opts: Opts) {
  const depResult = await ensureDependencies(opts.autoPR);
  const shimPath = await ensureBunShim(opts.repoRoot, opts.workRoot);
  return { autoPR: depResult.autoPR, shimPath };
}

function parseArgs(raw: string[]) {
  let task: string | undefined;
  let rounds = 3;
  let yolo = true;
  let workRoot = ".ai-worktrees";
  let timeoutMs = 25 * 60 * 1000;
  let autoPR = true;

  const bool = (v?: string) =>
    ["1", "true", "yes", "on"].includes((v || "").toLowerCase());

  for (let i = 0; i < raw.length; i++) {
    const token = raw[i];
    switch (token) {
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
      case "--no-pr":
        autoPR = false;
        break;
      default:
        if (!token.startsWith("-") && task === undefined) {
          task = token;
        }
        break;
    }
  }

  return normalizeParsedArgs({ task, rounds, yolo, workRoot, timeoutMs, autoPR });
}

interface ParsedArgs {
  task?: string;
  rounds: number;
  yolo: boolean;
  workRoot: string;
  timeoutMs: number;
  autoPR: boolean;
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
  };
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
  private proc?: ReturnType<typeof spawn>;
  private stdinWriter?: WritableStreamDefaultWriter<Uint8Array>;
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
        .then((exitCode) => this.handleExit(exitCode ?? wrap.proc.exitCode ?? 0))
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
      writer.close().catch(() => {
        /* ignore */
      });
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
    if (!this.stdinWriter) return false;
    try {
      await this.stdinWriter.write(textEncoder.encode(`\nProxy: ${message}\n`));
      return true;
    } catch {
      return false;
    }
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
  const proc = Bun.spawn(["bash", "-lc", cmd], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
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
  worktrees: Record<AgentId, Worktree>,
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

  const order =
    decision.mergePlan?.order && decision.mergePlan.order.length
      ? decision.mergePlan.order
      : [worktrees.gemini.branch, worktrees.claude.branch, worktrees.codex.branch];

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
  agents: Record<AgentId, AgentRunner>,
  statusSummary: string,
): Promise<
  | { status: "approved"; mergeBranch: string }
  | { status: "revisions" }
  | { status: "dnf"; reason: string; details?: string }
> {
  await git(opts.repoRoot, "checkout", opts.baseBranch);

  let lastError: string | undefined;

  for (let attempt = 1; attempt <= REVIEWER_MAX_RETRIES; attempt++) {
    console.log(C.gray(`Starting reviewer attempt ${attempt}/${REVIEWER_MAX_RETRIES}...`));

    const proc = await runCodexReviewer(
      opts.repoRoot,
      opts.baseBranch,
      {
        gemini: agents.gemini.worktree.branch,
        claude: agents.claude.worktree.branch,
        codex: agents.codex.worktree.branch,
      },
      opts.task,
      opts.yolo,
      statusSummary,
    );

    console.log(C.gray(`Reviewer process started, waiting for response (timeout: ${REVIEWER_TIMEOUT_MS / 1000}s)...`));

    // Add timeout to prevent hanging forever
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Reviewer timeout")), REVIEWER_TIMEOUT_MS);
    });

    let stdout: string;
    let stderr: string;
    let exitCode: number;

    try {
      // Read streams and wait for exit in parallel with timeout
      [stdout, stderr, exitCode] = await Promise.race([
        Promise.all([
          new Response(proc.stdout!).text(),
          new Response(proc.stderr!).text(),
          proc.exited,
        ]),
        timeoutPromise,
      ]);
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
      const mergeResult = await applyMergePlan(opts, {
        gemini: agents.gemini.worktree,
        claude: agents.claude.worktree,
        codex: agents.codex.worktree,
      }, decision);
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
  gitgang --task "Do this task" [--rounds N] [--no-yolo] [--workRoot PATH] [--timeoutMs MS] [--no-pr]

Defaults
  rounds=3, yolo=true, workRoot=.ai-worktrees, timeoutMs=1500000 (25m)

While running
  /status  /agents  /logs <agent>  /nudge <agent> <msg>  /kill <agent>  /help
  @all <message>  @codex|@claude|@gemini <message>
`,
  );
}

async function main() {
  const argv = Bun.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(VERSION);
    return;
  }

  let { task, rounds, yolo, workRoot, timeoutMs, autoPR } = parseArgs(argv);
  if (!task) {
    printHelp();
    process.exit(1);
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
  };

  const runtime = await prepareRuntime(opts);
  opts = { ...opts, autoPR: runtime.autoPR };
  if (runtime.shimPath) {
    const currentPath = process.env.PATH || "";
    if (!currentPath.split(":").includes(runtime.shimPath)) {
      process.env.PATH = `${runtime.shimPath}:${currentPath}`;
    }
    console.log(C.yellow("bun not found – using npx bun shim for agent runs."));
  }

  banner("🤘 GitGang - The gang's all here to code!", C.blue);
  console.log(`${C.gray("Repository:")} ${C.cyan(repo)}`);
  console.log(`${C.gray("Base branch:")} ${C.cyan(base)}`);
  console.log(`${C.gray("Task:")} ${task}`);
  console.log(
    `${C.gray("Rounds:")} ${rounds}  ${C.gray("Auto-merge:")} ${yolo}  ${C.gray("Auto-PR:")} ${opts.autoPR}`,
  );
  console.log(
    C.dim("Type /help or @agent/@all <msg> for interactive controls while agents run."),
  );

  mkdirSync(resolve(repo, workRoot), { recursive: true });
  const wGem = await createWorktree(repo, base, "gemini", workRoot);
  const wCla = await createWorktree(repo, base, "claude", workRoot);
  const wCdx = await createWorktree(repo, base, "codex", workRoot);

  const agents: Record<AgentId, AgentRunner> = {
    gemini: new AgentRunner("gemini", wGem, base, opts),
    claude: new AgentRunner("claude", wCla, base, opts),
    codex: new AgentRunner("codex", wCdx, base, opts),
  };

  const dashboard = startDashboardTicker({ agents, opts });
  const rl = startCommandPalette({
    agents,
    opts,
    refreshDashboard: dashboard.refresh,
  });

  banner("🚀 Starting AI Agents", C.green);
  console.log(`${TAG("gemini")} → ${C.dim(wGem.branch)}`);
  console.log(`${TAG("claude")} → ${C.dim(wCla.branch)}`);
  console.log(`${TAG("codex")} → ${C.dim(wCdx.branch)}`);
  console.log("");

  const agentEntries = Object.entries(agents) as Array<[AgentId, AgentRunner]>;
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

  if (!successfulAgents.length) {
    finalStatus = "dnf";
    dnfReason = "No agent completed the task";
    dnfDetails = failedAgents
      .map(({ id, result }) => `${id}: ${result.reason ?? "unknown failure"}`)
      .join("; ");
    await recordDNF(opts, dnfReason, dnfDetails);
  } else {
    banner("Reviewer loop (Codex)", C.magenta);
    for (let r = 1; r <= Math.max(1, rounds); r++) {
      console.log(C.cyan(`Round ${r}`));
      const statusSummary = buildStatusSummary(agents);
      const summaryBlock = `- ${statusSummary}`;
      const outcome = await doReview(opts, agents, summaryBlock);
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
  
  await cleanup(repo, [wGem, wCla, wCdx]);

  if (finalStatus === "approved") {
    banner("All done", C.green);
    console.log(C.green(`Approved. Merge branch ready: ${mergeBranch}`));
    if (opts.autoPR && mergeBranch) {
      try {
        const proc = Bun.spawn(
          ["gh", "pr", "create", "--fill", "--base", opts.baseBranch, "--head", mergeBranch],
          { cwd: opts.repoRoot, stdout: "pipe", stderr: "pipe" },
        );
        await proc.exited;
        if (proc.exitCode === 0) {
          console.log(C.green("PR created."));
        } else {
          console.log(C.yellow("GitHub CLI failed – skipping PR."));
        }
      } catch {
        console.log(C.yellow("GitHub CLI failed – skipping PR."));
      }
    }
  } else {
    banner("DNF", C.red);
    if (dnfReason) {
      console.log(C.red(`Run ended without completion: ${dnfReason}`));
      if (dnfDetails) console.log(C.dim(dnfDetails));
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(C.red(String(err?.stack || err)));
    process.exit(1);
  });
}

export {
  VERSION,
  C,
  TAG,
  line,
  box,
  banner,
  parseArgs,
  parseFirstJson,
  systemConstraints,
  featurePrompt,
  reviewerPromptJSON,
  ensureDependencies,
  applyMergePlan,
  recordDNF,
  parseStreamLine,
  shouldDisplayLine,
  formatMessage,
};
export type { AgentId, Opts, ReviewerDecision, AgentRunResult };
