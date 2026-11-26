// Entry point: registers the Cases view, the commands, and the editor-tab buttons.

import * as path from "path";
import * as vscode from "vscode";

import { ARRANGEMENTS, Command, PANE_NAMES, PANES } from "../shared/protocol";
import { CasesView, Entry, Node } from "./cases";
import { CapturePanel, PanelContext } from "./panel";
import { PrefsStore } from "./prefs";

const FAIL_ONLY = "tensorscope.failOnly";

export function activate(context: vscode.ExtensionContext): void {
    const cases = new CasesView(context.globalState.get(FAIL_ONLY, false));
    const prefs = new PrefsStore(context.globalState);
    const ctx: PanelContext = { extensionUri: context.extensionUri, cases, prefs };

    const setFailOnly = (value: boolean) => {
        cases.failOnly = value;
        void context.globalState.update(FAIL_ONLY, value);
        for (const p of CapturePanel.all()) p.post({ type: "failOnly", failOnly: value });
    };
    // Context-menu commands get the clicked node; from the palette or the page they act on the
    // shown case.
    const entryOf = (node?: Node): Entry | undefined =>
        node?.kind === "entry" ? node : cases.active?.capture.currentEntry;
    const command = (c: Command) => cases.active?.post({ type: "command", command: c });

    context.subscriptions.push(
        cases,
        prefs,
        vscode.commands.registerCommand("tensorscope.open", async (uri?: vscode.Uri) => {
            uri ??= (await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                openLabel: "Open Capture",
                title: "Capture directory (TENSORSCOPE_CAPTURE_DIR of a run, or any directory below it)",
            }))?.[0];
            if (uri) await CapturePanel.open(ctx, uri.fsPath);
        }),
        vscode.commands.registerCommand("tensorscope.failingOnly", () => setFailOnly(true)),
        vscode.commands.registerCommand("tensorscope.allCases", () => setFailOnly(false)),
        vscode.commands.registerCommand("tensorscope.reload", () => cases.active?.reload()),
        vscode.commands.registerCommand("tensorscope.copyFilter", async (node?: Node) => {
            const e = entryOf(node);
            if (!e) return;
            await vscode.env.clipboard.writeText(`--gtest_filter='${e.case.name}'`);
            vscode.window.setStatusBarMessage(`$(check) Copied --gtest_filter for ${e.case.name}`, 3000);
        }),
        vscode.commands.registerCommand("tensorscope.openManifest", (node?: Node) => {
            const e = entryOf(node);
            if (e) void vscode.window.showTextDocument(vscode.Uri.file(path.join(e.case.dir, "manifest.json")));
        }),
        vscode.commands.registerCommand("tensorscope.fit", () => command({ name: "fit" })),
        vscode.commands.registerCommand("tensorscope.shortcuts", () => command({ name: "shortcuts" })),
        vscode.commands.registerCommand("tensorscope.layout", () => pickLayout(prefs, command)));
}

type LayoutItem = vscode.QuickPickItem & { command?: Command };

// The layout menu stays open so several changes can be made, and redraws as the page reports them.
function pickLayout(prefs: PrefsStore, command: (c: Command) => void): void {
    const qp = vscode.window.createQuickPick<LayoutItem>();
    qp.title = "Tensorscope: Layout";
    qp.placeholder = "Arrange the panes, or show and hide them";
    const sep = (label: string): LayoutItem => ({ label, kind: vscode.QuickPickItemKind.Separator });
    const render = () => {
        const { arrangement, hidden, inspectorShown } = prefs.get();
        const at = qp.activeItems.length ? qp.items.indexOf(qp.activeItems[0]) : -1;
        qp.items = [
            sep("Arrangement"),
            ...ARRANGEMENTS.map((a): LayoutItem => ({
                label: `$(${a === arrangement ? "check" : "blank"}) ${a[0].toUpperCase() + a.slice(1)}`,
                command: { name: "arrange", arrangement: a },
            })),
            sep("Panes"),
            ...PANES.map((pane): LayoutItem => {
                const shown = !hidden.includes(pane);
                return {
                    label: `$(${shown ? "eye" : "eye-closed"}) ${PANE_NAMES[pane]}`,
                    description: shown ? "" : "hidden",
                    command: { name: "showPane", pane, shown: !shown },
                };
            }),
            sep("Side panel"),
            {
                label: `$(${inspectorShown ? "eye" : "eye-closed"}) Inspector`,
                description: inspectorShown ? "pixel, comparison, test failure" : "hidden",
                command: { name: "showInspector", shown: !inspectorShown },
            },
            sep(""),
            { label: "$(discard) Reset Layout", description: "default order, sizes and panes", command: { name: "resetLayout" } },
        ];
        if (at >= 0) qp.activeItems = [qp.items[at]];
    };
    render();
    const sub = prefs.onDidChange(render);
    qp.onDidAccept(() => {
        const c = qp.selectedItems[0]?.command;
        if (c) command(c);
    });
    qp.onDidHide(() => {
        sub.dispose();
        qp.dispose();
    });
    qp.show();
}
