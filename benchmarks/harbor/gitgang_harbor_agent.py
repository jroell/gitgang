"""
Harbor agent that runs gitgang in solo claude mode for terminal-bench 2.0.

Usage (from gitgang repo root):
    PYTHONPATH=benchmarks/harbor harbor run \\
        --dataset terminal-bench@2.0 \\
        --agent-import-path "gitgang_harbor_agent:GitgangAgent" \\
        --model claude-sonnet-4-6 \\
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
      1. System packages (curl, git, nodejs, npm) via root
      2. claude-code via the official install script (as agent user)
      3. Clone jroell/gitgang, npm ci --ignore-scripts --omit=optional, npm run build (as root)
      4. Symlink /opt/gitgang/dist/cli.js → /usr/local/bin/gitgang

    run() steps:
      1. Ensure the CWD is a git repo (terminal-bench envs may start without one)
      2. Run: gitgang --solo claude --yolo --no-pr -- "<instruction>"
    """

    SUPPORTS_ATIF: bool = False

    @staticmethod
    def name() -> str:
        # Custom name — not in AgentName enum; loaded via import_path
        return "gitgang"

    def get_version_command(self) -> str | None:
        return "node /opt/gitgang/dist/cli.js --version 2>/dev/null || echo unknown"

    async def install(self, environment: BaseEnvironment) -> None:
        # ── 1. System packages ──────────────────────────────────────────────
        await self.exec_as_root(
            environment,
            command=(
                "if command -v apt-get &>/dev/null; then"
                "  export DEBIAN_FRONTEND=noninteractive;"
                "  apt-get update -qq &&"
                "  apt-get install -y --no-install-recommends curl git nodejs npm;"
                " elif command -v apk &>/dev/null; then"
                "  apk add --no-cache curl git nodejs npm;"
                " elif command -v yum &>/dev/null; then"
                "  yum install -y curl git nodejs npm;"
                " fi"
            ),
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )

        # ── 2. Install claude-code (agent user) ─────────────────────────────
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

        # ── 3. Clone + build gitgang (root for /opt write access) ───────────
        await self.exec_as_root(
            environment,
            command=(
                "set -euo pipefail; "
                "git clone --depth 1 https://github.com/jroell/gitgang.git /opt/gitgang && "
                "cd /opt/gitgang && "
                # Skip postinstall (ensure-clis.mjs checks for all three CLIs)
                "npm ci --ignore-scripts --omit=optional && "
                "npm run build && "
                "chmod +x dist/cli.js"
            ),
        )

        # ── 4. Make gitgang available on PATH ───────────────────────────────
        await self.exec_as_root(
            environment,
            command=(
                "ln -sf /opt/gitgang/dist/cli.js /usr/local/bin/gitgang && "
                "chmod +x /usr/local/bin/gitgang"
            ),
        )

    def populate_context_post_run(self, context: AgentContext) -> None:
        # gitgang doesn't emit ATIF; capture basic token info if available
        output_path = self.logs_dir / "gitgang.txt"
        if not output_path.exists():
            return
        # Nothing to parse for now — extend later to extract claude token counts
        pass

    @with_prompt_template
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        escaped_instruction = shlex.quote(instruction)

        env = {
            "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", ""),
            # Tell claude-code it's running in a sandboxed env (bypass permissions)
            "IS_SANDBOX": "1",
            "FORCE_AUTO_BACKGROUND_TASKS": "1",
            "ENABLE_BACKGROUND_TASKS": "1",
            # Prevent gitgang from timing out too aggressively
            "GITGANG_AGENT_IDLE_TIMEOUT": "600000",  # 10 min idle timeout
        }

        # Remove empty values so the container's own env can take precedence
        env = {k: v for k, v in env.items() if v}

        # Pass model name through if set
        if self.model_name:
            model = self.model_name.split("/")[-1]
            model_flag = f"--model-claude {shlex.quote(model)}"
        else:
            model_flag = ""

        await self.exec_as_agent(
            environment,
            command=(
                # Ensure git config so gitgang can commit inside worktrees
                'git config --global user.email "agent@benchmark.local" 2>/dev/null || true; '
                'git config --global user.name "agent" 2>/dev/null || true; '
                # Initialise a git repo in the CWD if there isn't one already
                # (some terminal-bench tasks start without a repo)
                "if ! git rev-parse --git-dir &>/dev/null; then "
                "  git init -q && "
                "  git add -A 2>/dev/null || true && "
                "  git commit -q -m 'bench: initial state' --allow-empty; "
                "fi; "
                # Run gitgang in solo claude mode
                'export PATH="$HOME/.local/bin:$PATH"; '
                f"gitgang --solo claude --yolo --no-pr {model_flag} "
                f"-- {escaped_instruction} "
                f"2>&1 | tee /logs/agent/gitgang.txt"
            ),
            env=env,
        )
