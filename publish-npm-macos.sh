#!/usr/bin/env bash
set -euo pipefail

# publish-npm-macos.sh
# One-shot macOS script that builds and publishes @jroell/ai-orchestrator to npm.
# Requirements: macOS, git, npm, curl. The script installs Bun via Homebrew if needed.

# ---------- Config (you can tweak) ----------
PKG_SCOPE=""
PKG_NAME="gitgang"
PKG_FULL="${PKG_NAME}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Auto-bump patch version
CURRENT_VERSION=$(node -p "require('./package.json').version")
VERSION=$(node -e "const v = '${CURRENT_VERSION}'.split('.'); v[2] = parseInt(v[2]) + 1; console.log(v.join('.'));")

# Update package.json with new version
node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json')); pkg.version='${VERSION}'; fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');"

# Update VERSION constant in src/cli.ts
sed -i '' "s/const VERSION = \".*\";/const VERSION = \"${VERSION}\";/" "$SCRIPT_DIR/src/cli.ts"

# Darwin only per your request
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is macOS-only." >&2
  exit 1
fi

# Token must come from env for safety
if [[ -z "${NPM_TOKEN:-}" ]]; then
  echo "Missing NPM_TOKEN in environment. Do: export NPM_TOKEN='...'" >&2
  exit 1
fi

has() { command -v "$1" >/dev/null 2>&1; }
log() { printf "\033[36m[publish]\033[0m %s\n" "$*"; }
warn() { printf "\033[33m[warn]\033[0m %s\n" "$*"; }
err() { printf "\033[31m[err]\033[0m %s\n" "$*"; }

ensure_brew() {
  if has brew; then return; fi
  log "Installing Homebrew"
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  local BREW_PREFIX
  if [[ -d "/opt/homebrew" ]]; then BREW_PREFIX="/opt/homebrew"; else BREW_PREFIX="/usr/local"; fi
  eval "$(${BREW_PREFIX}/bin/brew shellenv)"
  if ! grep -Fq 'brew shellenv' "$HOME/.zshrc" 2>/dev/null; then
    echo "eval \"$(${BREW_PREFIX}/bin/brew shellenv)\"" >> "$HOME/.zshrc"
  fi
}

ensure_bun() {
  if has bun; then return; fi
  ensure_brew
  log "Installing Bun"
  brew install bun
}

# ---------- Make a temp package workspace ----------
PKG_DIR="$(mktemp -d -t ai-orchestrator-pkg-XXXXXX)"
log "Workspace: $PKG_DIR"
mkdir -p "$PKG_DIR/dist"

# ---------- Ensure Bun ----------
ensure_bun

# ---------- Build native binary ----------
log "Building native binary with Bun"
bun build "$SCRIPT_DIR/src/cli.ts" --compile --outfile "$PKG_DIR/dist/gitgang"
chmod +x "$PKG_DIR/dist/gitgang"

pushd "$PKG_DIR" >/dev/null

# ---------- Package.json, README, LICENSE ----------
log "Creating package.json for ${PKG_FULL}@${VERSION}"
cat > package.json <<JSON
{
  "name": "${PKG_FULL}",
  "version": "${VERSION}",
  "description": "GitGang - The gang's all here to code! Multi-agent AI orchestration with Gemini, Claude, and Codex.",
  "bin": { 
    "gitgang": "dist/gitgang",
    "gg": "dist/gitgang"
  },
  "files": ["dist/**", "README.md", "LICENSE"],
  "os": ["darwin"],
  "license": "MIT",
  "publishConfig": { "access": "public" },
  "keywords": ["gitgang", "git", "bun", "gemini", "claude", "codex", "ai", "cli", "worktree", "multi-agent"]
}
JSON

cat > README.md <<'MD'
# 🤘 GitGang

> The gang's all here to code!

Install:
```bash
npm i -g gitgang@latest
```

Usage:
```bash
gg "Do this task"
# or
gitgang "Do this task"
# defaults: rounds=3, yolo=true
# options: --task, --rounds, --no-yolo, --timeoutMs, --workRoot, --no-pr
```

Notes:
- Requires the following CLIs on PATH:
  - gemini (Gemini CLI, model gemini-2.5-pro)
  - claude (Claude Code CLI, model claude-sonnet-4-5)
  - codex (Codex CLI, model gpt-5-codex with high reasoning)
- The CLI creates three git worktrees, runs agents, and uses a Codex reviewer loop.
- Use slash commands while running: /status /agents /logs <agent> /nudge <agent> <msg> /kill <agent> /review /help.

Full docs: https://github.com/jroell/gitgang
MD

cat > LICENSE <<'LIC'
MIT License
Copyright (c)
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files, to deal in the Software
without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the software is furnished to do so,
subject to the following conditions:
The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
LIC

# ---------- Auth and publish ----------

log "Setting up npm auth (local to package dir)"
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc

# Keep npm cache local to the temp workspace to avoid ~/.npm permission issues.
export NPM_CONFIG_CACHE="$PKG_DIR/.npm-cache"

log "Publishing ${PKG_FULL}@${VERSION} to npm (public)"
npm publish --access public

popd >/dev/null

log "Done"
echo
echo "Install it globally with:"
echo "  npm i -g ${PKG_FULL}@latest"
echo
