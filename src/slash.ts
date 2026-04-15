export type ForcedMode = "ask" | "code" | null;

export type SlashCommand =
  | { kind: "message"; text: string; forcedMode: ForcedMode }
  | { kind: "merge" }
  | { kind: "pr" }
  | { kind: "history" }
  | { kind: "agents" }
  | { kind: "help" }
  | { kind: "quit" }
  | { kind: "set"; key: string; value: string }
  | { kind: "unknown"; raw: string };

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
    default:
      return { kind: "unknown", raw: input };
  }
}
