// Reads capture bundles (spec/format.md) for the webview. The page gets entryMeta() for every
// comparison up front and entryArrays() for one only when it shows it.

import * as fs from "fs/promises";
import * as path from "path";

import { Arrays, EntryMeta, ValueArray } from "../shared/protocol";

const FORMAT = "tensorscope";
const VERSION = 1;

interface ComparisonEntry {
    kind: string;
    label?: string;  // optional name for the comparison within its case
    axes: string[];
    compared?: number;  // present, like failed, exactly when status is
    failed?: number;
    arrays: { reference: string; actual: string; diff?: string; status?: string };
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

// NumPy dtype names, as str(dtype) gives them.
const DTYPE_NAMES: Record<string, string> = {
    b1: "bool", u1: "uint8", i1: "int8", u2: "uint16", i2: "int16", u4: "uint32", i4: "int32",
    u8: "uint64", i8: "int64", f2: "float16", f4: "float32", f8: "float64",
};
// Converted to float32 only where that is exact; everything else goes as float64.
const EXACT_IN_F32 = new Set(["u1", "i1", "u2", "i2", "f2", "f4"]);

async function readCase(manifest: string): Promise<Case> {
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

// Maps fn over items with at most `limit` calls in flight. Unbounded, a large capture opens enough
// files at once to hit the descriptor limit; one at a time is slow on network filesystems.
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

const IO_LIMIT = 32;

// Breadth-first, one level's directories read in parallel.
async function findManifests(root: string): Promise<string[]> {
    const manifests: string[] = [];
    for (let level = [root]; level.length;) {
        const listed = await mapLimit(level, IO_LIMIT, async (dir) =>
            (await fs.readdir(dir, { withFileTypes: true })).map((ent) => ({ dir, ent })));
        level = [];
        for (const { dir, ent } of listed.flat()) {
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) level.push(p);
            else if (ent.isFile() && ent.name === "manifest.json") manifests.push(p);
        }
    }
    return manifests;
}

// Every bundle under root (or root itself if it is a manifest), sorted by case name.
export async function findCases(root: string): Promise<Case[]> {
    const manifests = (await fs.stat(root)).isFile() ? [root] : await findManifests(root);
    const cases = await mapLimit(manifests, IO_LIMIT, readCase);
    return cases.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function parseNpy(buf: Buffer, file = "array"): Npy {
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

// Element values as the page reads them: float32 where that is exact, float64 otherwise.
function values(a: Npy): ValueArray {
    const src = elements(a);
    if (EXACT_IN_F32.has(a.descr))
        return ["f4", (src instanceof Float32Array ? src : Float32Array.from(src)).buffer as ArrayBuffer];
    return ["f8", (src instanceof Float64Array ? src : Float64Array.from(src)).buffer as ArrayBuffer];
}

async function load(c: Case, file: string): Promise<Npy> {
    const p = path.join(c.dir, file);
    return parseNpy(await fs.readFile(p), p);
}

// What the page needs to list a comparison; read from the manifest alone.
export function entryMeta(c: Case, k: number): EntryMeta {
    const e = c.comparisons[k];
    return {
        case: c.name,
        index: k,
        count: c.comparisons.length,
        label: e.label,
        passed: c.passed,
        failure: c.failure,
        kind: e.kind,
        axes: e.axes,
        compared: e.compared,
        failed: e.failed,
    };
}

// The rest of the entry, sent when the page opens the comparison. ArrayBuffers cross postMessage as
// binary, so nothing is base64-encoded or compressed on this path. Absent arrays go as null.
export async function entryArrays(c: Case, k: number): Promise<Arrays> {
    const e = c.comparisons[k];
    const optional = (file?: string) => (file ? load(c, file) : Promise.resolve(null));
    const [ref, act, diff, status] = await Promise.all(
        [load(c, e.arrays.reference), load(c, e.arrays.actual), optional(e.arrays.diff), optional(e.arrays.status)]);
    const f32 = diff && elements(diff), u8 = status && elements(status);
    return {
        shape: ref.shape,
        dtypes: [DTYPE_NAMES[ref.descr] ?? ref.descr, DTYPE_NAMES[act.descr] ?? act.descr],
        ref: values(ref),
        act: values(act),
        diff: f32 && ((f32 instanceof Float32Array ? f32 : Float32Array.from(f32)).buffer as ArrayBuffer),
        status: u8 && ((u8 instanceof Uint8Array ? u8 : Uint8Array.from(u8)).buffer as ArrayBuffer),
    };
}
