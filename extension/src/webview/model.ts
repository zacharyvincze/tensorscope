// A comparison decoded for display, and the computations on it. No DOM here, so it runs under test.

import type { Arrays, EntryMeta, ValueArray } from "../shared/protocol";

export type Values = Float32Array | Float64Array;

/** Values of a status array (spec/format.md). */
export const NOT_COMPARED = 0, PASS = 1, FAIL = 2;

/**
 * A comparison laid out as 2-D slices: the canonical arrays are channels-last, so element
 * (lead..., y, x, c) sits at offset(lead, y, x, c). Leading axes are stepped through one slice at
 * a time.
 */
export interface CaseView {
    readonly meta: EntryMeta;
    readonly shape: readonly number[];
    readonly dtypes: readonly [string, string];
    readonly channels: number;
    /** Exactly three channels, which can be shown together as RGB. */
    readonly rgb: boolean;
    /** Every axis but channels, padded to at least two: leading axes, then height and width. */
    readonly dims: readonly number[];
    /** Axis names for dims; "" for padding. */
    readonly labels: readonly string[];
    readonly height: number;
    readonly width: number;
    readonly ref: Values;
    readonly act: Values;
    /** actual - reference, NaN where not compared. */
    readonly diff: Float32Array;
    /** The test's verdicts; without one, the viewer's threshold marks (see applyThreshold). */
    readonly status: Uint8Array;
    /** Whether status holds the test's verdict. */
    readonly verdict: boolean;
    /** The full range of an 8-bit element type, shown as is; null for other types. */
    readonly typeRange: readonly [number, number] | null;
    /** The range manual display levels can span. */
    readonly domain: readonly [number, number];
    /** Largest and smallest nonzero |diff|. */
    readonly peak: number;
    readonly floor: number;
    /** For views without a verdict: the threshold status was computed for, and how many are over. */
    threshold: number;
    over: number;
}

const TYPE_RANGES: Record<string, [number, number]> = { uint8: [0, 255], int8: [-128, 127] };

const values = ([type, buffer]: ValueArray): Values =>
    type === "f8" ? new Float64Array(buffer) : new Float32Array(buffer);

export function decode(meta: EntryMeta, arrays: Arrays, threshold: number): CaseView {
    const ref = values(arrays.ref), act = values(arrays.act), n = ref.length;
    const hasChannels = meta.axes[meta.axes.length - 1] === "c";
    const channels = hasChannels ? arrays.shape[arrays.shape.length - 1] : 1;
    const dims = hasChannels ? arrays.shape.slice(0, -1) : arrays.shape.slice();
    const labels = hasChannels ? meta.axes.slice(0, -1) : meta.axes.slice();
    while (dims.length < 2) {
        dims.unshift(1);
        labels.unshift("");
    }

    const status = arrays.status ? new Uint8Array(arrays.status) : new Uint8Array(n);
    let diff: Float32Array;
    if (arrays.diff) diff = new Float32Array(arrays.diff);
    else {
        diff = new Float32Array(n);
        for (let o = 0; o < n; ++o) diff[o] = arrays.status && status[o] === NOT_COMPARED ? NaN : act[o] - ref[o];
    }

    const typeRange = TYPE_RANGES[arrays.dtypes[1]] ?? null;
    let domain: [number, number];
    if (typeRange) domain = typeRange;
    else {
        let lo = Infinity, hi = -Infinity;
        for (const a of [ref, act]) for (const x of a) if (Number.isFinite(x)) { if (x < lo) lo = x; if (x > hi) hi = x; }
        domain = lo === Infinity ? [0, 1] : hi > lo ? [lo, hi] : [lo - 0.5, hi + 0.5];
    }
    let peak = 0, floor = Infinity;
    for (const d of diff) {
        const m = Math.abs(d);
        if (m > peak) peak = m;
        if (m > 0 && m < floor) floor = m;
    }

    const view: CaseView = {
        meta, shape: arrays.shape, dtypes: arrays.dtypes, channels, rgb: channels === 3, dims, labels,
        height: dims[dims.length - 2], width: dims[dims.length - 1], ref, act, diff, status,
        verdict: arrays.status !== null, typeRange, domain, peak, floor, threshold: NaN, over: 0,
    };
    if (!view.verdict) applyThreshold(view, threshold);
    return view;
}

