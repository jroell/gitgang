import type { AgentId } from "./cli";
import { systemConstraints, featurePrompt } from "./cli";
import type { HistoryItem } from "./orchestrator";

export type BuildTurnPromptParams = {
  agent: AgentId;
  base: string;
  userMessage: string;
  history: HistoryItem[];
};

export function buildTurnPrompt(params: BuildTurnPromptParams): string {
  const parts: string[] = [systemConstraints(params.agent)];

  if (params.history.length > 0) {
    parts.push("");
    parts.push("CONVERSATION HISTORY:");
    for (const h of params.history) {
      parts.push(`[Turn ${h.turn}] user: ${h.user}`);
      parts.push(`[Turn ${h.turn}] assistant: ${h.assistant}`);
    }
  }

  parts.push("");
  parts.push("CURRENT TURN:");
  parts.push(featurePrompt(params.agent, params.base, params.userMessage));
  parts.push("");
  parts.push(
    "NOTE: You may answer in text only, or commit code changes to this worktree. " +
      "A text answer is always expected. Diffs are optional and the orchestrator " +
      "will decide whether to merge them.",
  );

  return parts.join("\n");
}
