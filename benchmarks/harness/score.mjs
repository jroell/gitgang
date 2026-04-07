// Summarize a benchmark results file: per-agent solo pass rate, merged
// (gitgang) pass rate, carrying detection, and per-category breakdowns.
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node score.mjs <results.json>");
  process.exit(1);
}
const report = JSON.parse(readFileSync(file, "utf8"));
const tasks = report.tasks;
const n = tasks.length;

function rate(count) { return `${count}/${n} (${Math.round(100 * count / n)}%)`; }

const geminiPass = tasks.filter((t) => t.agents.gemini.pass).length;
const claudePass = tasks.filter((t) => t.agents.claude.pass).length;
const codexPass  = tasks.filter((t) => t.agents.codex.pass).length;
const mergedPass = tasks.filter((t) => t.merged.pass).length;
const stumped    = tasks.filter((t) => !t.merged.pass).length;

console.log("Benchmark run:", report.startedAt, `(${(report.durationMs/60000).toFixed(1)} min)`);
console.log("─".repeat(60));
console.log(`gemini solo:  ${rate(geminiPass)}`);
console.log(`claude solo:  ${rate(claudePass)}`);
console.log(`codex  solo:  ${rate(codexPass)}`);
console.log(`gitgang merged: ${rate(mergedPass)}`);
console.log(`stumped (merged fail): ${rate(stumped)}`);

// Carrying detection: is there an agent whose solo rate is notably higher
// than the other two? If one agent accounts for most wins, the synthesis
// step may be riding on that agent.
const solos = [["gemini", geminiPass], ["claude", claudePass], ["codex", codexPass]].sort((a, b) => b[1] - a[1]);
const gap = solos[0][1] - solos[2][1];
if (gap >= Math.max(5, Math.ceil(n * 0.15))) {
  console.log(`\n⚠ carrying signal: ${solos[0][0]} leads ${solos[2][0]} by ${gap} tasks — one CLI may be doing most of the work`);
}

// Uplift from synthesis: how many tasks passed merged that no solo agent
// passed? Those are the tasks where synthesis actually added value.
const synthesisWins = tasks.filter((t) =>
  t.merged.pass && !t.agents.gemini.pass && !t.agents.claude.pass && !t.agents.codex.pass
).length;
const synthesisLosses = tasks.filter((t) =>
  !t.merged.pass && (t.agents.gemini.pass || t.agents.claude.pass || t.agents.codex.pass)
).length;
console.log(`\nsynthesis wins   (merged ok, all solos fail): ${synthesisWins}`);
console.log(`synthesis losses (merged fail, some solo ok): ${synthesisLosses}`);

// By difficulty
console.log("\nBy difficulty:");
for (const d of ["easy", "medium", "hard"]) {
  const sub = tasks.filter((t) => t.difficulty === d);
  if (!sub.length) continue;
  const merged = sub.filter((t) => t.merged.pass).length;
  console.log(`  ${d.padEnd(6)} ${merged}/${sub.length} merged pass (${Math.round(100*merged/sub.length)}%)`);
}

// By category
console.log("\nBy category:");
const cats = [...new Set(tasks.map((t) => t.category))].sort();
for (const c of cats) {
  const sub = tasks.filter((t) => t.category === c);
  const merged = sub.filter((t) => t.merged.pass).length;
  console.log(`  ${c.padEnd(16)} ${merged}/${sub.length}`);
}

// Expected vs observed stumps
const expectedStump = tasks.filter((t) => t.expectedToStump).length;
const expectedStumpAccuracy = tasks.filter((t) => t.expectedToStump === !t.merged.pass).length;
console.log(`\nexpected-to-stump prior: ${expectedStump}/${n}`);
console.log(`prior accuracy: ${expectedStumpAccuracy}/${n} (${Math.round(100*expectedStumpAccuracy/n)}%)`);