/**
 * For views without a verdict: marks FAIL where |diff| exceeds the threshold and PASS elsewhere.
 * Equal values pass even when diff is NaN (matching infinities, or NaN expected and produced).
 */
export function applyThreshold(v: CaseView, threshold: number): void {
    if (v.verdict || v.threshold === threshold) return;
    let over = 0;
    for (let o = 0; o < v.status.length; ++o) {
        const r = v.ref[o], a = v.act[o];
        const bad = !(Math.abs(v.diff[o]) <= threshold) && r !== a && !(Number.isNaN(r) && Number.isNaN(a));
        v.status[o] = bad ? FAIL : PASS;
        if (bad) ++over;
    }
    v.threshold = threshold;
    v.over = over;
}

/** Elements the test (or, without a verdict, the threshold) failed. */
export const failingCount = (v: CaseView): number => (v.verdict ? v.meta.failed ?? 0 : v.over);

/** Flat index of element (y, x, channel c) at leading-axis position `lead`. */
export function offset(v: CaseView, lead: readonly number[], y: number, x: number, c: number): number {
    let idx = 0;
    for (let k = 0; k < lead.length; ++k) idx = idx * v.dims[k] + lead[k];
    idx = (idx * v.height + y) * v.width + x;
    return idx * v.channels + c;
}

/**
 * Min and max of reference and actual over one slice and the given channels; with comparedOnly,
 * over compared elements only, falling back to every element when none were compared.
 */
export function sliceLimits(v: CaseView, lead: readonly number[], channels: readonly number[],
                            comparedOnly: boolean): [number, number] {
    let lo = Infinity, hi = -Infinity;
    for (let y = 0; y < v.height; ++y)
        for (let x = 0; x < v.width; ++x)
            for (const c of channels) {
                const o = offset(v, lead, y, x, c);
                if (comparedOnly && v.status[o] === NOT_COMPARED) continue;
                for (const a of [v.ref[o], v.act[o]]) if (Number.isFinite(a)) { if (a < lo) lo = a; if (a > hi) hi = a; }
            }
    if (lo === Infinity) return comparedOnly ? sliceLimits(v, lead, channels, false) : [0, 1];
    return hi > lo ? [lo, hi] : [lo - 0.5, hi + 0.5];
}

export interface Position {
    lead: number[];
    y: number;
    x: number;
}

/**
 * The next (dir 1) or previous (dir -1) pixel with a failing channel after `from`, in raster
 * order over every slice, wrapping around. Starts from the beginning (or end) without `from`.
 */
export function findFailure(v: CaseView, from: Position | null, dir: 1 | -1): Position | null {
    const plane = v.height * v.width, total = v.status.length / v.channels;
    const here = from ? offset(v, from.lead, from.y, from.x, 0) / v.channels : dir > 0 ? -1 : total;
    for (let s = 1; s <= total; ++s) {
        const p = (((here + dir * s) % total) + total) % total;
        let bad = false;
        for (let c = 0; c < v.channels && !bad; ++c) bad = v.status[p * v.channels + c] === FAIL;
        if (!bad) continue;
        const lead: number[] = [];
        let r = Math.floor(p / plane);
        for (let k = v.dims.length - 3; k >= 0; --k) {
            lead.unshift(r % v.dims[k]);
            r = Math.floor(r / v.dims[k]);
        }
        return { lead, y: Math.floor((p % plane) / v.width), x: p % v.width };
    }
    return null;
}

// The threshold slider: position 0 is exact equality; the rest spans [floor, peak] on a log scale.
export const THRESHOLD_STEPS = 1000;

export function thresholdAt(v: CaseView, pos: number): number {
    if (pos <= 0 || !(v.peak > 0)) return 0;
    return v.floor * (v.peak / v.floor) ** ((pos - 1) / (THRESHOLD_STEPS - 1));
}

export function thresholdPos(v: CaseView, t: number): number {
    if (!(t > 0) || !(v.peak > 0)) return 0;
    if (v.peak === v.floor) return t >= v.peak ? THRESHOLD_STEPS : 1;
    const pos = Math.round(1 + ((THRESHOLD_STEPS - 1) * Math.log(t / v.floor)) / Math.log(v.peak / v.floor));
    return Math.max(1, Math.min(THRESHOLD_STEPS, pos));
}
