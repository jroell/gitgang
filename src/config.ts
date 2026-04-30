/**
 * Per-repo config file reader and scaffolding helpers.
 *
 * `.gitgang/config.json` is a plain JSON file sitting next to the sessions
 * directory. Every field is optional; missing keys fall back to built-in
 * defaults (or values from CLI flags / env vars, which always win).
 *
 * Layering (highest priority wins):
 *   CLI flag > env var > .gitgang/config.json > built-in default
 *
 * All functions in this module are pure or do narrowly-scoped file I/O;
 * nothing here starts a session or talks to an agent.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Every field optional. Present fields override built-in defaults; missing
 * fields are inherited from the next lower precedence tier.
 */
export type GitgangConfig = {
  automerge?: "on" | "off" | "ask";
  reviewer?: "gemini" | "claude" | "codex";
  heartbeatIntervalMs?: number;
  timeoutMs?: number;
  models?: {
    gemini?: string;
    claude?: string;
    codex?: string;
  };
};

/**
 * Read `.gitgang/config.json` from the given repo root. Returns an empty
 * config object (not null!) if the file is missing or malformed, so callers
 * can always destructure safely.
 *
 * Malformed JSON is silently swallowed on purpose — a broken config file
 * should never prevent the CLI from running. A future improvement could
 * surface the parse error via a separate `validateConfig` helper.
 */
export function loadConfig(repoRoot: string): GitgangConfig {
  const path = join(repoRoot, ".gitgang", "config.json");
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return pickKnownFields(parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

/**
 * Whitelist the known top-level fields. Anything else (e.g. `_readme`
 * documentation strings, future fields) is stripped so downstream
 * consumers don't see surprise keys.
 */
function pickKnownFields(o: Record<string, unknown>): GitgangConfig {
  const out: GitgangConfig = {};
  if (o.automerge === "on" || o.automerge === "off" || o.automerge === "ask") {
    out.automerge = o.automerge;
  }
  if (o.reviewer === "gemini" || o.reviewer === "claude" || o.reviewer === "codex") {
    out.reviewer = o.reviewer;
  }
  if (typeof o.heartbeatIntervalMs === "number" && Number.isFinite(o.heartbeatIntervalMs)) {
    out.heartbeatIntervalMs = o.heartbeatIntervalMs;
  }
  if (typeof o.timeoutMs === "number" && Number.isFinite(o.timeoutMs)) {
    out.timeoutMs = o.timeoutMs;
  }
  if (typeof o.models === "object" && o.models !== null) {
    const m = o.models as Record<string, unknown>;
    const models: NonNullable<GitgangConfig["models"]> = {};
    if (typeof m.gemini === "string") models.gemini = m.gemini;
    if (typeof m.claude === "string") models.claude = m.claude;
    if (typeof m.codex === "string") models.codex = m.codex;
    if (Object.keys(models).length > 0) out.models = models;
  }
  return out;
}

/**
 * The exact content written by `gg init`. A plain-JSON file (no comments —
 * JSON doesn't support them) with a `_readme` sibling string to point users
 * at the schema. The values match gitgang's built-in defaults so the file
 * is a no-op until the user edits it.
 */
export const DEFAULT_CONFIG_CONTENT = `{
  "_readme": "gitgang per-repo config. Every field is optional. CLI flags and env vars override these. Delete this file to reset to built-in defaults.",
  "automerge": "ask",
  "reviewer": "codex",
  "heartbeatIntervalMs": 30000,
  "timeoutMs": 1500000,
  "models": {
    "gemini": "gemini-3.1-pro-preview",
    "claude": "claude-opus-4-7",
    "codex": "gpt-5.4"
  }
}
`;

/**
 * Scaffold `.gitgang/config.json`. Refuses to overwrite an existing file
 * unless `force` is set. Returns the absolute path written (or would-be
 * written) and a status flag for the caller to render a user-facing line.
 */
export function runInit(
  repoRoot: string,
  force: boolean,
): { path: string; outcome: "created" | "exists" | "overwritten" } {
  const dir = resolve(repoRoot, ".gitgang");
  const path = join(dir, "config.json");
  const existed = existsSync(path);
  if (existed && !force) {
    return { path, outcome: "exists" };
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, DEFAULT_CONFIG_CONTENT);
  return { path, outcome: existed ? "overwritten" : "created" };
}
