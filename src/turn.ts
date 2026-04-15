import type { AgentId } from "./cli";
import { systemConstraints, featurePrompt } from "./cli";
import type { HistoryItem } from "./orchestrator";

export type BuildTurnPromptParams = {
  agent: AgentId;
  base: string;
  userMessage: string;
  history: HistoryItem[];
  /**
   * When true, the agent is operating in a non-git directory where concurrent
   * writes from three parallel agents would collide and there's no worktree
   * to merge later. The prompt is prefixed with an explicit read-only
   * directive so the agent answers in text only and never edits files.
   */
  readOnly?: boolean;
};

export function buildTurnPrompt(params: BuildTurnPromptParams): string {
  const parts: string[] = [systemConstraints(params.agent)];

  if (params.readOnly) {
    parts.push("");
    parts.push("READ-ONLY MODE — IMPORTANT:");
    parts.push(
      "You are running in a non-git directory alongside two other parallel agents. " +
        "Any file write WILL collide with the other agents' writes. " +
        "You MUST NOT create, edit, delete, rename, or move any file. " +
        "Do not run shell commands that mutate state (no git init, git commit, " +
        "chmod, mv, rm, touch, etc.). Read-only tools are fine " +
        "(Read, Grep, Glob, and read-only Bash like `ls`, `cat`, `git log`, `find`). " +
        "Produce a complete text answer ONLY.",
    );
  }

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
  if (params.readOnly) {
    parts.push("REMINDER: Answer in text only. No file edits. No mutating shell commands.");
  } else {
    parts.push(
      "NOTE: You may answer in text only, or commit code changes to this worktree. " +
        "A text answer is always expected. Diffs are optional and the orchestrator " +
        "will decide whether to merge them.",
    );
  }

  return parts.join("\n");
}
