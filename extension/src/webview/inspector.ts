// The side panel: the hovered or pinned pixel, the comparison's details, and the test's failure text.

import type { App } from "./app";
import { clamp, fill, h, icon, iconButton } from "./dom";
import { fmt, fmtCount, fmtPercent, fmtShape } from "./format";
import { FAIL, NOT_COMPARED, offset } from "./model";

class Section {
    readonly el: HTMLElement;
    readonly body = h("div", { className: "section-body" });

    constructor(title: string, actions: HTMLElement[] = []) {
        const toggle = h("button", {
            className: "section-title", ariaExpanded: "true",
            onclick: () => {
                const open = this.el.classList.toggle("collapsed");
                toggle.ariaExpanded = String(!open);
            },
        }, icon("chevron-down", "chevron"), h("span", { textContent: title }));
        this.el = h("section", { className: "section" }, h("div", { className: "section-head" }, toggle, ...actions), this.body);
    }
}

export class Inspector {
    readonly el: HTMLElement;
    private readonly pixel = new Section("Pixel");
    private readonly details = new Section("Comparison");
    private readonly failure = new Section("Test failure");
    private readonly unpin: HTMLButtonElement;

    constructor(private readonly app: App) {
        this.unpin = iconButton("pinned", "Unpin (Esc)", () => app.setPinned(false), "unpin");
        this.pixel.el.querySelector(".section-head")!.append(this.unpin);
        this.el = h("aside", { className: "inspector", ariaLabel: "Inspector" },
            this.pixel.el, this.details.el, this.failure.el);
    }

    set width(px: number) {
        this.el.style.width = `${clamp(px, 200, window.innerWidth * 0.6)}px`;
    }

    updatePixel(): void {
        const v = this.app.view, at = this.app.hover;
        this.unpin.hidden = !this.app.pinned;
        if (!v || !at) {
            fill(this.pixel.body, h("p", { className: "hint" }, "Hover over the image to inspect a pixel. Click to pin it, so you can compare it across cases."));
            return;
        }
        const [y, x] = at, lead = this.app.lead;
        const coords = [...lead, y, x].flatMap((c, k) => (v.labels[k] ? [h("span", { className: "coord" }, h("span", { className: "axis", textContent: v.labels[k] }), String(c))] : []));
        const rows = Array.from({ length: v.channels }, (_, c) => {
            const o = offset(v, lead, y, x, c), s = v.status[o];
            const verdict = v.verdict
                ? (s === NOT_COMPARED ? h("span", { className: "muted", textContent: "not compared" })
                    : h("span", { className: s === FAIL ? "fail" : "pass" }, icon(s === FAIL ? "error" : "pass"), s === FAIL ? "fail" : "pass"))
                : h("span", { className: s === FAIL ? "over" : "muted", textContent: s === FAIL ? "over" : "within" });
            return h("tr", { className: s === FAIL ? "failing" : "" },
                v.channels > 1 ? h("th", { textContent: `c${c}` }) : null,
                h("td", { textContent: fmt(v.ref[o]) }),
                h("td", { textContent: fmt(v.act[o]) }),
                h("td", { textContent: fmt(v.diff[o]) }),
                h("td", { className: "verdict" }, verdict));
        });
        fill(this.pixel.body,
            h("div", { className: "coords" }, ...coords, this.app.pinned ? h("span", { className: "pin-note" }, icon("pinned"), "pinned") : null),
            h("table", { className: "values" },
                h("thead", {}, h("tr", {},
                    v.channels > 1 ? h("th", {}) : null,
                    h("th", { textContent: "reference" }), h("th", { textContent: "actual" }), h("th", { textContent: "diff" }), h("th", {}))),
                h("tbody", {}, ...rows)));
    }

    updateDetails(): void {
        const e = this.app.entry, v = this.app.view;
        if (!e) return;
        const row = (k: string, value: HTMLElement | string) => [h("dt", { textContent: k }), h("dd", {}, value)];
        const items = [
            ...(e.count > 1 ? row("Comparison", `${e.index + 1} of ${e.count}${e.label ? ` (${e.label})` : ""}`) : e.label ? row("Label", e.label) : []),
            ...row("Kind", e.kind),
            ...row("Axes", e.axes.join(", ")),
            ...(v ? [...row("Shape", fmtShape(v.shape)), ...row("Reference", v.dtypes[0]), ...row("Actual", v.dtypes[1])] : []),
            ...(e.compared !== undefined && e.failed !== undefined
                ? [...row("Compared", `${fmtCount(e.compared)} elements`),
                   ...row("Failed", h("span", { className: e.failed ? "fail" : "pass", textContent: `${fmtCount(e.failed)} (${fmtPercent(e.failed, e.compared)})` }))]
                : row("Verdict", h("span", { className: "muted", textContent: "none recorded" }))),
            ...(v ? row("Max |Δ|", fmt(v.peak)) : []),
        ];
        fill(this.details.body, h("dl", {}, ...items));

        const text = e.failure.trim();
        fill(this.failure.body, text
            ? h("pre", { className: "failure", textContent: text })
            : h("p", { className: "hint", textContent: e.passed ? "The test passed." : "The test reported no failure text." }));
    }
}
