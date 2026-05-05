"""
Harbor agent that runs gitgang in solo claude mode for terminal-bench 2.0.

Usage (from gitgang repo root):
    PYTHONPATH=benchmarks/harbor harbor run \\
        --dataset terminal-bench@2.0 \\
        --agent-import-path "gitgang_harbor_agent:GitgangAgent" \\
        --model claude-opus-4-7 \\
        -n 1
"""

import os
import shlex
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class GitgangAgent(BaseInstalledAgent):
    """
    Runs gitgang --solo claude inside a terminal-bench Docker container.

    install() steps:
      1. System packages + Node 22 LTS via NodeSource (root)
      2. Rust toolchain via rustup (agent user)
      3. claude-code via the official install script (agent user)
      4. Clone jroell/gitgang + npm ci --ignore-scripts + npm run build (root)
      5. Symlink dist/cli.js -> /usr/local/bin/gitgang

    run() steps:
      1. Ensure CWD is a git repo (terminal-bench envs may not have one)
      2. Run: gitgang --solo claude --yolo --no-pr -- "<instruction>"

    The run command is wrapped so it always exits 0. Harbor should rely on
    the verifier (reward) to determine success, not the agent exit code.
    """

    SUPPORTS_ATIF: bool = False

    @staticmethod
    def name() -> str:
        return "gitgang"

    def get_version_command(self) -> str | None:
        return "node /opt/gitgang/dist/cli.js --version 2>/dev/null || echo unknown"

    async def install(self, environment: BaseEnvironment) -> None:
        # 1. System packages + Node 22 LTS + common build tools + extra libs
        #    Pre-installing a wide set of dev tools avoids mid-task dependency
        #    resolution delays that eat into the agent's time budget.
        await self.exec_as_root(
            environment,
            command=(
                "set -euo pipefail; "
                "if command -v apt-get &>/dev/null; then "
                "  export DEBIAN_FRONTEND=noninteractive; "
                "  apt-get update -qq; "
                "  apt-get install -y --no-install-recommends "
                "    curl git ca-certificates gnupg "
                "    build-essential cmake pkg-config autoconf automake libtool "
                "    python3-pip python3-venv python3-dev python3-setuptools "
                "    libssl-dev libffi-dev zlib1g-dev libreadline-dev "
                "    libsqlite3-dev libncurses5-dev libgdbm-dev libnss3-dev "
                "    libbz2-dev liblzma-dev libxml2-dev libxslt1-dev "
                "    unzip wget jq bc file xxd netcat-openbsd "
                "    sqlite3 gawk flex bison "
                # procps provides ps/top — many Docker images omit it,
                # causing agent runtime crashes (ENOENT on ps).
                "    procps; "
                # Java JDK (best-effort — may not exist in all base images)
                "  apt-get install -y --no-install-recommends default-jdk-headless 2>/dev/null || true; "
                # NodeSource repo for Node 22 LTS
                "  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; "
                "  apt-get install -y --no-install-recommends nodejs; "
                "elif command -v apk &>/dev/null; then "
                "  apk add --no-cache curl git nodejs npm python3 py3-pip build-base cmake; "
                "elif command -v yum &>/dev/null; then "
                "  yum install -y curl git nodejs npm python3 python3-pip gcc gcc-c++ make cmake; "
                "fi; "
                "node --version; npm --version; python3 --version"
            ),
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )

        # 2. Install Rust toolchain (many tasks need Cargo/rustc)
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                "if ! command -v rustc &>/dev/null; then "
                "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y 2>&1 | tail -3; "
                "  . $HOME/.cargo/env; "
                "  rustc --version; "
                "else "
                "  echo 'Rust already installed'; rustc --version; "
                "fi"
            ),
        )

        # 2b. Install Go toolchain (many tasks need it)
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                "if ! command -v go &>/dev/null; then "
                "  GO_VERSION=$(curl -fsSL 'https://go.dev/VERSION?m=text' 2>/dev/null | head -1 || echo 'go1.23.2'); "
                "  curl -fsSL \"https://go.dev/dl/${GO_VERSION}.linux-amd64.tar.gz\" | tar -C $HOME -xz 2>&1 | tail -1; "
                '  echo \'export PATH="$HOME/go/bin:$HOME/.cargo/bin:$PATH"\' >> ~/.bashrc; '
                "  export PATH=\"$HOME/go/bin:$PATH\"; "
                "  go version; "
                "else "
                "  echo 'Go already installed'; go version; "
                "fi"
            ),
        )

        # 2c. Pre-install common Python packages (avoids mid-task pip delays)
        #     These cover the most common task requirements across terminal-bench.
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                'export PATH="$HOME/.cargo/bin:$PATH"; '
                "python3 -m pip install --break-system-packages -q "
                "  numpy scipy pandas matplotlib requests flask pytest "
                "  pyyaml toml jsonschema cryptography pycryptodome "
                "  beautifulsoup4 lxml pillow sympy networkx "
                "  scikit-learn regex chardet "
                "  2>&1 | tail -3 || true; "
                "echo 'Python packages OK'"
            ),
        )

        # 3. Install claude-code (agent user)
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                "curl -fsSL https://claude.ai/install.sh | bash && "
                'echo \'export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"\' >> ~/.bashrc && '
                'export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH" && '
                "claude --version"
            ),
            env={"ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", "")},
        )

        # 4. Clone gitgang
        await self.exec_as_root(
            environment,
            command=(
                "set -euo pipefail; "
                "git clone --depth 1 https://github.com/jroell/gitgang.git /opt/gitgang && "
                "echo 'Clone OK'"
            ),
        )

        # 5. Install npm deps + build (separate step for clearer errors)
        await self.exec_as_root(
            environment,
            command=(
                "set -euo pipefail; "
                "cd /opt/gitgang && "
                # --ignore-scripts skips postinstall (ensure-clis.mjs requires all 3 CLIs)
                "npm ci --ignore-scripts 2>&1 && "
                "echo 'npm ci OK'"
            ),
        )

        await self.exec_as_root(
            environment,
            command=(
                "set -euo pipefail; "
                "cd /opt/gitgang && "
                "npm run build 2>&1 && "
                "chmod +x dist/cli.js && "
                "echo 'Build OK'"
            ),
        )

        # 6. Symlink onto PATH
        await self.exec_as_root(
            environment,
            command=(
                "ln -sf /opt/gitgang/dist/cli.js /usr/local/bin/gitgang && "
                "chmod +x /usr/local/bin/gitgang && "
                "node /opt/gitgang/dist/cli.js --version && "
                "echo 'Symlink OK'"
            ),
        )

    def populate_context_post_run(self, context: AgentContext) -> None:
        # gitgang doesn't emit ATIF yet; extend later to parse claude token counts
        pass

    @with_prompt_template
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        escaped_instruction = shlex.quote(instruction)

        # Harbor's default agent timeout is 900s. The run() method starts after
        # install completes, so nearly all 900s is available here. We reserve
        # 60s of buffer for harbor overhead and pass the rest to gitgang so the
        # agent can self-limit before being killed externally.
        HARBOR_AGENT_TIMEOUT_SEC = 900
        GITGANG_BUFFER_SEC = 60
        time_budget_sec = HARBOR_AGENT_TIMEOUT_SEC - GITGANG_BUFFER_SEC  # 840s

        env = {
            "ANTHROPIC_API_KEY": (
                os.environ.get("ANTHROPIC_API_KEY")
                or os.environ.get("ANTHROPIC_AUTH_TOKEN")
                or ""
            ),
            "CLAUDE_CODE_OAUTH_TOKEN": os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", ""),
            "ANTHROPIC_BASE_URL": os.environ.get("ANTHROPIC_BASE_URL", ""),
            "IS_SANDBOX": "1",
            "FORCE_AUTO_BACKGROUND_TASKS": "1",
            "ENABLE_BACKGROUND_TASKS": "1",
            # Idle timeout for claude inside gitgang (ms) - generous to allow
            # long-running commands (model training, compilation, etc.)
            "GITGANG_AGENT_IDLE_TIMEOUT": "600000",
            # Time budget passed into gitgang so it can inform the agent and
            # enforce a subprocess timeout before harbor's hard kill.
            "GITGANG_TIME_BUDGET_SECONDS": str(time_budget_sec),
            # Max turns cap to prevent runaway loops while still allowing
            # enough turns for complex multi-step tasks
            "GITGANG_MAX_TURNS": "150",
            # Disable interactive prompts/confirmations inside claude
            "DISABLE_PROMPT": "1",
        }
        env = {k: v for k, v in env.items() if v}

        model_flag = ""
        if self.model_name:
            model = self.model_name.split("/")[-1]
            model_flag = f"--model-claude {shlex.quote(model)} "

        # ── Environment Bootstrapping ──
        # Gather a snapshot of the sandbox BEFORE the agent starts. This saves
        # 2-5 exploration turns that the agent would otherwise spend on ls,
        # which python3, etc. The snapshot is written to CLAUDE.md so Claude
        # Code auto-reads it on startup. (Inspired by Meta-Harness 76.4%.)
        await self.exec_as_agent(
            environment,
            command=(
                'export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:$PATH"; '
                # Global git config so gitgang can commit inside worktrees
                'git config --global user.email "agent@benchmark.local" 2>/dev/null || true; '
                'git config --global user.name "agent" 2>/dev/null || true; '
                # Init a git repo if the task env doesn't have one already
                "if ! git rev-parse --git-dir &>/dev/null; then "
                "  git init -q && "
                "  git add -A 2>/dev/null || true && "
                "  git commit -q -m 'bench: initial state' --allow-empty; "
                "fi; "
                # Gather environment snapshot and write CLAUDE.md
                "{"
                '  echo "# Environment Context (auto-generated)"; '
                '  echo ""; '
                '  echo "## CRITICAL INSTRUCTIONS"; '
                '  echo "- This context was pre-gathered. DO NOT re-run discovery commands — go straight to reading the task and test scripts."; '
                '  echo "- The test/validation scripts below are GROUND TRUTH. Read them carefully — their assertions define correct behavior."; '
                '  echo "- Read ALL existing source files and test files before writing any code."; '
                '  echo "- Think first: what domain knowledge applies? What are the pitfalls? Pick the simplest reliable approach."; '
                '  echo "- Commit EARLY: cd \\$(git rev-parse --show-toplevel) && git add -A && git commit -m solution (before testing)."; '
                '  echo "- Your work is verified by automated programmatic tests checking exact outputs."; '
                '  echo "- Track your working directory with pwd. If the task uses absolute paths (like /app/), work there."; '
                '  echo "- After writing files, verify: ls -la /path/to/file && head -5 /path/to/file"; '
                '  echo "- If you edit the same file 3+ times and tests still fail, re-read the task and try a different approach."; '
                '  echo "- Compare actual vs expected output byte-for-byte when tests fail: diff, xxd, repr()."; '
                '  echo "- If a task needs a server/daemon: start it, verify it responds, THEN commit."; '
                '  echo ""; '
                # Task description FIRST — this is the most important context
                '  echo "## Task Description"; '
                "  cat TASK.md task.md task.txt README.md readme.md 2>/dev/null | head -300 || echo '(no task file found — task will be passed via prompt)'; "
                '  echo ""; '
                '  echo "## Test/Validation Scripts"; '
                '  echo "\\`\\`\\`"; '
                "  ls -la tests/ test/ verify* check* validate* run_tests* run* grade* score* Makefile 2>/dev/null | head -20 || echo '(none found)'; "
                '  echo "\\`\\`\\`"; '
                '  echo ""; '
                '  echo "## Test Script Contents (GROUND TRUTH — read carefully)"; '
                # Include the actual source of test/validation scripts so the agent
                # doesn't need to spend turns reading them during execution.
                "  for f in $(find . -maxdepth 2 -name 'test_*' -o -name '*_test.*' -o -name 'verify*' -o -name 'check*' -o -name 'validate*' -o -name 'grade*' -o -name 'score*' 2>/dev/null | head -5); do "
                '    echo "### $f"; '
                '    echo "\\`\\`\\`"; '
                "    cat \"$f\" 2>/dev/null | head -150; "
                '    echo "\\`\\`\\`"; '
                '    echo ""; '
                "  done; "
                # Also include Makefile test targets if present
                "  if [ -f Makefile ]; then "
                '    echo "### Makefile (test targets)"; '
                '    echo "\\`\\`\\`"; '
                "    grep -A5 'test\\|check\\|verify\\|grade' Makefile 2>/dev/null | head -40 || true; "
                '    echo "\\`\\`\\`"; '
                "  fi; "
                '  echo ""; '
                '  echo "## Working Directory"; '
                '  echo "\\`$(pwd)\\`"; '
                '  echo ""; '
                '  echo "## Files"; '
                '  echo "\\`\\`\\`"; '
                "  find . -maxdepth 3 -type f 2>/dev/null | grep -v '.git/' | head -80; "
                '  echo "\\`\\`\\`"; '
                '  echo ""; '
                '  echo "## Available Tools"; '
                '  echo "\\`\\`\\`"; '
                "  which python3 python node npm gcc g++ make cmake cargo rustc go javac ruby perl 2>/dev/null || true; "
                "  python3 --version 2>/dev/null || true; "
                "  node --version 2>/dev/null || true; "
                "  gcc --version 2>/dev/null | head -1 || true; "
                "  rustc --version 2>/dev/null || true; "
                "  go version 2>/dev/null || true; "
                '  echo "\\`\\`\\`"; '
                '  echo ""; '
                '  echo "## Build Config"; '
                '  echo "\\`\\`\\`"; '
                "  cat Makefile makefile package.json requirements.txt setup.py pyproject.toml Cargo.toml go.mod CMakeLists.txt 2>/dev/null | head -120 || true; "
                '  echo "\\`\\`\\`"; '
                '  echo ""; '
                '  echo "## Installed Python Packages"; '
                '  echo "\\`\\`\\`"; '
                "  python3 -m pip list --format=columns 2>/dev/null | head -50 || true; "
                '  echo "\\`\\`\\`"; '
                '  echo ""; '
                '  echo "## System"; '
                '  free -h 2>/dev/null | head -3 || true; '
                "  nproc 2>/dev/null || true; "
                "  nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || true; "
                "} > CLAUDE.md 2>/dev/null; "
                "git add CLAUDE.md 2>/dev/null && git commit -q -m 'bootstrap: environment context' 2>/dev/null || true; "
                "echo 'Bootstrap OK'"
            ),
            env=env,
        )

        # ── Pre-flight check ──
        await self.exec_as_agent(
            environment,
            command=(
                'export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:$PATH"; '
                "if ! claude --version &>/dev/null; then "
                "  echo 'WARNING: claude not found on PATH'; "
                "fi; "
                "echo 'Pre-flight OK'"
            ),
            env=env,
        )

        # ── Run gitgang (with retry-on-early-exit) ──
        # If the agent exits before using 40% of its time budget, it likely
        # hit an error or misunderstood the task. We retry with additional
        # context about the failure so it can take a different approach.
        # Harbor's verifier (reward) is the sole arbiter of success.
        MAX_RETRIES = 1  # At most one retry to avoid wasting the entire budget
        retry_context = ""

        for attempt in range(MAX_RETRIES + 1):
            attempt_label = f"(attempt {attempt + 1}/{MAX_RETRIES + 1})" if attempt > 0 else ""
            retry_prefix = ""
            if retry_context:
                # On retry, prepend context about the previous failure
                retry_prefix = (
                    f"IMPORTANT CONTEXT: A previous attempt at this task FAILED. "
                    f"Here is what went wrong:\\n{retry_context}\\n\\n"
                    f"Take a COMPLETELY DIFFERENT approach this time. "
                    f"Re-read the task and test scripts from scratch. "
                    f"Do NOT repeat the same mistake.\\n\\n"
                )

            retry_instruction = f"{retry_prefix}{escaped_instruction}" if retry_prefix else escaped_instruction

            # Calculate remaining time budget for this attempt
            remaining_budget = time_budget_sec if attempt == 0 else int(time_budget_sec * 0.55)

            attempt_env = {**env, "GITGANG_TIME_BUDGET_SECONDS": str(remaining_budget)}

            result = await self.exec_as_agent(
                environment,
                command=(
                    'export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:$PATH"; '
                    f"START_TIME=$(date +%s); "
                    f"gitgang --solo claude --yolo --no-pr {model_flag}"
                    f"-- {retry_instruction} "
                    f"2>&1 | tee /logs/agent/gitgang_{attempt}.txt; "
                    f"EXIT_CODE=$?; "
                    f"END_TIME=$(date +%s); "
                    f"ELAPSED=$((END_TIME - START_TIME)); "
                    # Write timing info for retry decision
                    f"echo \"GITGANG_ELAPSED=$ELAPSED\" > /tmp/gitgang_timing_{attempt}.txt; "
                    f"echo \"GITGANG_EXIT=$EXIT_CODE\" >> /tmp/gitgang_timing_{attempt}.txt; "
                    f"exit 0"
                ),
                env=attempt_env,
            )

            # Check if we should retry: read timing info and decide
            if attempt < MAX_RETRIES:
                timing_result = await self.exec_as_agent(
                    environment,
                    command=(
                        f"cat /tmp/gitgang_timing_{attempt}.txt 2>/dev/null || echo 'GITGANG_ELAPSED={remaining_budget}'; "
                        # Also capture last 30 lines of output for retry context
                        f"echo '---TAIL---'; "
                        f"tail -30 /logs/agent/gitgang_{attempt}.txt 2>/dev/null || true"
                    ),
                    env=env,
                )

                # Parse timing — if elapsed < 40% of budget, agent likely failed early
                elapsed = remaining_budget  # default: assume full budget used
                tail_output = ""
                if timing_result and hasattr(timing_result, 'output'):
                    output = timing_result.output or ""
                    for line in output.split('\n'):
                        if line.startswith('GITGANG_ELAPSED='):
                            try:
                                elapsed = int(line.split('=')[1])
                            except (ValueError, IndexError):
                                pass
                    if '---TAIL---' in output:
                        tail_output = output.split('---TAIL---', 1)[1].strip()[:500]

                # Only retry if agent used less than 40% of its time budget
                # (indicating early exit/crash rather than legitimate completion)
                threshold = int(remaining_budget * 0.40)
                if elapsed < threshold and tail_output:
                    retry_context = (
                        f"The agent exited after only {elapsed}s of {remaining_budget}s budget. "
                        f"Last output:\\n{tail_output}"
                    )
                    continue  # Retry with context
                else:
                    break  # Agent used significant time — don't retry
            # else: last attempt, no more retries
