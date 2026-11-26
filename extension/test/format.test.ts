import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fmt, fmtCount, fmtPercent, fmtShape, fmtShort } from "../src/webview/format";

describe("format", () => {
    it("writes values compactly", () => {
        assert.equal(fmt(3), "3");
        assert.equal(fmt(0.5), "0.5");
        assert.equal(fmt(1 / 3), "0.333333");
        assert.equal(fmt(1e-7), "1.0000e-7");
        assert.equal(fmt(NaN), "—");
        assert.equal(fmt(-Infinity), "−∞");
        assert.equal(fmtShort(0.123456), "0.123");
        assert.equal(fmtShort(123456.7), "1.23e+5");
    });

    it("writes counts, percentages, and shapes", () => {
        assert.equal(fmtCount(1234567), "1,234,567");
        assert.equal(fmtPercent(1, 3), "33.3%");
        assert.equal(fmtPercent(1, 10000), "0.010%");
        assert.equal(fmtPercent(0, 5), "0%");
        assert.equal(fmtPercent(0, 0), "0%");
        assert.equal(fmtShape([1, 16, 24, 3]), "1 × 16 × 24 × 3");
        assert.equal(fmtShape([]), "scalar");
    });
});
