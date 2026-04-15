# Interactive Mode — Design Spec

**Date:** 2026-04-14
**Author:** Jason Roell
**Status:** Design approved; implementation plan pending
**Target release:** gitgang v1.7.0

## Summary

Add an interactive (REPL) mode to gitgang that lets users converse with the three-agent ensemble (gemini / claude / codex) over multiple turns. Each turn either answers a question (synthesized from all three agents with explicit agreement/disagreement analysis) or drives a code change (via the existing worktree-and-reviewer pipeline, gated by an explicit merge confirmation). A Claude Code instance runs as the orchestrator each turn: it classifies intent, verifies cross-agent claims by browsing the code, and emits a structured synthesis.

## Motivation

Gitgang today is one-shot: `gg "task"` fires three agents in parallel, a reviewer picks the best merge, auto-merges, opens a PR, and exits. That flow is great for well-scoped tasks, but it does not support:

- **Questions** — "how does auth work here?" requires no code changes, yet still benefits from three perspectives reconciled against the actual code.
- **Iteration** — "try that again, but ..." requires re-running with added context rather than starting a fresh one-shot.
- **Exploration** — users often want to understand a codebase before deciding whether to change it.

Adding an interactive mode covers these while leaving the one-shot path untouched.

## Decisions Settled During Brainstorming

| # | Decision | Resolution |
|---|----------|------------|
| Q1 | Invocation surface | Bare `gg` enters interactive; `gg -i` alias; `gg -i "opener"` pre-loads first turn; `gg "task"` remains one-shot unchanged. |
| Q2 | Question-vs-code router | Orchestrator classifies intent as the first step of its system prompt (no separate LLM call). Users can force a mode with `/ask` or `/code` slash prefixes. |
| Q3 | What the orchestrator *is* | A fresh `claude --print` process spawned per turn. Receives history + sub-agent outputs via stdin, uses Claude Code's built-in Read / Grep / Glob / Bash tools to verify. |
| Q4 | Sub-agent fan-out mechanism | Full existing worktree + YOLO plumbing on every turn, including pure questions. Sub-agents may emit diffs freely; the orchestrator decides what (if anything) to merge. |
| Q5 | Merge behavior in interactive code-mode | Show-and-confirm: print the merge plan + `Merge this? [y/N/e]`. One-shot mode keeps auto-merge. Session default overridable via `/set automerge`. |

## Architecture

Three layers:

```
┌─────────────────────────────────────────┐
│  REPL loop (src/repl.ts)                │
│  - readline prompt + slash parser        │
│  - session log writer                    │
│  - worktree lifecycle manager            │
└────────────────┬────────────────────────┘
                 │ per-turn fan-out
    ┌────────────┼────────────┐
    ▼            ▼            ▼
┌────────┐  ┌────────┐  ┌────────┐
│ gemini │  │ claude │  │ codex  │  ← existing spawn-in-worktree
│ agent  │  │ agent  │  │ agent  │     plumbing (YOLO, parallel)
└───┬────┘  └───┬────┘  └───┬────┘
    │ text+diff │ text+diff │ text+diff
    └───────────┼───────────┘
                ▼
        ┌───────────────┐
        │ Orchestrator  │  ← fresh `claude --print` per turn
        │ (Claude Code) │     tools: Read/Grep/Glob/Bash
        └───────────────┘
```

The REPL is additive — it is a new process mode that reuses existing agent-spawning, reviewer-prompt, and merge-application functions rather than reimplementing them.

## Session Lifecycle

1. **Start** — `gg` or `gg -i [opener]`. Creates `.gitgang/sessions/<ISO-timestamp>-<shortid>/` with `session.jsonl`, `metadata.json`, `worktrees/`, `debug/`. Prints banner + `/help` hint.
2. **Opener** — when passed, queued as the first user turn automatically.
3. **Turn loop** — read user input → detect slash command → run turn → render output → loop.
4. **First Ctrl+C** — cancel current turn (SIGTERM sub-agents and/or orchestrator), clean worktrees, return to prompt.
5. **Second Ctrl+C / EOF / `/quit` / `/exit`** — exit. Session log stays; worktrees cleaned.
6. **Resume** — `gg -i --resume` picks most-recent session in repo; `gg -i --resume <id>` targets specific one. Replays session log as conversation history on next turn; does not re-run past turns or restore worktrees.

## Turn Execution Flow

