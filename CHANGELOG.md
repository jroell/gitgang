# GitGang Changelog

## Unreleased

**Pair mode is now the default when you run `gg` with no arguments.**

- `gg` (bare) prompts for a task and then enters pair mode with `claude` as coder and `codex` as reviewer.
- `gg pair` (no flags) uses the same defaults — `--coder` and `--reviewer` are now optional everywhere; previously both were required.
- Empty prompt / Ctrl+C / Ctrl+D cancels cleanly with exit 0 — no session directory or worktree is created.
- Outside a git repository, bare `gg` falls back to the v1.8.1 read-only interactive Q&A mode instead of crashing (pair mode needs worktrees, which need a git repo).
- `gg -i` still starts the interactive REPL; `gg "task"` still runs the one-shot multi-agent flow. Scripts that passed a task positionally or used `-i` keep working unchanged.
- Help text updated: the new Usage block shows pair-as-default, with an explicit "Pair Mode" section listing override flags (`--coder`, `--reviewer`, `--no-yolo`, `--timeout`).
- `gg --solo <agent> "task"` now skips the reviewer loop entirely, auto-merges the successful agent branch into the generated merge branch, and exits 0 when that merge is clean.
- The default Claude model is now `claude-opus-4-7` across GitGang flows. Use `GITGANG_CLAUDE_MODEL` or `--model-claude` to override it per environment or per run.

**Note for returning users**: if you typed bare `gg` expecting the interactive REPL (the v1.7.0–v1.9.x default), use `gg -i` from now on.

**Tests**: 555 passing (+4 new assertions covering the new defaults and relaxed pair parsing).

## v1.8.1 — 2026-04-15

Non-git Q&A mode — gitgang now works like Claude Code: you can run `gg -i` from any directory, not just git repos.

**New: read-only Q&A mode outside git**

- Running `gg -i` from a non-git directory no longer fails. Instead, gitgang enters a read-only Q&A mode: agents can read files in your cwd (via their Read/Grep/Glob tools) but are explicitly told not to edit anything. No worktrees, no merges, no `/pr`.
- Session storage moves to `~/.gitgang/sessions/` globally when outside a repo (inside one, it stays at `<repo>/.gitgang/sessions/` as before).
- `/merge` and `/pr` surface a friendly "requires a git repo — run `git init` here" message instead of crashing.
- Clear startup banner explains the mode and points at `git init` for full flow.
- `gg doctor`'s "git: in repo" check degrades from ✗ to ⚠ — it no longer fails the exit code outside repos, matching how users actually run this tool.

**Implementation highlights**

- New `findRepoRoot(): Promise<string | null>` non-throwing twin of `repoRoot()`. Callers that can tolerate non-git context use it; the one-shot path stays strict.
- `RealFanOutConfig.noGit` flag: when true, `createRealFanOut` skips worktree creation and runs each agent with `cwd = process.cwd()`. Prompt files go to the logsDir to keep the user's directory clean.
- `buildTurnPrompt.readOnly`: prepends a prominent READ-ONLY section naming forbidden mutating commands (`git init`, `git commit`, `rm`, `touch`, etc.) and explicitly whitelisting read-only tools (Read, Grep, Glob, `ls`, `cat`, `git log`). The trailing reminder is also swapped to "No file edits. No mutating shell commands."
- Full suite: 548 tests passing (+11 new, covering `findRepoRoot`, `readOnly` prompt shape, command whitelist, section ordering).

**Migration**: none. Existing git-mode behavior is unchanged.



## v1.8.0 — 2026-04-15

Massive additive release. First npm publish since v1.6.0; bundles all work from the in-repo v1.7.0 + v1.7.1 + an overnight 17-feature polish pass. No breaking changes — every existing command still works exactly as in v1.6.0.

### Interactive REPL mode

- **`gg`** or **`gg -i`** — enters an interactive session. Each turn fans out to all three agents (gemini, claude, codex) in parallel worktrees; a fresh Claude Code orchestrator classifies intent, browses the code to verify claims, and emits a structured synthesis with explicit agreement/disagreement analysis, per-agent positions, and evidence citations (`path:line`).
- **Question-mode turns** end with the synthesis.
- **Code-mode turns** default to show-and-confirm merges (`Merge this? [y/N/e]`). Configure with `--automerge on|off|ask` or `/set automerge`.
- Sessions persist to `.gitgang/sessions/<id>/`. Resume with `gg -i --resume` (most-recent) or `gg -i --resume <id>`. One-shot mode (`gg "task"`) is unchanged.
- Full conversation history, session metadata, and per-turn agent outputs archived to disk.

### Slash commands inside a session

