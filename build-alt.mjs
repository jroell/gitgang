import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const distDir = resolve("dist");
const outfile = resolve(distDir, "cli.js");

// Don't rm dist - just overwrite in place
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

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
  allowOverwrite: true,
});

try {
  chmodSync(outfile, 0o755);
} catch {
  /* ignore chmod failures */
}

console.log(`Built ${outfile}`);
