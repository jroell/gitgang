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

## Harbor / terminal-bench 2.0 runner

The Harbor adapter lives at `benchmarks/harbor/gitgang_harbor_agent.py` and runs `gitgang --solo claude` inside the terminal-bench container.

Before each run it bootstraps a `CLAUDE.md` file with the task text, discovered test/validation scripts, selected script contents, and a quick environment snapshot. That preloaded context is intentional: it lets the agent start from the verifier and repo constraints instead of burning turns on rediscovery.

The runner also hardens benchmark execution in two ways:

- if gitgang exits before using 40% of its allotted time budget, Harbor retries once with the tail of the failed run prepended as failure context and a reduced remaining budget
- the system constraints explicitly tell the agent to compare actual vs expected output byte-for-byte and to do a final format check before finishing

Use this path when you want terminal-bench 2.0 style runs rather than the local `benchmarks/harness/*.mjs` harness.

## Honesty about stump rate

The `expectedToStump` flag on each task is a prior, not empirical data. The
real stump rate has to come from actually running the suite. Categories were
chosen to exercise known LLM failure modes: subtle spec following, hard
complexity requirements, unicode edges, concurrency semantics, and problems
where the obvious approach is wrong. Retune `expectedToStump` once a few real
runs exist.
