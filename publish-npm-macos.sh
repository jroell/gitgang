#!/usr/bin/env bash
set -euo pipefail

# publish-npm-macos.sh
# One-shot macOS script that builds and publishes @jroell/ai-orchestrator to npm.
# Requirements: macOS, git, npm, curl. The script installs Bun via Homebrew if needed.

# ---------- Config (you can tweak) ----------
PKG_SCOPE=""
PKG_NAME="jroell88-ai-orchestrator"
PKG_FULL="${PKG_NAME}"

# Semver with timestamp patch so repeated runs do not clash
VERSION="0.1.$(date +%Y%m%d%H%M)"

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
mkdir -p "$PKG_DIR/src" "$PKG_DIR/dist"

# ---------- Write the Bun CLI (TypeScript) ----------
# Defaults:
#   ai-orchestrator "Do this task"  -> rounds=3, yolo=true
# Flags:
#   --task, --rounds, --no-yolo, --timeoutMs, --workRoot, --no-pr, --help, --version
cat > "$PKG_DIR/src/cli.ts" <<'TS'
// bun-multi-agent-orchestrator-1.3.1-v2.ts
import { spawn, $ } from "bun";
import { existsSync, mkdirSync, appendFileSync, readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import * as readline from "node:readline";

const VERSION = "1.3.1-v2";
const C = {
  r: "\x1b[0m",
  b: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
};
const TAG = (name: string) => {
  const map: Record<string, (s: string) => string> = { gemini: C.magenta, claude: C.yellow, codex: C.green, review: C.blue };
  return (map[name] || C.gray)(`[${name.toUpperCase()}]`);
};
const line = (n=84) => "".padEnd(n, "═");
function banner(title: string, color: (s:string)=>string = C.cyan) { console.log(`${color(line())}\n${color("║")} ${C.b(title)}\n${color(line())}`); }

type AgentId = "gemini" | "claude" | "codex";
interface Opts { task: string; repoRoot: string; baseBranch: string; workRoot: string; rounds: number; timeoutMs: number; yolo: boolean; autoPR: boolean; }
interface Worktree { agent: AgentId; branch: string; dir: string; log: string }
const MODELS = { gemini: "gemini-2.5-pro", claude: "claude-sonnet-4-5", codex: "gpt-5-codex" } as const;

async function git(cwd: string, ...args: (string | Record<string, string>)[]) { const res = await $`git ${args}`.cwd(cwd).quiet(); if (!res.success) throw new Error(`git ${args.join(" ")} failed: ${await res.text()}`); return (await res.text()).trim(); }
async function ensureCleanTree(cwd: string) { const diff = await git(cwd, "status", "--porcelain"); if (diff) throw new Error("Working tree not clean. Commit or stash first."); }
async function repoRoot(): Promise<string> { return await $`git rev-parse --show-toplevel`.text().then(s => s.trim()); }
async function currentBranch(cwd: string): Promise<string> { return await git(cwd, "rev-parse", "--abbrev-ref", "HEAD"); }
const ts = () => { const d=new Date(),p=(n:number)=>`${n}`.padStart(2,"0"); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
async function createWorktree(cwd: string, base: string, agent: AgentId, rootFolder: string): Promise<Worktree> { const b=`agents/${agent}/${ts()}-${randomUUID().slice(0,6)}`; const dir=resolve(cwd, rootFolder, `${agent}-${b.replaceAll("/","_")}`); mkdirSync(dir,{recursive:true}); await git(cwd,"worktree","add","-b",b,dir,base); const logs=resolve(dir,".logs"); mkdirSync(logs,{recursive:true}); return { agent, branch:b, dir, log: join(logs, `${agent}.log`) }; }

function systemConstraints(agent: AgentId) { return ["You are an autonomous senior engineer with full authorization to edit files, run shell commands, install dependencies, and run tests.","Do not ask for permission. Decide and proceed.","Work in small, verifiable steps and commit early with clear messages.","Add or update tests to cover the change.","If something fails, debug and keep going until complete.","At the end, summarize what changed and any follow ups."].join("\n"); }
function featurePrompt(agent: AgentId, base: string, task: string) { return `Task: ${task}\n\nBase branch: ${base}\nYou are in a dedicated git worktree and branch for ${agent}.\nObjectives:\n1) Implement the feature to production quality.\n2) Add or update tests.\n3) Update docs if needed.\n4) Commit early and often with clear messages.\n5) Ensure the project builds and tests pass.\nRules:\n- You have full authorization to modify files and run commands in this workspace.\n- Do not prompt for confirmation.\n- If blocked, propose a plan, then execute it.\n- Keep going until done.`; }
function reviewerPromptJSON(base: string, branches: { gemini: string; claude: string; codex: string; }, task: string) { return `You are the final reviewer. Compare these branches against ${base}:\n- ${branches.gemini}\n- ${branches.claude}\n- ${branches.codex}\n\nTask: ${task}\n\nGoal: Pick the best parts from each and integrate into a new merge branch off ${base}. If none are satisfactory, produce concrete fix instructions per agent and keep the loop going.\n\nOutput JSON only with this schema:\n{\n  \"status\": \"approve\" | \"revise\",\n  \"mergePlan\": { \"order\": [\"branchName\", ...], \"notes\": \"why this order\", \"postMergeChecks\": [\"command\", ...] },\n  \"revisions\": [{ \"agent\": \"gemini\" | \"claude\" | \"codex\", \"instructions\": \"actionable steps\" }]\n}`; }

interface ProcWrap { proc: Process, name: AgentId, log: string, stdin?: WritableStreamDefaultWriter }
function streamToLog(prefix: string, logFile: string, color: (s: string)=>string, stream: ReadableStream<Uint8Array>) { const dec=new TextDecoder(); (async()=>{ for await (const chunk of stream) { const text=dec.decode(chunk); const tagged=text.replaceAll(/(^|\n)/g, `$1${color(prefix)} `); process.stdout.write(tagged); appendFileSync(logFile, text); } })(); }

async function runGemini(w: Worktree, base: string, task: string, yolo: boolean): Promise<ProcWrap> { const prompt=`${systemConstraints("gemini")}\n\n${featurePrompt("gemini", base, task)}`; const args=["--prompt",prompt,"-m",MODELS.gemini,"--output-format","stream-json"]; if(yolo) args.push("--yolo"); const proc=spawn(["gemini",...args],{cwd:w.dir,stdin:"pipe",stdout:"pipe",stderr:"pipe"}); const stdin=proc.stdin?.getWriter(); streamToLog(TAG("gemini"), w.log, C.magenta, proc.stdout!); streamToLog(TAG("gemini"), w.log, C.magenta, proc.stderr!); return { proc, name:"gemini", log:w.log, stdin }; }
async function runClaude(w: Worktree, base: string, task: string, yolo: boolean): Promise<ProcWrap> { const prompt=`${systemConstraints("claude")}\n\n${featurePrompt("claude", base, task)}`; const args=["-p",prompt,"--model",MODELS.claude,"--output-format","stream-json","--verbose"]; if(yolo) args.push("--dangerously-skip-permissions"); const proc=spawn(["claude",...args],{cwd:w.dir,stdin:"pipe",stdout:"pipe",stderr:"pipe"}); const stdin=proc.stdin?.getWriter(); streamToLog(TAG("claude"), w.log, C.yellow, proc.stdout!); streamToLog(TAG("claude"), w.log, C.yellow, proc.stderr!); return { proc, name:"claude", log:w.log, stdin }; }
async function runCodexCoder(w: Worktree, base: string, task: string, yolo: boolean): Promise<ProcWrap> { const prompt=`${systemConstraints("codex")}\n\n${featurePrompt("codex", base, task)}`; const args=["exec",prompt,"--model",MODELS.codex,"--config","model_reasoning_effort=\"high\""]; args.push(yolo?"--yolo":"--full-auto"); const proc=spawn(["codex",...args],{cwd:w.dir,stdin:"pipe",stdout:"pipe",stderr:"pipe"}); const stdin=proc.stdin?.getWriter(); streamToLog(TAG("codex"), w.log, C.green, proc.stdout!); streamToLog(TAG("codex"), w.log, C.green, proc.stderr!); return { proc, name:"codex", log:w.log, stdin }; }
async function runCodexReviewer(cwd:string, base:string, branches:{gemini:string; claude:string; codex:string;}, task:string, yolo:boolean){ const prompt=reviewerPromptJSON(base, branches, task); const args=["exec",prompt,"--model",MODELS.codex,"--config","model_reasoning_effort=\"high\""]; args.push(yolo?"--yolo":"--full-auto"); return await spawn(["codex",...args],{cwd,stdin:"pipe",stdout:"pipe",stderr:"pipe"}); }
function parseFirstJson(s:string){ const m=s.match(/\{[\s\S]*\}/); if(!m) return; try{return JSON.parse(m[0]);}catch{return;} }

function startCommandPalette(state:{ agents:Record<AgentId,ProcWrap|undefined>; worktrees:Record<AgentId,Worktree>; opts:Opts; onReview:()=>Promise<void>; }){ const rl=readline.createInterface({input:process.stdin,output:process.stdout}); process.stdin.resume(); console.log(C.gray("Type /help for commands. Agents continue running while you use this.")); rl.on("line", async line=>{ const s=line.trim(); if(!s.startsWith("/")) return; const parts=s.slice(1).split(/\s+/); const cmd=(parts.shift()||"").toLowerCase(); try{ switch(cmd){ case"help": console.log(C.cyan(`/status  /agents  /logs <agent>  /nudge <agent> <msg>  /kill <agent>  /review  /help`)); break; case"status": for(const id of ["gemini","claude","codex"] as AgentId[]){ const a=state.agents[id]; console.log(`${TAG(id)} ${a?C.green("running"):C.yellow("idle")} @ ${state.worktrees[id].branch}`);} break; case"agents": console.log(Object.entries(state.worktrees).map(([k,v])=>`${k}: ${v.branch} → ${v.dir}`).join("\n")); break; case"nudge":{ const id=parts.shift() as AgentId; const msg=parts.join(" "); if(!id||!msg){console.log(C.red("Usage: /nudge <agent> <message>")); break;} const a=state.agents[id]; if(a?.stdin){ await a.stdin.write(`\nProxy: ${msg}\n`); await a.stdin.flush(); console.log(C.green(`nudged ${id}`)); } else console.log(C.yellow(`${id} has no stdin or exited`)); break;} case"logs":{ const id=parts.shift() as AgentId; if(!id){console.log(C.red("Usage: /logs <agent>")); break;} const f=state.worktrees[id].log; if(!existsSync(f)){console.log(C.yellow("no log yet")); break;} const txt=readFileSync(f,"utf8"); console.log(C.dim(txt.slice(-8000))); break;} case"kill":{ const id=parts.shift() as AgentId; const a=id?state.agents[id]:undefined; if(a){ a.proc.kill(); console.log(C.yellow(`sent SIGTERM to ${id}`)); } else console.log(C.yellow(`${id} not running`)); break;} case"review": await state.onReview(); break; default: console.log(C.yellow(`Unknown command: /${cmd}`)); } }catch(e){ console.error(C.red(`Command error: ${e}`)); } }); return rl; }

function printHelp(){ console.log(`\n${C.b("AI Orchestrator ("+VERSION+")")}\n${"".padEnd(84,"-")}\n\nUsage\n  ai-orchestrator "Do this task"\n  ai-orchestrator --task "Do this task" [--rounds N] [--no-yolo] [--workRoot PATH] [--timeoutMs MS] [--no-pr]\n\nDefaults\n  rounds=3, yolo=true, workRoot=.ai-worktrees, timeoutMs=1500000 (25m)\n\nWhile running\n  /status  /agents  /logs <agent>  /nudge <agent> <msg>  /kill <agent>  /review  /help\n`); }

function parseArgs(raw: string[]){
  let task: string | undefined; let rounds = 3; let yolo = true; let workRoot = ".ai-worktrees"; let timeoutMs = 25*60*1000; let autoPR = true;
  const get = (flag: string, fallback?: string) => { const i = raw.indexOf(flag); return i>=0 ? raw[i+1] : fallback; };
  const bool = (v?: string) => ["1","true","yes","on"].includes((v||"").toLowerCase());
  const firstPositional = raw.find(t => !t.startsWith("-"));
  if (firstPositional) task = firstPositional;
  if (get("--task")) task = get("--task");
  if (get("--rounds")) rounds = Number(get("--rounds"));
  if (get("--yolo")) yolo = bool(get("--yolo"));
  if (raw.includes("--no-yolo")) yolo = false;
  if (get("--workRoot")) workRoot = get("--workRoot")!;
  if (get("--timeoutMs")) timeoutMs = Number(get("--timeoutMs"));
  if (raw.includes("--no-pr")) autoPR = false;
  return { task, rounds, yolo, workRoot, timeoutMs, autoPR };
}

async function doReview(opts: Opts, w: Record<AgentId, Worktree>) {
  await git(opts.repoRoot, "checkout", opts.baseBranch);
  const proc = await runCodexReviewer(opts.repoRoot, opts.baseBranch, { gemini: w.gemini.branch, claude: w.claude.branch, codex: w.codex.branch }, opts.task, opts.yolo);
  const out = await new Response(proc.stdout!).text(); const err = await new Response(proc.stderr!).text(); if (err) process.stderr.write(C.gray(err)); process.stdout.write(C.dim(out));
  const decision = parseFirstJson(out);
  if (!decision) { console.log(C.red("Reviewer did not emit valid JSON. Stop for manual review.")); return false; }
  if (decision.status === "approve") {
    const mergeBranch = `ai-merge-${ts()}`; await git(opts.repoRoot, "checkout", "-b", mergeBranch, opts.baseBranch);
    const order: string[] = decision.mergePlan?.order || [w.gemini.branch, w.claude.branch, w.codex.branch];
    for (const b of order) { try { console.log(C.gray(`Merging ${b}…`)); await git(opts.repoRoot, "merge", "--no-ff", b, "-m", `merge ${b} per reviewer plan`); } catch { console.log(C.yellow(`Merge conflict with ${b}. Leaving for manual resolution.`)); break; } }
    console.log(C.green(`Approved. Merge branch ready: ${mergeBranch}`));
    try { await $`gh pr create --fill --base ${opts.baseBranch} --head ${mergeBranch}`.cwd(opts.repoRoot).quiet(); console.log(C.green("PR created.")); } catch { console.log(C.yellow("GitHub CLI not configured or failed – skipping PR.")); }
    return true;
  }
  const revisions: { agent: AgentId; instructions: string }[] = decision.revisions || [];
  if (!revisions.length) { console.log(C.yellow("Reviewer asked for revisions but none listed.")); return false; }
  for (const r of revisions) {
    const addendum = `\nFollow up from reviewer: ${r.instructions}\nKeep going until checks pass.`;
    if (r.agent === "gemini") await runGemini(w.gemini, opts.baseBranch, opts.task + addendum, opts.yolo);
    if (r.agent === "claude") await runClaude(w.claude, opts.baseBranch, opts.task + addendum, opts.yolo);
    if (r.agent === "codex") await runCodexCoder(w.codex, opts.baseBranch, opts.task + addendum, opts.yolo);
  }
  return false;
}

async function cleanup(repo: string, works: Worktree[]) { console.log(C.gray("Cleaning up worktrees…")); for (const w of works) { try { await git(repo, "worktree", "remove", "--force", w.dir); } catch { if (existsSync(w.dir)) rmSync(w.dir, { recursive: true, force: true }); } } console.log(C.green("Cleanup complete.")); }

async function main(){
  const argv = Bun.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) { printHelp(); return; }
  if (argv.includes("--version") || argv.includes("-v")) { console.log(VERSION); return; }
  const { task, rounds, yolo, workRoot, timeoutMs, autoPR } = parseArgs(argv);
  if (!task) { printHelp(); process.exit(1); }

  const repo = await repoRoot();
  const base = await currentBranch(repo);
  await ensureCleanTree(repo);

  banner("AI Multi-Agent Orchestrator (Bun 1.3.1)", C.blue);
  console.log(`${C.gray(`repo:`)} ${repo}`); console.log(`${C.gray(`base:`)} ${base}`); console.log(`${C.gray(`task:`)} ${task}`); console.log(`${C.gray(`rounds:`)} ${rounds}  ${C.gray(`yolo:`)} ${yolo}`);

  mkdirSync(resolve(repo, workRoot), { recursive: true });
  const wGem = await createWorktree(repo, base, "gemini", workRoot);
  const wCla = await createWorktree(repo, base, "claude", workRoot);
  const wCdx = await createWorktree(repo, base, "codex", workRoot);

  const opts: Opts = { task, repoRoot: repo, baseBranch: base, workRoot, rounds, timeoutMs, yolo, autoPR };
  const agents: Record<AgentId, ProcWrap | undefined> = { gemini: undefined, claude: undefined, codex: undefined };
  const worktrees: Record<AgentId, Worktree> = { gemini: wGem, claude: wCla, codex: wCdx };
  const rl = startCommandPalette({ agents, worktrees, opts, onReview: async () => { await doReview(opts, worktrees); } });

  banner("Start agents", C.green);
  agents.gemini = await runGemini(wGem, base, task, yolo);
  agents.claude = await runClaude(wCla, base, task, yolo);
  agents.codex = await runCodexCoder(wCdx, base, task, yolo);

  const wait = async (a?: ProcWrap) => a ? a.proc.exited : Promise.resolve(0);
  const timer = setTimeout(() => console.log(C.yellow(`\n${C.b("Heads up")}: agents still running…`)), timeoutMs);
  await Promise.all([wait(agents.gemini), wait(agents.claude), wait(agents.codex)]);
  clearTimeout(timer);

  banner("Reviewer loop (Codex)", C.magenta);
  for (let r = 1; r <= Math.max(1, rounds); r++) {
    console.log(C.cyan(`Round ${r}`));
    const approved = await doReview(opts, worktrees);
    if (approved) break;
  }

  rl.close();
  await cleanup(repo, [wGem, wCla, wCdx]);
  banner("All done", C.green);
}
main().catch(err => { console.error(C.red(String(err?.stack || err))); process.exit(1); });
TS

# ---------- Ensure Bun ----------
ensure_bun

# ---------- Build native binary ----------
log "Building native binary with Bun"
pushd "$PKG_DIR" >/dev/null
bun build ./src/cli.ts --compile --outfile ./dist/ai-orchestrator
chmod +x ./dist/ai-orchestrator

# ---------- Package.json, README, LICENSE ----------
log "Creating package.json for ${PKG_FULL}@${VERSION}"
cat > package.json <<JSON
{
  "name": "${PKG_FULL}",
  "version": "${VERSION}",
  "description": "AI Multi-Agent Orchestrator (Bun) for Gemini CLI, Claude Code CLI, and Codex CLI.",
  "bin": { "ai-orchestrator": "dist/ai-orchestrator" },
  "files": ["dist/**", "README.md", "LICENSE"],
  "os": ["darwin"],
  "license": "MIT",
  "publishConfig": { "access": "public" },
  "keywords": ["bun", "gemini", "claude", "codex", "ai", "cli", "worktree"]
}
JSON

cat > README.md <<'MD'
# @jroell/ai-orchestrator

Install:
```bash
npm i -g @jroell/ai-orchestrator@latest
```

Usage:
```bash
ai-orchestrator "Do this task"
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

log "Publishing ${PKG_FULL}@${VERSION} to npm (public)"
npm publish --access public

popd >/dev/null

log "Done"
echo
echo "Install it globally with:"
echo "  npm i -g ${PKG_FULL}@latest"
echo
