# Publishing GitGang Updates

## Quick Publish (v1.4.0 - Improved Output)

These changes improve the output formatting significantly with better color coding, JSON filtering, and readability.

### Steps to Publish:

1. **Ensure NPM_TOKEN is set:**
   ```bash
   export NPM_TOKEN="your-npm-token-here"
   ```

2. **Run the publish script:**
   ```bash
   ./publish-npm-macos.sh
   ```

   This script will:
   - Check for Bun installation
   - Compile the CLI with `bun build`
   - Create package.json with timestamp version
   - Publish to npm as `gitgang`

3. **Verify publication:**
   ```bash
   npm info gitgang
   ```

4. **Test globally:**
   ```bash
   npm install -g gitgang@latest
   gg --version  # Should show 1.4.0
   ```

## What Changed in v1.4.0

### User-Facing Improvements:
- ✅ Color-coded agent output (Gemini=Magenta, Claude=Yellow, Codex=Green)
- ✅ Filtered JSON noise - only shows relevant messages
- ✅ Better formatting with emojis (💭 thinking, 🔧 tools, $ commands)
- ✅ Cleaner section headers and banners
- ✅ Raw logs still preserved in `.logs/` for debugging

### Technical Changes:
- New `StreamMessage` interface for JSON parsing
- `parseStreamLine()` function to identify message types
- `shouldDisplayLine()` filter to hide verbose metadata
- `formatMessage()` with type-specific formatting
- Enhanced `streamToLog()` with line-by-line processing

## Git Workflow

```bash
# Stage all changes
git add -A

# Commit with descriptive message
git commit -m "v1.4.0: Improve output formatting with color coding and JSON filtering"

# Push to remote
git push origin main

# Tag the release
git tag v1.4.0
git push origin v1.4.0
```

## Rollback (if needed)

If issues arise:
```bash
npm unpublish gitgang@<version>  # Use specific version
```

Or publish a patch version with fixes.
