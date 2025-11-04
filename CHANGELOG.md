# GitGang Changelog

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
