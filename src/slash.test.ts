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
