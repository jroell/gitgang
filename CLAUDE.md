# GitGang — Project Context

AI-powered multi-agent CLI (`gitgang` / `gg`). TypeScript ESM, bundled to a single `dist/cli.js` via esbuild. Published to npm as `gitgang`. See `README.md` for user-facing docs.

## Commands

```bash
npm install        # Install deps (postinstall runs ensure-clis.mjs)
npm run build      # esbuild → dist/cli.js (single bundled file, deps external, node18 target)
npm test           # vitest run — ~500+ tests across src/*.test.ts
node dist/cli.js --version   # Verify a build locally before releasing
./release.sh       # Bump patch, update VERSION in src/cli.ts, build, test, commit, npm publish, git push
```

## Architecture

- Entry point: `src/cli.ts` → bundled into `dist/cli.js` (the only file shipped to npm besides `scripts/ensure-clis.mjs`).
- Core modules in `src/`:
  - `pair.ts` — AI pair programming mode (one agent codes, another reviews, they negotiate)
  - `orchestrator.ts` — multi-agent `-i` mode (Gemini + Claude + Codex in parallel, synthesized result)
  - `turn.ts` — per-turn agent dispatch and prompt building (includes `buildTurnPrompt()`)
  - `session.ts`, `repl.ts` — interactive session state and REPL loop
  - `renderer.ts`, `sidebar.ts`, `persistent-sidebar.ts`, `theme.ts`, `styles.ts` — Dracula-themed TUI layer
  - `config.ts` — per-repo config system (`gg init` command)
  - `doctor.ts` — environment health check (`gg doctor`, `--json` flag)
  - `completions.ts` — shell completion generator (`gg completions`)
  - `non-git.ts` — read-only Q&A mode for running outside git repos (v1.8.1+)
  - `markdown.ts`, `confirm.ts`, `slash.ts` — TUI/input helpers
- Tests: `src/*.test.ts` (vitest, vanilla — no test framework config file beyond `devDependencies`).
- Backend abstraction: the "agent" interface is designed to be extended; current backends are `claude`, `codex`, `gemini` CLIs discovered on `PATH`.

## Publishing Gotchas

- **npm 2FA is required** for publish — the release script will prompt for the OTP; it cannot run fully unattended.
- **`VERSION` constant in `src/cli.ts`** must stay in sync with `package.json`. `release.sh` uses `sed` to update it — don't rename the `const VERSION = "x.y.z";` pattern or the regex breaks silently.
- **`packages: "external"`** in `scripts/build.mjs` means runtime deps (`boxen`, `chalk`, `ora`, etc.) are *not* bundled — they must stay in `dependencies` (not `devDependencies`) or the published CLI breaks for users.
- **`files` in `package.json`** is explicit (`dist/cli.js` + `scripts/ensure-clis.mjs`) — anything else added to the project won't ship unless listed there.

## Runtime Gotchas

- **`gg` alias can be shadowed by oh-my-zsh's git plugin** (which defines `gg` as `git gui citool`). After installing, users may need `unalias gg` or the explicit override placed later in `.zshrc`. The `gg doctor` command should help diagnose this.
- **Non-git mode requires `findRepoRoot()` — not `repoRoot()`.** `repoRoot()` throws when outside a git repo; `findRepoRoot()` returns null gracefully. When adding features that use repo context, always check for the no-git case (see `runInteractive()` in `src/cli.ts` for the pattern).
- **Working tree must be clean** for interactive sessions in git mode — otherwise startup aborts. Untracked `.claude/` directories are a common culprit; keep them in `.gitignore`.
- **Dependent CLIs must be on `PATH`.** Pair mode needs ≥2 of {claude, codex}; interactive mode needs all of {claude, codex, gemini}. Missing CLIs fail fast but with a helpful message from `doctor`.

## Release Workflow Specifics

`release.sh` does the full flow in one shot:
1. Reads current version from `package.json`, bumps the **patch** number only (manual edit for minor/major)
2. Writes new version to `package.json`, `package-lock.json`, and `src/cli.ts`
3. Runs `npm run build` + `npm test` — refuses to publish if either fails
4. Verifies `dist/cli.js --version` matches the new version
5. Commits with message `v${NEW_VERSION}` (plain, no conventional-commit scope)
6. `npm publish` (prompts for 2FA OTP) → `git push origin HEAD`

For minor/major bumps: edit `package.json` version first, then let the script handle the rest — or run the steps manually. Always update `CHANGELOG.md` before a release; it's not automated.
