import { describe, expect, test } from "bun:test";
import { renderHelloWorldSidebar } from "./sidebar";

describe("renderHelloWorldSidebar", () => {
  test("includes hello world task description", () => {
    const output = renderHelloWorldSidebar();
    expect(output).toContain("Hello, World!");
    expect(output).toContain("AI Orchestrator");
  });

  test("can hide the logo section", () => {
    const output = renderHelloWorldSidebar({ showLogo: false });
    expect(output).not.toContain("GitGang");
  });
});
