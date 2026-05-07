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

## terminal-bench 2.0 hard subset

For the Docker-based `terminal-bench@2.0` hard subset, use the Harbor wrapper:

```bash
# Preview the command and selected tasks
./benchmarks/run-tbench-hard.sh --dry-run

# Run the full hard subset
./benchmarks/run-tbench-hard.sh

# Iterate on a smaller slice while debugging the harness
./benchmarks/run-tbench-hard.sh --n-tasks 5
./benchmarks/run-tbench-hard.sh --task fix-code-vulnerability
```

Prerequisites:

- `harbor` installed and on your `PATH`
- Docker running locally
- `ANTHROPIC_API_KEY` available for Harbor

Useful flags:

- `--model <provider/model>` to override the Harbor model
- `--n-concurrent <n>` to change parallelism
- `--task <name>` or `--n-tasks <n>` to narrow the run while iterating

## Benchmark-mode runtime behavior

When the Harbor agent launches `gitgang` with a time budget, `gitgang` now enables a few benchmark-specific behaviors that are useful to know when you are comparing runs or debugging failures:

- It passes a time budget through `GITGANG_TIME_BUDGET_SECONDS` and caps Claude turns with `GITGANG_MAX_TURNS`.
- In benchmark mode, `gitgang` bootstraps a `CLAUDE.md` file in the worktree with test and validation scripts, project-type hints, key source-file previews, and pre-flight test output.
- If an agent exits suspiciously early (before 40% of its budget), `gitgang` retries once with extra diagnostic context from the first attempt, including the output tail, `git diff`, and any test results it could capture.

These behaviors are automatic when you run `benchmarks/run-tbench-hard.sh`; you do not need extra CLI flags to opt in.

## Honesty about stump rate

The `expectedToStump` flag on each task is a prior, not empirical data. The
real stump rate has to come from actually running the suite. Categories were
chosen to exercise known LLM failure modes: subtle spec following, hard
complexity requirements, unicode edges, concurrency semantics, and problems
where the obvious approach is wrong. Retune `expectedToStump` once a few real
runs exist.
