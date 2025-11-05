/**
 * Professional sidebar dashboard component
 * Inspired by Crush's sidebar design with real-time updates
 */

import type { AgentId, Opts } from "./cli.js";
import {
  theme,
  icons,
  createBox,
  createSection,
  createAgentStatus,
  createGradientTitle,
  createSeparator,
  createStatsGrid,
  truncate,
  joinLines,
} from "./styles.js";

export interface AgentStats {
  filesChanged: number;
  commits: number;
  errors: number;
  additions: number;
  deletions: number;
  lastFile?: string;
}

export interface AgentInfo {
  getStatus: () => "idle" | "running" | "restarting" | "completed" | "failed";
  getStats: () => AgentStats;
}

/**
 * Render the complete sidebar dashboard
 */
export function renderSidebar(
  agents: Record<AgentId, AgentInfo>,
  opts: Opts,
  options?: {
    width?: number;
    height?: number;
    showLogo?: boolean;
    showHelloWorld?: boolean;
  }
): string {
  const width = options?.width || 50;
  const showLogo = options?.showLogo !== false;
  
  const sections: string[] = [];
  
  // Logo section (if enabled)
  if (showLogo) {
    sections.push(renderLogo(width));
  }
  
  // Task information section
  sections.push(renderTaskInfo(opts, width));
  
  // Agent status section
  sections.push(renderAgentStatus(agents, width));
  
  // Overall stats section
  sections.push(renderOverallStats(agents, width));

  // Hello world section (if enabled)
  if (options?.showHelloWorld) {
    sections.push(renderHelloWorld(width));
  }
  
  // Join all sections with spacing
  const content = joinLines(sections, 1);
  
  // Wrap in a stylish box
  return createBox(content, {
    title: theme.title("AI Orchestrator"),
    style: "focused",
    width,
    padding: 1,
  });
}

/**
 * Render the Hello World section
 */
function renderHelloWorld(width: number): string {
  const lines: string[] = [];
  
  // Section header
  lines.push(createSection("Hello World", width - 4));
  lines.push("");
  
  // Hello world message
  lines.push(theme.text("Hello, world!"));
  
  return lines.join("\n");
}

/**
 * Render the logo section
 */
function renderLogo(width: number): string {
  const logo = `
  ╭──────────────╮
  │ ${theme.primary("Git")}${theme.accent("Gang")} ${icons.agent} │
  ╰──────────────╯
  `.trim();
  
  return logo;
}

/**
 * Render task information
 */
function renderTaskInfo(opts: Opts, width: number): string {
  const lines: string[] = [];
  
  // Section header
  lines.push(createSection("Task", width - 4));
  lines.push("");
  
  // Task description
  const task = truncate(opts.task, width - 8);
  lines.push(theme.text(task));
  lines.push("");
  
  // Round information
  const roundInfo = theme.muted(`Round: `) + theme.stats.value(`1/${opts.rounds}`);
  lines.push(roundInfo);
  
  return lines.join("\n");
}

/**
 * Render agent status section
 */
function renderAgentStatus(agents: Record<AgentId, AgentInfo>, width: number): string {
  const lines: string[] = [];
  
  // Section header
  lines.push(createSection("Agents", width - 4));
  lines.push("");
  
  // List agents
  const agentList = Object.keys(agents) as AgentId[];
  
  for (const id of agentList) {
    const runner = agents[id];
    const status = runner.getStatus();
    const stats = runner.getStats();
    
    const statusLine = createAgentStatus({
      id,
      status,
      filesChanged: stats.filesChanged,
      commits: stats.commits,
      errors: stats.errors,
      width: width - 4,
    });
    
    lines.push(statusLine);
  }
  
  return lines.join("\n");
}

/**
 * Render overall statistics
 */
function renderOverallStats(agents: Record<AgentId, AgentInfo>, width: number): string {
  const lines: string[] = [];
  
  // Section header
  lines.push(createSection("Overall Stats", width - 4));
  lines.push("");
  
  // Calculate totals
  let totalFiles = 0;
  let totalCommits = 0;
  let totalErrors = 0;
  let totalAdditions = 0;
  let totalDeletions = 0;
  let completedCount = 0;
  let failedCount = 0;
  let runningCount = 0;
  
  for (const runner of Object.values(agents)) {
    const stats = runner.getStats();
    const status = runner.getStatus();
    
    totalFiles += stats.filesChanged;
    totalCommits += stats.commits;
    totalErrors += stats.errors;
    totalAdditions += stats.additions;
    totalDeletions += stats.deletions;
    
    if (status === "completed") completedCount++;
    else if (status === "failed") failedCount++;
    else if (status === "running" || status === "restarting") runningCount++;
  }
  
  // Status summary
  const statusParts: string[] = [];
  if (runningCount > 0) {
    statusParts.push(theme.running(`${icons.running} ${runningCount} running`));
  }
  if (completedCount > 0) {
    statusParts.push(theme.completed(`${icons.completed} ${completedCount} done`));
  }
  if (failedCount > 0) {
    statusParts.push(theme.failed(`${icons.failed} ${failedCount} failed`));
  }
  
  if (statusParts.length > 0) {
    lines.push(statusParts.join("  "));
    lines.push("");
  }
  
  // Metrics grid
  const stats = [
    { label: "Files", value: totalFiles, type: totalFiles > 0 ? "good" : undefined },
    { label: "Commits", value: totalCommits, type: totalCommits > 0 ? "good" : undefined },
    { label: "Errors", value: totalErrors, type: totalErrors > 0 ? "bad" : undefined },
  ] as const;
  
  lines.push(createStatsGrid([...stats]));
  
  // Change summary
  if (totalAdditions > 0 || totalDeletions > 0) {
    lines.push("");
    const changes = [
      { label: "+", value: totalAdditions, type: "good" },
      { label: "-", value: totalDeletions, type: "warning" },
    ] as const;
    lines.push(createStatsGrid([...changes]));
  }
  
  return lines.join("\n");
}

/**
 * Calculate sidebar height
 */
export function calculateSidebarHeight(
  agents: Record<AgentId, AgentInfo>,
  opts: Opts,
  options?: { showLogo?: boolean }
): number {
  const showLogo = options?.showLogo !== false;
  
  let height = 0;
  
  // Logo section
  if (showLogo) {
    height += 5; // Logo + spacing
  }
  
  // Task section
  height += 6; // Header + task + round + spacing
  
  // Agent status section
  const agentCount = Object.keys(agents).length;
  height += 3 + agentCount; // Header + agents + spacing
  
  // Overall stats section
  height += 8; // Header + status + stats + changes + spacing
  
  // Box padding and borders
  height += 4; // Top/bottom padding + borders
  
  return height;
}

export default {
  renderSidebar,
  calculateSidebarHeight,
};
