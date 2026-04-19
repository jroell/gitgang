"""
Harbor agent that runs gitgang in solo claude mode for terminal-bench 2.0.

Usage (from gitgang repo root):
    PYTHONPATH=benchmarks/harbor harbor run \\
        --dataset terminal-bench@2.0 \\
        --agent-import-path "gitgang_harbor_agent:GitgangAgent" \\
        --model claude-opus-4-6 \\
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
      2. Common build tools for compilation-heavy tasks (root)
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
                "    sqlite3 gawk flex bison; "
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

        # 2. Install claude-code (agent user)
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                "curl -fsSL https://claude.ai/install.sh | bash && "
                'echo \'export PATH="$HOME/.local/bin:$PATH"\' >> ~/.bashrc && '
                'export PATH="$HOME/.local/bin:$PATH" && '
                "claude --version"
            ),
            env={"ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", "")},
        )

        # 3. Clone gitgang
        await self.exec_as_root(
            environment,
            command=(
                "set -euo pipefail; "
                "git clone --depth 1 https://github.com/jroell/gitgang.git /opt/gitgang && "
                "echo 'Clone OK'"
            ),
        )

        # 4. Install npm deps + build (separate step for clearer errors)
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

        # 5. Symlink onto PATH
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
            "GITGANG_MAX_TURNS": "200",
            # Disable interactive prompts/confirmations inside claude
            "DISABLE_PROMPT": "1",
        }
        env = {k: v for k, v in env.items() if v}

        model_flag = ""
        if self.model_name:
            model = self.model_name.split("/")[-1]
            model_flag = f"--model-claude {shlex.quote(model)} "

        # The run command is wrapped so it always exits 0. Harbor raises
        # NonZeroAgentExitCodeError for non-zero exits, but we want the
        # verifier (reward) to be the sole arbiter of success. gitgang may
        # exit non-zero for reasons that don't affect the solution quality
        # (e.g., reviewer JSON parse failure, timeout after work is done).
        await self.exec_as_agent(
            environment,
            command=(
                # Global git config so gitgang can commit inside worktrees
                'git config --global user.email "agent@benchmark.local" 2>/dev/null || true; '
                'git config --global user.name "agent" 2>/dev/null || true; '
                # Init a git repo if the task env doesn't have one already
                "if ! git rev-parse --git-dir &>/dev/null; then "
                "  git init -q && "
                "  git add -A 2>/dev/null || true && "
                "  git commit -q -m 'bench: initial state' --allow-empty; "
                "fi; "
                # Pre-flight: verify claude auth works before spending time
                'export PATH="$HOME/.local/bin:$PATH"; '
                "if ! claude --version &>/dev/null; then "
                "  echo 'WARNING: claude not found on PATH'; "
                "fi; "
                # Run gitgang in solo claude mode. The trailing `; exit 0`
                # ensures harbor doesn't abort on non-zero gitgang exit --
                # the verifier's reward is the real signal.
                f"gitgang --solo claude --yolo --no-pr {model_flag}"
                f"-- {escaped_instruction} "
                f"2>&1 | tee /logs/agent/gitgang.txt; exit 0"
            ),
            env=env,
        )
