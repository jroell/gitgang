/**
 * `gg doctor` — environment health check. Answers the one question every new
 * user has: "am I set up correctly?" Each probe is a pure function over the
 * result of a single system query, so the whole suite is unit-testable with
 * injected stubs.
 */

import { existsSync, accessSync, constants as fsConstants, mkdirSync, rmdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

export type CheckStatus = "ok" | "warn" | "fail";

export type CheckResult = {
  name: string;
  status: CheckStatus;
  detail?: string;
  /** Optional hint about how to fix a failing/warning check. */
  hint?: string;
};

/**
 * Inputs to the pure check functions. Real implementation fills these
 * from system state; tests pass stubs.
 */
export type DoctorProbes = {
  /** Returns the absolute path of a binary on PATH, or null if missing. */
  which(bin: string): string | null;
  /** Returns the value of an env var, or undefined if unset. */
  getEnv(name: string): string | undefined;
  /** Returns true if `cwd` is inside a git repo (i.e., `.git` resolves). */
  isGitRepo(cwd: string): boolean;
  /** Returns true if the path is writable (existing dir or can be created). */
  isWritable(path: string): boolean;
  /** Returns the Node.js major version the caller is running under. */
  nodeMajor(): number;
};

/** Minimum Node major version gitgang is known to work on. */
export const MIN_NODE_MAJOR = 20;

/**
 * Build the full set of checks. Pure function — returns an array in a stable
 * order so test assertions and user-facing output are deterministic.
 */
export function runAllChecks(probes: DoctorProbes, cwd: string): CheckResult[] {
  return [
    checkNode(probes),
    checkBinary(probes, "git", { required: true }),
    checkBinary(probes, "gemini", {
      required: true,
      hint: "Install Gemini CLI: https://github.com/google-gemini/gemini-cli",
    }),
    checkBinary(probes, "claude", {
      required: true,
      hint: "Install Claude Code: https://docs.claude.com/en/docs/claude-code",
    }),
    checkBinary(probes, "codex", {
      required: true,
      hint: "Install OpenAI Codex: npm i -g @openai/codex",
    }),
    checkBinary(probes, "gh", {
      required: false,
      hint: "Install GitHub CLI for `/pr`: https://cli.github.com/",
    }),
    checkEnvVar(probes, "GOOGLE_API_KEY", { optional: ["GEMINI_API_KEY"] }),
    checkEnvVar(probes, "ANTHROPIC_API_KEY", { optional: ["CLAUDE_CODE_OAUTH_TOKEN"] }),
    checkEnvVar(probes, "OPENAI_API_KEY"),
    checkGitRepo(probes, cwd),
    checkGitgangDirWritable(probes, cwd),
  ];
}

export function checkNode(probes: DoctorProbes): CheckResult {
  const major = probes.nodeMajor();
  if (major >= MIN_NODE_MAJOR) {
    return { name: "Node.js", status: "ok", detail: `v${major}.x (≥${MIN_NODE_MAJOR} required)` };
  }
  return {
    name: "Node.js",
    status: "fail",
    detail: `v${major}.x`,
    hint: `gitgang requires Node.js ≥ ${MIN_NODE_MAJOR}. Upgrade via nvm or your package manager.`,
  };
}

export function checkBinary(
  probes: DoctorProbes,
  bin: string,
  opts: { required: boolean; hint?: string } = { required: true },
): CheckResult {
  const path = probes.which(bin);
  if (path) return { name: `binary: ${bin}`, status: "ok", detail: path };
  return {
    name: `binary: ${bin}`,
    status: opts.required ? "fail" : "warn",
    detail: opts.required ? "not on PATH" : "not installed (optional)",
    hint: opts.hint ?? `Install ${bin} and ensure it's on PATH.`,
  };
}

export function checkEnvVar(
  probes: DoctorProbes,
  name: string,
  opts: { optional?: string[] } = {},
): CheckResult {
  const value = probes.getEnv(name);
  if (value && value.trim().length > 0) {
    return { name: `env: ${name}`, status: "ok", detail: "set" };
  }
  const alternates = opts.optional ?? [];
  for (const alt of alternates) {
    const altValue = probes.getEnv(alt);
    if (altValue && altValue.trim().length > 0) {
      return {
        name: `env: ${name}`,
        status: "ok",
        detail: `unset — but ${alt} is set (acceptable fallback)`,
      };
    }
  }
  return {
    name: `env: ${name}`,
    status: "fail",
    detail: "unset",
    hint:
      alternates.length > 0
        ? `Set ${name} (or one of: ${alternates.join(", ")}) in your shell profile.`
        : `Set ${name} in your shell profile.`,
  };
}

export function checkGitRepo(probes: DoctorProbes, cwd: string): CheckResult {
  return probes.isGitRepo(cwd)
    ? { name: "git: in repo", status: "ok", detail: cwd }
    : {
        // Not being in a git repo is a degradation (read-only Q&A mode only),
        // not a failure — users can still run `gg -i` for questions. `warn`
        // rather than `fail` so `gg doctor` stays green outside repos.
        name: "git: in repo",
        status: "warn",
        detail: `${cwd} is not inside a git repository`,
        hint: "Run `git init` for full code-change flow, or use read-only Q&A mode.",
      };
}

export function checkGitgangDirWritable(probes: DoctorProbes, cwd: string): CheckResult {
  const path = resolve(cwd, ".gitgang");
  return probes.isWritable(path)
    ? { name: "writable: .gitgang/", status: "ok", detail: path }
    : {
        name: "writable: .gitgang/",
        status: "fail",
        detail: `cannot create ${path}`,
        hint: "Check filesystem permissions on the current directory.",
      };
}

/**
 * Render a check-result list to a human-readable, optionally colored string.
 * Status markers: ✓ (ok, green), ⚠ (warn, yellow), ✗ (fail, red).
 */
export function renderDoctorReport(results: CheckResult[], color = true): string {
  const c = color;
  const paint = (text: string, ansi: string) => (c ? `\x1b[${ansi}m${text}\x1b[0m` : text);
  const lines: string[] = [];
  lines.push(paint("gg doctor — environment health check", "1"));
  lines.push("");

  let failCount = 0;
  let warnCount = 0;
  for (const r of results) {
    if (r.status === "fail") failCount++;
    if (r.status === "warn") warnCount++;
    const marker =
      r.status === "ok"
        ? paint("✓", "32")
        : r.status === "warn"
          ? paint("⚠", "33")
          : paint("✗", "31");
    const detail = r.detail ? ` — ${r.detail}` : "";
    lines.push(`  ${marker} ${r.name.padEnd(28)}${detail}`);
    if (r.hint && r.status !== "ok") {
      lines.push(`      ${paint("hint:", "2")} ${r.hint}`);
    }
  }

  lines.push("");
  if (failCount === 0 && warnCount === 0) {
    lines.push(paint("✓ All checks passed. You're set up to run gitgang.", "32"));
  } else if (failCount === 0) {
    lines.push(
      paint(
        `✓ No blocking failures. ${warnCount} optional check${warnCount === 1 ? "" : "s"} flagged (see ⚠ above).`,
        "33",
      ),
    );
  } else {
    lines.push(
      paint(
        `✗ ${failCount} check${failCount === 1 ? "" : "s"} failed. Fix the issues above before running gitgang.`,
        "31",
      ),
    );
  }
  return lines.join("\n") + "\n";
}

/**
 * Real-environment probes — the implementations that query the actual system.
 * Separated from the pure check functions so tests can inject stubs.
 */
export function realProbes(): DoctorProbes {
  return {
    which(bin: string): string | null {
      try {
        const out = execSync(`command -v ${bin}`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        const path = out.trim();
        return path.length > 0 ? path : null;
      } catch {
        return null;
      }
    },
    getEnv(name: string): string | undefined {
      return process.env[name];
    },
    isGitRepo(cwd: string): boolean {
      try {
        execSync("git rev-parse --is-inside-work-tree", {
          cwd,
          stdio: ["ignore", "pipe", "ignore"],
        });
        return true;
      } catch {
        return false;
      }
    },
    isWritable(path: string): boolean {
      if (existsSync(path)) {
        try {
          accessSync(path, fsConstants.W_OK);
          return true;
        } catch {
          return false;
        }
      }
      // Doesn't exist; try creating + cleaning up.
      try {
        mkdirSync(path, { recursive: true });
        rmdirSync(path);
        return true;
      } catch {
        return false;
      }
    },
    nodeMajor(): number {
      return Number(process.versions.node.split(".")[0]);
    },
  };
}

/**
 * Top-level entry: run all probes and render the report. Returns exit code
 * 0 if no failures, 1 otherwise.
 */
/**
 * JSON-shaped counterpart to runDoctor. Returns structured check results
 * plus the derived exit code, so callers can serialize to stdout for
 * machine consumption (CI, dashboards, jq pipelines).
 */
export function runDoctorJson(cwd: string): { results: CheckResult[]; exitCode: number } {
  const results = runAllChecks(realProbes(), cwd);
  const exitCode = results.some((r) => r.status === "fail") ? 1 : 0;
  return { results, exitCode };
}

export function runDoctor(cwd: string, color = true): { report: string; exitCode: number } {
  const results = runAllChecks(realProbes(), cwd);
  const exitCode = results.some((r) => r.status === "fail") ? 1 : 0;
  return { report: renderDoctorReport(results, color), exitCode };
}
