// The four image panes: their grid, headers, canvases, linked pan and zoom, and the pixel marker.

import { PANES, Pane } from "../shared/protocol";
import type { App } from "./app";
import { clamp, fill, h, icon, iconButton } from "./dom";
import { fmtCount, fmtShort } from "./format";
import type { Painting } from "./render";
import { INFERNO_GRADIENT } from "./theme";

export const PANE_TITLES: Record<Pane, string> = {
    ref: "Reference",
    act: "Actual",
    diff: "|actual − reference|",
    status: "Status",
};

const GAP = 6, MIN_PANE = 80;

interface PaneView {
    el: HTMLDivElement;
    title: HTMLSpanElement;
    extra: HTMLSpanElement;
    maximize: HTMLButtonElement;
    scroller: HTMLDivElement;
    canvas: HTMLCanvasElement;
    mark: HTMLDivElement;
}

export interface Message {
    icon: string;
    title: string;
    detail?: string;
    action?: { label: string; run: () => void };
}

export class Panes {
    readonly el: HTMLDivElement;
    private readonly grid = h("div", { className: "grid" });
    private readonly progress = h("div", { className: "progress", hidden: true, role: "progressbar", ariaLabel: "Loading" });
    private readonly message = h("div", { className: "message", hidden: true });
    private readonly panes = {} as Record<Pane, PaneView>;
    private readonly levelChips: HTMLButtonElement[] = [];
    private readonly diffRange = h("span", { className: "range" });
    private readonly statusLegend = h("span", { className: "legend" });
    private readonly statusCount = h("span", { className: "count" });
    private progressTimer: ReturnType<typeof setTimeout> | undefined;
    private syncing = false;

    constructor(private readonly app: App) {
        for (const k of PANES) this.panes[k] = this.makePane(k);
        this.grid.append(...PANES.map((k) => this.panes[k].el));
        this.el = h("div", { className: "pane-area" }, this.progress, this.grid, this.message);
        this.grid.addEventListener("mousedown", (ev) => this.dragSplitter(ev));
        new ResizeObserver(() => this.positionSplitters()).observe(this.grid);
        this.listenForPointer();
    }

    private makePane(k: Pane): PaneView {
        const title = h("span", { className: "pane-title", textContent: PANE_TITLES[k] });
        const extra = h("span", { className: "pane-extra" });
        if (k === "ref" || k === "act") {
            const chip = h("button", {
                className: "chip", title: "Display range: the values drawn black and white. Click to adjust.",
                ariaHasPopup: "dialog", onclick: () => this.app.levelsPopover.toggle(chip),
            });
            this.levelChips.push(chip);
            extra.append(chip);
        } else if (k === "diff") {
            extra.append(h("span", { className: "colorbar", style: { background: INFERNO_GRADIENT } }), this.diffRange);
        } else {
            extra.append(this.statusCount, this.statusLegend);
        }
        const maximize = iconButton("screen-full", "Maximize (double-click the title)", () => this.app.toggleMaximized(k));
        const head = h("div", { className: "pane-head", draggable: true, title: "Drag onto another pane to swap them · double-click to maximize" },
            icon("gripper", "grip"), title, extra,
            h("span", { className: "pane-actions" }, maximize, iconButton("close", "Hide this pane", () => this.app.showPane(k, false))));
        const canvas = h("canvas", { ariaLabel: `${PANE_TITLES[k]} image` });
        // The marker lives in a stage with the canvas, so it is placed in image pixels however the
        // canvas is centred.
        const mark = h("div", { className: "mark" });
        const scroller = h("div", { className: "scroller" }, h("div", { className: "stage" }, canvas, mark));
        const el = h("div", { className: "pane", dataset: { pane: k } }, head, scroller);

        head.addEventListener("dblclick", (ev) => !(ev.target as Element).closest("button") && this.app.toggleMaximized(k));
        head.addEventListener("dragstart", (ev) => {
            ev.dataTransfer!.setData("application/x-tensorscope-pane", k);
            ev.dataTransfer!.effectAllowed = "move";
            el.classList.add("moving");
        });
        head.addEventListener("dragend", () => {
            el.classList.remove("moving");
            for (const p of PANES) this.panes[p].el.classList.remove("drop");
        });
        el.addEventListener("dragover", (ev) => {
            if (!ev.dataTransfer?.types.includes("application/x-tensorscope-pane") || el.classList.contains("moving")) return;
            ev.preventDefault();
            el.classList.add("drop");
        });
        el.addEventListener("dragleave", (ev) => !el.contains(ev.relatedTarget as Node) && el.classList.remove("drop"));
        el.addEventListener("drop", (ev) => {
            ev.preventDefault();
            el.classList.remove("drop");
            const from = ev.dataTransfer?.getData("application/x-tensorscope-pane") as Pane | undefined;
            if (from && from !== k) this.app.swapPanes(from, k);
        });
        scroller.addEventListener("scroll", () => !this.syncing && this.scrollAll(scroller.scrollLeft, scroller.scrollTop));
        return { el, title, extra, maximize, scroller, canvas, mark };
    }

