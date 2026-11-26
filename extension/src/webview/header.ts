// The case header: verdict badge, case name as a breadcrumb, and a one-line summary.

import type { App } from "./app";
import { fill, h, icon, iconButton } from "./dom";
import { fmt, fmtCount, fmtPercent, fmtShape } from "./format";
import { failingCount } from "./model";

export class Header {
    readonly el: HTMLElement;
    private readonly badge = h("span", { className: "badge" });
    private readonly crumbs = h("h1", { className: "crumbs" });
    private readonly summary = h("div", { className: "summary" });

    constructor(private readonly app: App) {
        this.el = h("header", { className: "case-header" },
            h("div", { className: "title-row" },
                this.badge,
                this.crumbs,
                iconButton("copy", "Copy --gtest_filter for this case (C)", () => app.copyFilter())),
            this.summary);
    }

    update(): void {
        const e = this.app.entry, v = this.app.view;
        this.el.hidden = !e;
        if (!e) return;

        this.badge.className = `badge ${e.passed ? "pass" : "fail"}`;
        fill(this.badge, icon(e.passed ? "pass-filled" : "error"), e.passed ? "Passed" : "Failed");
        this.badge.title = e.passed ? "The test case passed" : "The test case failed";

        const parts = e.case.split("/");
        fill(this.crumbs, ...parts.flatMap((p, i) => [
            i ? icon("chevron-right", "sep") : null,
            h("span", { className: i === parts.length - 1 ? "leaf" : "", textContent: p }),
        ]));
        if (e.label || e.count > 1)
            this.crumbs.append(h("span", {
                className: "tag",
                textContent: e.label ?? `#${e.index + 1}`,
                title: `Comparison ${e.index + 1} of ${e.count} in this case`,
            }));
        this.crumbs.title = e.case;

        const items: (HTMLElement | string)[] = [h("span", { textContent: e.kind, title: "Kind" })];
        if (v) {
            items.push(h("span", { textContent: fmtShape(v.shape), title: `Shape (${e.axes.join(", ")})` }));
            const [rt, at] = v.dtypes;
            items.push(h("span", { textContent: rt === at ? rt : `${rt} → ${at}`, title: `Reference ${rt}, actual ${at}` }));
        }
        if (e.compared !== undefined && e.failed !== undefined) {
            items.push(e.failed
                ? h("span", { className: "fail", textContent: `${fmtCount(e.failed)} of ${fmtCount(e.compared)} failed (${fmtPercent(e.failed, e.compared)})` })
                : h("span", { className: "pass", textContent: `all ${fmtCount(e.compared)} compared passed` }));
        } else {
            items.push(h("span", { className: "no-verdict", title: "The comparator reported no per-element verdict; the status pane marks elements over a threshold you choose instead" },
                icon("warning"), "no per-element verdict"));
            if (v) items.push(h("span", { className: "over", textContent: `${fmtCount(failingCount(v))} over |Δ| > ${fmt(v.threshold)}` }));
        }
        if (v) items.push(h("span", { textContent: `max |Δ| ${fmt(v.peak)}`, title: "Largest |actual − reference| over the whole comparison" }));
        fill(this.summary, ...items.flatMap((it, i) => [i ? h("span", { className: "dot", textContent: "·" }) : null, it]));
    }
}
