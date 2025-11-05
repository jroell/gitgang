/**
 * Reusable styled UI components for terminal output
 * Inspired by Crush's component-based architecture
 */

import boxen from "boxen";
import gradientString from "gradient-string";
import { theme, colors, icons, box, sectionHeader, statDisplay, statusBadge } from "./theme.js";

export { theme, icons, statDisplay, statusBadge };

// Box styling presets
export const boxStyles = {
  default: {
    padding: 1,
    margin: 0,
    borderStyle: "round" as const,
    borderColor: colors.border,
  },
  focused: {
    padding: 1,
    margin: 0,
    borderStyle: "round" as const,
    borderColor: colors.borderFocus,
  },
  subtle: {
    padding: 1,
    margin: 0,
    borderStyle: "single" as const,
    borderColor: colors.border,
  },
  accent: {
    padding: 1,
    margin: 0,
    borderStyle: "double" as const,
    borderColor: colors.accent,
  },
} as const;

/**
 * Create a bordered box with title
 */
export function createBox(content: string, options?: {
  title?: string;
  style?: keyof typeof boxStyles;
  width?: number;
  padding?: number;
}): string {
  const style = options?.style || "default";
  const boxConfig = {
    ...boxStyles[style],
    ...(options?.title && { title: options.title }),
    ...(options?.width && { width: options.width }),
    ...(options?.padding !== undefined && { padding: options.padding }),
  };
  
  return boxen(content, boxConfig);
}

/**
 * Create a section header with separator line
 */
export function createSection(title: string, width: number): string {
  return sectionHeader(title, width);
}

/**
 * Create a status line with icon and text
 */
export function createStatusLine(options: {
  icon: string;
  label: string;
  status?: string;
  stats?: { label: string; value: number | string; type?: "good" | "bad" | "warning" }[];
  width?: number;
}): string {
  const parts: string[] = [];
  
  // Icon and label
  parts.push(options.icon);
  parts.push(theme.text(options.label));
  
  // Optional status
  if (options.status) {
    parts.push(theme.muted(`(${options.status})`));
  }
  
  // Stats if provided
  if (options.stats) {
    const statsText = options.stats
      .map((s) => statDisplay(s.label, s.value, s.type))
      .join(" ");
    parts.push(statsText);
  }
  
  return parts.join(" ");
}

/**
 * Create an agent status display
 */
export function createAgentStatus(options: {
  id: string;
  status: "idle" | "running" | "restarting" | "completed" | "failed";
  filesChanged?: number;
  commits?: number;
  errors?: number;
  width?: number;
}): string {
  const { id, status, filesChanged = 0, commits = 0, errors = 0 } = options;
  
  // Status icon
  let statusIcon = icons.pending;
  let statusTheme = theme.muted;
  
  switch (status) {
    case "running":
      statusIcon = icons.running;
      statusTheme = theme.running;
      break;
    case "restarting":
      statusIcon = icons.restarting;
      statusTheme = theme.warning;
      break;
    case "completed":
      statusIcon = icons.completed;
      statusTheme = theme.completed;
      break;
    case "failed":
      statusIcon = icons.failed;
      statusTheme = theme.failed;
      break;
  }
  
  // Agent name (uppercase for emphasis)
  const agentName = statusTheme(id.toUpperCase().padEnd(12));
  
  // Stats with conditional coloring
  const filesStat = theme.stats.label("F:") + 
    (filesChanged > 0 ? theme.stats.value(String(filesChanged).padStart(2)) : theme.muted(String(filesChanged).padStart(2)));
  
  const commitsStat = theme.stats.label("C:") +
    (commits > 0 ? theme.stats.valueGood(String(commits).padStart(2)) : theme.muted(String(commits).padStart(2)));
  
  const errorsStat = theme.stats.label("E:") +
    (errors > 0 ? theme.stats.valueBad(String(errors).padStart(2)) : theme.muted(String(errors).padStart(2)));
  
  return `${statusIcon} ${agentName} ${filesStat} ${commitsStat} ${errorsStat}`;
}

/**
 * Create a gradient text effect
 */
export function createGradient(text: string, colors: string[]): string {
  const gradient = gradientString(colors);
  return gradient(text);
}

/**
 * Create a progress bar
 */
export function createProgressBar(options: {
  current: number;
  total: number;
  width?: number;
  showPercentage?: boolean;
}): string {
  const width = options.width || 20;
  const percentage = Math.min(100, Math.max(0, (options.current / options.total) * 100));
  const filledWidth = Math.floor((percentage / 100) * width);
  const emptyWidth = width - filledWidth;
  
  const filled = theme.success("█".repeat(filledWidth));
  const empty = theme.muted("░".repeat(emptyWidth));
  const bar = filled + empty;
  
  if (options.showPercentage) {
    return `${bar} ${theme.muted(`${Math.floor(percentage)}%`)}`;
  }
  
  return bar;
}

/**
 * Create a stats grid
 */
export function createStatsGrid(stats: Array<{
  label: string;
  value: number | string;
  type?: "good" | "bad" | "warning";
}>): string {
  return stats.map((s) => statDisplay(s.label, s.value, s.type)).join("  ");
}

/**
 * Create a title with gradient effect
 */
export function createGradientTitle(text: string): string {
  return createGradient(text, [colors.primary, colors.secondary, colors.accent]);
}

/**
 * Create a logo with styling
 */
export function createLogo(text: string): string {
  // Create a gradient logo
  const gradient = gradientString([colors.primary, colors.secondary]);
  return gradient.multiline(text);
}

/**
 * Truncate text to fit width
 */
export function truncate(text: string, width: number, suffix: string = "…"): string {
  if (text.length <= width) {
    return text;
  }
  return text.substring(0, width - suffix.length) + suffix;
}

/**
 * Pad text to exact width
 */
export function padToWidth(text: string, width: number, align: "left" | "center" | "right" = "left"): string {
  // Strip ANSI codes for length calculation
  const plainText = text.replace(/\x1b\[[0-9;]*m/g, "");
  const textLength = plainText.length;
  
  if (textLength >= width) {
    return text;
  }
  
  const padding = width - textLength;
  
  if (align === "center") {
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return " ".repeat(leftPad) + text + " ".repeat(rightPad);
  } else if (align === "right") {
    return " ".repeat(padding) + text;
  } else {
    return text + " ".repeat(padding);
  }
}

/**
 * Create a separator line with optional label
 */
export function createSeparator(width: number, label?: string): string {
  if (!label) {
    return theme.border(box.horizontal.repeat(width));
  }
  
  const labelText = ` ${label} `;
  const labelLength = labelText.length;
  const lineWidth = Math.max(0, Math.floor((width - labelLength) / 2));
  const leftLine = box.horizontal.repeat(lineWidth);
  const rightLine = box.horizontal.repeat(width - lineWidth - labelLength);
  
  return theme.border(leftLine) + theme.subtitle(labelText) + theme.border(rightLine);
}

/**
 * Join lines with proper spacing
 */
export function joinLines(lines: string[], spacing: number = 0): string {
  const spacer = "\n".repeat(spacing + 1);
  return lines.filter((line) => line !== "").join(spacer);
}

export default {
  createBox,
  createSection,
  createStatusLine,
  createAgentStatus,
  createGradient,
  createProgressBar,
  createStatsGrid,
  createGradientTitle,
  createLogo,
  truncate,
  padToWidth,
  createSeparator,
  joinLines,
};
