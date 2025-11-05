#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REQUIRED_CLIS = [
  { command: "gemini", npmPackage: "@gitgang/gemini-cli" },
  { command: "claude", npmPackage: "@gitgang/claude-cli" },
  { command: "codex", npmPackage: "@gitgang/codex-cli" },
];

const cwd = process.cwd();

function run(cmd, args, opts = {}) {
  const baseOptions = {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    cwd,
    ...opts,
  };

  if (baseOptions.stdio === "inherit" || (Array.isArray(baseOptions.stdio) && baseOptions.stdio.includes("inherit"))) {
    delete baseOptions.encoding;
  }

  const result = spawnSync(cmd, args, baseOptions);
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    status: result.status,
  };
}

function commandInPath(command) {
  const which = process.platform === "win32" ? "where" : "which";
  const result = run(which, [command]);
  if (result.ok) return true;
  const localBin = resolve(cwd, "node_modules", ".bin", command + (process.platform === "win32" ? ".cmd" : ""));
  return existsSync(localBin);
}

function resolveInstalledVersion(pkg) {
  try {
    const packageJsonPath = require.resolve(join(pkg, "package.json"), {
      paths: [cwd],
    });
    const raw = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.version || null;
  } catch (err) {
    return null;
  }
}

function fetchLatestVersion(pkg) {
  const result = run("npm", ["view", pkg, "version"], { cwd });
  if (!result.ok) return null;
  return result.stdout.split("\n").filter(Boolean).pop() ?? null;
}

function installPackage(pkg) {
  console.log(`Installing ${pkg}@latest as devDependency…`);
  const result = run("npm", ["install", "--save-dev", `${pkg}@latest`], { cwd, stdio: "inherit" });
  if (!result.ok) {
    console.warn(`  ⚠️  Failed to install ${pkg}. stderr: ${result.stderr}`);
  }
  return result.ok;
}

function ensureCli({ command, npmPackage }) {
  const hasCommand = commandInPath(command);
  const latest = fetchLatestVersion(npmPackage);

  if (!latest) {
    console.warn(`
⚠️  Unable to find ${npmPackage} on npm. Please install the ${command} CLI manually and ensure it is on PATH.
`);
    return;
  }

  if (!hasCommand) {
    const ok = installPackage(npmPackage);
    if (!ok) {
      console.warn(`
⚠️  ${command} CLI is still missing after attempted install. Please install ${npmPackage}@${latest} manually.
`);
      return;
    }
  }

  const installed = resolveInstalledVersion(npmPackage);
  if (!installed) {
    console.warn(`
⚠️  Could not resolve installed version for ${npmPackage}. You may need to reinstall manually.
`);
    return;
  }

  if (installed !== latest) {
    console.log(`${npmPackage} is at ${installed}, updating to ${latest}…`);
    const ok = installPackage(npmPackage);
    if (!ok) {
      console.warn(`
⚠️  Failed to update ${npmPackage}. Installed version remains ${installed}.`);
    }
  }
}

for (const cli of REQUIRED_CLIS) {
  try {
    ensureCli(cli);
  } catch (err) {
    console.warn(`⚠️  Unexpected error while ensuring ${cli.command}:`, err);
  }
}
