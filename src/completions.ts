/**
 * `gg completions <shell>` — generates a shell completion script for bash,
 * zsh, or fish. Pure function; no I/O.
 *
 * The script completes:
 *   - top-level: sessions, doctor, completions, -i, --interactive,
 *     --version, -v, --help, -h
 *   - sessions subcommands: list, show, stats, export, delete, prune, search
 *   - completions arg: bash, zsh, fish
 *
 * Dynamic completion of session ids (e.g. `gg sessions show <TAB>` listing
 * real ids from .gitgang/sessions/) is intentionally out of scope for v1;
 * static completion alone covers the discoverability problem.
 */

export type Shell = "bash" | "zsh" | "fish";

export const TOP_LEVEL_COMMANDS = [
  "sessions",
  "doctor",
  "completions",
  "-i",
  "--interactive",
  "--version",
  "-v",
  "--help",
  "-h",
] as const;

export const SESSIONS_SUBCOMMANDS = [
  "list",
  "show",
  "stats",
  "export",
  "delete",
  "prune",
  "search",
] as const;

export const COMPLETIONS_SHELLS: readonly Shell[] = ["bash", "zsh", "fish"];

export function generateCompletionScript(shell: Shell): string {
  switch (shell) {
    case "bash":
      return bashScript();
    case "zsh":
      return zshScript();
    case "fish":
      return fishScript();
  }
}

function bashScript(): string {
  const topLevel = TOP_LEVEL_COMMANDS.join(" ");
  const subs = SESSIONS_SUBCOMMANDS.join(" ");
  const shells = COMPLETIONS_SHELLS.join(" ");
  return `# gitgang bash completion
# Source this in ~/.bashrc:   eval "$(gg completions bash)"

_gitgang_complete() {
  local cur prev words cword
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  # sessions <TAB>
  if [[ "\${COMP_WORDS[1]}" == "sessions" && "\$COMP_CWORD" -eq 2 ]]; then
    COMPREPLY=( \$(compgen -W "${subs}" -- "\$cur") )
    return 0
  fi

  # completions <TAB>
  if [[ "\${COMP_WORDS[1]}" == "completions" && "\$COMP_CWORD" -eq 2 ]]; then
    COMPREPLY=( \$(compgen -W "${shells}" -- "\$cur") )
    return 0
  fi

  # top-level
  if [[ "\$COMP_CWORD" -eq 1 ]]; then
    COMPREPLY=( \$(compgen -W "${topLevel}" -- "\$cur") )
    return 0
  fi
}
complete -F _gitgang_complete gg
complete -F _gitgang_complete gitgang
`;
}

function zshScript(): string {
  const topLevel = TOP_LEVEL_COMMANDS.join(" ");
  const subs = SESSIONS_SUBCOMMANDS.join(" ");
  const shells = COMPLETIONS_SHELLS.join(" ");
  return `# gitgang zsh completion
# Source this in ~/.zshrc:   eval "$(gg completions zsh)"

_gitgang() {
  local -a top_cmds sub_cmds shell_cmds
  top_cmds=(${topLevel})
  sub_cmds=(${subs})
  shell_cmds=(${shells})

  if (( CURRENT == 2 )); then
    compadd -a top_cmds
    return 0
  fi

  if [[ "\${words[2]}" == "sessions" && CURRENT -eq 3 ]]; then
    compadd -a sub_cmds
    return 0
  fi

  if [[ "\${words[2]}" == "completions" && CURRENT -eq 3 ]]; then
    compadd -a shell_cmds
    return 0
  fi
}
compdef _gitgang gg
compdef _gitgang gitgang
`;
}

function fishScript(): string {
  const top = TOP_LEVEL_COMMANDS.filter((c) => !c.startsWith("-"));
  const flags = TOP_LEVEL_COMMANDS.filter((c) => c.startsWith("-"));
  const lines: string[] = [];
  lines.push("# gitgang fish completion");
  lines.push("# Source this in ~/.config/fish/completions/gg.fish:");
  lines.push("#   gg completions fish > ~/.config/fish/completions/gg.fish");
  lines.push("");
  for (const cmd of top) {
    lines.push(
      `complete -c gg -n '__fish_use_subcommand' -a '${cmd}' -d 'gitgang ${cmd} subcommand'`,
    );
    lines.push(
      `complete -c gitgang -n '__fish_use_subcommand' -a '${cmd}' -d 'gitgang ${cmd} subcommand'`,
    );
  }
  for (const flag of flags) {
    const desc =
      flag === "-i" || flag === "--interactive"
        ? "start interactive REPL"
        : flag === "-v" || flag === "--version"
          ? "print version"
          : "show help";
    lines.push(
      `complete -c gg -n '__fish_use_subcommand' -a '${flag}' -d '${desc}'`,
    );
    lines.push(
      `complete -c gitgang -n '__fish_use_subcommand' -a '${flag}' -d '${desc}'`,
    );
  }
  for (const sub of SESSIONS_SUBCOMMANDS) {
    lines.push(
      `complete -c gg -n '__fish_seen_subcommand_from sessions' -a '${sub}' -d 'sessions ${sub}'`,
    );
    lines.push(
      `complete -c gitgang -n '__fish_seen_subcommand_from sessions' -a '${sub}' -d 'sessions ${sub}'`,
    );
  }
  for (const shell of COMPLETIONS_SHELLS) {
    lines.push(
      `complete -c gg -n '__fish_seen_subcommand_from completions' -a '${shell}' -d 'generate ${shell} completion'`,
    );
    lines.push(
      `complete -c gitgang -n '__fish_seen_subcommand_from completions' -a '${shell}' -d 'generate ${shell} completion'`,
    );
  }
  return lines.join("\n") + "\n";
}
