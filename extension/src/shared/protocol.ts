// Everything the extension and its webview exchange. Both sides import these types, so a message
// one side sends and the other doesn't understand is a compile error rather than a silent no-op.

/** One comparison of one case, as the page lists it. Read from the manifest alone. */
export interface EntryMeta {
    case: string;
    /** Position of this comparison within its case. */
    index: number;
    /** Number of comparisons in the case. */
    count: number;
    label?: string;
    passed: boolean;
    failure: string;
    kind: string;
    axes: string[];
    /** Present, like `failed`, exactly when the bundle has per-element verdicts. */
    compared?: number;
    failed?: number;
}

/** How element values cross to the page: float32 where that is exact, float64 otherwise. */
export type ValueArray = ["f4" | "f8", ArrayBuffer];

/** A comparison's arrays, sent when the page first shows it. */
export interface Arrays {
    shape: number[];
    /** NumPy dtype names of reference and actual. */
    dtypes: [string, string];
    ref: ValueArray;
    act: ValueArray;
    /** float32 actual - reference; null when the bundle has none and the page derives it. */
    diff: ArrayBuffer | null;
    /** uint8 verdicts; null when the bundle has none. */
    status: ArrayBuffer | null;
}

export const PANES = ["ref", "act", "diff", "status"] as const;
export type Pane = (typeof PANES)[number];

export const PANE_NAMES: Record<Pane, string> = { ref: "Reference", act: "Actual", diff: "Difference", status: "Status" };

export const ARRANGEMENTS = ["grid", "row", "column"] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];

/** How reference and actual draw elements the comparator did not check. */
export const OUTSIDE_MODES = ["dim", "hide", "show"] as const;
export type Outside = (typeof OUTSIDE_MODES)[number];

/** Track sizes of the pane grid, as fractions. */
export interface Tracks {
    cols: number[];
    rows: number[];
}

/** The page's view settings. The extension stores them, so every capture opens the same way. */
export interface Prefs {
    order: Pane[];
    hidden: Pane[];
    arrangement: Arrangement;
    /** Track sizes per arrangement and grid shape, e.g. "grid:2x2". */
    tracks: Record<string, Tracks>;
    /** Width of the inspector panel in px. */
    inspector: number;
    outside: Outside;
}

/** Actions the extension's commands ask the page to perform. */
export type Command =
    | { name: "fit" }
    | { name: "shortcuts" }
    | { name: "resetLayout" }
    | { name: "arrange"; arrangement: Arrangement }
    | { name: "showPane"; pane: Pane; shown: boolean };

/** Extension -> page. */
export type HostMessage =
    /** The capture's comparisons; sent on "ready" and again whenever the capture reloads. */
    | { type: "cases"; root: string; entries: EntryMeta[]; failOnly: boolean; index?: number }
    /** Sent on "ready", and when another panel changes them. */
    | { type: "prefs"; prefs: Prefs }
    | { type: "failOnly"; failOnly: boolean }
    | { type: "select"; index: number }
    | { type: "command"; command: Command }
    | ({ type: "arrays"; id: number } & Arrays)
    | { type: "arraysFailed"; id: number; error: string };

/** Page -> extension. */
export type PageMessage =
    | { type: "ready" }
    | { type: "selected"; index: number }
    | { type: "load"; id: number; index: number }
    | { type: "prefs"; prefs: Prefs }
    | { type: "focusCases" }
    | { type: "copyFilter" }
    | { type: "openLayout" };

export const DEFAULT_PREFS: Prefs = {
    order: [...PANES],
    hidden: [],
    arrangement: "grid",
    tracks: {},
    inspector: 320,
    outside: "dim",
};

const isPane = (x: unknown): x is Pane => PANES.includes(x as Pane);
const isNumbers = (x: unknown): x is number[] =>
    Array.isArray(x) && x.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0);

/** Prefs from storage, which may hold an older version's: anything unusable falls back to the default. */
export function sanitizePrefs(stored: unknown): Prefs {
    const p = (typeof stored === "object" && stored !== null ? stored : {}) as Partial<Record<keyof Prefs, unknown>>;
    const storedOrder: unknown[] = Array.isArray(p.order) ? p.order : [];
    const order = storedOrder.length === PANES.length && PANES.every((k) => storedOrder.includes(k))
        ? (storedOrder as Pane[]) : [...PANES];
    const hidden = Array.isArray(p.hidden) ? [...new Set(p.hidden.filter(isPane))] : [];
    const tracks: Record<string, Tracks> = {};
    if (typeof p.tracks === "object" && p.tracks !== null)
        for (const [key, t] of Object.entries(p.tracks as Record<string, Partial<Tracks>>))
            if (isNumbers(t?.cols) && isNumbers(t?.rows)) tracks[key] = { cols: t.cols, rows: t.rows };
    return {
        order,
        hidden: hidden.length === PANES.length ? [] : hidden,
        arrangement: ARRANGEMENTS.includes(p.arrangement as Arrangement) ? (p.arrangement as Arrangement) : "grid",
        tracks,
        inspector: typeof p.inspector === "number" && p.inspector >= 160 ? p.inspector : DEFAULT_PREFS.inspector,
        outside: OUTSIDE_MODES.includes(p.outside as Outside) ? (p.outside as Outside) : "dim",
    };
}
