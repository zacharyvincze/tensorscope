// The page's state and every action on it. Components render from this state and call these
// actions; nothing else changes the state.

import {
    ARRANGEMENTS, Arrangement, Command, DEFAULT_PREFS, EntryMeta, Outside, PANE_NAMES, PANES, Pane, Prefs, sanitizePrefs,
} from "../shared/protocol";
import { LevelsPopover, ThresholdPopover } from "./controls";
import { clamp, h } from "./dom";
import { Header } from "./header";
import { abandonRequests, AppMessage, post, requestArrays } from "./host";
import { Inspector } from "./inspector";
import { applyThreshold, CaseView, decode, findFailure, sliceLimits } from "./model";
import { closePopover } from "./popover";
import { dragging, Panes } from "./panes";
import { paint } from "./render";
import { ShortcutsDialog } from "./shortcuts";
import { Palette, readPalette, watchTheme } from "./theme";
import { toast } from "./toast";
import { Toolbar } from "./toolbar";

const ZOOM_MIN = 1, ZOOM_MAX = 128;
/** Decoded comparisons kept, most recently used last, so a long session doesn't hold every case. */
const CACHE_SIZE = 24;

export class App {
    // ---- capture
    entries: EntryMeta[] = [];
    private root = "";
    private failOnly = false;
    /** The cases the Cases view lists, in its order; case navigation steps through these. */
    private visible: number[] = [];

    // ---- shown comparison
    current = -1;
    view: CaseView | null = null;
    /** Position on each leading axis. */
    lead: number[] = [];
    /** The channel picked: a channel number, or "all" for RGB. */
    channel = "all";
    /** Manual display levels; null for automatic. */
    levels: [number, number] | null = null;
    /** The levels last drawn, automatic or not. */
    shownLevels: readonly [number, number] = [0, 1];
    threshold = 0;
    zoom = 8;
    maximized: Pane | null = null;
    hover: [number, number] | null = null;
    pinned = false;
    prefs: Prefs = sanitizePrefs(DEFAULT_PREFS);

    // ---- components
    readonly header = new Header(this);
    readonly toolbar = new Toolbar(this);
    readonly panes = new Panes(this);
    readonly inspector = new Inspector(this);
    readonly levelsPopover = new LevelsPopover(this);
    readonly thresholdPopover = new ThresholdPopover(this);
    readonly shortcuts = new ShortcutsDialog();

    private palette: Palette;
    private readonly cache = new Map<number, Promise<CaseView>>();
    /** The latest pick, which may still be loading; keyboard steps go from it. */
    private target = -1;
    private readonly inspectorSplitter = h("div", { className: "inspector-splitter", title: "Drag to resize" });
    private selectSeq = 0;
    private prefsTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(root: HTMLElement) {
        this.inspectorSplitter.addEventListener("mousedown", (ev) => this.dragInspector(ev));
        root.append(this.header.el, this.toolbar.el,
                    h("main", { className: "workspace" }, this.panes.el, this.inspectorSplitter, this.inspector.el));
        this.palette = readPalette();
        watchTheme(() => {
            this.palette = readPalette();
            this.draw();
        });
        this.applyPrefs();
        this.refreshAll();
        this.panes.setMessage({ icon: "loading codicon-modifier-spin", title: "Opening capture…" });
    }

    get entry(): EntryMeta | null {
        return this.entries[this.current] ?? null;
    }

    // ---- messages from the extension

    receive(m: AppMessage): void {
        switch (m.type) {
            case "cases": return this.setCases(m.root, m.entries, m.failOnly, m.index);
            case "prefs":
                this.prefs = sanitizePrefs(m.prefs);
                return this.applyPrefs();
            case "failOnly":
                this.failOnly = m.failOnly;
                return this.filterCases();
            case "select": return void this.select(m.index);
            case "command": return this.run(m.command);
        }
    }

    private run(c: Command): void {
        closePopover();
        switch (c.name) {
            case "fit": return this.fit();
            case "shortcuts": return this.shortcuts.toggle();
            case "resetLayout": return this.resetLayout();
            case "arrange": return this.arrange(c.arrangement);
            case "showPane": return this.showPane(c.pane, c.shown);
            case "showInspector": return this.showInspector(c.shown);
        }
    }

