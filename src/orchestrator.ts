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

export type Disagreement = {
  topic: string;
  positions: Partial<Record<AgentId, string>>;
  verdict: string;
  evidence: string[];
};

export type MergePlan = {
  pick: AgentId | "hybrid";
  branches: string[];
  rationale: string;
  followups: string[];
};

export type OrchestratorOutput = {
  intent: "ask" | "code";
  agreement: string[];
  disagreement: Disagreement[];
  bestAnswer: string;
  mergePlan?: MergePlan;
};

export type ParseResult =
  | { ok: true; value: OrchestratorOutput }
  | { ok: false; raw: string; reason: string };

function extractJsonObject(raw: string): string | null {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return raw.slice(first, last + 1);
}

export function parseOrchestratorOutput(raw: string): ParseResult {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return { ok: false, raw, reason: "no JSON object found" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      ok: false,
      raw,
      reason: `JSON parse error: ${(err as Error).message}`,
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, raw, reason: "parsed value is not an object" };
  }
  const o = parsed as Record<string, unknown>;

  if (o.intent !== "ask" && o.intent !== "code") {
    return { ok: false, raw, reason: "intent must be 'ask' or 'code'" };
  }
  if (!Array.isArray(o.agreement)) {
    return { ok: false, raw, reason: "agreement must be array" };
  }
  if (!Array.isArray(o.disagreement)) {
    return { ok: false, raw, reason: "disagreement must be array" };
  }
  if (typeof o.best_answer !== "string") {
    return { ok: false, raw, reason: "best_answer must be string" };
  }

  const output: OrchestratorOutput = {
    intent: o.intent,
    agreement: o.agreement as string[],
    disagreement: o.disagreement as Disagreement[],
    bestAnswer: o.best_answer,
  };
  if (o.intent === "code" && o.merge_plan) {
    output.mergePlan = o.merge_plan as MergePlan;
  }
  return { ok: true, value: output };
}

export const ORCHESTRATOR_SYSTEM_PROMPT = `You are the orchestrator for a multi-agent code assistant. On each turn:

1. CLASSIFY the user's intent as "ask" (wants an answer) or "code" (wants
   code changes). If forcedMode is set in the envelope, use it instead.

2. BROWSE THE CODE as needed to verify or reconcile what the sub-agents say.
   You have Read, Grep, Glob, and Bash (read-only git commands only). When
   sub-agents disagree, prefer ground truth from the code over any single
   agent's claim.

3. SYNTHESIZE a single response with this exact JSON shape — no prose outside it:

{
  "intent": "ask" | "code",
  "agreement": ["claim every successful agent made"],
  "disagreement": [
    {
      "topic": "short title",
      "positions": { "gemini": "...", "claude": "...", "codex": "..." },
      "verdict": "what's actually true based on code inspection",
      "evidence": ["path:line", "..."]
    }
  ],
  "best_answer": "the full synthesized answer, markdown OK",
  "merge_plan": {
    "pick": "gemini" | "claude" | "codex" | "hybrid",
    "branches": ["agents/claude/turn-3"],
    "rationale": "why this merge",
    "followups": []
  }
}

The merge_plan key is ONLY present when intent is "code". Cite file paths
with path:line when using evidence. If all successful agents agree and
your code inspection confirms, disagreement is [].
If an agent failed, note it in agreement rather than in positions.`;

export type OrchestratorSpawnParams = {
  input: OrchestratorInput;
  model: string;
  yolo: boolean;
};

export type OrchestratorSpawnConfig = {
  command: string;
  args: string[];
  stdin: string;
};

export function orchestratorSpawnConfig(
  params: OrchestratorSpawnParams,
): OrchestratorSpawnConfig {
  const args = [
    "--print",
    "--model",
    params.model,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  if (params.yolo) args.push("--dangerously-skip-permissions");

  const stdin = [
    "SYSTEM:",
    ORCHESTRATOR_SYSTEM_PROMPT,
    "",
    "INPUT ENVELOPE:",
    JSON.stringify(params.input, null, 2),
    "",
    "Produce the JSON response now.",
  ].join("\n");

  return { command: "claude", args, stdin };
}
