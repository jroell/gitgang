# GitGang Changelog

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
