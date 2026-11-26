import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Arrays, EntryMeta } from "../src/shared/protocol";
import {
    applyThreshold, decode, FAIL, findFailure, NOT_COMPARED, offset, PASS, sliceLimits, thresholdAt, thresholdPos,
} from "../src/webview/model";

const meta = (axes: string[], verdict = true): EntryMeta => ({
    case: "S/F.T/0", index: 0, count: 1, passed: false, failure: "", kind: "nd", axes,
    ...(verdict ? { compared: 0, failed: 0 } : {}),
});

function arrays(shape: number[], ref: number[], act: number[], status?: number[]): Arrays {
    return {
        shape, dtypes: ["float32", "float32"],
        ref: ["f4", new Float32Array(ref).buffer], act: ["f4", new Float32Array(act).buffer],
        diff: null, status: status ? new Uint8Array(status).buffer : null,
    };
}

describe("decode", () => {
    it("lays out channels-last images as slices", () => {
        // n=2, h=1, w=2, c=3
        const n = 12, v = decode(meta(["n", "h", "w", "c"]), arrays([2, 1, 2, 3], Array(n).fill(0), Array(n).fill(0), Array(n).fill(1)), 0);
        assert.equal(v.channels, 3);
        assert.equal(v.rgb, true);
        assert.deepEqual(v.dims, [2, 1, 2]);
        assert.equal(v.height, 1);
        assert.equal(v.width, 2);
        assert.equal(offset(v, [1], 0, 1, 2), 11);
    });

    it("pads 1-D and scalar shapes to two dimensions", () => {
        const line = decode(meta(["i"]), arrays([3], [1, 2, 3], [1, 2, 3]), 0);
        assert.deepEqual(line.dims, [1, 3]);
        assert.deepEqual(line.labels, ["", "i"]);
        const scalar = decode(meta([]), arrays([], [5], [5]), 0);
        assert.deepEqual(scalar.dims, [1, 1]);
    });

    it("derives diff, NaN where not compared", () => {
        const v = decode(meta(["i"]), arrays([3], [1, 2, 3], [1.5, 2, 5], [1, 0, 2]), 0);
        assert.equal(v.diff[0], 0.5);
        assert.ok(Number.isNaN(v.diff[1]));
        assert.equal(v.diff[2], 2);
        assert.equal(v.peak, 2);
        assert.equal(v.floor, 0.5);
        assert.equal(v.verdict, true);
    });

    it("uses the full range of 8-bit types", () => {
        const a = arrays([2], [0, 1], [0, 1]);
        a.dtypes = ["uint8", "uint8"];
        assert.deepEqual(decode(meta(["i"]), a, 0).typeRange, [0, 255]);
    });
});

describe("applyThreshold", () => {
    it("marks elements over the threshold when the bundle has no verdict", () => {
        const v = decode(meta(["i"], false), arrays([4], [0, 0, 0, NaN], [0, 0.1, 1, NaN]), 0);
        assert.equal(v.verdict, false);
        assert.deepEqual([...v.status], [PASS, FAIL, FAIL, PASS]);  // NaN expected and produced passes
        assert.equal(v.over, 2);
        applyThreshold(v, 0.5);
        assert.deepEqual([...v.status], [PASS, PASS, FAIL, PASS]);
        assert.equal(v.over, 1);
    });

    it("leaves the test's verdict alone", () => {
        const v = decode(meta(["i"]), arrays([2], [0, 0], [0, 9], [NOT_COMPARED, PASS]), 0);
        applyThreshold(v, 100);
        assert.deepEqual([...v.status], [NOT_COMPARED, PASS]);
    });
});

describe("sliceLimits", () => {
    it("spans compared elements, falling back to all", () => {
        const v = decode(meta(["h", "w"]), arrays([1, 3], [0, 5, 10], [1, 6, 99], [1, 1, 0]), 0);
        assert.deepEqual(sliceLimits(v, [], [0], true), [0, 6]);
        assert.deepEqual(sliceLimits(v, [], [0], false), [0, 99]);
        const none = decode(meta(["h", "w"]), arrays([1, 2], [2, 4], [2, 4], [0, 0]), 0);
        assert.deepEqual(sliceLimits(none, [], [0], true), [2, 4]);
    });
});

describe("findFailure", () => {
    // n=2, h=2, w=2: failures at (n0, y1, x0) and (n1, y0, x1).
    const status = [1, 1, 2, 1, 1, 2, 1, 1];
    const v = decode(meta(["n", "h", "w"]), arrays([2, 2, 2], Array(8).fill(0), Array(8).fill(0), status), 0);

    it("finds the first failure, crossing slices and wrapping", () => {
        assert.deepEqual(findFailure(v, null, 1), { lead: [0], y: 1, x: 0 });
        assert.deepEqual(findFailure(v, { lead: [0], y: 1, x: 0 }, 1), { lead: [1], y: 0, x: 1 });
        assert.deepEqual(findFailure(v, { lead: [1], y: 0, x: 1 }, 1), { lead: [0], y: 1, x: 0 });
        assert.deepEqual(findFailure(v, null, -1), { lead: [1], y: 0, x: 1 });
    });

    it("returns null when nothing fails", () => {
        const ok = decode(meta(["i"]), arrays([2], [0, 0], [0, 0], [1, 1]), 0);
        assert.equal(findFailure(ok, null, 1), null);
    });
});

describe("threshold slider", () => {
    const v = decode(meta(["i"], false), arrays([3], [0, 0, 0], [0.001, 0.1, 10]), 0);

    it("maps position 0 to exact equality and the ends to floor and peak", () => {
        assert.equal(thresholdAt(v, 0), 0);
        assert.equal(thresholdAt(v, 1), v.floor);
        assert.ok(Math.abs(thresholdAt(v, 1000) - v.peak) < 1e-9 * v.peak);
    });

    it("round-trips positions", () => {
        for (const pos of [0, 1, 250, 999, 1000]) assert.equal(thresholdPos(v, thresholdAt(v, pos)), pos);
    });
});
