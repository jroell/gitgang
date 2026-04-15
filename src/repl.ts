import { createInterface } from "node:readline";
import type { ForcedMode } from "./slash";
import { parseSlashCommand } from "./slash";

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