On receipt of user input:

1. **Slash-command parse.** Plain text → auto-classification by orchestrator. `/ask X` forces ask mode; `/code X` forces code mode; other commands (e.g. `/merge`, `/pr`, `/help`) bypass the fan-out entirely.
2. **Log user event.** Append to `session.jsonl` as `{ type: "user", ... }`.
3. **Create three worktrees** under `sessions/<id>/worktrees/turn-<N>/{gemini,claude,codex}` using existing `createWorktree()`.
4. **Fan out in parallel** using existing agent spawn functions. Each agent receives the full conversation history plus the current user message plus a note that a text answer is expected and a diff is optional. Timeout and failure semantics match current one-shot mode.
5. **Collect results** per agent: `{ status, stdout_tail (~8KB), diff_summary, diff_paths, branch }`.
6. **Spawn orchestrator** (`claude --print`) with structured JSON piped to stdin (see Orchestrator Contract). The orchestrator classifies intent, browses code if it needs to, and emits structured JSON to stdout.
7. **Render** synthesis to terminal (see Output Rendering).
8. **Conditional merge step** — only runs when `intent === "code"`:
   - `automerge === "on"` → apply the merge plan immediately, no prompt (one-shot-style).
   - `automerge === "ask"` (default) → prompt `Merge this? [y/N/e]`. `y` applies the plan; `N` discards agent branches; `e` opens `$EDITOR` on the merge-plan JSON, then re-prompts.
   - `automerge === "off"` → do not prompt, do not merge. Agent branches are retained. User runs `/merge` in a later turn to apply the last stored plan.
9. **Teardown** — remove non-merged worktrees; append `orchestrator` and optional `merge` events to `session.jsonl`; loop.

**Key invariants:**

- Each turn starts fresh from `base`. History lives in prompts, not in branches.
- Ctrl+C during orchestrator preserves agent branches; Ctrl+C during fan-out discards everything.
- If all three agents fail, orchestrator is skipped, user gets `✗ All agents failed. Retry or /quit.` and returns to prompt.

## Orchestrator Contract

### Input (stdin, JSON envelope)

```jsonc
{
  "turn": 3,
  "repo_root": "/abs/path",
  "user_message": "how does auth work",
  "forced_mode": null,           // "ask" | "code" | null
  "history": [
    { "turn": 1, "user": "...", "assistant": "..." },
    { "turn": 2, "user": "...", "assistant": "..." }
  ],
  "agents": [
    {
      "id": "gemini",
      "model": "gemini-3.1-pro-preview",
      "status": "ok",            // "ok" | "failed" | "timeout"
      "branch": "agents/gemini/turn-3",
      "stdout_tail": "<last ~8KB>",
      "diff_summary": "<git diff --stat or empty>",
      "diff_paths": ["src/auth.ts"]
    },
    { "id": "claude", ... },
    { "id": "codex",  ... }
  ]
}
```

### System prompt (fixed per release)

```
You are the orchestrator for a multi-agent code assistant. On each turn:

1. CLASSIFY the user's intent as "ask" (wants an answer) or "code" (wants
   code changes). If `forced_mode` is set, use it instead.

2. BROWSE THE CODE as needed to verify or reconcile what the sub-agents say.
   You have Read, Grep, Glob, and Bash (read-only git commands only). When
   sub-agents disagree, prefer ground truth from the code over any single
   agent's claim.

3. SYNTHESIZE a single response with this JSON shape — no prose outside it:

{
  "intent": "ask" | "code",
  "agreement": ["claim every successful agent made"],
  "disagreement": [
    {
      "topic": "short title",
      "positions": { "gemini": "...", "claude": "...", "codex": "..." },
      "verdict": "what's actually true based on code inspection",
      "evidence": ["path:line", "..."]
    }
  ],
  "best_answer": "the full synthesized answer, markdown OK",
  "merge_plan": {           // only when intent = "code"
    "pick": "gemini" | "claude" | "codex" | "hybrid",
    "branches": ["agents/claude/turn-3"],
    "rationale": "why this merge",
    "followups": []
  }
}

Cite file paths with `path:line` when using evidence. If all successful
agents agree and your code inspection confirms, `disagreement` is [].
If an agent failed, note it in `agreement` rather than in positions.
```

### Output rendering (terminal)

