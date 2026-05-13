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

## GitGang benchmark-mode behavior

When the harness sets `GITGANG_TIME_BUDGET_SECONDS` (as the Harbor agent does for terminal-bench), gitgang switches Claude solo runs into a benchmark-tuned path designed to spend less time on setup and catch false finishes before the verifier does.

- Existing `CLAUDE.md` files are augmented instead of replaced.
- Gitgang preloads task files (`TASK.md`, `task.md`, etc.), environment discovery, project-specific hints, test and validation scripts, key source files, and a short pre-flight test baseline into `CLAUDE.md`.
- Claude runs under the supplied time budget and can also be capped with `GITGANG_MAX_TURNS` in custom harnesses.
- If a run exits very early (currently before 40% of the budget), gitgang retries once with the previous output, `git diff`, and test results attached as retry context.
- If a run exits with meaningful time still left (currently before 85% of the budget) but the post-exit validation still fails, gitgang retries once with the failing test output attached.

### Custom harness notes

- Set `GITGANG_TIME_BUDGET_SECONDS=<seconds>` to enable the benchmark-tuned prompt and timeout path.
- Optionally set `GITGANG_MAX_TURNS=<n>` if you want a stricter turn cap than the benchmark default.
- The packaged terminal-bench hard-subset flow in `benchmarks/run-tbench-hard.sh` and `benchmarks/harbor/gitgang_harbor_agent.py` already wires these knobs for you.

## Honesty about stump rate

The `expectedToStump` flag on each task is a prior, not empirical data. The
real stump rate has to come from actually running the suite. Categories were
chosen to exercise known LLM failure modes: subtle spec following, hard
complexity requirements, unicode edges, concurrency semantics, and problems
where the obvious approach is wrong. Retune `expectedToStump` once a few real
runs exist.
