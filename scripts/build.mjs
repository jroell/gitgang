#!/usr/bin/env node
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const distDir = resolve("dist");
const outfile = resolve(distDir, "cli.js");

// Clean dist to avoid bundling stale artifacts (e.g., old binaries)
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

await build({
  entryPoints: ["src/cli.ts"],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  banner: { js: "#!/usr/bin/env node" },
  packages: "external",
  logLevel: "info",
});

console.log(`Built ${outfile}`);
