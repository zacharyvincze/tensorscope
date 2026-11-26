// One capture open in an editor tab: the webview that shows it, the bundles it reads, and the
// file watcher that reloads it when the tests are rerun.

import { randomBytes } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import { HostMessage, PageMessage } from "../shared/protocol";
import { entryArrays, entryMeta, findCases } from "./bundle";
import { Capture, CasesView } from "./cases";
import { PrefsStore } from "./prefs";

export interface PanelContext {
    extensionUri: vscode.Uri;
    cases: CasesView;
    prefs: PrefsStore;
}

export class CapturePanel {
    // One panel per capture path, so reopening a capture reveals its tab instead of duplicating it.
    private static readonly panels = new Map<string, CapturePanel>();

    static all(): CapturePanel[] {
        return [...CapturePanel.panels.values()];
    }

    static async open(ctx: PanelContext, root: string): Promise<void> {
        const existing = CapturePanel.panels.get(root);
        if (existing) return existing.panel.reveal();
        const isFile = (await fs.stat(root)).isFile();
        const panel = new CapturePanel(ctx, root, isFile);
        CapturePanel.panels.set(root, panel);
        ctx.cases.show(panel);
        await panel.reload();
        // Bring up the case list for a newly opened capture; arrow keys then step through cases.
        void vscode.commands.executeCommand("tensorscope.cases.focus");
    }

    readonly capture = new Capture();
    readonly label: string;
    private readonly panel: vscode.WebviewPanel;
    private readonly disposables: vscode.Disposable[] = [];
    private pageReady = false;
    private loaded = false;

    private constructor(private readonly ctx: PanelContext, readonly root: string, isFile: boolean) {
        const dir = isFile ? path.dirname(root) : root;
        this.label = path.basename(dir);
        const assets = vscode.Uri.joinPath(ctx.extensionUri, "out");
        this.panel = vscode.window.createWebviewPanel(
            "tensorscope", `Tensorscope: ${this.label}`, vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [assets] });
        this.panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "resources", "tensorscope.svg");
        this.panel.webview.html = this.html(assets);

        this.disposables.push(
            this.panel.webview.onDidReceiveMessage((m: PageMessage) => this.receive(m)),
            this.panel.onDidChangeViewState((ev) => ev.webviewPanel.active && ctx.cases.show(this)),
            this.panel.onDidDispose(() => this.dispose()),
            ctx.prefs.onDidChange(({ prefs, source }) => source !== this && this.post({ type: "prefs", prefs })));

        // Rerunning the tests rewrites the bundles; reload once the writes settle.
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(dir), isFile ? "manifest.json" : "**/manifest.json"));
        let timer: NodeJS.Timeout | undefined;
        const changed = () => {
            clearTimeout(timer);
            timer = setTimeout(() => void this.reload(), 750);
        };
        this.disposables.push(watcher, watcher.onDidCreate(changed), watcher.onDidChange(changed),
                              watcher.onDidDelete(changed), { dispose: () => clearTimeout(timer) });
    }

    reveal(): void {
        this.panel.reveal();
    }

    post(message: HostMessage): void {
        void this.panel.webview.postMessage(message);
    }

    reload(): Thenable<void> {
        return vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Tensorscope: loading ${this.label}` },
            async () => {
                try {
                    this.capture.update(await findCases(this.root));
                    this.loaded = true;
                    if (this.pageReady) this.sendCases();
                    if (this.ctx.cases.active === this) this.ctx.cases.show(this);
                } catch (err) {
                    void vscode.window.showErrorMessage(`Tensorscope: ${(err as Error).message}`);
                }
            });
    }

    private sendCases(): void {
        const c = this.capture;
        this.post({
            type: "cases",
            root: this.root,
            entries: c.entries.map((e) => entryMeta(e.case, e.comparison)),
            failOnly: this.ctx.cases.failOnly,
            index: c.current >= 0 ? c.current : undefined,
        });
    }

    private receive(m: PageMessage): void {
        switch (m.type) {
            case "ready":
                this.pageReady = true;
                this.post({ type: "prefs", prefs: this.ctx.prefs.get() });
                if (this.loaded) this.sendCases();
                break;
            case "selected":
                this.ctx.cases.followPanel(this, m.index);
                break;
            case "load": {
                // Index the entry at request time: a reload in between renumbers, but also sends the
                // page new cases, which drops its outstanding requests.
                const e = this.capture.entries[m.index];
                const reply = e ? entryArrays(e.case, e.comparison) : Promise.reject(new Error("no such case"));
                reply.then(
                    (arrays) => this.post({ type: "arrays", id: m.id, ...arrays }),
                    (err: Error) => this.post({ type: "arraysFailed", id: m.id, error: String(err.message ?? err) }));
                break;
            }
            case "prefs":
                this.ctx.prefs.set(m.prefs, this);
                break;
            case "focusCases":
                void vscode.commands.executeCommand("tensorscope.cases.focus");
                break;
            case "copyFilter":
                void vscode.commands.executeCommand("tensorscope.copyFilter");
                break;
            case "openLayout":
                void vscode.commands.executeCommand("tensorscope.layout");
                break;
            default:
                assertNever(m);
        }
    }

    // The page is built entirely by out/webview.js; only this panel's own scripts may run, and
    // nothing loads from outside the extension.
    private html(assets: vscode.Uri): string {
        const webview = this.panel.webview;
        const uri = (...parts: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(assets, ...parts)).toString();
        const nonce = randomBytes(16).toString("base64");
        const csp = [
            "default-src 'none'",
            `img-src ${webview.cspSource} data: blob:`,
            `font-src ${webview.cspSource}`,
            `style-src ${webview.cspSource}`,
            `script-src 'nonce-${nonce}'`,
        ].join("; ");
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${uri("codicons", "codicon.css")}">
<link rel="stylesheet" href="${uri("webview.css")}">
<title>Tensorscope</title>
</head>
<body>
<script nonce="${nonce}" src="${uri("webview.js")}"></script>
</body>
</html>`;
    }

    private dispose(): void {
        CapturePanel.panels.delete(this.root);
        for (const d of this.disposables) d.dispose();
        if (this.ctx.cases.active === this) this.ctx.cases.show(CapturePanel.all().pop());
    }
}

function assertNever(x: never): never {
    throw new Error(`unhandled message ${JSON.stringify(x)}`);
}
