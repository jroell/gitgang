#!/usr/bin/env node
/**
 * Demo script to showcase the polished GitGang sidebar UI
 */

import { renderHelloWorldSidebar } from "./sidebar.js";

console.clear();
console.log("\n");
console.log("╔══════════════════════════════════════════════════════════╗");
console.log("║       GitGang Polished UI Demo - Inspired by Crush      ║");
console.log("╚══════════════════════════════════════════════════════════╝");
console.log("\n");

// Render the sidebar
const sidebar = renderHelloWorldSidebar({
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
