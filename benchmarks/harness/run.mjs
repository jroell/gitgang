// Benchmark runner: for each task, set up a throwaway git repo, invoke
// gitgang with the task prompt, then verify each of the three agent
// worktree branches AND the final merge branch. Records a per-task,
// per-agent result JSON under benchmarks/results/.
import { readdirSync, mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const TASKS_DIR = resolve(new URL(".", import.meta.url).pathname, "..", "tasks");
const RESULTS_DIR = resolve(new URL(".", import.meta.url).pathname, "..", "results");
const GITGANG = process.env.GITGANG_BIN ?? "gitgang";
const RUN_TIMEOUT_MS = Number(process.env.GITGANG_BENCH_TIMEOUT ?? 25 * 60 * 1000);

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  return res;
}

function git(cwd, ...args) {
  return sh("git", args, { cwd }).stdout.trim();
}

async function loadTasks(filter) {
  const files = readdirSync(TASKS_DIR).filter((f) => f.endsWith(".mjs") && f !== "index.mjs");
  const tasks = [];
  for (const f of files.sort()) {
    const mod = await import(pathToFileURL(join(TASKS_DIR, f)).href);
    const list = Array.isArray(mod.default) ? mod.default : [mod.default];
    for (const t of list) tasks.push(t);
  }
  return filter ? tasks.filter((t) => filter(t)) : tasks;
}

function seedRepo(task) {
  const dir = mkdtempSync(join(tmpdir(), `gg-bench-run-${task.id}-`));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "bench@gitgang.local");
  git(dir, "config", "user.name", "gitgang-bench");
  for (const [rel, content] of Object.entries(task.starterFiles)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  writeFileSync(join(dir, "TASK.md"), task.prompt);
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "bench: initial");
  git(dir, "branch", "-M", "main");
  return dir;
}

async function verifySolutionDir(task, dir) {
  const solFile = join(dir, task.solutionPath);
  if (!existsSync(solFile)) return { pass: false, error: "solution file missing" };
  try {
    const url = pathToFileURL(solFile).href + `?t=${Date.now()}`;
    const mod = await import(url);
    const timeoutMs = task.timeoutMs ?? 8000;
    await Promise.race([
      Promise.resolve(task.verify(mod)),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`verify timeout`)), timeoutMs)),
    ]);
    return { pass: true };
  } catch (err) {
    return { pass: false, error: (err?.message || String(err)).slice(0, 400) };
  }
}

async function runGitgang(repoDir, prompt) {
  return new Promise((resolve) => {
    const proc = spawn(GITGANG, [prompt, "--no-pr"], {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GITGANG_AGENT_IDLE_TIMEOUT: String(3 * 60 * 1000) },
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => { out += c.toString(); process.stdout.write(c); });
    proc.stderr.on("data", (c) => { err += c.toString(); });
    const timer = setTimeout(() => proc.kill("SIGTERM"), RUN_TIMEOUT_MS);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout: out, stderr: err });
    });
  });
}

function findBranches(repoDir) {
  const raw = git(repoDir, "branch", "--list", "--format=%(refname:short)");
  const branches = raw.split("\n").filter(Boolean);
  return {
    gemini: branches.find((b) => b.startsWith("agents/gemini/")),
    claude: branches.find((b) => b.startsWith("agents/claude/")),
    codex:  branches.find((b) => b.startsWith("agents/codex/")),
    merge:  branches.find((b) => b.startsWith("ai-merge-")),
  };
}

async function verifyBranch(task, repoDir, branch) {
  if (!branch) return { pass: false, error: "branch not found" };
  // Read solution file directly from the branch via git show; this avoids
  // conflicts with any worktree gitgang itself still holds for the branch.
  const dir = mkdtempSync(join(tmpdir(), `gg-verify-${task.id}-`));
  try {
    const res = sh("git", ["show", `${branch}:${task.solutionPath}`], { cwd: repoDir, allowFail: true });
    if (res.status !== 0) return { pass: false, error: `git show failed: ${(res.stderr || "").slice(0, 200)}` };
    const full = join(dir, task.solutionPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, res.stdout);
    return await verifySolutionDir(task, dir);
  } catch (err) {
    return { pass: false, error: (err?.message || String(err)).slice(0, 400) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const onlyHard = args.includes("--only-hard");
  const filterArg = args.find((a) => a.startsWith("--filter="));
  const substr = filterArg ? filterArg.slice("--filter=".length) : null;
  const tasks = await loadTasks((t) =>
    (!onlyHard || t.difficulty === "hard") && (!substr || t.id.includes(substr) || t.title.toLowerCase().includes(substr.toLowerCase()))
  );
  console.log(`Running ${tasks.length} tasks through gitgang (this will take a while)`);

  const runStart = Date.now();
  const perTask = [];
  for (const task of tasks) {
    console.log(`\n=== [${task.id}] ${task.title} (${task.difficulty}) ===`);
    const repo = seedRepo(task);
    const taskStart = Date.now();
    let gitgangResult = null;
    try {
      gitgangResult = await runGitgang(repo, task.prompt);
    } catch (err) {
      gitgangResult = { exitCode: 1, error: String(err) };
    }
    const branches = findBranches(repo);
    const agents = {
      gemini: await verifyBranch(task, repo, branches.gemini),
      claude: await verifyBranch(task, repo, branches.claude),
      codex:  await verifyBranch(task, repo, branches.codex),
    };
    const merged = await verifyBranch(task, repo, branches.merge);
    const entry = {
      id: task.id,
      title: task.title,
      category: task.category,
      difficulty: task.difficulty,
      expectedToStump: task.expectedToStump,
      durationMs: Date.now() - taskStart,
      gitgangExit: gitgangResult.exitCode,
      branches,
      agents,
      merged,
    };
    perTask.push(entry);
    const mark = (r) => r.pass ? "✓" : "✗";
    console.log(`  gemini=${mark(agents.gemini)} claude=${mark(agents.claude)} codex=${mark(agents.codex)} merged=${mark(merged)}`);
    rmSync(repo, { recursive: true, force: true });
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = join(RESULTS_DIR, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const report = { startedAt: new Date(runStart).toISOString(), durationMs: Date.now() - runStart, tasks: perTask };
  writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nResults: ${outFile}`);
}

await main();
