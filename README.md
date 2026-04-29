# 🤘 GitGang

> The gang's all here to code — Multi-agent AI orchestration for autonomous software development

**GitGang** is a CLI that coordinates multiple AI coding agents to collaboratively solve complex tasks. It runs in three modes: **Pair Mode** for autonomous AI pair programming, **Interactive Mode** for multi-agent Q&A and code synthesis, and **One-Shot Mode** for fire-and-forget parallel execution with automatic merge.

[![npm version](https://img.shields.io/npm/v/gitgang.svg)](https://www.npmjs.com/package/gitgang)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ Features

- **AI Pair Programming** (`gg pair`): One agent codes while another reviews in real-time — they discuss disagreements autonomously and course-correct without human intervention
- **Multi-Agent Collaboration** (`gg -i`): Three agents (Gemini, Claude, Codex) solve tasks in parallel with orchestrated synthesis
- **Premium Terminal UI**: Dracula-themed interface with colored tool call panels, edit diffs, insight boxes, spinners, and a live status bar
- **Autonomous Operation**: Agents work independently — pair mode runs fully unattended with a session summary at the end
- **Git Worktree Isolation**: Each agent works in its own branch (multi-agent mode)
- **Extensible Architecture**: Agent backend interface designed for adding new CLI tools (ForgeCode, Hermes/OpenRouter, etc.)
- **Non-Git Q&A Mode**: Run from any directory — agents answer questions in read-only mode
- **Single-File Bundle**: Lightweight Node CLI built with esbuild

## 📦 Installation

```bash
npm i -g gitgang@latest
```

### Prerequisites

GitGang works with these AI CLI tools. Install the ones you plan to use:

| CLI | Model | Required For |
|-----|-------|-------------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Claude Opus 4 | Pair mode, interactive mode |
| [Codex CLI](https://github.com/openai/codex) | GPT-5.4 | Pair mode, interactive mode |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Gemini 2.5 Pro | Interactive mode |

- **Pair mode** requires at least 2 of: `claude`, `codex`
- **Interactive mode** requires all 3: `gemini`, `claude`, `codex`
- All CLIs must be available on your `PATH`

## 🤝 Pair Mode — AI Pair Programming

Pair mode is the flagship feature and the **default when you run bare `gg`**. One agent codes while another acts as a real-time reviewer — like having a senior engineer watching over your shoulder, catching mistakes before they compound.

```bash
gg "implement JWT authentication middleware"          # pair mode (default)
gg pair --coder claude --reviewer codex "same task"   # explicit pair mode
```

Running `gg` with no arguments prompts for a task and then enters pair mode with `claude` as coder and `codex` as reviewer. Outside a git repo, bare `gg` falls back to read-only interactive Q&A mode instead.

### How It Works

1. **The coder works normally** — writes code, reads files, runs tests, exactly as it would in a solo session
2. **The reviewer monitors in parallel** — periodically checks the coder's output without interrupting it
3. **If the reviewer spots a problem** — it suspends the coder (SIGTSTP), and the two agents have an autonomous conversation to discuss the concern
4. **They talk it out** — the coder explains its reasoning, the reviewer pushes back or agrees, they go back and forth until they're aligned
5. **The coder resumes** — with the full conversation context, incorporating any agreed-upon changes
6. **Final review** — when the coder finishes, the reviewer does a thorough check of the completed work
7. **Session summary** — a concise report of what changed, decisions made, disagreements resolved, and follow-up items

### Pair Mode Options

```bash
gg pair --coder claude --reviewer codex "your task"
gg pair --coder codex --reviewer claude "fix the N+1 query in users endpoint"
gg pair --coder claude --reviewer claude "refactor auth module" --review-interval 30s
```

| Flag | Description | Default |
||------|-------------|---------|
|| `--coder` | Agent that writes code (`claude` or `codex`) | `claude` |
|| `--reviewer` | Agent that reviews (`claude` or `codex`) | `codex` |
|| `--review-interval` | How often the reviewer checks | `45s` |
|| `--max-interventions` | Max reviewer pause cycles before forcing completion | `5` |
|| `--timeout` | Total session timeout | `30m` |
|| `--yolo` / `--no-yolo` | Auto-approve agent actions | `true` |

### What You See

Pair mode streams the coder's full activity to your terminal with a premium TUI:

- **Tool calls** with colored header bars — Read (cyan), Edit (orange with red/green diff), Write (green), Bash (yellow)
- **Thinking** in dim italic with left borders
- **Insight blocks** in purple rounded boxes
- **File contents** and **command output** with bordered panels
- **Reviewer conversations** displayed in styled discussion boxes when they occur
- **Live status bar** at the bottom showing phase, round, elapsed time

### When to Use Pair Mode

- Complex refactors where direction matters early
- Tasks where you'd normally review halfway through
- Working in unfamiliar codebases where a second opinion prevents wrong turns
- When you want to walk away and let agents handle the full cycle autonomously

## 🔄 Interactive Mode

Start a conversational session with all three agents:

```bash
gg -i                        # enters interactive mode
gg -i "how does auth work"   # pre-loads first turn
```

Every turn sends your message to gemini, claude, and codex in parallel worktrees. A Claude Code orchestrator inspects the responses, browses the code to verify claims, and synthesizes an answer with:

- Points of agreement across agents
- Points of disagreement with the orchestrator's verdict and code citations
- A single best answer

For questions, the turn ends with the synthesis. For code changes, the orchestrator proposes a merge plan that you confirm with `[y/N/e]`.

### Non-Git Q&A Mode

Run `gg -i` from **any directory**, even outside a git repo. Agents answer questions in read-only mode — no file mutations, no worktrees.

### Slash Commands

    /ask <msg>     force question mode
    /code <msg>    force code mode
    /merge         apply the previous turn's merge plan
    /pr            open a PR for the last merge
    /diff [agent]  show diff vs base for picked or named agent's branch
    /redo          re-run the last user message as a fresh turn
    /only <agent> <msg>  run this single turn with only one agent
    /skip <agent> <msg>  run this single turn skipping one agent
    /clear         forget conversation so far (log stays on disk)
    /history       print the transcript
    /agents        show the agent roster and models
    /set K V       set a runtime knob (e.g. /set automerge on)
    /help          list commands
    /quit          exit

## 🚀 One-Shot Mode

Fire-and-forget: give a task, all three agents work in parallel, reviewer merges the best solution.

```bash
gg "Add user authentication with JWT tokens"
gg --solo claude "Audit the auth flow and apply the fix directly"
```

Use `--solo <agent>` when you want one agent to work alone. Solo mode skips the reviewer and multi-agent comparison loop, then auto-merges that agent's branch into the generated merge branch. If the agent succeeds and the merge is clean, the run exits with status 0.

### One-Shot Options

| Flag | Description | Default |
|------|-------------|---------|
| `--task` | Task description for agents | First positional arg |
| `--rounds` | Number of review rounds | `3` |
| `--yolo` / `--no-yolo` | Auto-approve agent actions | `true` |
| `--workRoot` | Directory for git worktrees | `.ai-worktrees` |
| `--timeout` | Max runtime (e.g. `25m`, `1h`) | `25m` |
| `--no-pr` | Skip GitHub PR creation | Creates PR by default |
| `--agents` | Comma-separated agent list | `gemini,claude,codex` |
| `--reviewer` | Which agent reviews | `codex` |
| `--solo <agent>` | Run one agent only; skip reviewer/comparison and auto-merge its branch | All three |

## 📂 Session Management

```bash
gg doctor                             # environment health check
gg doctor --json                      # machine-readable (for CI)
gg init                               # scaffold .gitgang/config.json
gg sessions list                      # list recent sessions
gg sessions show <id>                 # print transcript
gg sessions stats <id>                # turn/agent/merge counts
gg sessions search <query>            # find sessions matching text
gg sessions export <id>               # export markdown transcript
gg sessions delete <id> --yes         # remove a session
gg sessions prune --older-than 30d -y # delete old sessions
gg -i --resume                        # resume most-recent session
gg -i --resume <id>                   # resume a specific session
gg completions bash|zsh|fish          # shell completion script
```

Sessions live under `.gitgang/sessions/<id>/`. Outside a git repo, sessions are stored at `~/.gitgang/sessions/`.

## 🏗️ How It Works

### Pair Mode Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  CODER runs naturally, streaming output to terminal          │
│  REVIEWER checks periodically in parallel (coder undisturbed)│
│                                                              │
│  CONTINUE → coder keeps running (zero overhead)              │
│  PAUSE →                                                     │
│    1. SIGTSTP suspends coder (memory preserved)              │
│    2. Reviewer sends concern → coder responds                │
│    3. Autonomous conversation until agreement                │
│    4. Coder resumes via --resume with full context            │
│                                                              │
│  When coder finishes → final review pass                     │
│  COMPLETE → session summary for the human                    │
└──────────────────────────────────────────────────────────────┘
```

### Multi-Agent Mode Architecture

1. **Initialization**: Creates three git worktrees from your current branch
2. **Parallel Execution**: Launches Gemini, Claude, and Codex simultaneously
3. **Real-Time Dashboard**: Live status updates for each agent
4. **Autonomous Development**: Each agent implements independently
5. **Review Loop**: Reviewer compares solutions and merges the best parts
6. **Integration**: Creates merge branch with best solution
7. **PR Creation**: Optionally opens GitHub PR (requires `gh` CLI)

## ⚙️ Configuration

Per-repo configuration via `.gitgang/config.json`:

```bash
gg init  # creates the config file
```

```json
{
  "automerge": "ask",
  "reviewer": "codex",
  "timeoutMs": 1500000,
  "heartbeatIntervalMs": 30000,
  "models": {
    "gemini": "gemini-2.5-pro",
    "claude": "claude-opus-4-6",
    "codex": "gpt-5.4"
  }
}
```

Priority: CLI flags > env vars > config.json > built-in defaults.

Model overrides via environment variables: `GITGANG_GEMINI_MODEL`, `GITGANG_CLAUDE_MODEL`, `GITGANG_CODEX_MODEL`.

## 📋 Requirements

- **Node.js 18+** / **npm**
- **Git** (required for one-shot and code-change modes; interactive Q&A works without git)
- **AI CLI Tools**: `claude` + `codex` for pair mode; all three for interactive mode
- **Terminal**: RGB color support recommended (iTerm2, Ghostty, Warp, Hyper, etc.)
- **macOS** (tested; should work on Linux with the same CLIs installed)

## 🛠️ Development

```bash
git clone https://github.com/jroell/gitgang.git
cd gitgang
npm install
npm run build
node dist/cli.js pair --coder claude --reviewer codex "test task"
```

```bash
npm test  # run test suite
```

## 🎯 Use Cases

| Mode | Best For |
||------|----------|
|| `gg` / `gg pair` | Complex features, refactors, unfamiliar codebases — when early feedback prevents wasted work |
|| `gg -i` | Exploration, Q&A, comparing approaches, interactive code changes |
|| `gg "task"` | Simple, well-defined tasks — fire and forget |

## ⚠️ Important Notes

- Pair mode is **fully autonomous** — the human reviews the session summary at the end
- One-shot mode requires a **clean git working tree** (commit or stash first)
- In yolo mode, agents have **full authorization** to modify files and run commands
- Always review changes before merging to production
- Use `--no-yolo` for safer, permission-gated operation

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

## 👤 Author

**Jason Roell** ([@jroell88](https://github.com/jroell))

## 🔗 Links

- [npm Package](https://www.npmjs.com/package/gitgang)
- [GitHub Repository](https://github.com/jroell/gitgang)
- [Issue Tracker](https://github.com/jroell/gitgang/issues)
