// The Cases sidebar view: the comparisons of the active capture panel, grouped by test, kept in
// sync with the case shown in that panel.

import * as vscode from "vscode";

import { Case } from "./bundle";

export interface Entry {
    kind: "entry";
    index: number;  // position in the page's ENTRIES, i.e. pageData() order
    case: Case;
    comparison: number;
    leaf: string;
    group?: Group;
}

export interface Group {
    kind: "group";
    label: string;
    entries: Entry[];
}

export type Node = Entry | Group;

// "Prefix/Suite.Test/Param" groups under "Prefix/Suite.Test"; a plain "Suite.Test" under "Suite".
function split(name: string): [string, string] {
    const slash = name.lastIndexOf("/");
    if (slash > 0) return [name.slice(0, slash), name.slice(slash + 1)];
    const dot = name.indexOf(".");
    if (dot > 0) return [name.slice(0, dot), name.slice(dot + 1)];
    return ["", name];
}

const key = (e: Entry) => `${e.case.name}#${e.comparison}`;

export class Capture {
    entries: Entry[] = [];
    roots: Node[] = [];
    current = -1;            // entry shown in the panel
    private currentKey = ""; // the same entry across reloads, which renumber entries
    reload: () => Thenable<void> = async () => {};

    constructor(readonly root: string, readonly label: string, readonly panel: vscode.WebviewPanel) {}

    update(cases: Case[]): void {
        this.entries = [];
        const groups = new Map<string, Group>();
        this.roots = [];
        for (const c of cases)
            for (let k = 0; k < c.comparisons.length; ++k) {
                const [label, leaf] = split(c.name);
                const e: Entry = { kind: "entry", index: this.entries.length, case: c, comparison: k, leaf };
                this.entries.push(e);
                if (!label) {
                    this.roots.push(e);
                    continue;
                }
                let g = groups.get(label);
                if (!g) {
                    g = { kind: "group", label, entries: [] };
                    groups.set(label, g);
                    this.roots.push(g);
                }
                g.entries.push(e);
                e.group = g;
            }
        this.current = this.entries.findIndex((e) => key(e) === this.currentKey);
    }

    select(index: number): void {
        this.current = index;
        const e = this.entries[index];
        if (e) this.currentKey = key(e);
    }

    get failing(): number {
        return this.entries.filter((e) => !e.case.passed).length;
    }
}

const icon = (passed: boolean) => passed
    ? new vscode.ThemeIcon("testing-passed-icon", new vscode.ThemeColor("testing.iconPassed"))
    : new vscode.ThemeIcon("testing-failed-icon", new vscode.ThemeColor("testing.iconFailed"));

export class CasesView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
    readonly view: vscode.TreeView<Node>;
    private capture?: Capture;
    private readonly changed = new vscode.EventEmitter<Node | undefined>();
    readonly onDidChangeTreeData = this.changed.event;

    constructor(private failOnlyValue: boolean) {
        this.view = vscode.window.createTreeView("tensorscope.cases", {
            treeDataProvider: this,
            showCollapseAll: true,
        });
        // Selection follows keyboard moves in the tree too, so arrowing through it steps cases.
        this.view.onDidChangeSelection((ev) => {
            const n = ev.selection[0], c = this.capture;
            if (n?.kind !== "entry" || !c || n.index === c.current) return;
            c.select(n.index);
            c.panel.webview.postMessage({ type: "select", index: n.index });
        });
        this.view.onDidChangeVisibility((ev) => ev.visible && this.revealCurrent());
        this.setContext();
    }

    get active(): Capture | undefined {
        return this.capture;
    }

    get failOnly(): boolean {
        return this.failOnlyValue;
    }

    set failOnly(value: boolean) {
        this.failOnlyValue = value;
        this.refresh();
    }

    show(capture: Capture | undefined): void {
        this.capture = capture;
        this.refresh();
        this.revealCurrent();
    }

    refresh(): void {
        const c = this.capture;
        this.view.description = c ? `${c.label} · ${c.failing} of ${c.entries.length} failing` : undefined;
        this.setContext();
        this.changed.fire(undefined);
    }

    // The panel moved to another case, e.g. with its own arrow keys.
    followPanel(capture: Capture, index: number): void {
        if (index === capture.current) return;
        capture.select(index);
        if (capture === this.capture) this.revealCurrent();
    }

    // Only while the view is visible: reveal() would otherwise open the sidebar on every step.
    private revealCurrent(): void {
        const e = this.capture?.entries[this.capture.current];
        if (!e || !this.view.visible || (this.failOnlyValue && e.case.passed)) return;
        this.view.reveal(e, { select: true, focus: false, expand: true }).then(undefined, () => {});
    }

    private setContext(): void {
        vscode.commands.executeCommand("setContext", "tensorscope.hasCapture", !!this.capture);
        vscode.commands.executeCommand("setContext", "tensorscope.failOnly", this.failOnlyValue);
    }

    private shown(e: Entry): boolean {
        return !this.failOnlyValue || !e.case.passed;
    }

    getChildren(node?: Node): Node[] {
        if (!this.capture) return [];
        const nodes = node?.kind === "group" ? node.entries : node ? [] : this.capture.roots;
        return nodes.filter((n) => n.kind === "entry" ? this.shown(n) : n.entries.some((e) => this.shown(e)));
    }

    getParent(node: Node): Node | undefined {
        return node.kind === "entry" ? node.group : undefined;
    }

    getTreeItem(node: Node): vscode.TreeItem {
        if (node.kind === "group") {
            const failing = node.entries.filter((e) => !e.case.passed).length;
            const item = new vscode.TreeItem(node.label, failing
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed);
            item.id = `group:${node.label}`;
            item.iconPath = icon(!failing);
            item.description = failing ? `${failing} of ${node.entries.length} failing` : `${node.entries.length} passed`;
            item.contextValue = "group";
            return item;
        }
        const c = node.case, cmp = c.comparisons[node.comparison];
        const label = node.leaf + (c.comparisons.length > 1 ? ` [${node.comparison}]` : "");
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.id = `entry:${key(node)}`;
        item.iconPath = icon(c.passed);
        item.description = c.passed ? undefined : `${cmp.failed}/${cmp.compared}`;
        const tip = new vscode.MarkdownString();
        tip.appendMarkdown(`**${c.name}**${c.comparisons.length > 1 ? ` [${node.comparison}]` : ""}\n\n`);
        tip.appendMarkdown(`${cmp.kind} · ${cmp.failed} of ${cmp.compared} compared elements failed`);
        const failure = c.failure.trim();
        if (failure) tip.appendCodeblock(failure.length > 2000 ? failure.slice(0, 2000) + "\n…" : failure, "text");
        item.tooltip = tip;
        item.contextValue = "entry";
        return item;
    }

    dispose(): void {
        this.view.dispose();
        this.changed.dispose();
    }
}
