// Popover contents: the display range of reference and actual, and the viewer-side threshold.

import { OUTSIDE_MODES, Outside } from "../shared/protocol";
import type { App } from "./app";
import { Segmented, h } from "./dom";
import { THRESHOLD_STEPS, thresholdAt, thresholdPos } from "./model";
import { Popover } from "./popover";

/** A slider and a number box editing the same value. */
class NumberSlider {
    readonly range = h("input", { type: "range" });
    readonly box = h("input", { type: "number", step: "any" });
    readonly el: HTMLLabelElement;

    constructor(label: string, title: string, onSlide: (x: number) => void, onType: (x: number) => void) {
        this.range.ariaLabel = this.box.ariaLabel = label;
        this.range.oninput = () => onSlide(Number(this.range.value));
        this.box.onchange = () => onType(parseFloat(this.box.value));
        this.el = h("label", { className: "field", title }, h("span", { className: "key", textContent: label }), this.range, this.box);
    }

    /** Shows x in the box, unless the user is typing there. */
    show(x: number): void {
        if (document.activeElement !== this.box) this.box.value = String(+x.toPrecision(6));
    }
}

export class LevelsPopover extends Popover {
    private readonly lo: NumberSlider;
    private readonly hi: NumberSlider;
    private readonly auto: HTMLButtonElement;
    private readonly outside: Segmented<Outside>;
    private readonly outsideRow: HTMLElement;

    constructor(private readonly app: App) {
        super("Display range");
        this.lo = new NumberSlider("Black", "Value drawn black", (x) => app.setLevel("lo", x), (x) => app.setLevel("lo", x));
        this.hi = new NumberSlider("White", "Value drawn white", (x) => app.setLevel("hi", x), (x) => app.setLevel("hi", x));
        this.auto = h("button", {
            className: "secondary", textContent: "Automatic", onclick: () => app.setLevels(null),
            title: "8-bit data: the type's full range. Otherwise: the compared elements of the current slice. (A)",
        });
        this.outside = new Segmented("Elements not compared",
            OUTSIDE_MODES.map((m) => ({ value: m, text: m[0].toUpperCase() + m.slice(1) })), (m) => app.setOutside(m));
        this.outsideRow = h("div", { className: "field", title: "How reference and actual draw elements the comparator did not check" },
            h("span", { className: "key", textContent: "Not compared" }), this.outside.el);
        this.el.append(h("h3", { textContent: "Display range" }), this.lo.el, this.hi.el,
            h("div", { className: "field" }, h("span", { className: "key" }), this.auto), this.outsideRow);
    }

    protected override onOpen(): void {
        this.sync();
    }

    sync(): void {
        const v = this.app.view;
        if (!v) return;
        const [lo, hi] = this.app.shownLevels;
        const step = v.typeRange ? 1 : (v.domain[1] - v.domain[0]) / 1000;
        const min = Math.min(v.domain[0], lo), max = Math.max(v.domain[1], hi);
        for (const [s, x] of [[this.lo, lo], [this.hi, hi]] as const) {
            Object.assign(s.range, { min: String(min), max: String(max), step: String(step) });
            s.range.value = String(x);
            s.box.step = v.typeRange ? "1" : "any";
            s.show(x);
        }
        this.auto.ariaPressed = String(!this.app.levels);
        this.outside.value = this.app.prefs.outside;
        this.outsideRow.hidden = !v.verdict;
    }
}

export class ThresholdPopover extends Popover {
    private readonly slider: NumberSlider;

    constructor(private readonly app: App) {
        super("Threshold");
        const v = () => app.view;
        this.slider = new NumberSlider("|Δ| >", "Mark elements whose |actual − reference| exceeds this",
            (pos) => { const view = v(); if (view) app.setThreshold(thresholdAt(view, pos)); },
            (t) => app.setThreshold(t));
        Object.assign(this.slider.range, { min: "0", max: String(THRESHOLD_STEPS), step: "1" });
        this.slider.box.min = "0";
        this.el.append(h("h3", { textContent: "Threshold" }), this.slider.el,
            h("p", { className: "note", textContent: "This bundle has no per-element verdict, so the status pane marks elements over this threshold. It is a viewing aid, not the test's result." }));
    }

    protected override onOpen(): void {
        this.sync();
    }

    sync(): void {
        const v = this.app.view;
        if (!v) return;
        this.slider.range.disabled = !(v.peak > 0);
        this.slider.range.value = String(thresholdPos(v, this.app.threshold));
        this.slider.show(this.app.threshold);
    }
}
