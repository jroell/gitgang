import type { OrchestratorOutput } from "./orchestrator";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function paint(text: string, color: string, on: boolean): string {
  return on ? `${color}${text}${ANSI.reset}` : text;
}

export function renderSynthesis(
  output: OrchestratorOutput,
  opts: { color: boolean } = { color: true },
): string {
  const c = opts.color;
  const lines: string[] = [];

  const trivial =
    output.agreement.length === 0 &&
    output.disagreement.length === 0 &&
    !output.mergePlan &&
    output.bestAnswer.length < 200;

  lines.push(paint("▸ Answer", ANSI.cyan + ANSI.bold, c));
  lines.push(output.bestAnswer);

  if (output.agreement.length > 0) {
    lines.push("");
    lines.push(paint("✓ All 3 agents agree:", ANSI.green, c));
    for (const item of output.agreement) {
      lines.push(`  • ${item}`);
    }
  }

  for (const d of output.disagreement) {
    lines.push("");
    lines.push(paint(`⚠ Disagreement: ${d.topic}`, ANSI.yellow, c));
    for (const [agent, pos] of Object.entries(d.positions)) {
      lines.push(`  ${agent}: ${pos}`);
    }
    const ev = d.evidence.length > 0 ? ` [evidence: ${d.evidence.join(", ")}]` : "";
    lines.push(paint(`  → Verdict: ${d.verdict}${ev}`, ANSI.bold, c));
  }

  if (output.mergePlan) {
    lines.push("");
    lines.push(paint(`▸ Proposed merge: ${output.mergePlan.pick}`, ANSI.cyan + ANSI.bold, c));
    for (const b of output.mergePlan.branches) {
      lines.push(`  ${b}`);
    }
    lines.push(`  Rationale: ${output.mergePlan.rationale}`);
    if (output.mergePlan.followups.length > 0) {
      lines.push(`  Follow-ups:`);
      for (const f of output.mergePlan.followups) lines.push(`    • ${f}`);
    }
  }

  if (trivial) {
    lines.push("");
    lines.push(paint("✓ All agents aligned.", ANSI.dim, c));
  }

  return lines.join("\n") + "\n";
}
