# gitgang benchmark suite

A suite of 50 programming tasks for evaluating how well the gitgang orchestrator
(and the individual CLIs it wraps) handle real coding work.

## Scoring model

Each task has a `verify(mod)` function that imports the candidate solution and
runs a battery of assertions. Verification is pass/fail per task. The runner
records four things per task:

- `agents.gemini` — did the solo gemini worktree pass?
- `agents.claude` — did the solo claude worktree pass?
- `agents.codex`  — did the solo codex worktree pass?
- `merged`        — did the final merge branch gitgang produced pass?

A task is considered **passed** for gitgang if `merged` is true. The per-agent
columns exist so you can tell whether one CLI is carrying the others, and
whether the synthesis step is actually adding value over the best solo agent.

## Task shape

Every task is an ES module under `benchmarks/tasks/` exporting a default object:

```js
{
  id: "007",
  title: "Dijkstra with path reconstruction",
  category: "algorithms",
  difficulty: "hard",          // "easy" | "medium" | "hard"
  expectedToStump: true,       // prior, not ground truth
  prompt: "…markdown for gitgang…",
  starterFiles: {              // seeded into the repo the agents work in
    "solution.mjs": "export function solve() { throw new Error('todo'); }",
  },
  referenceFiles: {            // verified correct solution
    "solution.mjs": "…",
  },
  solutionPath: "solution.mjs",
  async verify(mod) { /* throws on failure */ },
}
```

The reference solution exists so the suite is self-verifying: running
`node benchmarks/harness/self-test.mjs` imports every reference solution and
runs its verifier. If a reference solution fails its own verify, the task is
broken and should be fixed before benchmarking anything.

## Running

```bash
# Self-test: verify every task has a correct reference solution
node benchmarks/harness/self-test.mjs

# Real benchmark: invoke gitgang per task, score results
node benchmarks/harness/run.mjs [--filter=<glob>] [--only-hard]

# Score an existing results file
node benchmarks/harness/score.mjs benchmarks/results/run-<timestamp>.json
```

## Benchmark-mode bootstrap

When gitgang is run under the Harbor / terminal-bench flow with a time budget,
the Claude worker now starts with an auto-generated `CLAUDE.md` in the task
worktree. The goal is to spend fewer turns on repo discovery and more turns
solving the task.

That bootstrap preloads:

- the first matching task file (`TASK.md`, `task.txt`, `README.md`,
  `INSTRUCTIONS.md`, `PROMPT.md`, etc.)
- a compact directory tree with file sizes
- discovered tool and runtime information
- discovered test and validation scripts plus Makefile test targets
- previews of up to 12 likely source files
- baseline pre-flight test output when gitgang can safely run something up front

If the task already ships its own `CLAUDE.md`, gitgang preserves it and appends
the extra benchmark context. The benchmark-mode prompt also now tells the agent
to run setup/init scripts when present and includes broader recovery guidance
for Docker, networking, binary-format, and file-placement failures. Normal
day-to-day use of `gg` is otherwise unchanged.

## Honesty about stump rate

The `expectedToStump` flag on each task is a prior, not empirical data. The
real stump rate has to come from actually running the suite. Categories were
chosen to exercise known LLM failure modes: subtle spec following, hard
complexity requirements, unicode edges, concurrency semantics, and problems
where the obvious approach is wrong. Retune `expectedToStump` once a few real
runs exist.
