# 🤖 AI Orchestrator

> Multi-agent AI orchestration for autonomous software development

**AI Orchestrator** is a powerful Bun-based CLI that coordinates multiple AI agents (Gemini, Claude, and Codex) to collaboratively solve complex coding tasks. Each agent works in isolation on git worktrees, and a reviewer agent merges the best solutions.

[![npm version](https://img.shields.io/npm/v/jroell88-ai-orchestrator.svg)](https://www.npmjs.com/package/jroell88-ai-orchestrator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ Features

- **Multi-Agent Collaboration**: Runs three AI agents in parallel (Gemini, Claude, Codex)
- **Git Worktree Isolation**: Each agent works in its own git worktree and branch
- **Intelligent Review Loop**: Codex reviewer analyzes all solutions and merges the best parts
- **Interactive Command Palette**: Monitor and control agents in real-time
- **Autonomous Execution**: Agents work independently with full permissions (optional yolo mode)
- **Native Binary**: Fast, compiled Bun executable (~60MB)

## 📦 Installation

```bash
npm i -g jroell88-ai-orchestrator@latest
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
ai-orchestrator "Add user authentication with JWT tokens"
```

### Advanced Options

```bash
ai-orchestrator --task "Refactor API layer" \
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
2. **Parallel Execution**: Launches Gemini, Claude, and Codex simultaneously
3. **Autonomous Development**: Each agent:
   - Implements the feature independently
   - Writes/updates tests
   - Commits changes incrementally
   - Handles failures autonomously
4. **Review Loop**: Codex reviewer:
   - Compares all three solutions
   - Either approves and merges best parts
   - Or provides targeted revision feedback
5. **Integration**: Creates merge branch with best solution
6. **PR Creation**: Optionally opens GitHub PR (requires `gh` CLI)

## 📋 Requirements

- **macOS** (Darwin only)
- **Git** repository with clean working tree
- **Node.js** / **npm** for installation
- **Bun** runtime (auto-installed via Homebrew if missing)
- **AI CLI Tools**: gemini, claude, codex

## 🛠️ Development

### Building from Source

```bash
# Clone the repo
git clone https://github.com/jroell/ai-orchestrator.git
cd ai-orchestrator

# Install Bun
brew install bun

# Build native binary
bun build ./src/cli.ts --compile --outfile ./dist/ai-orchestrator

# Run locally
./dist/ai-orchestrator "Test task"
```

### Publishing

```bash
# Set your npm token
export NPM_TOKEN='your_npm_token_here'

# Run publish script
./publish-npm-macos.sh
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

## 📝 Example Session

```bash
$ ai-orchestrator "Add Redis caching layer to API"

════════════════════════════════════════════════════════════════════════════════════
║ AI Multi-Agent Orchestrator (Bun 1.3.1)
════════════════════════════════════════════════════════════════════════════════════
repo: /Users/you/project
base: main
task: Add Redis caching layer to API
rounds: 3  yolo: true

════════════════════════════════════════════════════════════════════════════════════
║ Start agents
════════════════════════════════════════════════════════════════════════════════════
[GEMINI] Starting implementation...
[CLAUDE] Starting implementation...
[CODEX] Starting implementation...

Type /help for commands. Agents continue running while you use this.

/status
[GEMINI] running @ agents/gemini/20251104-010930-a4f2b1
[CLAUDE] running @ agents/claude/20251104-010930-c8e3d2
[CODEX] running @ agents/codex/20251104-010930-f9a1e5

════════════════════════════════════════════════════════════════════════════════════
║ Reviewer loop (Codex)
════════════════════════════════════════════════════════════════════════════════════
Round 1
Merging agents/gemini/20251104-010930-a4f2b1…
Merging agents/claude/20251104-010930-c8e3d2…
Approved. Merge branch ready: ai-merge-20251104-011245
PR created.

════════════════════════════════════════════════════════════════════════════════════
║ All done
════════════════════════════════════════════════════════════════════════════════════
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

## 👤 Author

**Jason Roell** ([@jroell88](https://github.com/jroell))

## 🔗 Links

- [npm Package](https://www.npmjs.com/package/jroell88-ai-orchestrator)
- [GitHub Repository](https://github.com/jroell/ai-orchestrator)
- [Issue Tracker](https://github.com/jroell/ai-orchestrator/issues)

---

**Note**: This tool gives AI agents significant autonomy over your codebase. Always review changes before merging to production. Use `--no-yolo` mode for safer, interactive operation.
