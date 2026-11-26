// Small floating panels anchored below the control that opens them. One is open at a time; a
// click elsewhere, Escape, or a resize closes it.

import { clamp, h } from "./dom";

let open: Popover | null = null;

export class Popover {
    readonly el: HTMLDivElement;
    private anchor: HTMLElement | null = null;

    constructor(label: string) {
        this.el = h("div", { className: "popover", role: "dialog", ariaLabel: label, hidden: true });
        document.body.append(this.el);
    }

    /** Refreshes the contents just before the popover shows. */
    protected onOpen(): void {}

    get isOpen(): boolean {
        return open === this;
    }

    toggle(anchor: HTMLElement): void {
        if (this.isOpen) this.close();
        else this.show(anchor);
    }

    show(anchor: HTMLElement): void {
        open?.close();
        open = this;
        this.anchor = anchor;
        this.onOpen();
        this.el.hidden = false;
        anchor.ariaExpanded = "true";
        const r = anchor.getBoundingClientRect();
        this.el.style.left = `${clamp(r.left, 4, window.innerWidth - this.el.offsetWidth - 4)}px`;
        this.el.style.top = `${clamp(r.bottom + 4, 4, window.innerHeight - this.el.offsetHeight - 4)}px`;
        this.el.querySelector<HTMLElement>("input, button")?.focus();
    }

    close(): void {
        if (!this.isOpen) return;
        open = null;
        this.el.hidden = true;
        if (this.anchor) this.anchor.ariaExpanded = "false";
        this.anchor = null;
    }

    /** Whether ev happened on this popover or the control that opened it. */
    owns(target: Node): boolean {
        return this.el.contains(target) || !!this.anchor?.contains(target);
    }
}

/** Closes the open popover; returns whether there was one. */
export function closePopover(): boolean {
    if (!open) return false;
    open.close();
    return true;
}

document.addEventListener("mousedown", (ev) => {
    if (open && !open.owns(ev.target as Node)) open.close();
});
window.addEventListener("resize", () => closePopover());
