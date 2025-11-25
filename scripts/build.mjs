#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const outfile = resolve("dist/cli.js");
mkdirSync(resolve("dist"), { recursive: true });

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
