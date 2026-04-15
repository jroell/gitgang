import { describe, test, expect } from "vitest";
import {
  checkNode,
  checkBinary,
  checkEnvVar,
  checkGitRepo,
  checkGitgangDirWritable,
  runAllChecks,
  renderDoctorReport,
  MIN_NODE_MAJOR,
  type DoctorProbes,
  type CheckResult,
} from "./doctor";

/**
 * Build a fully-stubbed DoctorProbes with optional per-field overrides.
 * Defaults to the "healthy" state so each test only overrides what it cares
 * about.
 */
function makeProbes(overrides: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    which: () => "/usr/bin/stub",
    getEnv: () => "stub",
    isGitRepo: () => true,
    isWritable: () => true,
    nodeMajor: () => MIN_NODE_MAJOR,
    ...overrides,
  };
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("checkNode", () => {
  test("passes at exactly the minimum", () => {
    const r = checkNode(makeProbes({ nodeMajor: () => MIN_NODE_MAJOR }));
    expect(r.status).toBe("ok");
    expect(r.detail).toContain(`v${MIN_NODE_MAJOR}`);
  });
  test("passes above the minimum", () => {
    const r = checkNode(makeProbes({ nodeMajor: () => MIN_NODE_MAJOR + 4 }));
    expect(r.status).toBe("ok");
  });
  test("fails below the minimum with hint", () => {
    const r = checkNode(makeProbes({ nodeMajor: () => MIN_NODE_MAJOR - 1 }));
    expect(r.status).toBe("fail");
    expect(r.hint).toMatch(/nvm|package manager/i);
  });
});

describe("checkBinary", () => {
  test("ok when which returns a path", () => {
    const r = checkBinary(
      makeProbes({ which: (b) => (b === "git" ? "/usr/bin/git" : null) }),
      "git",
    );
    expect(r.status).toBe("ok");
    expect(r.detail).toBe("/usr/bin/git");
  });
  test("fail when required binary missing", () => {
    const r = checkBinary(makeProbes({ which: () => null }), "git", {
      required: true,
    });
    expect(r.status).toBe("fail");
    expect(r.detail).toBe("not on PATH");
    expect(r.hint).toBeDefined();
  });
  test("warn (not fail) when optional binary missing", () => {
    const r = checkBinary(
      makeProbes({ which: () => null }),
      "gh",
      { required: false, hint: "install gh" },
    );
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("optional");
    expect(r.hint).toBe("install gh");
  });
  test("uses custom hint when provided", () => {
    const r = checkBinary(
      makeProbes({ which: () => null }),
      "gemini",
      { required: true, hint: "install gemini-cli" },
    );
    expect(r.hint).toBe("install gemini-cli");
  });
});

describe("checkEnvVar", () => {
  test("ok when set", () => {
    const r = checkEnvVar(
      makeProbes({ getEnv: (n) => (n === "GOOGLE_API_KEY" ? "val" : undefined) }),
      "GOOGLE_API_KEY",
    );
    expect(r.status).toBe("ok");
  });
  test("fail when unset", () => {
    const r = checkEnvVar(makeProbes({ getEnv: () => undefined }), "GOOGLE_API_KEY");
    expect(r.status).toBe("fail");
    expect(r.hint).toMatch(/shell profile/i);
  });
  test("fail when set but blank", () => {
    const r = checkEnvVar(
      makeProbes({ getEnv: () => "   " }),
      "GOOGLE_API_KEY",
    );
    expect(r.status).toBe("fail");
  });
  test("ok via optional fallback env", () => {
    const r = checkEnvVar(
      makeProbes({
        getEnv: (n) => (n === "GEMINI_API_KEY" ? "val" : undefined),
      }),
      "GOOGLE_API_KEY",
      { optional: ["GEMINI_API_KEY"] },
    );
    expect(r.status).toBe("ok");
    expect(r.detail).toContain("GEMINI_API_KEY");
  });
  test("hint mentions alternates when all unset", () => {
    const r = checkEnvVar(
      makeProbes({ getEnv: () => undefined }),
      "GOOGLE_API_KEY",
      { optional: ["GEMINI_API_KEY"] },
    );
    expect(r.status).toBe("fail");
    expect(r.hint).toContain("GEMINI_API_KEY");
  });
});

describe("checkGitRepo", () => {
  test("ok when in a git repo", () => {
    const r = checkGitRepo(makeProbes({ isGitRepo: () => true }), "/cwd");
    expect(r.status).toBe("ok");
    expect(r.detail).toBe("/cwd");
  });
  test("warn (not fail) when not a git repo — read-only Q&A mode still works", () => {
    const r = checkGitRepo(makeProbes({ isGitRepo: () => false }), "/cwd");
    expect(r.status).toBe("warn");
    expect(r.hint).toMatch(/git init|read-only Q&A/);
  });
  test("detail mentions the cwd when not in a repo", () => {
    const r = checkGitRepo(makeProbes({ isGitRepo: () => false }), "/home/alice");
    expect(r.detail).toContain("/home/alice");
  });
});

describe("checkGitgangDirWritable", () => {
  test("ok when dir is writable", () => {
    const r = checkGitgangDirWritable(
      makeProbes({ isWritable: () => true }),
      "/cwd",
    );
    expect(r.status).toBe("ok");
    expect(r.detail).toContain(".gitgang");
  });
  test("fail when not writable", () => {
    const r = checkGitgangDirWritable(
      makeProbes({ isWritable: () => false }),
      "/cwd",
    );
    expect(r.status).toBe("fail");
    expect(r.hint).toMatch(/permissions/i);
  });
});

