# Capture bundle format (v1)

The contract between the capture library and the viewer. Anything that writes this format can be viewed, and the viewer depends on nothing else.

## Layout

One directory per test case: `<capture dir>/<Suite>/<Fixture>.<Test>/<Param>/`. Each directory holds a `manifest.json` and the `.npy` arrays it names.

## manifest.json

```json
{
  "format": "tensorscope", "version": 1,
  "case": "Image_Color/ColorCastTest.Correctness/HOST_I8toI8_PKD3_FullRoi_2x36x55",
  "passed": false,
  "failure": "<test failure text>",
  "comparisons": [
    {"kind": "image", "axes": ["n", "h", "w", "c"], "compared": 11880, "failed": 8122,
     "arrays": {"reference": "0_reference.npy", "actual": "0_actual.npy",
                "diff": "0_diff.npy", "status": "0_status.npy"}}
  ]
}
```

Each comparator call in the test adds one entry to `comparisons`. Readers must reject a `format` they don't recognize and a `version` newer than they support.

## Arrays

Every array is a dense, row-major NPY v1.0 file over the whole logical tensor. Stride padding is dropped, but elements outside the compared region are kept.

| array | dtype | meaning |
|---|---|---|
| `reference` | any numeric | expected values |
| `actual` | any numeric | values under test |
| `diff` | `float32` | `actual - reference`; NaN where not compared |
| `status` | `uint8` | 0 not compared, 1 pass, 2 fail |

All four arrays in a comparison have the same shape.

## Kinds

| kind | axes |
|---|---|
| `image` | `n, h, w, c` (channels-last regardless of source layout) |
| `voxel` | `n, d, h, w, c` |
| `nd` | `n, d1, d2, ...` (logical dims as given) |
| `reduction` | `i` |