```
▸ Answer
<best_answer markdown, rendered>

✓ All 3 agents agree:
  • <agreement item 1>

⚠ Disagreement: <topic>
  gemini: <position>
  claude: <position>
  codex:  <position>
  → Verdict: <verdict>  [evidence: src/auth.ts:42]

[code-mode only]
▸ Proposed merge: claude's branch
  agents/claude/turn-3 — 2 files changed, 34 insertions(+), 8 deletions(-)
  Rationale: <rationale>
  Merge this? [y/N/e]
```

**Rendering rules:**

- If `agreement` and `disagreement` are both empty and `best_answer` is short, render a compact `✓ All agents aligned.` footer only.
- Evidence `path:line` references are printed but not hyperlinked in v1.
- If orchestrator stdout is not valid JSON against the schema, render raw text with a `⚠ Orchestrator output unparseable` banner and skip the merge prompt.

### merge_plan compatibility

The `merge_plan` object reuses the schema of today's reviewer output, so the existing `applyMergePlan()` function is a drop-in target with no changes required.

## Slash Commands (MVP)

| Command | Effect |
|---|---|
| `/ask <msg>` | Force question-mode; no merge prompt this turn |
| `/code <msg>` | Force code-mode |
| `/merge` | Apply the previous turn's merge plan (used after saying `N` and reconsidering) |
| `/pr` | Open a PR for the most recently merged branch |
| `/history` | Print the session transcript |
| `/set automerge on\|off\|ask` | Session-scoped merge behavior: `on` = auto-merge; `ask` = prompt (default); `off` = never prompt, retain branches for explicit `/merge` |
| `/set <key> <value>` | Set any supported runtime knob (timeout, models, reviewer, yolo) |
| `/agents` | Show current agent roster + models |
| `/help` | List commands |
| `/quit` / `/exit` | Exit (Ctrl+D also works) |

**Deferred to v2** (explicitly not in MVP): `/rerun`, `/only <agent>`, `/skip <agent>`, `/retry <agent>`, `/clear`, `/undo`, session export.

## CLI Surface

| Invocation | Behavior |
|---|---|
| `gg` | Interactive, new session |
| `gg -i` / `gg --interactive` | Same as above |
| `gg -i "opener text"` | Interactive with first turn pre-loaded |
| `gg -i --resume` | Resume most-recent session in this repo |
| `gg -i --resume <session-id>` | Resume specific session |
| `gg -i --automerge on\|off\|ask` | Session default (default `ask`) |
| `gg -i --session-dir <path>` | Override session root |
| `gg sessions list` | Show recent sessions for this repo |
| `gg sessions show <id>` | Print transcript |
| `gg "task"` | **Unchanged** — one-shot mode, auto-merge, auto-PR |

All existing one-shot flags (`--model-gemini`, `--reviewer`, `--rounds`, `--yolo`, post-merge check flags, etc.) work with `-i` and become session defaults. `--rounds` is almost always `1` in interactive since iteration happens conversationally.

## Persistence — On-Disk Layout

```
<repo>/.gitgang/
├── config.json                    # optional per-repo defaults
└── sessions/
    └── 2026-04-14T19-30-12-abc123/
        ├── metadata.json          # models, reviewer, automerge, start time
        ├── session.jsonl          # append-only turn log
        ├── worktrees/             # ephemeral, torn down after each turn
        └── debug/                 # orchestrator input/output per turn
            ├── turn-001-input.json
            └── turn-001-output.json
```

### `session.jsonl` event schema

```jsonc
{ "ts":"...", "turn":1, "type":"user",         "text":"...", "forced_mode":null }
{ "ts":"...", "turn":1, "type":"agent_start",  "agent":"gemini", "branch":"..." }
{ "ts":"...", "turn":1, "type":"agent_end",    "agent":"gemini", "status":"ok", "diff_summary":"..." }
{ "ts":"...", "turn":1, "type":"orchestrator", "payload": { /* synthesis JSON */ } }
{ "ts":"...", "turn":1, "type":"merge",        "branch":"...", "outcome":"merged"|"declined"|"pr_only" }
```

### Resume semantics

- Load `session.jsonl`; extract `user` + `orchestrator.best_answer` pairs into the history array fed to the next turn's agents and orchestrator.
- Do not re-run past turns; do not restore worktrees.
- If the last event is an `agent_start` with no matching `agent_end`, print `(turn N was interrupted; ignoring)` and proceed from turn N+1.

### Config precedence (highest wins)

