// Keyboard shortcuts: one table drives both the key handler and the help dialog, so they can't
// drift apart.

import type { App } from "./app";
import { h, iconButton } from "./dom";

interface Shortcut {
    /** KeyboardEvent.key values that trigger it. */
    keys: readonly string[];
    /** Only for keys with both a shifted and an unshifted shortcut, such as the arrows. */
    shift?: boolean;
    /** How the help dialog writes the keys. */
    display: readonly string[];
    description: string;
    group: "Cases" | "Image" | "Inspect";
    run(app: App): void;
}

const SHORTCUTS: readonly Shortcut[] = [
    { keys: ["ArrowDown", "j"], display: ["↓", "J"], description: "Next case", group: "Cases", run: (a) => a.stepCase(1) },
    { keys: ["ArrowUp", "k"], display: ["↑", "K"], description: "Previous case", group: "Cases", run: (a) => a.stepCase(-1) },
    { keys: ["/"], display: ["/"], description: "Focus the Cases view to filter", group: "Cases", run: (a) => a.focusCases() },
    { keys: ["c"], display: ["C"], description: "Copy --gtest_filter for this case", group: "Cases", run: (a) => a.copyFilter() },
    { keys: ["ArrowRight"], display: ["→"], description: "Next slice (innermost leading axis)", group: "Image", run: (a) => a.stepSlice(false, 1) },
    { keys: ["ArrowLeft"], display: ["←"], description: "Previous slice", group: "Image", run: (a) => a.stepSlice(false, -1) },
    { keys: ["ArrowRight"], shift: true, display: ["Shift", "→"], description: "Next position on the outermost axis", group: "Image", run: (a) => a.stepSlice(true, 1) },
    { keys: ["ArrowLeft"], shift: true, display: ["Shift", "←"], description: "Previous position on the outermost axis", group: "Image", run: (a) => a.stepSlice(true, -1) },
    { keys: ["f", "0"], display: ["F"], description: "Fit the image to the pane", group: "Image", run: (a) => a.fit() },
    { keys: ["+", "="], display: ["+"], description: "Zoom in (or scroll the wheel)", group: "Image", run: (a) => a.zoomBy(1) },
    { keys: ["-", "_"], display: ["−"], description: "Zoom out", group: "Image", run: (a) => a.zoomBy(-1) },
    { keys: ["a"], display: ["A"], description: "Automatic display range", group: "Image", run: (a) => a.setLevels(null) },
    { keys: ["n"], display: ["N"], description: "Next failing pixel, across slices", group: "Inspect", run: (a) => a.jumpToFailure(1) },
    { keys: ["N"], display: ["Shift", "N"], description: "Previous failing pixel", group: "Inspect", run: (a) => a.jumpToFailure(-1) },
    { keys: ["Escape"], display: ["Esc"], description: "Close a popup · restore a maximized pane · unpin", group: "Inspect", run: (a) => a.escape() },
    { keys: ["?"], display: ["?"], description: "Show these shortcuts", group: "Inspect", run: (a) => a.shortcuts.toggle() },
];

const MOUSE: readonly [string, string][] = [
    ["Click", "Pin the pixel under the cursor; click again to unpin"],
    ["Drag", "Pan every pane together"],
    ["Wheel", "Zoom about the cursor"],
    ["Drag a pane title", "Swap it with another pane"],
    ["Double-click a pane title", "Maximize or restore it"],
];

/** Runs the shortcut for ev, if there is one; returns whether one ran. */
export function handleKey(app: App, ev: KeyboardEvent): boolean {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
    // Shift is part of the character for keys like "?" and "+", so it only decides between two
    // shortcuts on the same key.
    const matches = SHORTCUTS.filter((k) => k.keys.includes(ev.key));
    const s = matches.length > 1 ? matches.find((k) => !!k.shift === ev.shiftKey) : matches[0];
    if (!s) return false;
    s.run(app);
    return true;
}

export class ShortcutsDialog {
    readonly el: HTMLDialogElement;

    constructor() {
        const groups = ["Cases", "Image", "Inspect"] as const;
        const kbd = (keys: readonly string[]) => h("span", { className: "keys" }, ...keys.map((k) => h("kbd", { textContent: k })));
        const row = (keys: HTMLElement, text: string) => h("tr", {}, h("td", {}, keys), h("td", { textContent: text }));
        this.el = h("dialog", { className: "shortcuts", ariaLabel: "Keyboard shortcuts" },
            h("header", {},
                h("h2", { textContent: "Keyboard shortcuts" }),
                iconButton("close", "Close (Esc)", () => this.el.close())),
            h("div", { className: "columns" },
                ...groups.map((g) => h("section", {},
                    h("h3", { textContent: g }),
                    h("table", {}, ...SHORTCUTS.filter((s) => s.group === g).map((s) => row(kbd(s.display), s.description))))),
                h("section", {},
                    h("h3", { textContent: "Mouse" }),
                    h("table", {}, ...MOUSE.map(([what, text]) => row(h("span", { className: "gesture", textContent: what }), text))))));
        this.el.addEventListener("click", (ev) => ev.target === this.el && this.el.close());
        document.body.append(this.el);
    }

    toggle(): void {
        if (this.el.open) this.el.close();
        else this.el.showModal();
    }
}