| Command | Effect |
|---|---|
| `/ask <msg>` | Force question-mode for this turn |
| `/code <msg>` | Force code-mode for this turn |
| `/only <agent> <msg>` | Run one turn with only gemini, claude, or codex |
| `/skip <agent> <msg>` | Run one turn skipping one agent (rate limits, etc.) |
| `/merge` | Apply a declined or deferred merge plan from a prior turn |
| `/pr` | Push current branch and open a PR with structured description |
| `/diff [agent]` | Show `git diff base...branch` for picked or named agent's work |
| `/redo` | Re-execute the last user message as a fresh turn |
| `/clear` | Forget in-context history (past turns stay on disk for sessions-show) |
| `/history` | Print the session transcript |
| `/agents` | Show agent roster and models |
| `/set K V` | Set a runtime knob (e.g. `/set automerge on`) |
| `/help`, `/quit` | Standard |

### Session-management toolkit

| Command | Purpose |
|---|---|
| `gg sessions list` | List recent sessions with Topic column |
| `gg sessions show <id>` | Print a past session transcript |
| `gg sessions stats <id>` | Aggregate summary (turns, duration, agent success/fail, merges) |
| `gg sessions export <id>` | Full markdown transcript to stdout (or `--output PATH`) |
| `gg sessions search <query>` | Case-insensitive substring search across user messages + answers |
| `gg sessions delete <id> --yes` | Remove a single session |
| `gg sessions prune --older-than <duration> [--yes]` | Bulk delete old sessions (dry-run by default) |

### New top-level subcommands

- **`gg doctor`** — environment health check (Node version, `git`/`gemini`/`claude`/`codex` binaries, API keys, git-repo status, `.gitgang/` writability). Color-coded output with fix hints; exit 1 on any required-check failure.
- **`gg init`** — scaffolds `.gitgang/config.json` with documented per-repo defaults (`automerge`, `reviewer`, `heartbeatIntervalMs`, `timeoutMs`, `models`). CLI flags > env vars > config file > built-in defaults.
- **`gg completions bash|zsh|fish`** — emits shell completion scripts for tab-completion of subcommands.
- **`--json`** output mode on `gg sessions list`, `gg sessions stats`, and `gg doctor` for scripting and `jq` pipelines.

### UX improvements

- **Live per-agent progress** during each turn: transition markers (`▸ gemini started`, `✓ codex done`, `✗ claude failed`, `⏱ gemini timeout`) plus a 30s heartbeat line summarizing running agents.
- **Terminal markdown rendering** of the orchestrator's `bestAnswer` — headers in bold cyan, code blocks in a fenced gutter, inline code highlighted, lists, blockquotes, and linkified URLs.
- **Smart PR descriptions** — `/pr` writes a structured markdown body from the session log (summary / merge plan / disagreements / conversation excerpt / signature) instead of `gh pr create --fill`'s generic git-log output.
- **Per-agent log files** at `<session>/logs/turn-N/<agent>.log` — full stdout, prompt, status, timing archived for every agent. Survives worktree cleanup.
- **Ctrl+C handler** — first press cancels the active turn by SIGTERM'ing active sub-agents; second press within 3 seconds exits cleanly.
- **Long-history warning** — one-line hint when accumulated conversation exceeds ~50KB.
- **Orphaned-worktree cleanup** on session start.
- **Session log diagnostics** — malformed `session.jsonl` lines recorded to `debug/resume-errors.log` during resume.
- **Hybrid merges** — multi-branch merge plans now apply every listed branch sequentially (previously silently used only the first).

### Bug fixes and stability

