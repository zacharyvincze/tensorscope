import { randomBytes } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import { Case, entryArrays, findCases, pageIndex } from "./bundle";
import { Capture, CasesView, Entry, Node } from "./cases";

// One panel per capture path, so reopening the same capture reveals it instead of duplicating it.
const captures = new Map<string, Capture>();
let cases: CasesView;

const FAIL_ONLY = "tensorscope.failOnly";

export function activate(context: vscode.ExtensionContext): void {
    cases = new CasesView(context.globalState.get(FAIL_ONLY, false));

    const setFailOnly = (value: boolean) => {
        cases.failOnly = value;
        context.globalState.update(FAIL_ONLY, value);
        for (const c of captures.values()) c.panel.webview.postMessage({ type: "failOnly", failOnly: value });
    };
    // Context-menu commands get the clicked node; from the palette they act on the shown case.
    const entryOf = (node?: Node): Entry | undefined => {
        if (node?.kind === "entry") return node;
        const c = cases.active;
        return c?.entries[c.current];
    };

    context.subscriptions.push(
        cases,
        vscode.commands.registerCommand("tensorscope.open", async (uri?: vscode.Uri) => {
            uri ??= (await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                openLabel: "Open Capture",
                title: "Capture directory (TENSORSCOPE_CAPTURE_DIR of a run, or any directory below it)",
            }))?.[0];
            if (uri) await open(context, uri.fsPath);
        }),
        vscode.commands.registerCommand("tensorscope.failingOnly", () => setFailOnly(true)),
        vscode.commands.registerCommand("tensorscope.allCases", () => setFailOnly(false)),
        vscode.commands.registerCommand("tensorscope.reload", () => cases.active?.reload()),
        vscode.commands.registerCommand("tensorscope.copyFilter", async (node?: Node) => {
            const e = entryOf(node);
            if (!e) return;
            await vscode.env.clipboard.writeText(`--gtest_filter='${e.case.name}'`);
            vscode.window.setStatusBarMessage(`Copied --gtest_filter for ${e.case.name}`, 3000);
        }),
        vscode.commands.registerCommand("tensorscope.openManifest", (node?: Node) => {
            const e = entryOf(node);
            if (e) vscode.window.showTextDocument(vscode.Uri.file(path.join(e.case.dir, "manifest.json")));
        }));
}

async function open(context: vscode.ExtensionContext, root: string): Promise<void> {
    const existing = captures.get(root);
    if (existing) return existing.panel.reveal();

    const isFile = (await fs.stat(root)).isFile();
    const label = path.basename(isFile ? path.dirname(root) : root);
    const panel = vscode.window.createWebviewPanel(
        "tensorscope", `Tensorscope: ${label}`, vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    const capture = new Capture(root, label, panel);
    captures.set(root, capture);

    const template = path.join(context.extensionPath, "media", "html_viewer.html");
    capture.reload = () => vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `Tensorscope: loading ${label}` },
        async () => {
            try {
                const found = await findCases(root);
                capture.update(found);
                panel.webview.html = await html(panel.webview, template, root, found);
                if (cases.active === capture) cases.show(capture);
            } catch (err) {
                vscode.window.showErrorMessage(`Tensorscope: ${(err as Error).message}`);
            }
        });

    panel.webview.onDidReceiveMessage((m) => {
        if (m.type === "ready") {
            const index = capture.current >= 0 ? capture.current : undefined;
            panel.webview.postMessage({ type: "init", failOnly: cases.failOnly, index });
        } else if (m.type === "selected") {
            cases.followPanel(capture, m.index);
        } else if (m.type === "load") {
            // Index the entry at request time: a reload in between renumbers, but also replaces the
            // page, so a stale request has no one left to answer.
            const e = capture.entries[m.index];
            const reply = e ? entryArrays(e.case, e.comparison) : Promise.reject(new Error("no such case"));
            reply.then(
                (data) => panel.webview.postMessage({ type: "arrays", id: m.id, ...data }),
                (err) => panel.webview.postMessage({ type: "arrays", id: m.id, error: String(err.message ?? err) }));
        } else if (m.type === "focusCases") {
            vscode.commands.executeCommand("tensorscope.cases.focus");
        }
    });
    panel.onDidChangeViewState((ev) => ev.webviewPanel.active && cases.show(capture));

    // Rerunning the tests rewrites the bundles; reload once the writes settle.
    const base = vscode.Uri.file(isFile ? path.dirname(root) : root);
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(base, isFile ? "manifest.json" : "**/manifest.json"));
    let timer: NodeJS.Timeout | undefined;
    const changed = () => {
        clearTimeout(timer);
        timer = setTimeout(capture.reload, 750);
    };
    watcher.onDidCreate(changed);
    watcher.onDidChange(changed);
    watcher.onDidDelete(changed);

    panel.onDidDispose(() => {
        clearTimeout(timer);
        watcher.dispose();
        captures.delete(root);
        if (cases.active === capture) cases.show([...captures.values()].pop());
    });

    cases.show(capture);
    await capture.reload();
    // Bring up the case list for a newly opened capture; arrow keys then step through cases.
    vscode.commands.executeCommand("tensorscope.cases.focus");
}

async function html(webview: vscode.Webview, template: string, root: string, found: Case[]): Promise<string> {
    if (!found.length) return message(`No capture bundles under ${root}.`);
    const page = await fs.readFile(template, "utf8");

    // Webviews should carry a CSP: only this page's own scripts run, and nothing loads remotely.
    const nonce = randomBytes(16).toString("base64");
    const csp = `default-src 'none'; img-src ${webview.cspSource} blob: data:; ` +
                `style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    const data = pageIndex(found);
    return page
        .replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`)
        .replace(/<script>/g, `<script nonce="${nonce}">`)
        .replace("/*__TENSORSCOPE_DATA__*/[]", () => data);
}

function message(text: string): string {
    const escaped = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:2em">${escaped}` +
           `<p>Run the tests with TENSORSCOPE_CAPTURE_DIR set; the view reloads when bundles appear.</p>` +
           `</body></html>`;
}

export function deactivate(): void {}
