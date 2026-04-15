import { describe, test, expect } from "vitest";
import {
  generateCompletionScript,
  TOP_LEVEL_COMMANDS,
  SESSIONS_SUBCOMMANDS,
  COMPLETIONS_SHELLS,
  type Shell,
} from "./completions";

describe("generateCompletionScript — shell branching", () => {
  test.each(["bash", "zsh", "fish"] as Shell[])(
    "%s shell produces a non-empty script",
    (shell) => {
      const out = generateCompletionScript(shell);
      expect(out.length).toBeGreaterThan(100);
    },
  );

  test("different shells produce different output", () => {
    const bash = generateCompletionScript("bash");
    const zsh = generateCompletionScript("zsh");
    const fish = generateCompletionScript("fish");
    expect(bash).not.toBe(zsh);
    expect(zsh).not.toBe(fish);
    expect(bash).not.toBe(fish);
  });
});

describe("bash completion script", () => {
  const script = generateCompletionScript("bash");

  test("binds the function with complete -F", () => {
    expect(script).toContain("complete -F _gitgang_complete gg");
    expect(script).toContain("complete -F _gitgang_complete gitgang");
  });

  test("lists every top-level command", () => {
    for (const cmd of TOP_LEVEL_COMMANDS) {
      expect(script).toContain(cmd);
    }
  });

  test("lists every sessions subcommand", () => {
    for (const sub of SESSIONS_SUBCOMMANDS) {
      expect(script).toContain(sub);
    }
  });

  test("lists every supported shell in completions subcommand", () => {
    for (const shell of COMPLETIONS_SHELLS) {
      expect(script).toContain(shell);
    }
  });

  test("has a source-instructions header comment", () => {
    expect(script.split("\n")[0]).toContain("bash completion");
    expect(script).toMatch(/eval.*gg completions bash/);
  });
});

describe("zsh completion script", () => {
  const script = generateCompletionScript("zsh");

  test("uses compdef for zsh-native binding", () => {
    expect(script).toContain("compdef _gitgang gg");
    expect(script).toContain("compdef _gitgang gitgang");
  });

  test("uses compadd not compgen (bash idiom)", () => {
    expect(script).toContain("compadd");
    expect(script).not.toContain("compgen");
  });

  test("lists every top-level command", () => {
    for (const cmd of TOP_LEVEL_COMMANDS) {
      expect(script).toContain(cmd);
    }
  });

  test("lists every sessions subcommand", () => {
    for (const sub of SESSIONS_SUBCOMMANDS) {
      expect(script).toContain(sub);
    }
  });

  test("has a source-instructions header comment", () => {
    expect(script.split("\n")[0]).toContain("zsh completion");
    expect(script).toMatch(/eval.*gg completions zsh/);
  });
});

describe("fish completion script", () => {
  const script = generateCompletionScript("fish");

  test("uses complete -c for fish-native binding", () => {
    expect(script).toContain("complete -c gg");
    expect(script).toContain("complete -c gitgang");
  });

  test("uses __fish_use_subcommand for top-level", () => {
    expect(script).toContain("__fish_use_subcommand");
  });

  test("uses __fish_seen_subcommand_from sessions for subcommands", () => {
    expect(script).toContain("__fish_seen_subcommand_from sessions");
  });

  test("includes every sessions subcommand with seen-subcommand-from gate", () => {
    for (const sub of SESSIONS_SUBCOMMANDS) {
      expect(script).toMatch(
        new RegExp(`__fish_seen_subcommand_from sessions.*-a '${sub}'`),
      );
    }
  });

  test("includes completions shells with seen-subcommand-from completions gate", () => {
    for (const shell of COMPLETIONS_SHELLS) {
      expect(script).toMatch(
        new RegExp(`__fish_seen_subcommand_from completions.*-a '${shell}'`),
      );
    }
  });

  test("flag entries include a description", () => {
    expect(script).toMatch(/-a '-i'.*-d 'start interactive REPL'/);
    expect(script).toMatch(/-a '-v'.*-d 'print version'/);
  });

  test("recommends the correct install path", () => {
    expect(script).toContain("~/.config/fish/completions/gg.fish");
  });
});

describe("TOP_LEVEL_COMMANDS", () => {
  test("includes the core commands users expect to tab-complete", () => {
    expect(TOP_LEVEL_COMMANDS).toContain("sessions");
    expect(TOP_LEVEL_COMMANDS).toContain("doctor");
    expect(TOP_LEVEL_COMMANDS).toContain("completions");
    expect(TOP_LEVEL_COMMANDS).toContain("-i");
    expect(TOP_LEVEL_COMMANDS).toContain("--version");
    expect(TOP_LEVEL_COMMANDS).toContain("--help");
  });
});

describe("SESSIONS_SUBCOMMANDS", () => {
  test("includes every sessions subcommand that exists in the CLI", () => {
    expect(SESSIONS_SUBCOMMANDS).toEqual([
      "list",
      "show",
      "stats",
      "export",
      "delete",
      "prune",
      "search",
    ]);
  });
});