CLI flag > slash command (`/set`) > `.gitgang/config.json` > env var > built-in default.

### Gitignore

The install/postinstall step checks for `.gitgang/` in the repo's `.gitignore` and appends it if missing.

## Error Handling

| Failure | Behavior |
|---|---|
| 1–2 agents fail/timeout | Orchestrator still runs with partial results + failure notices (reuses existing `successfulAgents` plumbing). |
| All 3 agents fail | Skip orchestrator. Print `✗ All agents failed. Retry or /quit.`. Return to prompt. |
| Orchestrator crashes or emits non-JSON | Print raw stdout with `⚠ Orchestrator output unparseable — showing raw text. No merge plan available.` Agent branches retained for inspection. |
| Merge conflict applying plan | Print conflict details. Preserve agent branches. Return to prompt. |
| Ctrl+C during fan-out | SIGTERM agents, clean worktrees, print `(turn N cancelled)`. |
| Ctrl+C during orchestrator | SIGTERM orchestrator, preserve agent branches, print paths so user can diff manually. |
| Dirty working tree at session start | Refuse to launch (`ensureCleanTree()`): `Commit or stash changes before starting an interactive session.`. |
| Session log corruption on resume | Parse valid lines; log bad lines to `debug/resume-errors.log`; continue. Unrecoverable errors fail loud. |
| Orphaned worktrees from prior crash | Detect on startup; auto-remove with a one-line notice. |
| Long history (>50 KB) | Print `ℹ History is getting long (~Nk). Consider /quit and starting fresh.`. No auto-summarize in v1. |

## Testing Strategy

- **Pure unit tests** (majority of coverage): slash command parser; session log event reader/writer; orchestrator input envelope builder; orchestrator output renderer (synthesis JSON → ANSI-colored string).
- **REPL integration tests**: the REPL reads from a `Readable` and writes to a `Writable`, both injectable. Tests use `PassThrough` streams to drive input and capture output. Mock `spawnAgentInWorktree` and `spawnOrchestrator`. Assert rendered output + `session.jsonl` events. No TTY emulation; no real subprocess spawning.
- **One real-agent smoke test** gated behind `GITGANG_SMOKE=1`, runs against a tiny fixture repo; manual pre-release validation only, not in CI.
- Reuses existing vitest + `cli.integration.test.ts` infrastructure — no new test framework.

## Scope Boundaries

**Explicitly IN v1:**

- Everything above.

**Explicitly OUT of v1** (to prevent scope creep):

- Voice / speech input
- Web UI, TUI, split panes (stays plain `readline` output)
- Multi-repo sessions
- Branching / forked conversation history
- Automatic PR updates across turns — each `/pr` opens a fresh PR
- Custom tool definitions for the orchestrator beyond Claude Code's built-ins
- Non-Claude orchestrator (the abstraction allows it; v1 ships Claude-only)
- `/rerun`, `/only`, `/skip`, `/retry`, `/clear`, `/undo` slash commands
- Auto-summarization of long histories
- Session export to markdown (achievable later via `/history > file` shell redirection)

## Open Questions / Follow-Ups

- **Pricing visibility** — each interactive turn spawns 3 agents with YOLO enabled + an orchestrator. Token/cost per turn could be substantial. A `/cost` command showing running session spend is a likely v2 addition once the loop is proven.
- **Per-repo config file discoverability** — `.gitgang/config.json` starts undocumented; a `gg init` command to scaffold it is a candidate v2 add.
- **Session GC** — session dirs accumulate. A `gg sessions prune --older-than 30d` command is v2.

## Files Expected to Change / Add

New files:
- `src/repl.ts` — the REPL loop itself
- `src/session.ts` — session-dir layout, log reader/writer
- `src/orchestrator.ts` — orchestrator spawn + envelope builder + output parser
- `src/slash.ts` — slash command parser + dispatch
- `src/repl.test.ts`, `src/session.test.ts`, `src/orchestrator.test.ts`, `src/slash.test.ts`

Modified files:
- `src/cli.ts` — flag parsing for `-i` / `--resume` / `sessions` subcommand; dispatch to REPL vs one-shot; export existing `spawnAgentInWorktree` and `applyMergePlan` for reuse
- `README.md` — interactive mode usage section
- `CHANGELOG.md` — v1.7.0 entry
- `package.json` — version bump

No changes expected to existing one-shot code paths beyond extracting reusable helpers.