describe("runAllChecks", () => {
  test("returns a stable, ordered list of checks", () => {
    const results = runAllChecks(makeProbes(), "/cwd");
    const names = results.map((r) => r.name);
    expect(names[0]).toBe("Node.js");
    expect(names).toContain("binary: git");
    expect(names).toContain("binary: gemini");
    expect(names).toContain("binary: claude");
    expect(names).toContain("binary: codex");
    expect(names).toContain("binary: gh");
    expect(names).toContain("env: GOOGLE_API_KEY");
    expect(names).toContain("env: ANTHROPIC_API_KEY");
    expect(names).toContain("env: OPENAI_API_KEY");
    expect(names).toContain("git: in repo");
    expect(names).toContain("writable: .gitgang/");
  });

  test("all ok when probes report healthy state", () => {
    const results = runAllChecks(makeProbes(), "/cwd");
    expect(results.every((r) => r.status === "ok")).toBe(true);
  });

  test("optional checks degrade to warn not fail", () => {
    // Only `gh` is optional; mark it missing.
    const results = runAllChecks(
      makeProbes({ which: (b) => (b === "gh" ? null : "/path") }),
      "/cwd",
    );
    const gh = results.find((r) => r.name === "binary: gh")!;
    expect(gh.status).toBe("warn");
    // Others still ok.
    expect(results.filter((r) => r.status === "fail")).toEqual([]);
  });

  test("fallback env vars count as ok", () => {
    const results = runAllChecks(
      makeProbes({
        getEnv: (n) =>
          n === "GEMINI_API_KEY" || n === "CLAUDE_CODE_OAUTH_TOKEN" || n === "OPENAI_API_KEY"
            ? "val"
            : undefined,
      }),
      "/cwd",
    );
    const envChecks = results.filter((r) => r.name.startsWith("env:"));
    expect(envChecks.every((r) => r.status === "ok")).toBe(true);
  });
});

describe("renderDoctorReport", () => {
  const results: CheckResult[] = [
    { name: "ok-thing", status: "ok", detail: "looks good" },
    { name: "warn-thing", status: "warn", detail: "optional", hint: "consider installing" },
    { name: "fail-thing", status: "fail", detail: "broken", hint: "fix it" },
  ];

  test("includes a header", () => {
    const out = stripAnsi(renderDoctorReport(results, false));
    expect(out).toContain("gg doctor");
  });

  test("renders each check with the right marker", () => {
    const out = stripAnsi(renderDoctorReport(results, false));
    expect(out).toContain("✓ ok-thing");
    expect(out).toContain("⚠ warn-thing");
    expect(out).toContain("✗ fail-thing");
  });

  test("prints hint lines for warn and fail, not for ok", () => {
    const out = stripAnsi(renderDoctorReport(results, false));
    expect(out).toContain("hint: consider installing");
    expect(out).toContain("hint: fix it");
    const okLine = out.split("\n").find((l) => l.includes("ok-thing"))!;
    expect(okLine).not.toContain("hint:");
  });

  test("summary line reflects all-green", () => {
    const out = stripAnsi(
      renderDoctorReport([{ name: "a", status: "ok" }], false),
    );
    expect(out).toMatch(/All checks passed/);
  });

  test("summary line reflects warn-only state", () => {
    const out = stripAnsi(
      renderDoctorReport(
        [
          { name: "a", status: "ok" },
          { name: "b", status: "warn" },
        ],
        false,
      ),
    );
    expect(out).toMatch(/No blocking failures/);
  });

  test("summary line reflects fail state", () => {
    const out = stripAnsi(
      renderDoctorReport([{ name: "a", status: "fail" }], false),
    );
    expect(out).toMatch(/failed/);
  });

  test("color: false strips ANSI", () => {
    const out = renderDoctorReport(results, false);
    expect(out).not.toContain("\x1b[");
  });

  test("color: true includes ANSI", () => {
    const out = renderDoctorReport(results, true);
    expect(out).toContain("\x1b[");
  });
});

import { runDoctorJson } from "./doctor";

describe("runDoctorJson", () => {
  test("returns { results, exitCode } with results being an array", () => {
    const { results, exitCode } = runDoctorJson(process.cwd());
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(typeof exitCode).toBe("number");
    expect([0, 1]).toContain(exitCode);
  });

  test("each result has the CheckResult shape", () => {
    const { results } = runDoctorJson(process.cwd());
    for (const r of results) {
      expect(typeof r.name).toBe("string");
      expect(["ok", "warn", "fail"]).toContain(r.status);
      // detail and hint are optional strings
      if (r.detail !== undefined) expect(typeof r.detail).toBe("string");
      if (r.hint !== undefined) expect(typeof r.hint).toBe("string");
    }
  });

  test("results are JSON-serializable without loss", () => {
    const { results } = runDoctorJson(process.cwd());
    const roundTripped = JSON.parse(JSON.stringify(results));
    expect(roundTripped).toEqual(results);
  });

  test("exitCode is 1 iff any result has status fail", () => {
    const { results, exitCode } = runDoctorJson(process.cwd());
    const hasFail = results.some((r) => r.status === "fail");
    expect(exitCode === 1).toBe(hasFail);
  });
});
