// Paints one slice of a comparison into the four panes' pixels.

import type { Outside, Pane } from "../shared/protocol";
import { CaseView, FAIL, NOT_COMPARED, offset } from "./model";
import { Palette, RGB, inferno } from "./theme";

export interface PaintRequest {
    view: CaseView;
    lead: readonly number[];
    /** One channel shown in grey, or three shown as RGB. */
    channels: readonly number[];
    /** Display levels: the values drawn black and white. */
    levels: readonly [number, number];
    outside: Outside;
    palette: Palette;
}

export interface Painting {
    images: Record<Pane, ImageData>;
    /** Pixels in this slice with any compared, and any failing, channel. */
    compared: number;
    failing: number;
}

export function paint({ view: v, lead, channels, levels, outside, palette }: PaintRequest): Painting {
    const { width: W, height: H } = v, rgb = channels.length === 3;
    const images: Record<Pane, ImageData> = {
        ref: new ImageData(W, H), act: new ImageData(W, H), diff: new ImageData(W, H), status: new ImageData(W, H),
    };
    const [lo, hi] = levels, scale = 255 / (hi - lo);
    const statusColors: readonly RGB[] = v.verdict
        ? [palette.notCompared, palette.pass, palette.fail]
        : [palette.background, palette.within, palette.over];
    const bg = palette.background;
    const ref = images.ref.data, act = images.act.data, diff = images.diff.data, status = images.status.data;
    let compared = 0, failing = 0;

    for (let y = 0; y < H; ++y)
        for (let x = 0; x < W; ++x) {
            const p = (y * W + x) * 4;
            let dmax = 0, smax = NOT_COMPARED;
            for (let j = 0; j < channels.length; ++j) {
                const o = offset(v, lead, y, x, channels[j]);
                const r = (v.ref[o] - lo) * scale, a = (v.act[o] - lo) * scale;
                if (rgb) {
                    ref[p + j] = r;
                    act[p + j] = a;
                } else {
                    ref[p] = ref[p + 1] = ref[p + 2] = r;
                    act[p] = act[p + 1] = act[p + 2] = a;
                }
                const d = Math.abs(v.diff[o]);
                if (d > dmax) dmax = d;
                if (v.status[o] > smax) smax = v.status[o];
            }
            if (smax !== NOT_COMPARED) ++compared;
            if (smax === FAIL) ++failing;
            // Elements the comparator skipped hold the test's own fill, which may be anything.
            if (smax === NOT_COMPARED && outside !== "show")
                for (const im of [ref, act])
                    for (let q = 0; q < 3; ++q) im[p + q] = outside === "dim" ? im[p + q] * 0.25 + bg[q] * 0.75 : bg[q];
            const dc = smax !== NOT_COMPARED ? inferno(v.peak ? dmax / v.peak : 0) : bg, sc = statusColors[smax];
            for (let q = 0; q < 3; ++q) {
                diff[p + q] = dc[q];
                status[p + q] = sc[q];
            }
            ref[p + 3] = act[p + 3] = diff[p + 3] = status[p + 3] = 255;
        }
    return { images, compared, failing };
}
