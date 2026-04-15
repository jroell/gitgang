export type ForcedMode = "ask" | "code" | null;

export type DiffTarget = "gemini" | "claude" | "codex" | "picked";

export type AgentId = "gemini" | "claude" | "codex";

/**
 * Per-turn agent roster override. Applied to the single upcoming turn;
 * subsequent turns revert to the session default. See /only and /skip.
 */
export type AgentFilter = { kind: "only" | "skip"; agent: AgentId };

export type SlashCommand =
  | {
      kind: "message";
      text: string;
      forcedMode: ForcedMode;
      agentFilter?: AgentFilter;
    }
  | { kind: "merge" }
  | { kind: "pr" }
  | { kind: "history" }
  | { kind: "agents" }
  | { kind: "help" }
  | { kind: "quit" }
  | { kind: "set"; key: string; value: string }
  | { kind: "diff"; target: DiffTarget }
  | { kind: "redo" }
  | { kind: "unknown"; raw: string };

function isAgentId(value: string): value is AgentId {
  return value === "gemini" || value === "claude" || value === "codex";
}

export function parseSlashCommand(raw: string): SlashCommand {
  const input = raw.trim();
  if (!input.startsWith("/")) {
    return { kind: "message", text: input, forcedMode: null };
  }

  const firstSpace = input.indexOf(" ");
  const head = firstSpace === -1 ? input : input.slice(0, firstSpace);
  const tail = firstSpace === -1 ? "" : input.slice(firstSpace + 1).trim();

  switch (head) {
    case "/ask":
      return { kind: "message", text: tail, forcedMode: "ask" };
    case "/code":
      return { kind: "message", text: tail, forcedMode: "code" };
    case "/merge":
      return { kind: "merge" };
    case "/pr":
      return { kind: "pr" };
    case "/history":
      return { kind: "history" };
    case "/agents":
      return { kind: "agents" };
    case "/help":
      return { kind: "help" };
    case "/quit":
    case "/exit":
      return { kind: "quit" };
    case "/set": {
      const parts = tail.split(/\s+/).filter(Boolean);
      if (parts.length < 2) return { kind: "unknown", raw: input };
      const [key, ...valueParts] = parts;
      return { kind: "set", key, value: valueParts.join(" ") };
    }
    case "/redo":
      return { kind: "redo" };
    case "/only":
    case "/skip": {
      // /only <agent> <message...> or /skip <agent> <message...>
      const filterKind = head === "/only" ? "only" : "skip";
      const parts = tail.split(/\s+/).filter(Boolean);
      if (parts.length === 0) return { kind: "unknown", raw: input };
      const agent = parts[0];
      if (!isAgentId(agent)) return { kind: "unknown", raw: input };
      const text = parts.slice(1).join(" ");
      return {
        kind: "message",
        text,
        forcedMode: null,
        agentFilter: { kind: filterKind, agent },
      };
    }
    case "/diff": {
      const target = tail.split(/\s+/).filter(Boolean)[0];
      if (!target) return { kind: "diff", target: "picked" };
      if (target === "gemini" || target === "claude" || target === "codex") {
        return { kind: "diff", target };
      }
      return { kind: "unknown", raw: input };
    }
    default:
      return { kind: "unknown", raw: input };
  }
}
