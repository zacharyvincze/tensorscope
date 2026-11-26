// Bundles the extension (Node) and the webview (browser) with esbuild, and copies the assets the
// webview loads. Type checking is separate: `npm run typecheck`.
//   node scripts/build.mjs [--production] [--watch]

import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "out");
const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "codicons"), { recursive: true });
const codicons = path.join(root, "node_modules", "@vscode", "codicons", "dist");
for (const file of ["codicon.css", "codicon.ttf"]) fs.copyFileSync(path.join(codicons, file), path.join(out, "codicons", file));
// vsce packages only files under the extension directory.
fs.copyFileSync(path.join(root, "..", "LICENSE"), path.join(root, "LICENSE"));

const common = { bundle: true, minify: production, sourcemap: !production, logLevel: "info" };
const contexts = await Promise.all([
    esbuild.context({
        ...common,
        entryPoints: [path.join(root, "src", "extension", "extension.ts")],
        outfile: path.join(out, "extension.js"),
        platform: "node",
        format: "cjs",
        target: "node18",
        external: ["vscode"],
    }),
    esbuild.context({
        ...common,
        entryPoints: { webview: path.join(root, "src", "webview", "main.ts") },
        outdir: out,
        platform: "browser",
        format: "iife",
        // VS Code 1.85's Electron.
        target: "chrome114",
    }),
]);

if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
} else {
    await Promise.all(contexts.map((c) => c.rebuild()));
    await Promise.all(contexts.map((c) => c.dispose()));
}
