import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, runInit, DEFAULT_CONFIG_CONTENT } from "./config";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "gitgang-config-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(repoRoot: string, content: string) {
  const dir = join(repoRoot, ".gitgang");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.json"), content);
}

describe("loadConfig — happy paths", () => {
  test("returns empty object when file missing", () => {
    expect(loadConfig(tmp)).toEqual({});
  });

  test("reads fully-populated config", () => {
    writeConfig(
      tmp,
      JSON.stringify({
        automerge: "on",
        reviewer: "claude",
        heartbeatIntervalMs: 15000,
        timeoutMs: 300000,
        models: { gemini: "g-custom", claude: "c-custom", codex: "x-custom" },
      }),
    );
    const cfg = loadConfig(tmp);
    expect(cfg).toEqual({
      automerge: "on",
      reviewer: "claude",
      heartbeatIntervalMs: 15000,
      timeoutMs: 300000,
      models: { gemini: "g-custom", claude: "c-custom", codex: "x-custom" },
    });
  });

  test("partial config only sets the present fields", () => {
    writeConfig(tmp, JSON.stringify({ automerge: "off" }));
    expect(loadConfig(tmp)).toEqual({ automerge: "off" });
  });

  test("_readme field is stripped (not whitelisted)", () => {
    writeConfig(
      tmp,
      JSON.stringify({ _readme: "ignored", automerge: "on" }),
    );
    const cfg = loadConfig(tmp);
    expect(cfg).toEqual({ automerge: "on" });
    expect("_readme" in cfg).toBe(false);
  });

  test("unknown top-level fields are stripped", () => {
    writeConfig(
      tmp,
      JSON.stringify({ automerge: "on", futureField: "hi", nested: { x: 1 } }),
    );
    expect(loadConfig(tmp)).toEqual({ automerge: "on" });
  });

  test("partial models object only sets the present agents", () => {
    writeConfig(tmp, JSON.stringify({ models: { claude: "claude-custom" } }));
    expect(loadConfig(tmp)).toEqual({ models: { claude: "claude-custom" } });
  });
});

describe("loadConfig — invalid inputs", () => {
  test("malformed JSON returns empty", () => {
    writeConfig(tmp, "{ broken");
    expect(loadConfig(tmp)).toEqual({});
  });

  test("non-object root (array) returns empty", () => {
    writeConfig(tmp, "[]");
    expect(loadConfig(tmp)).toEqual({});
  });

  test("null root returns empty", () => {
    writeConfig(tmp, "null");
    expect(loadConfig(tmp)).toEqual({});
  });

  test("invalid automerge value is dropped", () => {
    writeConfig(tmp, JSON.stringify({ automerge: "bogus" }));
    expect(loadConfig(tmp)).toEqual({});
  });

  test("invalid reviewer value is dropped", () => {
    writeConfig(tmp, JSON.stringify({ reviewer: "bogus" }));
    expect(loadConfig(tmp)).toEqual({});
  });

  test("non-number timeoutMs is dropped", () => {
    writeConfig(tmp, JSON.stringify({ timeoutMs: "600000" }));
    expect(loadConfig(tmp)).toEqual({});
  });

  test("NaN/Infinity heartbeatIntervalMs is dropped", () => {
    writeConfig(tmp, `{ "heartbeatIntervalMs": null }`);
    expect(loadConfig(tmp)).toEqual({});
  });

  test("empty models object is dropped (no partial agents set)", () => {
    writeConfig(tmp, JSON.stringify({ models: {} }));
    expect(loadConfig(tmp)).toEqual({});
  });

  test("non-string model value is dropped", () => {
    writeConfig(
      tmp,
      JSON.stringify({ models: { gemini: 42, claude: "c-ok" } }),
    );
    expect(loadConfig(tmp)).toEqual({ models: { claude: "c-ok" } });
  });
});

describe("runInit — scaffolding", () => {
  test("creates .gitgang/config.json with default content", () => {
    const { path, outcome } = runInit(tmp, false);
    expect(outcome).toBe("created");
    expect(path).toBe(join(tmp, ".gitgang", "config.json"));
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(DEFAULT_CONFIG_CONTENT);
  });

  test("creates parent directory if missing", () => {
    expect(existsSync(join(tmp, ".gitgang"))).toBe(false);
    runInit(tmp, false);
    expect(existsSync(join(tmp, ".gitgang"))).toBe(true);
  });

  test("refuses to overwrite existing file without force", () => {
    writeConfig(tmp, `{"automerge":"on"}`);
    const { outcome } = runInit(tmp, false);
    expect(outcome).toBe("exists");
    // Existing file untouched
    expect(readFileSync(join(tmp, ".gitgang", "config.json"), "utf8")).toBe(
      `{"automerge":"on"}`,
    );
  });

  test("overwrites existing file when force=true", () => {
    writeConfig(tmp, `{"automerge":"on"}`);
    const { outcome } = runInit(tmp, true);
    expect(outcome).toBe("overwritten");
    expect(readFileSync(join(tmp, ".gitgang", "config.json"), "utf8")).toBe(
      DEFAULT_CONFIG_CONTENT,
    );
  });

  test("default content is valid JSON and re-parseable via loadConfig", () => {
    runInit(tmp, false);
    // Must not throw and must round-trip to known defaults.
    expect(() => JSON.parse(DEFAULT_CONFIG_CONTENT)).not.toThrow();
    const cfg = loadConfig(tmp);
    expect(cfg.automerge).toBe("ask");
    expect(cfg.reviewer).toBe("codex");
    expect(cfg.heartbeatIntervalMs).toBe(30000);
    expect(cfg.models?.gemini).toBe("gemini-3.1-pro");
    expect(cfg.models?.claude).toBe("claude-opus-4-7");
    expect(cfg.models?.codex).toBe("gpt-5.5");
  });

  test("default content includes the _readme hint for humans", () => {
    expect(DEFAULT_CONFIG_CONTENT).toContain("_readme");
    expect(DEFAULT_CONFIG_CONTENT).toContain("gitgang per-repo config");
  });
});
