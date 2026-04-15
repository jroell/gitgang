import { describe, test, expect } from "vitest";
import { parseArgs } from "./cli";

describe("gg init subcommand parsing", () => {
  test("'init' parses to subcommand with force=false", () => {
    const p = parseArgs(["init"]);
    expect(p.subcommand).toEqual({ kind: "init", force: false });
  });

  test("'init --force' sets force=true", () => {
    const p = parseArgs(["init", "--force"]);
    expect(p.subcommand).toEqual({ kind: "init", force: true });
  });

  test("'init -f' short form", () => {
    const p = parseArgs(["init", "-f"]);
    expect(p.subcommand).toEqual({ kind: "init", force: true });
  });
});
