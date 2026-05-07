#!/usr/bin/env bash
#
# Run terminal-bench@2.0 HARD subset using gitgang's harbor agent.
#
# Prerequisites:
#   - harbor >= 0.4.0 (pip install harbor)
#   - Docker running
#   - ANTHROPIC_API_KEY set in environment
#
# Usage:
#   # Run all 30 hard tasks (4 concurrent):
#   ./benchmarks/run-tbench-hard.sh
#
#   # Run a specific number of tasks:
#   ./benchmarks/run-tbench-hard.sh --n-tasks 5
#
#   # Run a single task by name:
#   ./benchmarks/run-tbench-hard.sh --task gpt2-codegolf
#
#   # Dry run (just list what would run):
#   ./benchmarks/run-tbench-hard.sh --dry-run
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
JOBS_DIR="${REPO_ROOT}/benchmark-jobs"
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
JOB_NAME="gitgang-hard-${TIMESTAMP}"
N_CONCURRENT="${N_CONCURRENT:-4}"
MODEL="${MODEL:-anthropic/claude-opus-4-7}"

# ── Hard subset task names (30 tasks from terminal-bench@2.0) ──
HARD_TASKS=(
  bn-fit-modify
  cancel-async-tasks
  circuit-fibsqrt
  configure-git-webserver
  dna-assembly
  extract-moves-from-video
  feal-differential-cryptanalysis
  feal-linear-cryptanalysis
  fix-code-vulnerability
  fix-ocaml-gc
  gpt2-codegolf
  install-windows-3.11
  llm-inference-batching-scheduler
  make-doom-for-mips
  make-mips-interpreter
  mcmc-sampling-stan
  model-extraction-relu-logits
  password-recovery
  path-tracing
  path-tracing-reverse
  polyglot-rust-c
  protein-assembly
  regex-chess
  sam-cell-seg
  sparql-university
  torch-pipeline-parallelism
  torch-tensor-parallelism
  train-fasttext
  video-processing
  write-compressor
)

# ── Parse arguments ──
DRY_RUN=false
EXTRA_ARGS=()
SINGLE_TASK=""
N_TASKS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --task)
      SINGLE_TASK="$2"
      shift 2
      ;;
    --n-tasks)
      N_TASKS="$2"
      shift 2
      ;;
    --model)
      MODEL="$2"
      shift 2
      ;;
    --n-concurrent)
      N_CONCURRENT="$2"
      shift 2
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

# ── Check prerequisites ──
if ! command -v harbor &>/dev/null; then
  echo "ERROR: harbor CLI not found. Install with: pip install harbor"
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  echo "ERROR: Docker is not running. Start Docker Desktop first."
  exit 1
fi

# ── Load API key ──
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  # Try to source from known .env files
  for envfile in "$REPO_ROOT/.env" "$HOME/.env" "$HOME/.cursor-tools/.env"; do
    if [ -f "$envfile" ]; then
      KEY=$(grep "^ANTHROPIC_API_KEY=" "$envfile" 2>/dev/null || true)
      KEY="${KEY#ANTHROPIC_API_KEY=}"
      if [ -n "$KEY" ]; then
        export ANTHROPIC_API_KEY="$KEY"
        echo "Loaded ANTHROPIC_API_KEY from $envfile"
        break
      fi
    fi
  done
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ERROR: ANTHROPIC_API_KEY not set."
  echo "Set it via: export ANTHROPIC_API_KEY=sk-..."
  echo "Or create a .env file in the repo root."
  exit 1
fi

# ── Build include flags ──
INCLUDE_FLAGS=()

if [ -n "$SINGLE_TASK" ]; then
  # Run a single specific task
  INCLUDE_FLAGS+=("-i" "$SINGLE_TASK")
  echo "Running single task: $SINGLE_TASK"
elif [ ${#HARD_TASKS[@]} -gt 0 ]; then
  # Include all hard tasks
  for task in "${HARD_TASKS[@]}"; do
    INCLUDE_FLAGS+=("-i" "$task")
  done
  echo "Running ${#HARD_TASKS[@]} hard tasks"
fi

if [ -n "$N_TASKS" ]; then
  INCLUDE_FLAGS+=("-l" "$N_TASKS")
  echo "Limiting to $N_TASKS tasks"
fi

# ── Construct command ──
mkdir -p "$JOBS_DIR"

CMD=(
  harbor run
  --dataset "terminal-bench@2.0"
  --agent-import-path "gitgang_harbor_agent:GitgangAgent"
  --model "$MODEL"
  --n-concurrent "$N_CONCURRENT"
  --jobs-dir "$JOBS_DIR"
  --job-name "$JOB_NAME"
  --ae "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"
  "${INCLUDE_FLAGS[@]}"
  "${EXTRA_ARGS[@]}"
)

echo ""
echo "════════════════════════════════════════════════════"
echo "  GitGang Terminal-Bench 2.0 — Hard Subset"
echo "════════════════════════════════════════════════════"
echo "  Model:       $MODEL"
echo "  Agent:       gitgang (solo claude)"
echo "  Concurrent:  $N_CONCURRENT"
echo "  Jobs dir:    $JOBS_DIR/$JOB_NAME"
echo "  Tasks:       $([ -n "$SINGLE_TASK" ] && echo "$SINGLE_TASK" || echo "${#HARD_TASKS[@]} hard tasks")"
echo "════════════════════════════════════════════════════"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would execute:"
  echo ""
  # Print command with env vars redacted
  echo "  PYTHONPATH=$SCRIPT_DIR/harbor \\"
  echo "  ${CMD[*]}" | sed "s/ANTHROPIC_API_KEY=[^ ]*/ANTHROPIC_API_KEY=<REDACTED>/g"
  echo ""
  echo "Hard tasks:"
  for task in "${HARD_TASKS[@]}"; do
    echo "  - $task"
  done
  exit 0
fi

# ── Run ──
echo "Starting benchmark run..."
echo "Logs: $JOBS_DIR/$JOB_NAME/"
echo ""

export PYTHONPATH="$SCRIPT_DIR/harbor:${PYTHONPATH:-}"
exec "${CMD[@]}"
