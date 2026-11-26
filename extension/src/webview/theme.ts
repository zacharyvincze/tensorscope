// Canvas colours. The panes are drawn pixel by pixel, so the theme's CSS colours are read into RGB.

export type RGB = readonly [number, number, number];

export interface Palette {
    /** The pane background, which elements outside the comparison fade into. */
    background: RGB;
    notCompared: RGB;
    pass: RGB;
    fail: RGB;
    /** Without a verdict, the status pane shows a viewer-side threshold in colours of its own. */
    within: RGB;
    over: RGB;
}

// Normalizes any CSS colour through a canvas, which reports "#rrggbb" or "rgba(r, g, b, a)".
const probe = document.createElement("canvas").getContext("2d")!;
function cssColor(name: string): RGB {
    probe.fillStyle = "#000";
    probe.fillStyle = getComputedStyle(document.body).getPropertyValue(name).trim() || "#000";
    const c = probe.fillStyle;
    if (c.startsWith("#")) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as unknown as RGB;
    const m = c.match(/[\d.]+/g);
    return m ? (m.slice(0, 3).map(Number) as unknown as RGB) : [0, 0, 0];
}

export function readPalette(): Palette {
    return {
        background: cssColor("--ts-canvas"),
        notCompared: cssColor("--ts-not-compared"),
        pass: cssColor("--ts-pass"),
        fail: cssColor("--ts-fail"),
        within: cssColor("--ts-within"),
        over: cssColor("--ts-over"),
    };
}

/** Calls back when VS Code switches theme: it rewrites the variables on <html> and the class on <body>. */
export function watchTheme(onChange: () => void): void {
    const watch = new MutationObserver(onChange);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    watch.observe(document.body, { attributes: true, attributeFilter: ["class"] });
}

// Inferno, sampled at nine points: perceptually uniform, and readable on dark and light themes.
const INFERNO: RGB[] = [[0, 0, 4], [31, 12, 72], [85, 15, 109], [136, 34, 106], [186, 54, 85],
                        [227, 89, 51], [249, 140, 10], [249, 201, 50], [252, 255, 164]];

/** The colour map at t in [0, 1]. */
export function inferno(t: number): RGB {
    const s = Math.max(0, Math.min(1, t)) * (INFERNO.length - 1);
    const i = Math.min(Math.floor(s), INFERNO.length - 2), f = s - i, a = INFERNO[i], b = INFERNO[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const INFERNO_GRADIENT = `linear-gradient(to right, ${INFERNO.map((c) => `rgb(${c.join(",")})`).join(", ")})`;
