# Capture library

The C++ side of tensorscope. Tests use it to write the reference and actual tensors of a comparison, plus each element's pass/fail verdict, to a bundle on disk. The [VS Code extension](../extension/README.md) opens bundles.

Header-only C++17, standard library only. It knows nothing about your tensor types: you copy elements into it.

- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Mapping your layout](#mapping-your-layout)
- [Reporting verdicts](#reporting-verdicts)
- [Without verdicts](#without-verdicts)
- [Several comparisons in one test](#several-comparisons-in-one-test)
- [Without GoogleTest](#without-googletest)
- [Kinds and axes](#kinds-and-axes)
- [Element types](#element-types)
- [Runtime control](#runtime-control)
- [Errors and pitfalls](#errors-and-pitfalls)
- [API reference](#api-reference)

## Quick start

**1. Add it to the build** behind an option that is off by default:

```cmake
option(MYPROJECT_TENSORSCOPE "Record failing tensor comparisons for tensorscope" OFF)
if(MYPROJECT_TENSORSCOPE)
    include(FetchContent)
    FetchContent_Declare(tensorscope
        GIT_REPOSITORY git@github.com:zacharyvincze/tensorscope.git
        GIT_TAG <tag>)  # pin a tag or commit
    FetchContent_MakeAvailable(tensorscope)
    target_link_libraries(my_tests PRIVATE tensorscope::capture)
    target_compile_definitions(my_tests PRIVATE MYPROJECT_TENSORSCOPE)
endif()
```

**2. Install the GoogleTest listener** in `main`:

```cpp
#include <gtest/gtest.h>
#ifdef MYPROJECT_TENSORSCOPE
#include <tensorscope/gtest.hpp>
#endif

int main(int argc, char** argv) {
    ::testing::InitGoogleTest(&argc, argv);
#ifdef MYPROJECT_TENSORSCOPE
    tensorscope::install();
#endif
    return RUN_ALL_TESTS();
}
```

**3. Capture in your comparison helper.** Copy every element with `put`, hand the comparator the observer, then `submit`:

```cpp
tensorscope::Capture<float, float> cap;  // inactive: every call is a no-op
if (tensorscope::enabled()) {
    cap = tensorscope::Capture<float, float>("nd", {"n", "d1", "d2"}, {batch, rows, cols});
    for (std::size_t i = 0; i < count; ++i) cap.put(i, reference[i], actual[i]);
}
const std::size_t failed = compare(reference, actual, count, tol, cap.observer());
cap.submit();
EXPECT_EQ(failed, 0u);
```

Guard tensorscope code with `#ifdef MYPROJECT_TENSORSCOPE` so the tests still build with the option off.

`compare` is your own comparator with one extra parameter, called for each element it checks (see [Reporting verdicts](#reporting-verdicts)):

```cpp
std::size_t compare(const float* ref, const float* act, std::size_t count, float tol,
                    const std::function<void(std::size_t, double, bool)>& observe = {}) {
    std::size_t failed = 0;
    for (std::size_t i = 0; i < count; ++i) {
        const double diff = double(act[i]) - ref[i];
        const bool pass = std::fabs(diff) <= tol;
        if (!pass) ++failed;
        if (observe) observe(i, diff, pass);
    }
    return failed;
}
```

**4. Run and open.**

```sh
cmake -B build -DMYPROJECT_TENSORSCOPE=ON && cmake --build build
TENSORSCOPE_CAPTURE_DIR=$PWD/capture build/my_tests
```

Open `capture/` in VS Code with **tensorscope: Open Capture…**. Each failing test case has one bundle at `capture/<Suite>.<Test>/`.

For a standalone, commented program that writes a bundle by hand, see [examples/pack_bundle.cpp](../examples/pack_bundle.cpp).

## How it works

| step | who | call |
|---|---|---|
| 1. Copy values | your adapter | `Capture<TRef, TAct> cap(kind, axes, shape)`, then `cap.put(...)` per element |
| 2. Report verdicts | your comparator | `observer(index, actual - reference, pass)` per element checked |
| 3. Queue | your test helper | `cap.submit()` |
| 4. Write | the listener, when the test ends | one bundle per test case, holding every submitted comparison |

The bundle layout is defined in [spec/format.md](../spec/format.md).

Each element has two indices:

- **Storage index:** its position in your comparator's buffer, which may be padded, strided or planar.
- **Dense index:** its position in the bundle's row-major array of `shape`.

`put` records the mapping, so the comparator reports storage indices and never needs the bundle's layout.

## Mapping your layout

If your data is already dense and in the bundle's axis order, use `put(i, ref, act)`: storage and dense index are the same.

Otherwise use `put(storage, dense, ref, act)`. Example: a planar (NCHW) image into the bundle's channels-last (NHWC) layout:

```cpp
tensorscope::Capture<float, float> capture_image(const MyImage& ref, const MyImage& act) {
    if (!tensorscope::enabled()) return {};

    const std::size_t n = ref.n, c = ref.c, h = ref.h, w = ref.w;
    tensorscope::Capture<float, float> cap("image", {"n", "h", "w", "c"}, {n, h, w, c});
    for (std::size_t b = 0; b < n; ++b)
        for (std::size_t ch = 0; ch < c; ++ch)
            for (std::size_t y = 0; y < h; ++y)
                for (std::size_t x = 0; x < w; ++x) {
                    const std::size_t storage = ref.index(b, ch, y, x);        // comparator's index
                    const std::size_t dense = ((b * h + y) * w + x) * c + ch;  // NHWC
                    cap.put(storage, dense, ref.data[storage], act.data[storage]);
                }
    return cap;
}
```

Rules:

- Copy every logical element, including ones the comparator skips. Unreported elements show as "not compared".
- Skip stride padding.
- `TRef` and `TAct` may differ (e.g. `double` reference, `float` actual). Values are converted to them.
- Don't mix the two `put` overloads in one `Capture`.
- `Capture` is move-only; return it by value.

## Reporting verdicts

Pass `cap.observer()` to the comparator. For each element it checks, the comparator calls it with:

- the storage index,
- `actual - reference` as it measured it,
- its own pass/fail decision.

The viewer shows exactly these verdicts. Don't recompute them in the adapter.

- Declare the parameter as `std::function<void(std::size_t, double, bool)>` (same type as `tensorscope::Observer`) to keep tensorscope out of the comparator's headers.
- Calling `observer()` gives the comparison verdicts: every element starts as "not compared".
- If an element is reported twice, the last report wins.
- The observer may be called from several threads, as long as each element is reported by one thread only.
- Call `submit()` after the comparator returns. Reports after `submit()` are ignored.

## Without verdicts

Never call `observer()`. The bundle then holds only reference and actual. The viewer computes the difference and offers a threshold slider instead of the pass/fail pane.

```cpp
tensorscope::Capture<double, float> cap("nd", {"n", "d1", "d2"}, {batch, rows, cols});
for (std::size_t i = 0; i < count; ++i) cap.put(i, reference[i], actual[i]);
cap.submit();
```

Use this as a stopgap until your comparator takes an observer.

## Several comparisons in one test

Each submitted `Capture` becomes one comparison in the case's bundle, in submit order. Name them with `cap.set_label("output")`; unlabelled ones are numbered.

## Without GoogleTest

`capture.hpp` has no test framework dependency. Collect the queued comparisons and write the bundle yourself:

```cpp
tensorscope::Case result;
result.name = "Blur.Horizontal/1x3x16x24";  // each '/' is a directory level
result.passed = failed == 0;
result.failure = "12 elements differ by more than 1e-5";  // free text, may be empty
result.comparisons = tensorscope::take_pending();
tensorscope::write_bundle(tensorscope::capture_dir(), result);
```

- `write_bundle(root, case)` writes `root/<name>/`, replacing an existing bundle there. Other files in the directory are left alone.
- `remove_bundle(root, name)` deletes a case's bundle.

[examples/pack_bundle.cpp](../examples/pack_bundle.cpp) is a complete program. Build and run it:

```sh
cmake -S . -B build -DTENSORSCOPE_BUILD_EXAMPLES=ON && cmake --build build
build/examples/tensorscope_example_pack_bundle capture/
```

## Kinds and axes

`axes` names each dimension of `shape`, outermost first. The viewer shows a last axis `c` as channels, the two axes before it as rows and columns, and steps through any earlier axes.

| kind | axes | use for |
|---|---|---|
| `image` | `n, h, w, c` | Images. Always channels-last. Use `c = 1` for single-channel. |
| `voxel` | `n, d, h, w, c` | Volumes. |
| `nd` | `n, d1, d2, ...` | General tensors, logical dimensions in natural order. |
| `reduction` | `i` | 1-D results, e.g. per-row sums. |

Unknown kinds are shown the same way. [spec/format.md](../spec/format.md) is authoritative.

## Element types

`TRef` and `TAct` may be any arithmetic type of up to 8 bytes: `bool`, `int8`–`int64`, `uint8`–`uint64`, `float`, `double`. `diff` is always stored as `float32`.

For other types, specialize `NpyDescr` with the NumPy dtype string. Example: a half type:

```cpp
template <>
struct tensorscope::NpyDescr<my::half> {
    static std::string get() { return "<f2"; }
};
```

The viewer has no bfloat16 type; convert bfloat16 to `float` in the adapter.

## Runtime control

| variable | effect |
|---|---|
| `TENSORSCOPE_CAPTURE_DIR` | Turns capture on and sets the output root. Unset or empty: `enabled()` is false and `install()` does nothing. |
| `TENSORSCOPE_CAPTURE_ALL` | `1` also writes passing cases. Unset, empty or `0`: failing cases only. |

The listener, per test case:

- writes a bundle when the test fails (or always, with `TENSORSCOPE_CAPTURE_ALL=1`);
- deletes the case's old bundle when it passes, so stale failures don't linger;
- skips cases that submitted nothing;
- drops anything submitted outside a test body;
- prints a warning if a bundle can't be written, and never stops the run.

Test names map to directories: `Filters/BlurTest.Correctness/U8` is written to `capture/Filters/BlurTest.Correctness/U8/`.

## Errors and pitfalls

The library throws rather than writing a misleading bundle. Inside a test, an exception fails that test.

| mistake | result |
|---|---|
| `kind` empty, or `axes` and `shape` differ in length | constructor throws `std::invalid_argument` |
| dense index outside the shape | `put` throws `std::out_of_range` |
| comparator reports a storage index no `put` mapped | observer throws `std::out_of_range` |
| both `put` overloads used in one `Capture` | `put` throws `std::logic_error` |
| case name empty or containing `.` / `..` | `write_bundle` / `remove_bundle` throw `std::invalid_argument` |
| bundle can't be written | `write_bundle` throws; the listener prints a warning instead |

Not checked:

- A `Capture` that is never submitted is silently dropped.
- `submit()` must be called from one thread; the queue has no lock.
- Memory: until the case ends, each comparison holds both tensors plus 5 bytes per element for verdicts, and `put(storage, dense, ...)` adds 8 bytes per storage index until submit. For large tensors, narrow the run with `--gtest_filter`.

## API reference

Namespace `tensorscope`. Everything is in `<tensorscope/capture.hpp>` except `install()`, which is in `<tensorscope/gtest.hpp>`.

**Building a comparison**

| name | description |
|---|---|
| `Capture<TRef, TAct>(kind, axes, shape)` | Starts one comparison. Default-constructed: inactive, ignores every call. Move-only. |
| `put(i, ref, act)` | Copies an element of already-dense data. |
| `put(storage, dense, ref, act)` | Copies an element and maps `storage` to `dense`. |
| `observer()` | Callback for the comparator. Enables verdicts. Empty when inactive. |
| `set_label(label)` | Names the comparison within its case. |
| `submit()` | Queues the comparison. The `Capture` is inactive afterwards. |
| `active()` | False when default-constructed, moved from or submitted. |
| `Observer` | `std::function<void(std::size_t storage, double diff, bool pass)>` |

**Writing bundles**

| name | description |
|---|---|
| `install()` | Registers the GoogleTest listener. Call after `InitGoogleTest`. |
| `enabled()` | `TENSORSCOPE_CAPTURE_DIR` is set and not empty. |
| `capture_dir()` | `TENSORSCOPE_CAPTURE_DIR`, or `nullptr`. |
| `capture_all()` | `TENSORSCOPE_CAPTURE_ALL` asks for passing cases. |
| `take_pending()` | Returns the queued comparisons and empties the queue. |
| `Case` | `name`, `passed`, `failure`, `comparisons`. |
| `write_bundle(root, case)` | Writes the bundle, replacing an old one. Throws on error. |
| `remove_bundle(root, name)` | Deletes a case's bundle if present. |
| `bundle_dir(root, name)` | Path of a case's bundle. |

**Reading back** (e.g. in tests of your adapter, via `take_pending()`)

| name | description |
|---|---|
| `Comparison::kind()`, `label()`, `axes()`, `shape()` | As passed to the `Capture`. |
| `Comparison::reference()`, `actual()`, `diff()`, `status()` | The arrays. Without verdicts, `diff` and `status` have `present() == false`. |
| `Comparison::has_verdicts()` | `observer()` was called. |
| `Comparison::compared()`, `failed()` | Count of elements with a verdict, and of failures. |
| `Array::get<T>(i)` | Element `i`. Throws if `T` doesn't match the dtype. |
| `Array::descr()`, `shape()`, `size()`, `bytes()` | Dtype string, shape, element count, raw bytes. |
| `Status` | `kNotCompared`, `kPass`, `kFail`. |
