import { randomBytes } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import { findCases, pageData } from "./bundle";

// One panel per capture path, so reopening the same capture reveals it instead of duplicating it.
const panels = new Map<string, vscode.WebviewPanel>();

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand("tensorscope.open", async (uri?: vscode.Uri) => {
            uri ??= (await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                openLabel: "Open Capture",
                title: "Capture directory (TENSORSCOPE_CAPTURE_DIR of a run, or any directory below it)",
            }))?.[0];
            if (uri) await open(context, uri.fsPath);
        }));
}

async function open(context: vscode.ExtensionContext, root: string): Promise<void> {
    const existing = panels.get(root);
    if (existing) return existing.reveal();

    const isFile = (await fs.stat(root)).isFile();
    const label = path.basename(isFile ? path.dirname(root) : root);
    const panel = vscode.window.createWebviewPanel(
        "tensorscope", `tensorscope: ${label}`, vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    panels.set(root, panel);

    const template = path.join(context.extensionPath, "media", "html_viewer.html");
    const render = () => vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `tensorscope: loading ${label}` },
        async () => {
            try {
                panel.webview.html = await html(panel.webview, template, root);
            } catch (err) {
                vscode.window.showErrorMessage(`tensorscope: ${(err as Error).message}`);
            }
        });

    // Rerunning the tests rewrites the bundles; reload once the writes settle.
    const base = vscode.Uri.file(isFile ? path.dirname(root) : root);
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(base, isFile ? "manifest.json" : "**/manifest.json"));
    let timer: NodeJS.Timeout | undefined;
    const changed = () => {
        clearTimeout(timer);
        timer = setTimeout(render, 750);
    };
    watcher.onDidCreate(changed);
    watcher.onDidChange(changed);
    watcher.onDidDelete(changed);

    panel.onDidDispose(() => {
        clearTimeout(timer);
        watcher.dispose();
        panels.delete(root);
    });
    await render();
}

async function html(webview: vscode.Webview, template: string, root: string): Promise<string> {
    const cases = await findCases(root);
    const page = await fs.readFile(template, "utf8");
    if (!cases.length) return message(`No capture bundles under ${root}.`);

    // Webviews should carry a CSP: only this page's own scripts run, and nothing loads remotely.
    const nonce = randomBytes(16).toString("base64");
    const csp = `default-src 'none'; img-src ${webview.cspSource} blob: data:; ` +
                `style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    const data = await pageData(cases);
    return page
        .replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`)
        .replace(/<script>/g, `<script nonce="${nonce}">`)
        .replace("/*__TENSORSCOPE_DATA__*/[]", () => data);
}

function message(text: string): string {
    const escaped = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2em">${escaped}` +
           `<p>Run the tests with TENSORSCOPE_CAPTURE_DIR set; the view reloads when bundles appear.</p>` +
           `</body></html>`;
}

export function deactivate(): void {}
