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
