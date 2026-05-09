# GitGang Benchmark Improvement Run — 2026-05-09

## Environment
- Claude Code: 2.1.128
- Gemini CLI: 0.41.2
- Default models: claude-opus-4-7, gemini-3.1-pro, gpt-5.5
- Node.js: v22.22.0
- All 598 tests passing

## Status
This is a pre-benchmark improvement run. No terminal-bench 2.0 score has been recorded yet because the benchmark requires Docker containers and the harbor framework running on the user's machine (not available in this sandboxed environment).

## Improvements Made

### 1. Enhanced Directory Tree in CLAUDE.md Bootstrap
- **New**: Added `generateDirectoryTree()` function that produces a compact, annotated directory tree showing file sizes
- **Impact**: Eliminates 1-2 wasted agent turns on `find` or `ls` exploration commands
- **Pattern**: Agents commonly waste early turns discovering project structure; pre-loading this saves time for actual coding

### 2. Expanded Task File Detection
- Added: `README.md`, `INSTRUCTIONS.md`, `PROMPT.md` and variants to task file candidates
- **Impact**: Catches more task description formats used across different benchmark tasks

### 3. Increased Source File Preview Limits
- Source file preview: 100 → 200 lines
- Test file preview: 150 → 250 lines
- Task file content: 8KB → 16KB
- Max source files: 8 → 12
- Max source file size: 15KB → 25KB
- **Impact**: More context loaded upfront means fewer turns spent reading files
- **Pattern**: Agents frequently need to read source/test files that were truncated; expanding limits reduces follow-up reads

### 4. Enhanced Environment Discovery
- Added: debug/binary tools (nasm, gdb, valgrind, strace, etc.)
- Added: other languages (perl, php, lua, R, julia)
- Added: archive tools, text processing tools, network tools
- Added: architecture, memory, CPU cores detection
- Added: installed apt packages sample
- **Impact**: Agent knows exactly what tools are available without trial-and-error

### 5. Broader Test Script Discovery
- Added patterns: `run.sh`, `setup.sh`, `init.sh`, `solve`, `judge`, `eval`, `benchmark`, `assert`, `expect`
- **Impact**: Catches validation scripts that use non-standard naming conventions

### 6. Setup Script Guidance in System Prompt
- Added Step 1.5: "Run setup/init scripts if present"
- Provides concrete bash commands to detect and run setup scripts
- **Impact**: Many terminal-bench tasks have setup scripts that must run before coding; agents that skip this waste time debugging missing dependencies

### 7. Enhanced Error Recovery Guidance
- Added: Docker debugging tips
- Added: Network/port debugging tips
- Added: Binary/hex mismatch debugging
- Added: File-not-found after writing debugging
- **Impact**: Common terminal-bench failure modes now have explicit recovery patterns

### 8. Enhanced Project Detection Hints
- Added: Shell script detection with CRLF/shebang warnings
- Added: Assembly file detection with nasm/gas guidance
- Added: SQL/database file detection
- Added: Docker daemon startup tip
- **Impact**: Domain-specific guidance reduces false starts on specialized tasks

### 9. Better CLAUDE.md Survey Guidance
- Updated prompt to tell agent to read CLAUDE.md "THOROUGHLY" and avoid redundant discovery
- **Impact**: Prevents agent from wasting turns re-running discovery that CLAUDE.md already covers

## Analysis of Common Failure Modes (General Patterns)

Based on terminal-bench 2.0 task analysis, the most common agent failure modes are:

1. **Wasted exploration** — Agent spends 2-4 turns just discovering project structure and environment. Fixed by pre-loading directory tree, env info, and source files into CLAUDE.md.

2. **Missing setup step** — Agent jumps into coding without running setup/init scripts. Fixed by adding Step 1.5 to the workflow.

3. **Insufficient context** — Agent truncates reading test files at 100-150 lines, missing critical assertions in the tail. Fixed by expanding preview limits.

4. **Wrong working directory** — Agent writes files in the wrong place. Reinforced in prompts with `pwd` checks and absolute path guidance.

5. **Premature exit** — Agent thinks it's done but tests actually fail. Already handled by post-exit test verification, now with better context.

## Next Steps
- Run terminal-bench 2.0 on user's machine: `harbor run -d terminal-bench@2.0 -a gitgang --solo claude -m anthropic/claude-opus-4-7 -k 5`
- Capture score and compare against Claude Code baseline (58.0%)
- Analyze first failure for next improvement cycle
