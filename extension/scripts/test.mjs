// Bundles test/*.test.ts with esbuild and runs them with Node's test runner.

import * as esbuild from "esbuild";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "out-test");
const tests = fs.readdirSync(path.join(root, "test")).filter((f) => f.endsWith(".test.ts"));

fs.rmSync(out, { recursive: true, force: true });
await esbuild.build({
    entryPoints: tests.map((f) => path.join(root, "test", f)),
    outdir: out,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    logLevel: "warning",
});
const run = spawnSync(process.execPath, ["--test", ...tests.map((f) => path.join(out, f.replace(/\.ts$/, ".js")))], { stdio: "inherit" });
process.exit(run.status ?? 1);
