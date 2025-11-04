import { describe, test, expect } from "bun:test";
import {
  parseStreamLine,
  shouldDisplayLine,
  formatMessage,
  C,
  TAG,
} from "./cli";

const color = (s: string) => s;

describe("Stream parsing", () => {
  test("parseStreamLine returns parsed object for JSON", () => {
    const msg = parseStreamLine('{"type":"message","content":"hi"}');
    expect(msg).toEqual({ type: "message", content: "hi" });
  });

  test("parseStreamLine returns null for plain text", () => {
    expect(parseStreamLine("plain text")).toBeNull();
  });

  test("shouldDisplayLine filters init but shows tool_result", () => {
    expect(shouldDisplayLine({ type: "init" } as any, "")).toBe(false);
    expect(shouldDisplayLine({ type: "tool_result" } as any, "")).toBe(true);
    expect(shouldDisplayLine({ type: "message" } as any, "")).toBe(true);
  });

  test("formatMessage handles assistant output", () => {
    const msg = { type: "message", role: "assistant", content: "done" } as any;
    expect(formatMessage(msg, "", color)).toContain("done");
  });

  test("formatMessage suppresses user echo", () => {
    const msg = { type: "user" } as any;
    expect(formatMessage(msg, "", color)).toBe("");
  });

  test("formatMessage formats exec command", () => {
    const msg = { type: "exec", command: "npm test" } as any;
    expect(formatMessage(msg, "", color)).toContain("npm test");
  });
});

describe("Tag rendering", () => {
  test("TAG returns uppercase label", () => {
    expect(TAG("codex")).toContain("CODEX");
  });

  test("C helpers apply styling", () => {
    expect(C.green("ok")).toContain("ok");
    expect(C.red("no")).toContain("no");
  });
});
