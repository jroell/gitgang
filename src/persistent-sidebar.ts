/**
 * Persistent sidebar that stays fixed on screen using ANSI escape codes
 * Inspired by tmux/screen split panes
 */

import { renderSidebar } from "./sidebar.js";
import type { AgentId } from "./cli.js";

interface SidebarOptions {
  width: number;
  position: "left" | "right";
  updateInterval?: number;
}

interface AgentInfo {
  getStatus: () => "idle" | "running" | "restarting" | "completed" | "failed";
  getStats: () => {
    filesChanged: number;
    commits: number;
    errors: number;
    additions: number;
    deletions: number;
    lastFile?: string;
  };
}

/**
 * ANSI escape codes for cursor control
 */
const ANSI = {
  // Cursor positioning
  saveCursor: "\x1b[s",           // Save cursor position
  restoreCursor: "\x1b[u",         // Restore cursor position
  hideCursor: "\x1b[?25l",         // Hide cursor
  showCursor: "\x1b[?25h",         // Show cursor
  
  // Positioning
  moveTo: (row: number, col: number) => `\x1b[${row};${col}H`,
  moveUp: (n: number) => `\x1b[${n}A`,
  moveDown: (n: number) => `\x1b[${n}B`,
  moveRight: (n: number) => `\x1b[${n}C`,
  moveLeft: (n: number) => `\x1b[${n}D`,
  
  // Clearing
  clearLine: "\x1b[2K",            // Clear entire line
  clearToEnd: "\x1b[0J",           // Clear from cursor to end of screen
  clearToStart: "\x1b[1J",         // Clear from cursor to start
  clearScreen: "\x1b[2J",          // Clear entire screen
  
  // Scrolling region
  setScrollRegion: (top: number, bottom: number) => `\x1b[${top};${bottom}r`,
  resetScrollRegion: "\x1b[r",
} as const;

/**
 * Manages a persistent sidebar display
 */
export class PersistentSidebar {
  private width: number;
  private position: "left" | "right";
  private updateInterval: number;
  private intervalId?: NodeJS.Timeout;
  private lastHeight: number = 0;
  private terminalWidth: number = 0;
  private terminalHeight: number = 0;
  
  constructor(options: SidebarOptions) {
    this.width = options.width;
    this.position = options.position;
    this.updateInterval = options.updateInterval || 2000;
    
    // Get terminal dimensions
    this.updateTerminalSize();
    
    // Listen for terminal resize
    process.stdout.on("resize", () => {
      this.updateTerminalSize();
    });
  }
  
  private updateTerminalSize() {
    this.terminalWidth = process.stdout.columns || 80;
    this.terminalHeight = process.stdout.rows || 24;
  }
  
  /**
   * Start the persistent sidebar
   */
  start<T extends Record<string, AgentInfo>>(
    agents: T,
    opts: any
  ) {
    // Initial render
    this.render(agents, opts);
    
    // Set up periodic updates
    this.intervalId = setInterval(() => {
      this.render(agents, opts);
    }, this.updateInterval);
    
    // Hide cursor for cleaner display
    process.stdout.write(ANSI.hideCursor);
    
    // Set up cleanup on exit
    process.on("exit", () => this.stop());
    process.on("SIGINT", () => this.stop());
    process.on("SIGTERM", () => this.stop());
  }
  
  /**
   * Stop the sidebar and clean up
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    
    // Show cursor again
    process.stdout.write(ANSI.showCursor);
    
    // Reset scroll region
    process.stdout.write(ANSI.resetScrollRegion);
  }
  
  /**
   * Render the sidebar at fixed position
   */
  private render<T extends Record<string, AgentInfo>>(
    agents: T,
    opts: any
  ) {
    // Save current cursor position
    process.stdout.write(ANSI.saveCursor);
    
    // Get sidebar content
    const sidebarContent = renderSidebar(agents, opts, {
      width: this.width,
      showLogo: true,
    });
    
    const lines = sidebarContent.split("\n");
    this.lastHeight = lines.length;
    
    // Calculate starting column based on position
    const effectiveWidth = Math.max(
      1,
      Math.min(this.width, this.terminalWidth - 2),
    );
    const rawCol =
      this.position === "right" ? this.terminalWidth - effectiveWidth - 1 : 1;
    const startCol = Math.min(Math.max(1, rawCol), this.terminalWidth);

    // Render each line at fixed position
    for (let i = 0; i < lines.length; i++) {
      const row = i + 1;
      
      // Don't render beyond terminal height
      if (row > this.terminalHeight - 1) break;
      
      // Move to position and render line
      const lineText = lines[i].slice(0, effectiveWidth);
      process.stdout.write(ANSI.moveTo(row, startCol));
      process.stdout.write(ANSI.clearToEnd);
      process.stdout.write(lineText);
    }
    
    // Restore cursor position
    process.stdout.write(ANSI.restoreCursor);
  }
  
  /**
   * Force an immediate update
   */
  update<T extends Record<string, AgentInfo>>(
    agents: T,
    opts: any
  ) {
    this.render(agents, opts);
  }
  
  /**
   * Get the width reserved for sidebar
   */
  getWidth(): number {
    return this.width + 2; // +2 for padding
  }
  
  /**
   * Set scroll region to prevent main content from overlapping sidebar
   */
  setScrollRegion() {
    if (this.position === "right") {
      // For right sidebar, no scroll region needed - just avoid that area
      return;
    } else {
      // For left sidebar, set scroll region
      const contentStart = this.lastHeight + 2;
      process.stdout.write(ANSI.setScrollRegion(contentStart, this.terminalHeight));
    }
  }
}

/**
 * Create and manage a persistent sidebar
 */
export function createPersistentSidebar(options: SidebarOptions): PersistentSidebar {
  return new PersistentSidebar(options);
}

export default PersistentSidebar;
