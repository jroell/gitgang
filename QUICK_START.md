# Quick Start: GitGang

## Install

```bash
npm i -g gitgang@latest
gg --version   # should print 1.9.x
```

Ensure at least two of the AI CLIs are on your `PATH`:

```bash
# Pair mode needs ≥2 of: claude, codex
# Interactive mode needs all 3: gemini, claude, codex
gg doctor      # checks everything and prints fix hints
```

## Pair Mode (default)

Bare `gg` enters AI pair programming — one agent codes while another reviews in real-time.

```bash
gg                          # prompts for a task, then pair mode (claude + codex)
gg "add JWT auth middleware" # pair mode with that task
gg pair --coder codex --reviewer claude "refactor auth"  # swap roles
```

The coder works normally while the reviewer monitors in parallel. If the reviewer spots a problem, it pauses the coder and the two agents have an autonomous conversation until they agree. When the coder finishes, the reviewer does a final pass and you get a session summary.

### Pair Mode Options

```bash
--coder <agent>          # claude (default) or codex
--reviewer <agent>       # codex (default) or claude
--review-interval <dur>  # how often reviewer checks (default: 45s)
--timeout <dur>          # total session timeout (default: 30m)
--no-yolo                # require human approval for agent actions
```

## Interactive Mode

Multi-agent Q&A and code synthesis with all three agents:

```bash
gg -i                        # enter interactive REPL
gg -i "how does auth work"   # pre-load first question
```

Each turn fans out to Gemini, Claude, and Codex in parallel. An orchestrator synthesizes their answers with agreement/disagreement analysis and code citations.

### Slash Commands

```
/ask <msg>     force question mode
/code <msg>    force code mode
/merge         apply the previous turn's merge plan
/pr            open a PR for the last merge
/diff [agent]  show diff for an agent's branch
/redo          re-run the last message
/history       print transcript
/agents        show agent roster
/set K V       set a runtime knob (e.g. /set automerge on)
/help          list commands
/quit          exit
```

## Non-Git Q&A

Run `gg -i` from any directory, even outside a git repo. Agents answer in read-only mode — no file mutations, no worktrees.

Outside a git repo, bare `gg` also falls back to this read-only Q&A mode.

## One-Shot Mode

Fire-and-forget parallel execution with automatic merge:

```bash
gg "Add user authentication" --agents gemini,claude,codex
gg --solo claude "Fix the auth middleware and merge the result"
```

`--solo <agent>` runs a single agent, skips the reviewer/comparison loop, and auto-merges that agent's branch if the run completes cleanly.

## Session Management

```bash
gg sessions list             # list recent sessions
gg sessions show <id>        # print transcript
gg sessions stats <id>       # summary counts
gg sessions search <query>   # full-text search
gg -i --resume               # resume most-recent session
gg -i --resume <id>          # resume a specific session
```

## Environment Check

```bash
gg doctor         # color-coded health check
gg doctor --json  # machine-readable for CI
```

## Configuration

```bash
gg init   # scaffold .gitgang/config.json
```

Priority: CLI flags > env vars > config.json > built-in defaults.

Model overrides: `GITGANG_GEMINI_MODEL`, `GITGANG_CLAUDE_MODEL`, `GITGANG_CODEX_MODEL`.

## Troubleshooting

### "Not in a git repository"
Pair mode and one-shot mode require a git repo. For read-only Q&A, `gg -i` works anywhere.

### "Working tree not clean"
Commit or stash changes first:
```bash
git add -A && git commit -m "WIP"
```

### Agent CLI not found
```bash
gg doctor   # shows which CLIs are missing with install hints
```

## Documentation

- `README.md` — Full reference
- `CHANGELOG.md` — Version history
- `CLAUDE.md` — Developer context

## Support

- GitHub Issues: https://github.com/jroell/gitgang/issues
- npm Package: https://www.npmjs.com/package/gitgang