    /** The panes on screen, in order. */
    shown(): Pane[] {
        const { maximized, prefs } = this.app;
        return maximized ? [maximized] : prefs.order.filter((k) => !prefs.hidden.includes(k));
    }

    private gridShape(n: number): [number, number] {
        const a = this.app.prefs.arrangement;
        if (a === "row") return [n, 1];
        if (a === "column") return [1, n];
        const cols = Math.ceil(Math.sqrt(n));
        return [cols, Math.ceil(n / cols)];
    }

    // Track sizes are kept per arrangement and shape, so maximizing or hiding a pane doesn't lose them.
    private tracks(cols: number, rows: number): { cols: number[]; rows: number[] } {
        const prefs = this.app.prefs, key = `${prefs.arrangement}:${cols}x${rows}`, t = prefs.tracks[key];
        if (t && t.cols.length === cols && t.rows.length === rows) return t;
        return (prefs.tracks[key] = { cols: Array(cols).fill(1), rows: Array(rows).fill(1) });
    }

    layout(): void {
        const shown = this.shown(), [cols, rows] = this.gridShape(shown.length), t = this.tracks(cols, rows);
        this.grid.style.gridTemplateColumns = t.cols.map((x) => `minmax(0, ${x}fr)`).join(" ");
        this.grid.style.gridTemplateRows = t.rows.map((x) => `minmax(0, ${x}fr)`).join(" ");
        for (const k of PANES) {
            const p = this.panes[k], i = shown.indexOf(k), max = this.app.maximized === k;
            p.el.hidden = i < 0;
            p.el.style.order = String(i);
            fill(p.maximize, icon(max ? "screen-normal" : "screen-full"));
            p.maximize.title = p.maximize.ariaLabel = max ? "Restore (Esc)" : "Maximize (double-click the title)";
        }
        this.positionSplitters();
        this.placeMarks();
    }

    // Splitters sit in the grid gaps; each moves the boundary between two adjacent tracks.
    private positionSplitters(): void {
        for (const s of this.grid.querySelectorAll(".splitter")) s.remove();
        const shown = this.shown(), [cols, rows] = this.gridShape(shown.length), g = this.grid.getBoundingClientRect();
        const add = (axis: "col" | "row", i: number, at: number) =>
            this.grid.append(h("div", { className: `splitter ${axis}`, dataset: { i: String(i) },
                                       style: { [axis === "col" ? "left" : "top"]: `${at + GAP / 2 - 3}px` } }));
        for (let i = 0; i < cols - 1; ++i) add("col", i, this.panes[shown[i]].el.getBoundingClientRect().right - g.left);
        for (let j = 0; j < rows - 1; ++j) add("row", j, this.panes[shown[j * cols]].el.getBoundingClientRect().bottom - g.top);
    }

