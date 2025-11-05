#!/usr/bin/env bun
/**
 * Demo script to showcase the new polished GitGang UI
 */

import { renderSidebar } from "./sidebar.js";

// Mock agent data
const mockAgents = {
  gemini: {
    getStatus: () => "running" as const,
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
    getStatus: () => "completed" as const,
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
    getStatus: () => "failed" as const,
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

const mockOpts = {
  task: "Add comprehensive test coverage to the authentication module",
  rounds: 3,
  yolo: false,
  workRoot: ".ai-worktrees",
  timeoutMs: 1500000,
  noPr: false,
  verbose: false,
};

console.clear();
console.log("\n");
console.log("╔══════════════════════════════════════════════════════════╗");
console.log("║       GitGang Polished UI Demo - Inspired by Crush      ║");
console.log("╚══════════════════════════════════════════════════════════╝");
console.log("\n");

// Render the sidebar
const sidebar = renderSidebar(mockAgents, mockOpts, {
  width: 54,
  showLogo: true,
});

console.log(sidebar);

console.log("\n");
console.log("✨ Features:");
console.log("  • Professional color scheme with semantic coloring");
console.log("  • Emoji status indicators for quick visual feedback");
console.log("  • Real-time stats tracking (Files, Commits, Errors)");
console.log("  • Bordered box with rounded corners using Unicode");
console.log("  • Gradient effects ready for animations");
console.log("  • Hierarchical layout with proper spacing");
console.log("\n");
