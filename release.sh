#!/usr/bin/env bash
set -euo pipefail

# release.sh - One command to bump version, build, publish to npm, and push to GitHub

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[release]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }

# Get current version and bump patch
CURRENT_VERSION=$(node -p "require('./package.json').version")
NEW_VERSION=$(node -e "const v='${CURRENT_VERSION}'.split('.'); v[2]=parseInt(v[2])+1; console.log(v.join('.'))")

log "Bumping version: $CURRENT_VERSION → $NEW_VERSION"

# Update package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json'));
pkg.version = '${NEW_VERSION}';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Update package-lock.json if present
if [[ -f "$SCRIPT_DIR/package-lock.json" ]]; then
  node -e "
const fs = require('fs');
const path = require('path');
const lockPath = path.join('${SCRIPT_DIR}', 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath));
lock.version = '${NEW_VERSION}';
if (lock.packages && lock.packages['']) lock.packages[''].version = '${NEW_VERSION}';
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
"
fi

# Update VERSION constant in src/cli.ts
sed -i '' "s/const VERSION = \".*\";/const VERSION = \"${NEW_VERSION}\";/" "$SCRIPT_DIR/src/cli.ts"

success "Version updated in package.json and src/cli.ts"

# Build distributable
log "Building dist/cli.js with Node..."
npm run build
chmod +x dist/cli.js
success "Build complete"

# Run tests
log "Running test suite..."
npm test
success "Tests passed"

# Verify version
CLI_VERSION=$(node "$SCRIPT_DIR/dist/cli.js" --version)
if [[ "$CLI_VERSION" != "$NEW_VERSION" ]]; then
  echo "Error: Build version ($CLI_VERSION) doesn't match expected ($NEW_VERSION)"
  exit 1
fi
success "CLI version verified: $CLI_VERSION"

# Git commit
log "Committing changes..."
git add -A
git commit -m "v${NEW_VERSION}"
success "Committed"

# Publish to npm
log "Publishing to npm..."
npm publish
success "Published gitgang@${NEW_VERSION} to npm"

# Push to GitHub
log "Pushing to GitHub..."
git push origin HEAD
success "Pushed to GitHub"

echo ""
echo -e "${GREEN}Released gitgang@${NEW_VERSION}${NC}"
echo ""
echo "Install with: npm i -g gitgang@latest"