    private dragSplitter(ev: MouseEvent): void {
        const s = (ev.target as Element).closest<HTMLElement>(".splitter");
        if (!s || ev.button !== 0) return;
        ev.preventDefault();
        const shown = this.shown(), [cols, rows] = this.gridShape(shown.length), t = this.tracks(cols, rows);
        const i = Number(s.dataset.i), col = s.classList.contains("col"), arr = col ? t.cols : t.rows;
        const a = this.panes[shown[col ? i : i * cols]].el.getBoundingClientRect();
        const b = this.panes[shown[col ? i + 1 : (i + 1) * cols]].el.getBoundingClientRect();
        const wa = col ? a.width : a.height, wb = col ? b.width : b.height, sum = arr[i] + arr[i + 1];
        const start = col ? ev.clientX : ev.clientY;
        dragging(col ? "col-resize" : "row-resize", (m) => {
            const d = clamp((col ? m.clientX : m.clientY) - start, MIN_PANE - wa, wb - MIN_PANE);
            arr[i] = (sum * (wa + d)) / (wa + wb);
            arr[i + 1] = sum - arr[i];
            this.layout();
        }, () => this.app.savePrefs());
    }

    /** Draws a painted slice at the current zoom. */
    show(p: Painting): void {
        for (const k of PANES) {
            const c = this.panes[k].canvas, img = p.images[k];
            c.width = img.width;
            c.height = img.height;
            c.getContext("2d")!.putImageData(img, 0, 0);
        }
        this.applyZoom();
    }

    /** Resizes the canvases for the zoom; the pixels are not re-rendered. */
    applyZoom(): void {
        const v = this.app.view, z = this.app.zoom;
        if (!v) return;
        for (const k of PANES) {
            const c = this.panes[k].canvas;
            c.style.width = `${v.width * z}px`;
            c.style.height = `${v.height * z}px`;
        }
        this.placeMarks();
    }

    updateHeads(p: Painting, levels: readonly [number, number], manual: boolean): void {
        const v = this.app.view!;
        for (const chip of this.levelChips)
            fill(chip, `${fmtShort(levels[0])} … ${fmtShort(levels[1])}`, manual ? null : h("span", { className: "auto", textContent: "auto" }));
        this.diffRange.textContent = `0 … ${fmtShort(v.peak)}`;
        const status = this.panes.status;
        status.title.textContent = v.verdict ? PANE_TITLES.status : "Threshold";
        const sw = (cls: string) => h("span", { className: `swatch ${cls}` });
        if (v.verdict) {
            fill(this.statusLegend, sw("pass"), "pass", sw("fail"), "fail", sw("not-compared"), "not compared");
        } else {
            const chip = h("button", {
                className: "chip", textContent: `|Δ| > ${fmtShort(this.app.threshold)}`, ariaHasPopup: "dialog",
                title: "No per-element verdict in this bundle: elements over this threshold are marked. It is a viewing aid, not the test's result. Click to adjust.",
                onclick: () => this.app.thresholdPopover.toggle(chip),
            });
            fill(this.statusLegend, sw("over"), chip);
        }
        this.statusCount.className = `count ${p.failing ? (v.verdict ? "fail" : "over") : ""}`;
        this.statusCount.textContent = `${fmtCount(p.failing)} / ${fmtCount(p.compared)} px`;
        this.statusCount.title = `Pixels in this slice that ${v.verdict ? "failed" : "are over the threshold"}, of those compared`;
    }

    firstScroller(): HTMLDivElement {
        return this.panes[this.shown()[0]].scroller;
    }

    /** Where the image sits within a pane's scrolled content, which centres a small image. */
    static stageOffset(scroller: HTMLElement): { left: number; top: number } {
        const stage = scroller.firstElementChild as HTMLElement;
        return { left: stage.offsetLeft, top: stage.offsetTop };
    }

    scrollAll(left: number, top: number): void {
        this.syncing = true;
        for (const k of PANES) {
            const s = this.panes[k].scroller;
            s.scrollLeft = left;
            s.scrollTop = top;
        }
        this.syncing = false;
    }

