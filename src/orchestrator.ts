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
