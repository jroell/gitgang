import { describe, test, expect } from "vitest";
import { PassThrough } from "node:stream";
import { runRepl, type ReplDeps } from "./repl";

function makeDeps(overrides: Partial<ReplDeps> = {}): {
  input: PassThrough;
  output: PassThrough;
  outputText: () => string;
  deps: ReplDeps;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (c) => chunks.push(c));
  const deps: ReplDeps = {
    input,
    output,
    executeTurn: async () => {},
    showHistory: async () => {},
    showAgents: async () => {},
    showHelp: async () => {},
    runSetCommand: async () => {},
    runMergeCommand: async () => {},
    runPrCommand: async () => {},
    banner: "gitgang interactive (test)",
    ...overrides,
  };
  return { input, output, outputText: () => Buffer.concat(chunks).toString("utf8"), deps };
}

describe("runRepl", () => {
  test("prints banner and prompt, exits on /quit", async () => {
    const { input, outputText, deps } = makeDeps();
    const p = runRepl(deps);
    input.write("/quit\n");
    input.end();
    await p;
    const text = outputText();
    expect(text).toContain("gitgang interactive (test)");
  });

  test("exits on EOF (stream end)", async () => {
    const { input, deps } = makeDeps();
    const p = runRepl(deps);
    input.end();
    await p;
    // Does not throw.
  });

  test("dispatches slash commands", async () => {
    let historyCalled = 0;
    let agentsCalled = 0;
    let helpCalled = 0;
    const { input, deps } = makeDeps({
      showHistory: async () => {
        historyCalled++;
      },
      showAgents: async () => {
        agentsCalled++;
      },
      showHelp: async () => {
        helpCalled++;
      },
    });
    const p = runRepl(deps);
    input.write("/history\n");
    input.write("/agents\n");
    input.write("/help\n");
    input.write("/quit\n");
    input.end();
    await p;
    expect(historyCalled).toBe(1);
    expect(agentsCalled).toBe(1);
    expect(helpCalled).toBe(1);
  });

  test("calls executeTurn for plain text and forced modes", async () => {
    const calls: Array<{ text: string; forcedMode: string | null }> = [];
    const { input, deps } = makeDeps({
      executeTurn: async (text, forcedMode) => {
        calls.push({ text, forcedMode });
      },
    });
    const p = runRepl(deps);
    input.write("how does auth work\n");
    input.write("/ask explain caching\n");
    input.write("/code add a button\n");
    input.write("/quit\n");
    input.end();
    await p;
    expect(calls).toEqual([
      { text: "how does auth work", forcedMode: null },
      { text: "explain caching", forcedMode: "ask" },
      { text: "add a button", forcedMode: "code" },
    ]);
  });

  test("unknown command prints an error and continues", async () => {
    const { input, outputText, deps } = makeDeps();
    const p = runRepl(deps);
    input.write("/frobnicate\n");
    input.write("/quit\n");
    input.end();
    await p;
    expect(outputText()).toContain("Unknown command");
  });
});