- Fixed Gemini default model name — now uses `gemini-3.1-pro-preview` (was the invalid `gemini-3.1-pro`, which 404'd on every request).
- Fixed hard-coded `main` base branch in interactive mode — now detects current branch dynamically (was broken for `master`-default repos).
- Added `ensureCleanTree` guard at interactive session start (spec said "refuse dirty trees"; wasn't actually called).
- Added `.gitgang/` and `.worktrees/` to install-time gitignore.
- Removed stale `src/cli.ts.bak` committed to the repo.

### Developer notes

- Tests: **537 passing** across 21 test files (up from ~150 at v1.6.0).
- All new features built with strict TDD against dependency-injected interfaces — every subprocess, stream, and fs op has a test double.
- 17 new modules with isolated unit tests: `src/session.ts`, `src/repl.ts`, `src/orchestrator.ts`, `src/renderer.ts`, `src/markdown.ts`, `src/turn.ts`, `src/slash.ts`, `src/confirm.ts`, `src/doctor.ts`, `src/config.ts`, `src/completions.ts`, plus `src/interactive.integration.test.ts`.
- Built bundle: ~130KB (up from ~70KB at v1.6.0).

### Migration

Nothing. Every v1.6.0 invocation still works unchanged. Interactive mode, sessions, doctor, init, completions, and `--json` are all additive.



## v1.7.1 — 2026-04-15

Polish and hardening pass on interactive mode. No breaking changes.

**New features**

- **`/merge` and `/pr` commands are now real.** `/merge` applies the most recent orchestrator merge plan that was declined or deferred (useful after answering `N` on a prompt). `/pr` pushes the current branch with `-u origin` and runs `gh pr create --fill` for the most recently merged branch.
- **Ctrl+C handler.** First press cancels the active turn by sending `SIGTERM` to every running sub-agent and the orchestrator. A second press within 3 seconds exits the session with code 130.
- **Hybrid merge plans merge every listed branch.** Previously only `branches[0]` was applied with a warning; `pick: "hybrid"` with multiple branches now runs `git merge --no-ff` for each in order, aborting the whole operation on any conflict.
- **Long-history warning.** After each turn, if the accumulated conversation exceeds ~50 KB, a one-line hint suggests `/quit` and a fresh session.
- **Orphaned worktree cleanup on startup.** If a prior session crashed and left `turn-N/` directories behind, new sessions remove them and print a one-line notice.
- **Corrupt session log diagnostics.** Malformed lines in `session.jsonl` now get recorded (with line number, reason, and raw text) to `debug/resume-errors.log` during resume.
- **Cleaner merge prompt rendering.** `"Merge this? [y/N/e]"` is now written only when the prompt will actually read input (automerge mode `ask`). In `automerge=off` mode, a `"Branches retained. Use /merge to apply the plan."` message replaces the misleading prompt.

**Internal changes**

- New exports from `src/session.ts`: `findPendingMergePlan(events)`, `findLastMergedBranch(events)`, `readEventsWithErrors(logPath)`, `readEventsLogged(logPath, debugDir)`.
- New exports from `src/repl.ts`: `cancelActiveChildren()`, `activeChildCount()`, `estimateHistoryBytes(history, userMessage, output)`, `LONG_HISTORY_WARN_BYTES`.
- New export from `src/cli.ts`: `cleanOrphanedWorktrees(worktreesDir, stderr)`.
- Tests: 253/253 passing (+19 since v1.7.0).

## v1.7.0 — 2026-04-15

**New: Interactive mode**

- `gg` or `gg -i` enters an interactive REPL. Every turn fans out to all three agents; a fresh Claude Code orchestrator classifies intent, browses the code, and emits a structured synthesis.
- Question-mode turns show agreement across agents, explicit disagreement with per-agent positions, the orchestrator's verdict, and a synthesized best answer.
- Code-mode turns default to show-and-confirm merges (`Merge this? [y/N/e]`). Configure with `--automerge on|off|ask` or `/set automerge ...`.
- Sessions persist to `.gitgang/sessions/<id>/`. Resume with `gg -i --resume`. List with `gg sessions list`.
- One-shot mode (`gg "task"`) is unchanged.

**Also in this release**

- Default Gemini model: `gemini-3.1-pro-preview` (was the invalid `gemini-3.1-pro`).

**Known limitations (v1.7.0 ships these, fixes coming in v1.7.1)**

- `/merge` and `/pr` slash commands are placeholders and print a "not yet implemented" message.
- Hybrid merge plans (multiple branches) fall back to applying only the first branch with a warning.
- Base branch is hard-coded to `main` in interactive mode; `master` repos should switch default or use one-shot mode for now.
- The "Merge this? [y/N/e]" prompt line is printed by the synthesis renderer even in `automerge=on` and `automerge=off` modes where the prompt isn't actually read — visually misleading but harmless.

## [1.4.0] - 2025-11-03

### Added
- **Smart JSON Stream Parsing**: Automatically parses and filters JSON output from AI agents
- **Message Type Detection**: Identifies thinking, tool_use, exec, assistant, and system messages
- **Emoji Indicators**:
  - 💭 for thinking/reasoning steps
  - 🔧 for tool usage
  - $ for shell commands
  - ⚙️ for initialization
  - 🚀 for agent startup banner

### Improved
- **Color-Coded Agent Output**:
  - [GEMINI] in Magenta
  - [CLAUDE] in Yellow
  - [CODEX] in Green
- **Cleaner Console Output**: Filters out verbose JSON metadata, session IDs, and timestamps
- **Better Section Headers**: Clear visual separation between initialization, agent startup, and execution
- **Enhanced Banner Display**: More informative startup banner with repository, branch, and task details

### Changed
- Refactored `streamToLog()` to process lines individually with intelligent filtering
- Added `shouldDisplayLine()` filter function to hide unnecessary metadata
- Created `formatMessage()` to provide consistent, human-readable formatting
- Updated initial help message location to avoid duplication

### Technical Details
- New interfaces: `StreamMessage` for typed JSON parsing
- Line-buffering logic to handle incomplete JSON chunks
- Preserved all raw output in `.logs/` files for debugging
- No changes to command-line interface or usage

### Migration
No breaking changes. Drop-in replacement for v1.3.x.

```bash
npm install -g gitgang@1.4.0
```

---

## [1.3.2] - Previous

- Initial gitgang release with three-agent orchestration
- Support for Gemini, Claude, and Codex agents
- Git worktree isolation
- Interactive command palette (/status, /logs, /nudge, etc.)
- Automatic PR creation option
