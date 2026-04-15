import { createInterface } from "node:readline";
import type { ForcedMode } from "./slash";
import { parseSlashCommand } from "./slash";
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

  const historyBytes = estimateHistoryBytes(history, userMessage, output);
  if (historyBytes > LONG_HISTORY_WARN_BYTES) {
    const kb = Math.round(historyBytes / 1024);
    deps.output.write(
      `ℹ History is getting long (~${kb}k). Consider /quit and starting fresh.\n`,
    );
  }

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
    } else {
      // automerge === "off" → no prompt, no apply, but tell the user
      deps.output.write("Branches retained. Use /merge to apply the plan.\n");
    }
  }

  await deps.cleanupWorktrees(turn);
}

function currentTurnNumber(session: LoadedSession): number {
  let max = 0;
  for (const e of session.events) if (e.turn > max) max = e.turn;
  return max;
}

export const LONG_HISTORY_WARN_BYTES = 50 * 1024;

export function estimateHistoryBytes(
  history: Array<{ turn: number; user: string; assistant: string }>,
  currentUserMessage: string,
  currentOrchestratorOutput: OrchestratorOutput,
): number {
  let bytes = Buffer.byteLength(currentUserMessage, "utf8");
  bytes += Buffer.byteLength(currentOrchestratorOutput.bestAnswer, "utf8");
  for (const h of history) {
    bytes += Buffer.byteLength(h.user, "utf8");
    bytes += Buffer.byteLength(h.assistant, "utf8");
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Real (subprocess-spawning) factories for fanOut and spawnOrchestrator
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { AgentId } from "./cli";
import { createWorktree, spawnProcess } from "./cli";
import { buildTurnPrompt } from "./turn";
import { orchestratorSpawnConfig, parseOrchestratorOutput } from "./orchestrator";

async function readStream(stream?: Readable | null): Promise<string> {
  if (!stream) return "";
  return new Promise((resolve, reject) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      data += chunk;
    });
    stream.on("error", (err: Error) => reject(err));
    stream.on("end", () => resolve(data));
  });
}

export type RealFanOutConfig = {
  agentIds: AgentId[];
  models: Record<AgentId, string>;
  yolo: boolean;
  timeoutMs: number;
  repoRoot: string;
};

export function createRealFanOut(cfg: RealFanOutConfig): ExecuteTurnDeps["fanOut"] {
  return async ({ turn, userMessage, history, worktreesDir, base }) => {
    mkdirSync(worktreesDir, { recursive: true });
    const rootFolder = join(worktreesDir, `turn-${turn}`);
    mkdirSync(rootFolder, { recursive: true });

    const results: AgentResult[] = await Promise.all(
      cfg.agentIds.map(async (agent): Promise<AgentResult> => {
        let branch = `agents/${agent}/turn-${turn}`;
        try {
          const wt = await createWorktree(cfg.repoRoot, base, agent, rootFolder);
          branch = wt.branch;

          const prompt = buildTurnPrompt({ agent, base, userMessage, history });
          const promptFile = join(wt.dir, ".gitgang-prompt.txt");
          writeFileSync(promptFile, prompt);

          const [command, ...args] = agentCommandFor(agent, cfg.models[agent], cfg.yolo);
          const bashCmd = `cat ${JSON.stringify(promptFile)} | ${command} ${args
            .map((a) => JSON.stringify(a))
            .join(" ")}`;
          const proc = spawnProcess(["bash", "-c", bashCmd], { cwd: wt.dir });

          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            try {
              proc.kill("SIGTERM");
            } catch {
              // best effort
            }
          }, cfg.timeoutMs);

          const [stdout, , code] = await Promise.all([
            readStream(proc.stdout),
            readStream(proc.stderr),
            proc.exited,
          ]);
          clearTimeout(timer);

          const diffSummary = await gitDiffStat(wt.dir, base);
          const diffPaths = diffSummary
            ? diffSummary
                .split("\n")
                .filter(Boolean)
                .map((l) => l.split("|")[0].trim())
                .filter((p) => p && !p.startsWith(" "))
            : [];

          const status: AgentResult["status"] = timedOut
            ? "timeout"
            : code === 0
              ? "ok"
              : "failed";

          return {
            id: agent,
            model: cfg.models[agent],
            status,
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
      return [
        "codex",
        "exec",
        "--model",
        model,
        ...(yolo ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
      ];
  }
}

async function gitDiffStat(worktreeDir: string, base: string): Promise<string> {
  try {
    const proc = spawnProcess(["git", "diff", "--stat", `${base}..HEAD`], {
      cwd: worktreeDir,
    });
    const [stdout] = await Promise.all([
      readStream(proc.stdout),
      readStream(proc.stderr),
      proc.exited,
    ]);
    return stdout.trim();
  } catch {
    return "";
  }
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

    mkdirSync(cfg.debugDir, { recursive: true });
    const turnTag = String(input.turn).padStart(3, "0");
    const inputFile = join(cfg.debugDir, `turn-${turnTag}-input.json`);
    writeFileSync(inputFile, JSON.stringify(input, null, 2));

    const proc = spawnProcess([command, ...args], { cwd: cfg.repoRoot });

    try {
      proc.stdin?.write(stdin);
      proc.stdin?.end();
    } catch {
      // best effort
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        // best effort
      }
    }, cfg.timeoutMs);

    const [stdout, , code] = await Promise.all([
      readStream(proc.stdout),
      readStream(proc.stderr),
      proc.exited,
    ]);
    clearTimeout(timer);

    const outputFile = join(cfg.debugDir, `turn-${turnTag}-output.txt`);
    writeFileSync(outputFile, stdout);

    if (timedOut) {
      throw new Error(`orchestrator timed out after ${cfg.timeoutMs}ms`);
    }
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
