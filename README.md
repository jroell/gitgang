# 🤘 GitGang

> The gang's all here to code — Multi-agent AI orchestration for autonomous software development

**GitGang** is a Node-based CLI (bundled with esbuild) that coordinates multiple AI agents (Gemini, Claude, and Codex) to collaboratively solve complex coding tasks. Each agent works in isolation on git worktrees, and a reviewer agent merges the best solutions.

[![npm version](https://img.shields.io/npm/v/gitgang.svg)](https://www.npmjs.com/package/gitgang)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ Features

- **Multi-Agent Collaboration**: Runs three AI agents in parallel (Gemini, Claude, Codex)
- **Real-Time Dashboard**: Live-updating progress display showing file changes, commits, and agent status
- **Beautiful Dracula UI**: Modern terminal interface with RGB colors, rounded corners, and live spinners
- **Git Worktree Isolation**: Each agent works in its own git worktree and branch
- **Intelligent Review Loop**: Codex reviewer analyzes all solutions and merges the best parts
- **Interactive Command Palette**: Monitor and control agents in real-time
- **Autonomous Execution**: Agents work independently with full permissions (optional yolo mode)
- **Single-File Bundle**: Lightweight Node CLI built with esbuild (no Bun required)

## 📦 Installation

```bash
npm i -g gitgang@latest
```

### Prerequisites

You need the following CLI tools installed and configured:

- **[Gemini CLI](https://github.com/google/generative-ai-sdk)** - Google's Gemini 2.5 Pro model
- **[Claude Code CLI](https://docs.anthropic.com/claude/docs/claude-cli)** - Anthropic's Claude Sonnet 4.5
- **[Codex CLI](https://github.com/codex-ai/codex-cli)** - OpenAI's GPT-5 Codex with high reasoning

All three CLIs must be available on your `PATH`.

## 🚀 Usage

### Basic Usage

```bash
gg "Add user authentication with JWT tokens"
# or
gitgang "Add user authentication with JWT tokens"
```

### Advanced Options

```bash
gitgang --task "Refactor API layer" \
  --rounds 5 \
  --no-yolo \
  --workRoot .agents \
  --timeoutMs 3600000 \
  --no-pr
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--task` | Task description for agents | First positional arg |
| `--rounds` | Number of review rounds | `3` |
| `--yolo` / `--no-yolo` | Auto-approve agent actions | `true` |
| `--workRoot` | Directory for git worktrees | `.ai-worktrees` |
| `--timeoutMs` | Max runtime in milliseconds | `1500000` (25m) |
| `--no-pr` | Skip GitHub PR creation | Creates PR by default |

## Interactive Mode

Start a conversational session with all three agents:

    gg              # enters interactive mode (no task)
    gg -i           # same
    gg -i "how does auth work"   # pre-loads first turn

Every turn sends your message to gemini, claude, and codex in parallel worktrees. A Claude Code orchestrator then inspects the responses, browses the code to verify claims, and synthesizes an answer with:

- Points of agreement across agents
- Points of disagreement with the orchestrator's verdict and code citations
- A single best answer

For questions, the turn ends with the synthesis. For code changes, the orchestrator proposes a merge plan that you confirm with `[y/N/e]`.

**Slash commands inside a session:**

    /ask <msg>     force question mode
    /code <msg>    force code mode
    /merge         apply the previous turn's merge plan
    /pr            open a PR for the last merge
    /diff [agent]  show diff vs base for picked or named agent's branch
    /redo          re-run the last user message as a fresh turn
    /only <agent> <msg>  run this single turn with only one agent (gemini|claude|codex)
    /skip <agent> <msg>  run this single turn skipping one agent
    /clear         forget conversation so far (log stays on disk)
    /history       print the transcript
    /agents        show the agent roster and models
    /set K V       set a runtime knob (e.g. /set automerge on)
    /help          list commands
    /quit          exit

**Session management:**

    gg doctor                             # environment health check (binaries, env vars, git)
    gg sessions list                      # list recent sessions (with topic)
    gg sessions search <query>            # find sessions matching text (topic/answer)
    gg sessions stats <id>                # show turn/agent/merge counts + duration for a session
    gg sessions delete <id> --yes         # remove a single session from disk
    gg sessions prune --older-than 30d    # dry-run list sessions older than duration
    gg sessions prune --older-than 30d -y # actually delete them
    gg sessions show <id>                 # print a past session's transcript
    gg sessions export <id>               # export full markdown transcript to stdout
    gg sessions export <id> --output PATH # write export to a file
    gg -i --resume                        # resume most-recent session
    gg -i --resume <id>                   # resume a specific session

Sessions live under `.gitgang/sessions/<id>/` (auto-added to `.gitignore` on install).

## 🎮 Interactive Commands

While agents are running, use these slash commands:

| Command | Description |
|---------|-------------|
| `/status` | Show agent status and branches |
| `/agents` | List all agent worktrees |
| `/logs <agent>` | View logs for gemini, claude, or codex |
| `/nudge <agent> <msg>` | Send message to specific agent |
| `/kill <agent>` | Terminate a running agent |
| `/review` | Trigger reviewer manually |
| `/help` | Show available commands |

## 🏗️ How It Works

1. **Initialization**: Creates three git worktrees from your current branch
2. **Parallel Execution**: Launches Gemini, Claude, and Codex simultaneously with live spinners
3. **Real-Time Monitoring**: Dashboard updates every 2 seconds showing:
   - Agent status (pending, working, complete)
   - Files changed, added, and deleted in each worktree
   - Commit counts per agent
   - Current activity (thinking, running commands, editing files)
   - Reviewer status (distinct from regular agents)
   - Elapsed session time
4. **Autonomous Development**: Each agent:
   - Implements the feature independently
   - Writes/updates tests
   - Commits changes incrementally
   - Handles failures autonomously
5. **Review Loop**: Codex reviewer:
   - Compares all three solutions
   - Either approves and merges best parts
   - Or provides targeted revision feedback
6. **Integration**: Creates merge branch with best solution
7. **PR Creation**: Optionally opens GitHub PR (requires `gh` CLI)

## 📋 Requirements

- **macOS** (tested; should work anywhere with git and Node)
- **Git** repository with clean working tree
- **Node.js 18+** / **npm** for installation
- **AI CLI Tools**: gemini, claude, codex
- **Terminal**: RGB color support recommended (iTerm2, Terminal.app, Hyper, etc.)
  - Gracefully falls back to basic ANSI colors in unsupported terminals

## 🛠️ Development

### Building from Source

```bash
# Clone the repo
git clone https://github.com/jroell/gitgang.git
cd gitgang

# Install deps
npm install

# Run locally
npm run build
node dist/cli.js "Test task"
```

### Sidebar Demo

Render the polished sidebar without wiring the full CLI:

```ts
import { renderHelloWorldSidebar } from "./src/sidebar.ts";

console.log(renderHelloWorldSidebar());
```

### Publishing

```bash
# Set your npm token
export NPM_TOKEN='your_npm_token_here'

# Run publish script
./release.sh
```

## 🎯 Use Cases

- **Feature Development**: Implement complex features with multiple perspectives
- **Refactoring**: Get different approaches to code restructuring
- **Bug Fixes**: Multiple agents tackle the same bug differently
- **Code Reviews**: Compare solutions before committing
- **Experimentation**: Try different implementation strategies simultaneously

## ⚠️ Important Notes

- Requires a **clean git working tree** (commit or stash changes first)
- Agents have **full authorization** to modify files and run commands in yolo mode
- Each agent works in **isolated git worktrees** to prevent conflicts
- The reviewer creates a **new merge branch** for the final solution
- Worktrees are **automatically cleaned up** after completion
- **Real-time dashboard** updates every 2 seconds with live git status monitoring
- **Terminal colors** auto-detected; works in basic ANSI mode if RGB not supported
- **Reviewer agent** shown separately with distinct visual styling (pink badge)

## 📝 Example Session

```bash
$ gitgang "Add Redis caching layer to API"

╭─────────────────────────────────────────────────────────────────────────────────╮
│ 🤘 GitGang - The gang's all here to code!                                      │
╰─────────────────────────────────────────────────────────────────────────────────╯

Repository: /Users/you/project
Base branch: main
Task: Add Redis caching layer to API
Rounds: 3  Auto-merge: true
Type /help for interactive commands while agents run.

╭─────────────────────────────────────────────────────────────────────────────────╮
│ 🚀 Starting AI Agents                                                           │
╰─────────────────────────────────────────────────────────────────────────────────╯

 GEMINI  → agents/gemini/20251104-010930-a4f2b1
 CLAUDE  → agents/claude/20251104-010930-c8e3d2
 CODEX   → agents/codex/20251104-010930-f9a1e5

╭─────────────────────────────────────────────────────────────────────────────────╮
│ 📊 Agent Dashboard                              Round 1  ⏱️  3:24               │
├─────────────────────────────────────────────────────────────────────────────────┤
│ ● GEMINI   ✓ Complete    Files: +3 ~2 -0    Commits: 4                         │
│   Implemented Redis client with connection pooling                              │
│                                                                                  │
│ ● CLAUDE   ● Working     Files: +2 ~1 -0    Commits: 3                         │
│   Adding cache layer to API endpoints...                                        │
│                                                                                  │
│ ○ CODEX    ○ Pending     Files: +0 ~0 -0    Commits: 0                         │
│   Waiting to start...                                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│ REVIEWER   ● Reviewing                                                          │
│   Comparing all solutions...                                                    │
╰─────────────────────────────────────────────────────────────────────────────────╯

╭─────────────────────────────────────────────────────────────────────────────────╮
│ ✓ Reviewer Approved                                                             │
╰─────────────────────────────────────────────────────────────────────────────────╯

Merge branch ready: ai-merge-20251104-011245
PR created: https://github.com/you/project/pull/123

╭─────────────────────────────────────────────────────────────────────────────────╮
│ ✨ All done!                                                                    │
╰─────────────────────────────────────────────────────────────────────────────────╯
```

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

---

**Note**: This tool gives AI agents significant autonomy over your codebase. Always review changes before merging to production. Use `--no-yolo` mode for safer, interactive operation.
