/**
 * Comprehensive theme system inspired by Charm's charmtone palette
 * Provides color definitions, semantic colors, and theming utilities
 */

import chalk from "chalk";

// Core brand colors
export const colors = {
  // Primary palette
  primary: "#7D56F4",    // Charple - rich purple
  secondary: "#FFD700",  // Dolly - golden yellow
  tertiary: "#FF6B6B",   // Coral - warm red
  accent: "#FFB86C",     // Zest - bright orange

  // Background shades
  bgBase: "#1A1A2E",        // Deep navy
  bgBaseLighter: "#252547",  // Lighter navy
  bgSubtle: "#2D2D44",      // Subtle purple-grey
  bgOverlay: "#3A3A5A",     // Overlay shade

  // Foreground shades
  fgBase: "#E0E0E0",        // Light grey
  fgMuted: "#A0A0B0",       // Muted grey
  fgHalfMuted: "#808090",   // Half muted
  fgSubtle: "#606070",      // Subtle grey
  fgSelected: "#FFFFFF",    // Pure white

  // Border colors
  border: "#404050",        // Subtle border
  borderFocus: "#7D56F4",   // Focused border (primary)

  // Semantic colors
  success: "#50FA7B",       // Bright green
  error: "#FF5555",         // Bright red
  warning: "#F1FA8C",       // Bright yellow
  info: "#8BE9FD",          // Bright cyan

  // Additional semantic shades
  successDark: "#44D868",
  errorDark: "#D94141",
  warningDark: "#D9C76D",
  infoDark: "#6DBFD9",

  // Status colors
  running: "#8BE9FD",       // Cyan
  completed: "#50FA7B",     // Green
  failed: "#FF5555",        // Red
  pending: "#FFB86C",       // Orange

  // Specialized colors
  blue: "#8BE9FD",
  blueDark: "#6DBFD9",
  green: "#50FA7B",
  greenDark: "#44D868",
  yellow: "#F1FA8C",
  yellowDark: "#D9C76D",
  red: "#FF5555",
  redDark: "#D94141",
  purple: "#BD93F9",
  purpleDark: "#9B73D9",
  pink: "#FF79C6",
  pinkDark: "#D95FA6",
} as const;

// Chalk styled theme functions
export const theme = {
  // Primary styles
  primary: chalk.hex(colors.primary),
  secondary: chalk.hex(colors.secondary),
  tertiary: chalk.hex(colors.tertiary),
  accent: chalk.hex(colors.accent),

  // Semantic styles
  success: chalk.hex(colors.success).bold,
  error: chalk.hex(colors.error).bold,
  warning: chalk.hex(colors.warning).bold,
  info: chalk.hex(colors.info),

  // Status styles
  running: chalk.hex(colors.running),
  completed: chalk.hex(colors.completed),
  failed: chalk.hex(colors.failed),
  pending: chalk.hex(colors.pending),

  // Text hierarchy
  title: chalk.hex(colors.accent).bold,
  subtitle: chalk.hex(colors.secondary),
  text: chalk.hex(colors.fgBase),
  muted: chalk.hex(colors.fgMuted),
  subtle: chalk.hex(colors.fgSubtle),
  selected: chalk.hex(colors.fgSelected).bold,

  // Border styles
  border: chalk.hex(colors.border),
  borderFocus: chalk.hex(colors.borderFocus),

  // Background styles (using bgColor)
  bgPrimary: chalk.bgHex(colors.bgBase),
  bgSubtle: chalk.bgHex(colors.bgSubtle),
  bgOverlay: chalk.bgHex(colors.bgOverlay),

  // Combined styles
  badge: {
    success: chalk.bgHex(colors.successDark).hex(colors.fgSelected).bold,
    error: chalk.bgHex(colors.errorDark).hex(colors.fgSelected).bold,
    warning: chalk.bgHex(colors.warningDark).hex(colors.bgBase).bold,
    info: chalk.bgHex(colors.infoDark).hex(colors.fgSelected),
    default: chalk.bgHex(colors.bgSubtle).hex(colors.fgBase),
  },

  // Icon styles
  icon: {
    success: chalk.hex(colors.success),
    error: chalk.hex(colors.error),
    warning: chalk.hex(colors.warning),
    info: chalk.hex(colors.info),
    running: chalk.hex(colors.running),
    pending: chalk.hex(colors.pending),
  },

  // Stats styles
  stats: {
    label: chalk.hex(colors.fgMuted),
    value: chalk.hex(colors.fgBase).bold,
    valueHigh: chalk.hex(colors.warning).bold,  // For high counts/warnings
    valueGood: chalk.hex(colors.success),       // For good metrics
    valueBad: chalk.hex(colors.error).bold,     // For errors
  },
} as const;

// Emoji/icon constants
export const icons = {
  // Status indicators
  running: "🔄",
  restarting: "🔁",
  completed: "✅",
  failed: "❌",
  pending: "⏸️",
  warning: "⚠️",
  error: "×",
  success: "✓",
  info: "ⓘ",

  // Progress indicators
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  dots: "•",
  arrow: "→",
  triangleRight: "▶",

  // Stats icons
  file: "📄",
  commit: "📦",
  errorCount: "×",
  changes: "Δ",
  
  // UI elements
  separator: "│",
  verticalLine: "│",
  horizontalLine: "─",
  
  // Agent types
  agent: "🤖",
  reviewer: "🔍",
  model: "◇",
} as const;

// Box drawing characters (Unicode)
export const box = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  verticalRight: "├",
  verticalLeft: "┤",
  horizontalDown: "┬",
  horizontalUp: "┴",
  cross: "┼",
} as const;

// Helper to create separator lines
export function separator(width: number, char: string = box.horizontal): string {
  return theme.border(char.repeat(width));
}

// Helper to create section headers
export function sectionHeader(title: string, width: number): string {
  const titleText = theme.subtitle(title);
  const titleLength = title.length;
  const remainingWidth = width - titleLength - 1; // -1 for space
  
  if (remainingWidth > 0) {
    return titleText + " " + separator(remainingWidth);
  }
  return titleText;
}

// Helper for stat display
export function statDisplay(label: string, value: number | string, type?: "good" | "bad" | "warning"): string {
  const labelText = theme.stats.label(label);
  let valueText: string;
  
  if (type === "good") {
    valueText = theme.stats.valueGood(String(value));
  } else if (type === "bad") {
    valueText = theme.stats.valueBad(String(value));
  } else if (type === "warning") {
    valueText = theme.stats.valueHigh(String(value));
  } else {
    valueText = theme.stats.value(String(value));
  }
  
  return `${labelText}: ${valueText}`;
}

// Helper for status badges
export function statusBadge(text: string, type: "success" | "error" | "warning" | "info" | "default" = "default"): string {
  return " " + theme.badge[type](` ${text} `) + " ";
}

export default theme;
