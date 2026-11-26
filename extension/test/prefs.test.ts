import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_PREFS, sanitizePrefs } from "../src/shared/protocol";

describe("sanitizePrefs", () => {
    it("falls back to the defaults for missing or foreign data", () => {
        for (const stored of [undefined, null, 42, "x", {}]) assert.deepEqual(sanitizePrefs(stored), DEFAULT_PREFS);
    });

    it("keeps valid settings", () => {
        const prefs = {
            order: ["status", "diff", "act", "ref"], hidden: ["diff"], arrangement: "row",
            tracks: { "row:3x1": { cols: [1, 2, 1], rows: [1] } }, inspector: 400, inspectorShown: false, outside: "hide",
        };
        assert.deepEqual(sanitizePrefs(prefs), prefs);
    });

    it("repairs each invalid field on its own", () => {
        const p = sanitizePrefs({
            order: ["ref", "ref", "act", "diff"], hidden: ["ref", "act", "diff", "status"], arrangement: "spiral",
            tracks: { a: { cols: [0], rows: [1] }, b: { cols: [1], rows: [2] } }, inspector: 10, outside: "dim",
        });
        assert.deepEqual(p.order, DEFAULT_PREFS.order);
        assert.deepEqual(p.hidden, [], "hiding every pane is not allowed");
        assert.equal(p.arrangement, "grid");
        assert.deepEqual(p.tracks, { b: { cols: [1], rows: [2] } });
        assert.equal(p.inspector, DEFAULT_PREFS.inspector);
    });
});
