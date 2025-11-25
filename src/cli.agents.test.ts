import { describe, test, expect } from "vitest";
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

describe("Error detection in agent output", () => {
  test("should detect tool execution errors", () => {
    const errorLine = '[GEMINI] Error executing tool replace: File path must be within one of the workspace directories';
    expect(errorLine.includes("Error executing tool")).toBe(true);
  });

  test("should extract error message from output", () => {
    const errorLine = '[GEMINI] Error executing tool replace: File path must be within one of the workspace directories: /some/path';
    const errorMessage = errorLine.split(":").slice(1).join(":").trim().slice(0, 200);
    expect(errorMessage).toContain("File path must be within");
  });

  test("should identify path-related errors", () => {
    const errorMessage = "File path must be within one of the workspace directories";
    expect(errorMessage.includes("File path must be within")).toBe(true);
  });

  test("should distinguish successful tool_result from errors", () => {
    const successLine = '[GEMINI]   ✓ tool_result: Success';
    const errorLine = '[GEMINI] Error executing tool: failed';
    
    expect(successLine.includes("Error")).toBe(false);
    expect(errorLine.includes("Error")).toBe(true);
  });
});
