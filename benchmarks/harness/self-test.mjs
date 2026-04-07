// Self-test: load every task, write its reference solution to a tmp dir,
// dynamically import it, and run the task's verify function. Any failure
// means the task itself is broken (no known correct solution) and should
// be fixed before benchmarking anything else.
import { readdirSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const TASKS_DIR = resolve(new URL(".", import.meta.url).pathname, "..", "tasks");

async function loadTasks() {
  const files = readdirSync(TASKS_DIR).filter((f) => f.endsWith(".mjs") && f !== "index.mjs");
  const tasks = [];
  for (const f of files.sort()) {
    const mod = await import(pathToFileURL(join(TASKS_DIR, f)).href);
    const list = Array.isArray(mod.default) ? mod.default : [mod.default];
    for (const t of list) tasks.push({ file: f, ...t });
  }
  return tasks;
}

async function runOne(task) {
  const dir = mkdtempSync(join(tmpdir(), `gg-bench-${task.id}-`));
  try {
    for (const [rel, content] of Object.entries(task.referenceFiles)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    const solutionUrl = pathToFileURL(join(dir, task.solutionPath)).href + `?t=${Date.now()}`;
    const mod = await import(solutionUrl);
    const timeoutMs = task.timeoutMs ?? 8000;
    await Promise.race([
      Promise.resolve(task.verify(mod)),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`verify timeout after ${timeoutMs}ms`)), timeoutMs)),
    ]);
    return { id: task.id, title: task.title, pass: true };
  } catch (err) {
    return { id: task.id, title: task.title, pass: false, error: err?.stack || String(err) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tasks = await loadTasks();
console.log(`Loaded ${tasks.length} tasks`);

const results = [];
for (const task of tasks) {
  const r = await runOne(task);
  results.push(r);
  const mark = r.pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  process.stdout.write(`${mark} ${r.id} ${r.title}${r.pass ? "" : "\n    " + r.error.split("\n")[0]}\n`);
}

const failed = results.filter((r) => !r.pass);
const hard = tasks.filter((t) => t.difficulty === "hard").length;
const stumpers = tasks.filter((t) => t.expectedToStump).length;
console.log(`\n${results.length - failed.length}/${results.length} reference solutions pass`);
console.log(`Distribution: ${tasks.filter(t=>t.difficulty==="easy").length} easy / ${tasks.filter(t=>t.difficulty==="medium").length} medium / ${hard} hard`);
console.log(`Expected-to-stump: ${stumpers}/${tasks.length} (${Math.round(100 * stumpers / tasks.length)}%)`);

if (failed.length) {
  console.error("\nFAILED tasks need their reference solution or verify function fixed:");
  for (const f of failed) console.error(`  - ${f.id} ${f.title}`);
  process.exit(1);
}
