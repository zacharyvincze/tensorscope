# Capture bundle format (v1)

The contract between the capture library and the viewer. Anything that writes this format can be viewed, and the viewer depends on nothing else.

## Layout

One directory per test case: `<capture dir>/<Suite>/<Fixture>.<Test>/<Param>/`. Each directory holds a `manifest.json` and the `.npy` arrays it names. A case directory may also contain other case directories. Writers write the manifest last, so a reader that finds one also finds its arrays.

## manifest.json

```json
{
  "format": "tensorscope", "version": 1,
  "case": "Filters/BlurTest.Correctness/U8_3ch_2x36x55",
  "passed": false,
  "failure": "<test failure text>",
  "comparisons": [
    {"kind": "image", "label": "output", "axes": ["n", "h", "w", "c"],
     "compared": 11880, "failed": 8122,
     "arrays": {"reference": "0_reference.npy", "actual": "0_actual.npy",
                "diff": "0_diff.npy", "status": "0_status.npy"}}
  ]
}
```

Each comparator call in the test adds one entry to `comparisons`. Readers must reject a `format` they don't recognize and a `version` newer than they support. Readers must ignore keys they don't recognize, so a writer can add an optional key without bumping `version`.

`label` is optional. It names the comparison within its case, for when a case has several; readers fall back to the comparison's index.

`compared` and `failed` count the elements with status 1 or 2 and with status 2. They are present exactly when `status` is, so readers can list cases without loading arrays.

## Arrays

Every array is a dense, row-major NPY v1.0 file over the whole logical tensor. Stride padding is dropped, but elements outside the compared region are kept.

| array | dtype | required | meaning |
|---|---|---|---|
| `reference` | any numeric | yes | expected values |
| `actual` | any numeric | yes | values under test |
| `diff` | `float32` | no | `actual - reference`; NaN where not compared |
| `status` | `uint8` | no | the comparator's verdict: 0 not compared, 1 pass, 2 fail |

All arrays in a comparison have the same shape. An absent array is omitted from `arrays`.

Without `diff`, readers compute `actual - reference`, NaN where `status` is 0. Without `status`, the bundle carries no per-element verdict: every element counts as compared, and readers must not present anything they derive (such as a threshold on `diff`) as the test's verdict. Writers whose comparator decides per element should always write `status`.

## Kinds

`kind` says how to interpret the data. Readers lay out every kind by its `axes`: a last axis `c` is channels, the last two other axes are rows and columns, and any earlier axes are positions to step through. An unrecognized kind is shown the same way.

| kind | axes |
|---|---|
| `image` | `n, h, w, c` (channels-last regardless of source layout) |
| `voxel` | `n, d, h, w, c` |
| `nd` | `n, d1, d2, ...` (logical dims as given) |
| `reduction` | `i` |
