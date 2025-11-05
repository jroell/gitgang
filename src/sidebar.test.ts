import { describe, test, expect } from "bun:test";
import { renderSidebar } from "./sidebar";
import type { AgentId, Opts } from "./cli";
import type { AgentInfo } from "./sidebar";

const mockAgents: Record<AgentId, AgentInfo> = {
  gemini: {
    getStatus: () => "running",
    getStats: () => ({
      filesChanged: 3,
      commits: 1,
      errors: 0,
      additions: 45,
      deletions: 12,
      lastFile: "src/components/Button.tsx",
    }),
  },
  claude: {
    getStatus: () => "completed",
    getStats: () => ({
      filesChanged: 5,
      commits: 2,
      errors: 0,
      additions: 89,
      deletions: 23,
      lastFile: "src/utils/helpers.ts",
    }),
  },
  codex: {
    getStatus: () => "failed",
    getStats: () => ({
      filesChanged: 1,
      commits: 0,
      errors: 3,
      additions: 8,
      deletions: 2,
      lastFile: "src/api/client.ts",
    }),
  },
};

const mockOpts: Opts = {
  task: "Add comprehensive test coverage to the authentication module",
  rounds: 3,
  yolo: false,
  workRoot: ".ai-worktrees",
  timeoutMs: 1500000,
  noPr: false,
  verbose: false,
};

describe("renderSidebar", () => {
  test("should render the sidebar without the Hello World section by default", () => {
    const sidebar = renderSidebar(mockAgents, mockOpts);
    expect(sidebar).not.toContain("Hello World");
  });

  test("should render the sidebar with the Hello World section when showHelloWorld is true", () => {
    const sidebar = renderSidebar(mockAgents, mockOpts, {
      showHelloWorld: true,
    });
    expect(sidebar).toContain("Hello World");
  });
});
