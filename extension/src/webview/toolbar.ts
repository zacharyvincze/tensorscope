// The toolbar under the header: slice position, channel, failure navigation, and zoom.

import type { App } from "./app";
import { Segmented, fill, h, iconButton } from "./dom";
import { fmtCount } from "./format";
import { failingCount } from "./model";

export class Toolbar {
    readonly el: HTMLDivElement;
    private readonly slices = h("div", { className: "group slices" });
    private readonly channel = h("div", { className: "group" });
    private readonly failures = h("div", { className: "group" });
    private readonly failureCount = h("span", { className: "count" });
    private readonly prevFailure: HTMLButtonElement;
    private readonly nextFailure: HTMLButtonElement;
    private readonly zoomText: HTMLButtonElement;
    private positions: HTMLSpanElement[] = [];
    private ranges: HTMLInputElement[] = [];
    /** The channel buttons, when there are few enough channels for buttons rather than a list. */
    private channelButtons: Segmented<string> | null = null;

    constructor(private readonly app: App) {
        this.prevFailure = iconButton("arrow-up", "Previous failing pixel (Shift+N)", () => app.jumpToFailure(-1));
        this.nextFailure = iconButton("arrow-down", "Next failing pixel (N)", () => app.jumpToFailure(1));
        fill(this.failures, h("span", { className: "label", textContent: "Failures" }), this.failureCount, this.prevFailure, this.nextFailure);
        this.zoomText = h("button", { className: "zoom-text", title: "Fit to pane (F)", onclick: () => app.fit() });
        this.el = h("div", { className: "toolbar", role: "toolbar", ariaLabel: "View" },
            this.slices,
            this.channel,
            h("div", { className: "spacer" }),
            this.failures,
            h("div", { className: "group" },
                iconButton("zoom-out", "Zoom out (−)", () => app.zoomBy(-1)),
                this.zoomText,
                iconButton("zoom-in", "Zoom in (+)", () => app.zoomBy(1)),
                iconButton("screen-full", "Fit to pane (F)", () => app.fit())));
    }

    /** Rebuilds the controls that depend on the shown comparison's shape. */
    rebuild(): void {
        const v = this.app.view;
        this.el.hidden = !v;
        if (!v) return;

        // Leading axes with more than one position get a stepper; the rest have nothing to step.
        this.positions = [];
        this.ranges = [];
        const steppers: HTMLElement[] = [];
        v.dims.slice(0, -2).forEach((size, k) => {
            if (size === 1) return;
            const name = v.labels[k] || `axis ${k}`;
            const range = h("input", {
                type: "range", min: "0", max: String(size - 1), ariaLabel: `${name} position`,
                oninput: () => this.app.setLead(k, Number(range.value)),
            });
            const pos = h("span", { className: "pos" });
            this.ranges[k] = range;
            this.positions[k] = pos;
            steppers.push(h("div", { className: "group", title: `Step through ${name} (← →; Shift for the outermost axis)` },
                h("span", { className: "label", textContent: name }),
                iconButton("chevron-left", `Previous ${name}`, () => this.app.setLead(k, this.app.lead[k] - 1)),
                range,
                iconButton("chevron-right", `Next ${name}`, () => this.app.setLead(k, this.app.lead[k] + 1)),
                pos));
        });
        fill(this.slices, ...steppers);

        const options = [...(v.rgb ? [{ value: "all", text: "RGB", title: "All three channels as colour" }] : []),
                         ...Array.from({ length: v.channels }, (_, c) => ({ value: String(c), text: String(c), title: `Channel ${c}` }))];
        const pick = (value: string) => this.app.setChannel(value);
        this.channelButtons = options.length > 1 && options.length <= 5 ? new Segmented("Channel", options, pick) : null;
        if (options.length > 1)
            fill(this.channel, h("span", { className: "label", textContent: "Channel" }), this.channelButtons?.el
                ?? h("select", { ariaLabel: "Channel", onchange: (ev) => pick((ev.target as HTMLSelectElement).value) },
                    ...options.map((o) => h("option", { value: o.value, textContent: o.title, selected: o.value === this.app.channel }))));
        this.channel.hidden = options.length <= 1;
        this.update();
    }

    /** Refreshes the values shown, after a step, a zoom, or a threshold change. */
    update(): void {
        const v = this.app.view;
        if (!v) return;
        const lead = this.app.lead;
        this.ranges.forEach((r, k) => (r.value = String(lead[k])));
        this.positions.forEach((p, k) => (p.textContent = `${lead[k]} / ${v.dims[k] - 1}`));
        const failing = failingCount(v);
        this.failureCount.textContent = fmtCount(failing);
        this.failureCount.className = `count ${failing ? (v.verdict ? "fail" : "over") : ""}`;
        this.failureCount.title = v.verdict ? "Failing elements in this comparison" : "Elements over the threshold";
        this.prevFailure.disabled = this.nextFailure.disabled = !failing;
        this.zoomText.textContent = `${this.app.zoom}×`;
        this.zoomText.title = `Zoom ${this.app.zoom}× · fit to pane (F)`;
        if (this.channelButtons) this.channelButtons.value = this.app.channel;
    }
}