    // A reload renumbers the comparisons, so everything decoded is dropped; the extension says
    // which entry the previous selection now is.
    private setCases(root: string, entries: EntryMeta[], failOnly: boolean, index?: number): void {
        this.root = root;
        this.entries = entries;
        this.failOnly = failOnly;
        this.cache.clear();
        abandonRequests("the capture was reloaded");
        this.filterCases();
        if (!entries.length) {
            this.current = -1;
            this.view = null;
            this.refreshAll();
            this.panes.setMessage({
                icon: "beaker",
                title: "No test cases captured yet",
                detail: `Nothing under ${this.root}. Run the tests with TENSORSCOPE_CAPTURE_DIR pointing here; this tab updates as cases are written.`,
            });
            return;
        }
        void this.select(index ?? this.visible[0] ?? 0, true);
    }

    private filterCases(): void {
        this.visible = this.entries.map((_, i) => i).filter((i) => !this.failOnly || !this.entries[i].passed);
    }

    // ---- selecting a comparison

    private load(i: number): Promise<CaseView> {
        let p = this.cache.get(i);
        if (p) this.cache.delete(i);
        else p = requestArrays(i).then((a) => decode(this.entries[i], a, this.threshold));
        this.cache.set(i, p);
        p.catch(() => this.cache.get(i) === p && this.cache.delete(i));
        while (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
        return p;
    }

    async select(i: number, force = false): Promise<void> {
        if (!this.entries[i] || (i === this.current && !force)) return;
        // Stepping faster than cases load: only the latest pick may take over the panes.
        const seq = ++this.selectSeq;
        this.target = i;
        this.panes.setLoading(true);
        let v: CaseView;
        try {
            v = await this.load(i);
        } catch (err) {
            if (seq !== this.selectSeq) return;
            this.panes.setLoading(false);
            this.current = this.target = i;
            this.view = null;
            this.refreshAll();
            this.panes.setMessage({
                icon: "error",
                title: "This comparison could not be loaded",
                detail: (err as Error).message,
                action: { label: "Try Again", run: () => void this.select(i, true) },
            });
            return;
        }
        if (seq !== this.selectSeq) return;
        this.panes.setLoading(false);
        this.panes.setMessage(null);

        const sameSize = this.view?.width === v.width && this.view?.height === v.height;
        if (i !== this.current) this.levels = null;
        applyThreshold(v, this.threshold);  // it may have been decoded under an older threshold
        this.current = i;
        this.view = v;
        post({ type: "selected", index: i });
        // A pinned pixel carries over to compare it across cases, unless this one is too small.
        if (this.hover && (this.hover[0] >= v.height || this.hover[1] >= v.width)) {
            this.hover = null;
            this.pinned = false;
        }

        // Slice positions carry over to a comparison with the same leading axes.
        const leadDims = v.dims.slice(0, -2);
        if (this.lead.length !== leadDims.length) this.lead = leadDims.map(() => 0);
        this.lead = this.lead.map((x, k) => Math.min(x, leadDims[k] - 1));
        // A channel pick carries over when the comparison has it; otherwise its default.
        const channels = [...(v.rgb ? ["all"] : []), ...Array.from({ length: v.channels }, (_, c) => String(c))];
        if (!channels.includes(this.channel)) this.channel = channels[0];

        this.refreshAll();
        // Same-sized comparisons keep zoom and scroll, so a pinned pixel can be compared across cases.
        if (!sameSize) this.fit();
        this.draw();
        // Warm the neighbours, so stepping through the list rarely waits.
        const pos = this.visible.indexOf(i);
        for (const j of [this.visible[pos + 1], this.visible[pos - 1]]) if (j !== undefined) this.load(j).catch(() => {});
    }

    private refreshAll(): void {
        this.layoutInspector();
        this.header.update();
        this.toolbar.rebuild();
        this.inspector.updateDetails();
        this.inspector.updatePixel();
    }

    stepCase(dir: 1 | -1): void {
        const pos = this.visible.indexOf(this.target);
        const next = pos < 0 ? this.visible[0] : this.visible[clamp(pos + dir, 0, this.visible.length - 1)];
        if (next !== undefined) void this.select(next);
    }

    // ---- drawing

    private shownChannels(): number[] {
        return this.channel === "all" ? [0, 1, 2] : [Number(this.channel)];
    }

    draw(): void {
        const v = this.view;
        if (!v) return;
        const channels = this.shownChannels(), outside = this.prefs.outside;
        this.shownLevels = this.levels ?? v.typeRange ?? sliceLimits(v, this.lead, channels, outside !== "show");
        const painting = paint({ view: v, lead: this.lead, channels, levels: this.shownLevels, outside, palette: this.palette });
        this.panes.show(painting);
        this.panes.updateHeads(painting, this.shownLevels, !!this.levels);
        this.toolbar.update();
        if (this.levelsPopover.isOpen) this.levelsPopover.sync();
        if (this.hover) this.inspector.updatePixel();
    }

    setChannel(channel: string): void {
        this.channel = channel;
        this.draw();
    }

    setLead(k: number, position: number): void {
        const v = this.view;
        if (!v) return;
        this.lead[k] = clamp(position, 0, v.dims[k] - 1);
        this.draw();
    }

    /** Steps the innermost (or, with outer, the outermost) leading axis that has more than one position. */
    stepSlice(outer: boolean, dir: 1 | -1): void {
        const v = this.view;
        if (!v) return;
        const axes = v.dims.slice(0, -2).map((_, k) => k).filter((k) => v.dims[k] > 1);
        if (!axes.length) return;
        const k = outer ? axes[0] : axes[axes.length - 1];
        this.setLead(k, this.lead[k] + dir);
    }

    // ---- display range and threshold

    setLevels(levels: [number, number] | null): void {
        this.levels = levels;
        this.draw();
    }

    /** Sets one end of the manual levels, pushing the other so black stays below white. */
    setLevel(end: "lo" | "hi", x: number): void {
        const v = this.view;
        if (!v || !Number.isFinite(x)) return;
        const step = v.typeRange ? 1 : (v.domain[1] - v.domain[0]) / 1000, [lo, hi] = this.shownLevels;
        this.setLevels(end === "lo" ? [x, Math.max(hi, x + step)] : [Math.min(lo, x - step), x]);
    }

    setOutside(outside: Outside): void {
        this.prefs.outside = outside;
        this.savePrefs();
        this.draw();
    }

    setThreshold(t: number): void {
        const v = this.view;
        if (!v || v.verdict || !Number.isFinite(t)) return;
        this.threshold = Math.max(0, t);
        applyThreshold(v, this.threshold);
        this.header.update();
        this.draw();
        this.thresholdPopover.sync();
    }

    // ---- zoom and pan

    fit(): void {
        const v = this.view;
        if (!v) return;
        const s = this.panes.firstScroller();
        this.zoom = clamp(Math.floor(Math.min((s.clientWidth - 2) / v.width, (s.clientHeight - 2) / v.height)), ZOOM_MIN, ZOOM_MAX);
        this.panes.applyZoom();
        this.panes.scrollAll(0, 0);
        this.toolbar.update();
    }

    private static zoomStep(z: number, dir: number): number {
        return dir > 0 ? Math.max(z + 1, Math.round(z * 1.25)) : Math.min(z - 1, Math.round(z / 1.25));
    }

    /** Zooms one step, keeping the image point at (mx, my) of `scroller` in place. */
    zoomAt(scroller: HTMLElement, mx: number, my: number, dir: number): void {
        const next = clamp(App.zoomStep(this.zoom, dir), ZOOM_MIN, ZOOM_MAX), old = this.zoom;
        if (!this.view || next === old) return;
        const before = Panes.stageOffset(scroller);
        const ix = (scroller.scrollLeft + mx - before.left) / old, iy = (scroller.scrollTop + my - before.top) / old;
        this.zoom = next;
        this.panes.applyZoom();
        const after = Panes.stageOffset(scroller);
        this.panes.scrollAll(ix * next + after.left - mx, iy * next + after.top - my);
        this.toolbar.update();
    }

    zoomBy(dir: 1 | -1): void {
        const s = this.panes.firstScroller();
        this.zoomAt(s, s.clientWidth / 2, s.clientHeight / 2, dir);
    }

    private centerOn(y: number, x: number): void {
        const s = this.panes.firstScroller(), at = Panes.stageOffset(s);
        this.panes.scrollAll(at.left + (x + 0.5) * this.zoom - s.clientWidth / 2,
                             at.top + (y + 0.5) * this.zoom - s.clientHeight / 2);
    }

    // ---- inspecting pixels

    hoverPixel(y: number | null, x?: number): void {
        if (this.pinned) return;
        const v = this.view;
        this.hover = v && y !== null && x !== undefined && y >= 0 && x >= 0 && y < v.height && x < v.width ? [y, x] : null;
        this.panes.placeMarks();
        this.inspector.updatePixel();
    }

    /** A click pins the pixel under it, or unpins it if it was already pinned. */
    clickPixel(y: number, x: number): void {
        const same = this.pinned && this.hover?.[0] === y && this.hover?.[1] === x;
        this.pinned = false;
        if (!same) this.hoverPixel(y, x);
        this.setPinned(!same && !!this.hover);
    }

    setPinned(pinned: boolean): void {
        this.pinned = pinned;
        this.panes.placeMarks();
        this.inspector.updatePixel();
    }

    jumpToFailure(dir: 1 | -1): void {
        const v = this.view;
        if (!v) return;
        const from = this.hover ? { lead: this.lead, y: this.hover[0], x: this.hover[1] } : null;
        const at = findFailure(v, from, dir);
        if (!at) return toast(v.verdict ? "No failing elements in this comparison" : "No elements over the threshold", "pass");
        this.lead = at.lead;
        this.hover = [at.y, at.x];
        this.pinned = true;
        this.draw();
        this.centerOn(at.y, at.x);
        this.setPinned(true);
    }

    /** Escape backs out of one thing at a time, innermost first. */
    escape(): void {
        if (closePopover()) return;
        if (this.maximized) return this.toggleMaximized(this.maximized);
        if (this.pinned) return this.setPinned(false);
    }

    // ---- pane layout

    private applyPrefs(): void {
        this.layoutInspector();
        this.panes.layout();
        this.draw();
    }

    /** Sends the prefs to the extension once changes settle. */
    savePrefs(): void {
        clearTimeout(this.prefsTimer);
        this.prefsTimer = setTimeout(() => post({ type: "prefs", prefs: this.prefs }), 250);
    }

    private changeLayout(change: () => void): void {
        change();
        this.panes.layout();
        this.savePrefs();
    }

    arrange(arrangement: Arrangement): void {
        if (!ARRANGEMENTS.includes(arrangement)) return;
        this.maximized = null;
        this.changeLayout(() => (this.prefs.arrangement = arrangement));
    }

    showPane(pane: Pane, shown: boolean): void {
        const hidden = this.prefs.hidden;
        if (!shown && this.panes.shown().length === 1 && !hidden.includes(pane) && !this.maximized)
            return toast("At least one pane must stay visible", "warning");
        if (this.maximized === pane) this.maximized = null;
        this.changeLayout(() => (this.prefs.hidden = shown ? hidden.filter((p) => p !== pane) : [...new Set([...hidden, pane])]));
        if (!shown) toast(`${PANE_NAMES[pane]} pane hidden · restore it from Layout in the title bar`, "eye-closed");
    }

    swapPanes(a: Pane, b: Pane): void {
        const o = this.prefs.order, i = o.indexOf(a), j = o.indexOf(b);
        this.changeLayout(() => ([o[i], o[j]] = [o[j], o[i]]));
    }

    toggleMaximized(pane: Pane): void {
        this.maximized = this.maximized === pane ? null : pane;
        this.panes.layout();
    }

    resetLayout(): void {
        this.maximized = null;
        this.changeLayout(() => Object.assign(this.prefs, { order: [...PANES], hidden: [], arrangement: "grid", tracks: {}, inspectorShown: true }));
        this.layoutInspector();
        this.fit();
    }

    // The inspector shows only with a comparison to describe, and only if the user hasn't hidden it.
    private layoutInspector(): void {
        this.inspector.width = this.prefs.inspector;
        this.inspector.el.hidden = this.inspectorSplitter.hidden = !this.entry || !this.prefs.inspectorShown;
        this.toolbar.update();
    }

    showInspector(shown: boolean): void {
        this.prefs.inspectorShown = shown;
        this.layoutInspector();
        this.savePrefs();
    }

    toggleInspector(): void {
        this.showInspector(!this.prefs.inspectorShown);
    }

    private dragInspector(ev: MouseEvent): void {
        if (ev.button !== 0) return;
        ev.preventDefault();
        const w0 = this.inspector.el.getBoundingClientRect().width, x0 = ev.clientX;
        dragging("col-resize", (m) => {
            this.prefs.inspector = Math.round(clamp(w0 - (m.clientX - x0), 200, window.innerWidth * 0.6));
            this.inspector.width = this.prefs.inspector;
        }, () => this.savePrefs());
    }

    // ---- handed to the extension

    copyFilter(): void {
        post({ type: "copyFilter" });
    }

    focusCases(): void {
        post({ type: "focusCases" });
    }
}
