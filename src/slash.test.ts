import { describe, test, expect } from "vitest";
import { parseSlashCommand } from "./slash";

describe("parseSlashCommand", () => {
  test("plain text is a message with forcedMode null", () => {
    expect(parseSlashCommand("how does auth work")).toEqual({
      kind: "message",
      text: "how does auth work",
      forcedMode: null,
    });
  });

  test("/ask forces mode=ask", () => {
    expect(parseSlashCommand("/ask how does auth work")).toEqual({
      kind: "message",
      text: "how does auth work",
      forcedMode: "ask",
    });
  });

  test("/code forces mode=code", () => {
    expect(parseSlashCommand("/code add a logout button")).toEqual({
      kind: "message",
      text: "add a logout button",
      forcedMode: "code",
    });
  });

  test("/merge has no text", () => {
    expect(parseSlashCommand("/merge")).toEqual({ kind: "merge" });
  });

  test("/pr is recognized", () => {
    expect(parseSlashCommand("/pr")).toEqual({ kind: "pr" });
  });

  test("/history is recognized", () => {
    expect(parseSlashCommand("/history")).toEqual({ kind: "history" });
  });

  test("/agents is recognized", () => {
    expect(parseSlashCommand("/agents")).toEqual({ kind: "agents" });
  });

  test("/help is recognized", () => {
    expect(parseSlashCommand("/help")).toEqual({ kind: "help" });
  });

  test("/quit and /exit both mean quit", () => {
    expect(parseSlashCommand("/quit")).toEqual({ kind: "quit" });
    expect(parseSlashCommand("/exit")).toEqual({ kind: "quit" });
  });

  test("/set key value is parsed", () => {
    expect(parseSlashCommand("/set automerge on")).toEqual({
      kind: "set",
      key: "automerge",
      value: "on",
    });
  });

  test("/set without key errors via kind=unknown", () => {
    expect(parseSlashCommand("/set")).toEqual({
      kind: "unknown",
      raw: "/set",
    });
  });

  test("unknown slash command returns kind=unknown", () => {
    expect(parseSlashCommand("/frobnicate")).toEqual({
      kind: "unknown",
      raw: "/frobnicate",
    });
  });

  test("empty input returns empty message", () => {
    expect(parseSlashCommand("")).toEqual({
      kind: "message",
      text: "",
      forcedMode: null,
    });
  });

  test("leading/trailing whitespace is trimmed", () => {
    expect(parseSlashCommand("  /ask  foo  ")).toEqual({
      kind: "message",
      text: "foo",
      forcedMode: "ask",
    });
  });
});

describe("/diff", () => {
  test("/diff alone targets picked", () => {
    expect(parseSlashCommand("/diff")).toEqual({ kind: "diff", target: "picked" });
  });
  test("/diff gemini targets gemini", () => {
    expect(parseSlashCommand("/diff gemini")).toEqual({ kind: "diff", target: "gemini" });
  });
  test("/diff claude targets claude", () => {
    expect(parseSlashCommand("/diff claude")).toEqual({ kind: "diff", target: "claude" });
  });
  test("/diff codex targets codex", () => {
    expect(parseSlashCommand("/diff codex")).toEqual({ kind: "diff", target: "codex" });
  });
  test("/diff bogus is unknown", () => {
    expect(parseSlashCommand("/diff bogus")).toEqual({ kind: "unknown", raw: "/diff bogus" });
  });
  test("/diff ignores trailing whitespace", () => {
    expect(parseSlashCommand("/diff   gemini  ")).toEqual({
      kind: "diff",
      target: "gemini",
    });
  });
});

describe("/redo", () => {
  test("/redo returns redo command", () => {
    expect(parseSlashCommand("/redo")).toEqual({ kind: "redo" });
  });
  test("/redo ignores trailing whitespace", () => {
    expect(parseSlashCommand("  /redo  ")).toEqual({ kind: "redo" });
  });
  test("/redo with extra args is still redo (args ignored)", () => {
    // We could be strict here, but trailing args on argless commands is a
    // common typo; just treat as redo.
    expect(parseSlashCommand("/redo extra")).toEqual({ kind: "redo" });
  });
});

describe("/only and /skip", () => {
  test("/only claude <text> produces message with only-filter", () => {
    expect(parseSlashCommand("/only claude fix the bug")).toEqual({
      kind: "message",
      text: "fix the bug",
      forcedMode: null,
      agentFilter: { kind: "only", agent: "claude" },
    });
  });

  test("/skip codex <text> produces message with skip-filter", () => {
    expect(parseSlashCommand("/skip codex add logout")).toEqual({
      kind: "message",
      text: "add logout",
      forcedMode: null,
      agentFilter: { kind: "skip", agent: "codex" },
    });
  });

  test("/only with bogus agent is unknown", () => {
    expect(parseSlashCommand("/only bogus xyz")).toEqual({
      kind: "unknown",
      raw: "/only bogus xyz",
    });
  });

  test("/skip with bogus agent is unknown", () => {
    expect(parseSlashCommand("/skip notreal text")).toEqual({
      kind: "unknown",
      raw: "/skip notreal text",
    });
  });

  test("/only without agent is unknown", () => {
    expect(parseSlashCommand("/only")).toEqual({
      kind: "unknown",
      raw: "/only",
    });
  });

  test("/only claude with no text yields empty-text message (agent still captured)", () => {
    expect(parseSlashCommand("/only claude")).toEqual({
      kind: "message",
      text: "",
      forcedMode: null,
      agentFilter: { kind: "only", agent: "claude" },
    });
  });

  test("each valid agent works with /only", () => {
    expect(parseSlashCommand("/only gemini x").kind).toBe("message");
    expect(parseSlashCommand("/only claude x").kind).toBe("message");
    expect(parseSlashCommand("/only codex x").kind).toBe("message");
  });

  test("multi-word text preserved in /skip", () => {
    expect(parseSlashCommand("/skip gemini do many things quickly")).toMatchObject({
      text: "do many things quickly",
    });
  });

  test("/only preserves inner whitespace runs as single spaces", () => {
    // Inner whitespace runs collapse in our tokenizer, which is fine — agents
    // don't care about exact whitespace in prompts.
    expect(parseSlashCommand("/only claude  extra  spaces")).toMatchObject({
      text: "extra spaces",
    });
  });
});

describe("/clear", () => {
  test("/clear returns clear command", () => {
    expect(parseSlashCommand("/clear")).toEqual({ kind: "clear" });
  });
  test("/clear tolerates whitespace", () => {
    expect(parseSlashCommand("  /clear  ")).toEqual({ kind: "clear" });
  });
  test("/clear with extra args still clear (args ignored)", () => {
    expect(parseSlashCommand("/clear just do it")).toEqual({ kind: "clear" });
  });
});