    // Outlines the hovered or pinned pixel in every pane, at least 5 px so it shows at low zoom.
    placeMarks(): void {
        const v = this.app.view, at = this.app.hover, z = this.app.zoom, pinned = this.app.pinned;
        const on = !!v && !!at && at[0] < v.height && at[1] < v.width;
        for (const k of PANES) {
            const { mark } = this.panes[k];
            mark.hidden = !on;
            if (!on) continue;
            const size = Math.max(z, 5) + (pinned ? 2 : 0), pad = (size - z) / 2;
            mark.classList.toggle("pinned", pinned);
            Object.assign(mark.style, {
                left: `${at![1] * z - pad}px`, top: `${at![0] * z - pad}px`,
                width: `${size}px`, height: `${size}px`,
            });
        }
    }

    /** Shows the progress bar if loading takes long enough to notice. */
    setLoading(loading: boolean): void {
        clearTimeout(this.progressTimer);
        if (loading) this.progressTimer = setTimeout(() => (this.progress.hidden = false), 120);
        else this.progress.hidden = true;
    }

    /** Covers the panes with a message, or removes it. */
    setMessage(m: Message | null): void {
        this.message.hidden = !m;
        this.grid.hidden = !!m;
        if (!m) return;
        fill(this.message,
            icon(m.icon, "message-icon"),
            h("h2", { textContent: m.title }),
            m.detail ? h("p", { textContent: m.detail }) : null,
            m.action ? h("button", { className: "primary", textContent: m.action.label, onclick: m.action.run }) : null);
    }

    private listenForPointer(): void {
        const pixelAt = (ev: MouseEvent, canvas: HTMLCanvasElement): [number, number] => {
            const r = canvas.getBoundingClientRect(), z = this.app.zoom;
            return [Math.floor((ev.clientY - r.top) / z), Math.floor((ev.clientX - r.left) / z)];
        };
        let drag: { scroller: HTMLDivElement; x: number; y: number; left: number; top: number; moved: boolean } | null = null;
        for (const k of PANES) {
            const { scroller, canvas } = this.panes[k];
            canvas.addEventListener("mousemove", (ev) => !drag?.moved && this.app.hoverPixel(...pixelAt(ev, canvas)));
            canvas.addEventListener("mouseleave", () => this.app.hoverPixel(null));
            // Wheel zooms about the cursor: the image point under it stays put.
            scroller.addEventListener("wheel", (ev) => {
                if (!this.app.view) return;
                ev.preventDefault();
                const r = scroller.getBoundingClientRect();
                this.app.zoomAt(scroller, ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1 : -1);
            }, { passive: false });
            // Dragging pans every pane together; a click without movement pins or unpins the pixel.
            scroller.addEventListener("mousedown", (ev) => {
                if (ev.button !== 0) return;
                ev.preventDefault();
                drag = { scroller, x: ev.clientX, y: ev.clientY, left: scroller.scrollLeft, top: scroller.scrollTop, moved: false };
                scroller.classList.add("panning");
            });
        }
        window.addEventListener("mousemove", (ev) => {
            if (!drag) return;
            const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
            if (drag.moved) this.scrollAll(drag.left - dx, drag.top - dy);
        });
        window.addEventListener("mouseup", (ev) => {
            if (!drag) return;
            drag.scroller.classList.remove("panning");
            if (!drag.moved && ev.target instanceof HTMLCanvasElement) this.app.clickPixel(...pixelAt(ev, ev.target));
            drag = null;
        });
    }
}

/** Tracks a mouse drag until release, with `cursor` everywhere meanwhile. */
export function dragging(cursor: string, onMove: (ev: MouseEvent) => void, onEnd: () => void): void {
    document.body.style.cursor = cursor;
    document.body.classList.add("resizing");
    const up = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", up);
        document.body.style.cursor = "";
        document.body.classList.remove("resizing");
        onEnd();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", up);
}
