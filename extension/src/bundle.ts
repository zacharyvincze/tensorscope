// Reads capture bundles (spec/format.md) and builds the page payload. The payload must match what
// viewer/src/tensorscope_viewer/html_export.py embeds, since both feed the same html_viewer.html.

import * as fs from "fs/promises";
import * as path from "path";
import { gzipSync } from "zlib";

export const FORMAT = "tensorscope";
export const VERSION = 1;

interface ComparisonEntry {
    kind: string;
    axes: string[];
    compared: number;
    failed: number;
    arrays: Record<"reference" | "actual" | "diff" | "status", string>;
}

export interface Case {
    dir: string;
    name: string;
    passed: boolean;
    failure: string;
    comparisons: ComparisonEntry[];
}

interface Npy {
    descr: string;
    shape: number[];
    data: Buffer;
}

// NumPy dtype names, as html_export.py reports them via str(dtype).
const DTYPE_NAMES: Record<string, string> = {
    b1: "bool", u1: "uint8", i1: "int8", u2: "uint16", i2: "int16", u4: "uint32", i4: "int32",
    u8: "uint64", i8: "int64", f2: "float16", f4: "float32", f8: "float64",
};
// Converted to float32 only where that is exact; everything else goes as float64.
const EXACT_IN_F32 = new Set(["u1", "i1", "u2", "i2", "f2", "f4"]);

export async function readCase(manifest: string): Promise<Case> {
    const data = JSON.parse(await fs.readFile(manifest, "utf8"));
    if (data.format !== FORMAT) throw new Error(`${manifest}: not a ${FORMAT} manifest`);
    if (!Number.isInteger(data.version) || data.version > VERSION)
        throw new Error(`${manifest}: ${FORMAT} version newer than v${VERSION}, update the extension`);
    return {
        dir: path.dirname(manifest),
        name: data.case,
        passed: data.passed,
        failure: data.failure,
        comparisons: data.comparisons,
    };
}

async function findManifests(dir: string, out: string[]): Promise<void> {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) await findManifests(p, out);
        else if (ent.isFile() && ent.name === "manifest.json") out.push(p);
    }
}

// Every bundle under root (or root itself if it is a manifest), sorted by case name.
export async function findCases(root: string): Promise<Case[]> {
    const manifests: string[] = [];
    if ((await fs.stat(root)).isFile()) manifests.push(root);
    else await findManifests(root, manifests);
    const cases = await Promise.all(manifests.map(readCase));
    return cases.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function parseNpy(buf: Buffer, file = "array"): Npy {
    if (buf.subarray(0, 6).toString("latin1") !== "\x93NUMPY") throw new Error(`${file}: not NPY`);
    const major = buf[6];
    const headerLen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8);
    const start = major === 1 ? 10 : 12;
    const header = buf.subarray(start, start + headerLen).toString("latin1");
    const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
    const fortran = /'fortran_order':\s*(True|False)/.exec(header)?.[1];
    const shape = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1];
    if (!descr || !fortran || shape === undefined) throw new Error(`${file}: bad NPY header`);
    if (fortran === "True") throw new Error(`${file}: Fortran-order arrays are not supported`);
    if (descr[0] === ">") throw new Error(`${file}: big-endian arrays are not supported`);
    return {
        descr: descr.slice(1),
        shape: shape.split(",").map((s) => s.trim()).filter(Boolean).map(Number),
        data: buf.subarray(start + headerLen),
    };
}

function halfToFloat(h: number): number {
    const sign = h & 0x8000 ? -1 : 1, exp = (h >> 10) & 0x1f, frac = h & 0x3ff;
    if (exp === 0) return sign * frac * 2 ** -24;
    if (exp === 31) return frac ? NaN : sign * Infinity;
    return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

// Raw elements as a numeric sequence. Copies first: Buffers can be unaligned for typed views.
function elements(a: Npy): ArrayLike<number> {
    const b = a.data.buffer.slice(a.data.byteOffset, a.data.byteOffset + a.data.byteLength);
    switch (a.descr) {
        case "b1": case "u1": return new Uint8Array(b);
        case "i1": return new Int8Array(b);
        case "u2": return new Uint16Array(b);
        case "i2": return new Int16Array(b);
        case "u4": return new Uint32Array(b);
        case "i4": return new Int32Array(b);
        case "f4": return new Float32Array(b);
        case "f8": return new Float64Array(b);
        case "u8": return Float64Array.from(new BigUint64Array(b), Number);
        case "i8": return Float64Array.from(new BigInt64Array(b), Number);
        case "f2": return Float32Array.from(new Uint16Array(b), halfToFloat);
        default: throw new Error(`unsupported dtype ${a.descr}`);
    }
}

// gzip + base64; the page inflates it with DecompressionStream when the case is opened.
function pack(bytes: ArrayBufferView): string {
    const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return gzipSync(view, { level: 6 }).toString("base64");
}

function values(a: Npy): [string, string] {
    const f4 = EXACT_IN_F32.has(a.descr);
    const src = elements(a);
    return [f4 ? "f4" : "f8", pack(f4 ? Float32Array.from(src) : Float64Array.from(src))];
}

async function load(c: Case, file: string): Promise<Npy> {
    const p = path.join(c.dir, file);
    return parseNpy(await fs.readFile(p), p);
}

async function payload(c: Case, index: number): Promise<object> {
    const e = c.comparisons[index];
    const [ref, act, diff, status] = await Promise.all(
        (["reference", "actual", "diff", "status"] as const).map((r) => load(c, e.arrays[r])));
    return {
        case: c.name,
        index,
        count: c.comparisons.length,
        passed: c.passed,
        failure: c.failure,
        kind: e.kind,
        axes: e.axes,
        shape: ref.shape,
        dtypes: [DTYPE_NAMES[ref.descr] ?? ref.descr, DTYPE_NAMES[act.descr] ?? act.descr],
        compared: e.compared,
        failed: e.failed,
        ref: values(ref),
        act: values(act),
        diff: pack(Float32Array.from(elements(diff))),
        status: pack(Uint8Array.from(elements(status))),
    };
}

// The JSON the page reads from its data script, with "</" escaped so it can't close the tag.
export async function pageData(cases: Case[]): Promise<string> {
    const entries: object[] = [];
    for (const c of cases)
        for (let k = 0; k < c.comparisons.length; ++k) entries.push(await payload(c, k));
    return JSON.stringify(entries).replace(/<\//g, "<\\/");
}
