// How numbers read on screen.

/** Up to six significant digits; exponent form for very large or small magnitudes. */
export function fmt(x: number): string {
    if (Number.isNaN(x)) return "—";
    if (!Number.isFinite(x)) return x > 0 ? "∞" : "−∞";
    if (Number.isInteger(x)) return String(x);
    return Math.abs(x) >= 1e5 || Math.abs(x) < 1e-3 ? x.toExponential(4) : x.toPrecision(6).replace(/\.?0+$/, "");
}

/** Three significant digits, for the narrow pane headers. */
export function fmtShort(x: number): string {
    if (Number.isNaN(x) || !Number.isFinite(x) || Number.isInteger(x)) return fmt(x);
    return Math.abs(x) >= 1e5 || Math.abs(x) < 1e-3 ? x.toExponential(2) : String(+x.toPrecision(3));
}

/** A count with thousands separators. */
export const fmtCount = (n: number): string => n.toLocaleString("en-US");

/** part / whole as a percentage, with more digits when it is close to 0 or 100. */
export function fmtPercent(part: number, whole: number): string {
    if (!whole) return "0%";
    const p = (100 * part) / whole;
    if (p === 0 || p === 100) return `${p}%`;
    return `${p < 0.1 || p > 99.9 ? p.toPrecision(2) : p.toFixed(1)}%`;
}

export const fmtShape = (shape: readonly number[]): string => (shape.length ? shape.join(" × ") : "scalar");
