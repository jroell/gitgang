# Quick Start: GitGang v1.4.0

## What's New? 🎉

GitGang now has **beautiful, color-coded output** instead of JSON noise!

### Before (v1.3.2):
```
[GEMINI] {"type":"tool_use","timestamp":"2025-11-04T01:50:27.511Z","tool_name":"run_shell_command"...}
```

### After (v1.4.0):
```
[GEMINI]   🔧 run_shell_command: Run vitest with coverage reporting
[GEMINI]   Understood. I will increase Vitest coverage to 90%...
```

## Publishing (For Maintainer)

```bash
# 1. Set your npm token
export NPM_TOKEN='your-npm-token-here'

# 2. Run the release script (bumps version, builds dist/cli.js, publishes, pushes)
cd /Users/jasonroell/ai-orchestrator
./release.sh

# 3. Commit and tag
# release.sh already commits and pushes; tags are optional
```

## Installing (For Users)

```bash
# Install/upgrade globally
npm install -g gitgang@latest

# Verify version
gg --version  # Should show 1.4.0

# Or use npx
npx gitgang@latest "your task"
```

## Using It

```bash
# Navigate to your project
cd /path/to/your/repo

# Run gitgang with a task
gitgang "Add user authentication with JWT"

# Or use the short alias
gg "Add user authentication with JWT"
```

## Interactive Commands While Running

```bash
/status         # Check agent status
/logs gemini    # View agent logs
/nudge codex "Fix the failing test"
/kill claude    # Stop an agent
/review         # Trigger review manually
/help           # Show all commands
```

## Output Features

✅ **Color-Coded Agents**:
- 🟣 [GEMINI] - Magenta
- 🟡 [CLAUDE] - Yellow  
- 🟢 [CODEX] - Green

✅ **Clean Messages**:
- 💭 Thinking/reasoning
- 🔧 Tool usage
- $ Shell commands
- ⚙️ Initialization

✅ **No JSON Spam**:
- Filters out metadata
- Shows only relevant content
- Full logs saved in `.logs/` for debugging

## Troubleshooting

### "Not in a git repository"
Make sure you're in a git project:
```bash
git status  # Should work
```

### "Working tree not clean"
Commit or stash changes first:
```bash
git add -A && git commit -m "WIP"
# or
git stash
```

### Agent CLI not found
Install required CLIs:
```bash
npm install -g @google/gemini-cli
npm install -g @anthropic/claude-cli  
npm install -g @openai/codex-cli
```

### Still see JSON output?
You might have an old cached version:
```bash
npm uninstall -g gitgang
npm install -g gitgang@1.4.0
```

## Documentation

- `README.md` - Full documentation
- `OUTPUT_IMPROVEMENTS.md` - Details on output changes
- `CHANGELOG.md` - Version history
- `PUBLISH.md` - Publishing guide
- `WORK_SUMMARY.md` - Technical implementation

## Support

- GitHub Issues: https://github.com/jroell/gitgang/issues
- npm Package: https://www.npmjs.com/package/gitgang

---

**Enjoy the improved GitGang experience! 🤘**
