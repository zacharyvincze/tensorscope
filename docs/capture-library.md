# Using the capture library

The capture library is the C++ side of tensorscope. Your tests use it to record the reference and actual tensors of a comparison, along with each element's pass/fail verdict, into a bundle on disk. The [VS Code extension](../extension/README.md) then opens the bundle.

The library is header-only C++17 and knows nothing about your code. You write a small adapter that copies your tensors into a `Capture`. Your comparator reports its per-element verdicts through a callback.

## Contents

- [Adding it to a build](#adding-it-to-a-build)
- [How it fits together](#how-it-fits-together)
- [Integrating with GoogleTest](#integrating-with-googletest)
- [Writing an adapter](#writing-an-adapter)
- [Reporting verdicts from a comparator](#reporting-verdicts-from-a-comparator)
- [Captures without verdicts](#captures-without-verdicts)
- [Several comparisons in one test](#several-comparisons-in-one-test)
- [Using it without GoogleTest](#using-it-without-googletest)
- [Kinds and axes](#kinds-and-axes)
- [Element types](#element-types)
- [Runtime control](#runtime-control)
- [Errors and pitfalls](#errors-and-pitfalls)
- [API reference](#api-reference)

## Adding it to a build

Fetch the library with `FetchContent` and link `tensorscope::capture`. Put it behind an option that is off by default, so default and release builds never download or compile it:

```cmake
option(MYPROJECT_TENSORSCOPE "Record failing tensor comparisons for tensorscope" OFF)

if(MYPROJECT_TENSORSCOPE)
    include(FetchContent)
    FetchContent_Declare(tensorscope
        GIT_REPOSITORY git@github.com:zacharyvincze/tensorscope.git
        GIT_TAG <tag>)
    FetchContent_MakeAvailable(tensorscope)
    target_link_libraries(my_tests PRIVATE tensorscope::capture)
    target_compile_definitions(my_tests PRIVATE MYPROJECT_TENSORSCOPE)
endif()
```

Pin `GIT_TAG` to a tag or commit. Wrap your adapter code in `#ifdef MYPROJECT_TENSORSCOPE` so the tests still build when the option is off.

The target only adds an include directory and requires C++17. It has no link dependencies. `<tensorscope/gtest.hpp>` includes `<gtest/gtest.h>`, but `tensorscope::capture` does not link GoogleTest. Your test target must already link it.

| header | contents |
|---|---|
| `<tensorscope/capture.hpp>` | `Capture`, the comparisons it builds, and the bundle writer. Standard library only. |
| `<tensorscope/gtest.hpp>` | A GoogleTest listener that writes one bundle per test case. Includes `capture.hpp`. |

## How it fits together

Each comparison your test makes goes through four steps:

```
adapter                    comparator                  test helper          listener (at test end)
───────                    ──────────                  ───────────          ──────────────────────
Capture<TRef, TAct> cap    compare(..., observer)      cap.submit()         writes every submitted
cap.put(...) per element   calls observer(i, d, ok)    queues the result    comparison as one bundle
                           for each element it checks  for this test case
```

1. **The adapter copies the values.** It creates a `Capture` with the tensor's canonical shape and copies every element of the reference and actual tensors into it.
2. **The comparator reports verdicts.** You pass `cap.observer()` to your comparator. It calls the observer once for each element it checks, with its own index for the element, `actual - reference`, and whether the element passed.
3. **`submit()` queues the comparison** for the running test case. The `Capture` is spent after that.
4. **The listener writes the bundle** when the test ends: one directory per test case, holding every comparison the test submitted.

You only ever build a `Capture`. The rest of the names are things you pass along or read back:

| name | what it is |
|---|---|
| `Capture<TRef, TAct>` | Builds one comparison: the values, plus verdicts if a comparator reports any. `TRef` and `TAct` are the element types of the reference and actual tensors. |
| `Observer` | The callback a comparator calls for each element it checks: `std::function<void(std::size_t storage, double diff, bool pass)>`. |
| `Comparison` | A finished, read-only comparison, as written to the bundle. You get one only from `take_pending()`, for instance in your own tests. |
| `Array` | One read-only array of a `Comparison` (reference, actual, diff, or status). |
| `Case` | One test case: its name, its verdict, its failure text, and its comparisons. Only needed when writing bundles yourself, without the listener. |
| bundle | One directory per test case, holding a `manifest.json` plus `.npy` files. The layout is defined in [spec/format.md](../spec/format.md). |

An element has two positions:

- **Storage index:** where the element sits in your comparator's buffer. That buffer may be padded, strided, or planar.
- **Dense index:** where the element sits in the bundle's canonical row-major array. For images, that array is always channels-last.

The adapter tells the `Capture` which dense index each storage index maps to. Your comparator then reports storage indices and never needs to know the bundle's layout.

## Integrating with GoogleTest

### 1. Install the listener

Call `tensorscope::install()` in your test `main` after `InitGoogleTest`:

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

`install()` does nothing (apart from printing a note) unless `TENSORSCOPE_CAPTURE_DIR` is set. When it is set, the listener:

- discards anything submitted outside a test when each test starts;
- when a test fails, writes the comparisons it submitted as one bundle (with `TENSORSCOPE_CAPTURE_ALL=1`, passing tests are written too);
- when a test passes, deletes that test's bundle from an earlier run, so old failures don't linger;
- skips tests that submitted no comparisons;
- prints a warning if a bundle can't be written, and lets the test run carry on.

### 2. Bundle location

The bundle goes to `$TENSORSCOPE_CAPTURE_DIR/<suite>.<test>/`. Each `/` in a parameterized test name becomes a directory level, so `Filters/BlurTest.Correctness/U8_3ch` is written to `Filters/BlurTest.Correctness/U8_3ch/`. A rerun replaces the case's own files and leaves other cases alone.

### 3. Hook into your comparison helper

In whatever helper your tests use to compare a kernel's output with its reference, build a `Capture` and pass its observer to the comparator. The next two sections show how.

## Writing an adapter

The adapter runs before the comparator. It creates a `Capture` with the canonical kind, axes, and shape, then copies every element with `put(storage, dense, reference, actual)`.

This example converts a planar (NCHW) image to the channels-last layout that bundles use for images:

```cpp
#include <tensorscope/capture.hpp>

tensorscope::Capture<float, float> capture_image(const MyImage& ref, const MyImage& act) {
    if (!tensorscope::enabled()) return {};  // inactive: no copies, every call a no-op

    const std::size_t n = ref.n, c = ref.c, h = ref.h, w = ref.w;
    tensorscope::Capture<float, float> cap("image", {"n", "h", "w", "c"}, {n, h, w, c});
    for (std::size_t b = 0; b < n; ++b)
        for (std::size_t ch = 0; ch < c; ++ch)
            for (std::size_t y = 0; y < h; ++y)
                for (std::size_t x = 0; x < w; ++x) {
                    const std::size_t storage = ref.index(b, ch, y, x);  // the comparator's index
                    const std::size_t dense = ((b * h + y) * w + x) * c + ch;  // NHWC
                    cap.put(storage, dense, ref.data[storage], act.data[storage]);
                }
    return cap;
}
```

Points to note:

- `Capture<TRef, TAct>` fixes the element types of `reference` and `actual`. They may differ, for example a `double` reference against a `float` kernel. Values passed to `put` are converted to these types, so an `int` passed to a `uint8_t` capture is stored as `uint8_t`.
- Copy every element of the logical tensor, including any the comparator skips. Elements the comparator never reports keep status "not compared", and the viewer still shows their values.
- Drop stride padding. Only logical elements belong in the bundle.
- If your data is already dense and in the canonical axis order, use `put(i, reference, actual)`. The storage index is then the dense index, and the capture keeps no mapping table.
- If `TENSORSCOPE_CAPTURE_DIR` is unset, return a default-constructed `Capture`. It is inactive: `put`, `observer()`, and `submit()` do nothing, and `observer()` returns an empty function. Returning early skips the copy loop entirely.
- A `Capture` can be moved but not copied, so return it by value as above.

## Reporting verdicts from a comparator

The comparator stays your own code. Its only connection to tensorscope is an optional `Observer` argument. It calls the observer once per element it checks, passing the storage index, `actual - reference` as the comparator measured it, and its own pass/fail decision:

```cpp
std::size_t compare(const float* ref, const float* act, std::size_t count, float tol,
                    const tensorscope::Observer& observe = {}) {
    std::size_t failed = 0;
    for (std::size_t i = 0; i < count; ++i) {
        const double diff = static_cast<double>(act[i]) - ref[i];
        const bool pass = std::fabs(diff) <= tol;
        if (!pass) ++failed;
        if (observe) observe(i, diff, pass);
    }
    return failed;
}
```

To avoid a compile-time dependency on tensorscope, declare the parameter as `std::function<void(std::size_t, double, bool)>`. `tensorscope::Observer` is an alias for that type.

The test helper then connects the adapter and the comparator:

```cpp
tensorscope::Capture<float, float> cap = capture_image(reference, actual);
const std::size_t failed = compare(reference.data.data(), actual.data.data(),
                                   reference.data.size(), 1e-5f, cap.observer());
cap.submit();  // queue for this test case; the listener writes it when the case ends
EXPECT_EQ(failed, 0u);
```

The status mask is the comparator's verdict. Don't recompute it in the adapter or apply a separate tolerance there. The viewer exists to show exactly what the test decided.

Calling `observer()` is what gives a comparison verdicts. From that moment every element is "not compared" until the comparator reports it, so a comparator that checks nothing (an empty region, say) records zero compared elements rather than no verdict at all. If the comparator reports the same element twice, the last report wins.

A parallel comparator may call the observer from several threads at once, as long as no two threads report the same element.

## Captures without verdicts

If you can't add an observer to the comparator yet, copy the values and never call `observer()`. The bundle then has no `diff` or `status` arrays. The viewer computes the difference itself and shows a threshold slider instead of the pass/fail pane. That threshold is a viewing aid, not the test's verdict.

```cpp
tensorscope::Capture<double, float> cap("nd", {"n", "d1", "d2"}, {batch, rows, cols});
for (std::size_t i = 0; i < count; ++i) cap.put(i, reference[i], actual[i]);
cap.submit();
```

Treat this as a stopgap. Writers whose comparator decides per element should report verdicts.

## Several comparisons in one test

A test may submit any number of captures. Each becomes one comparison in the case's bundle, in the order they were submitted. Give each a label so the viewer can tell them apart; without one, the viewer numbers them:

```cpp
tensorscope::Capture<float, float> cap = capture_image(reference, actual);
cap.set_label("output");
```

## Using it without GoogleTest

`capture.hpp` does not depend on any test framework. Without the listener, collect the submitted comparisons and write the bundle yourself:

```cpp
#include <tensorscope/capture.hpp>

// ... build Captures, run comparators, call submit() ...

if (tensorscope::enabled()) {
    tensorscope::Case result;
    result.name = "Example/Blur.Horizontal/1x3x16x24";
    result.passed = failed == 0;
    result.failure = failure_text;  // free text, may be empty
    result.comparisons = tensorscope::take_pending();
    tensorscope::write_bundle(tensorscope::capture_dir(), result);
}
```

`write_bundle(root, case)` writes the bundle to `root/<case name>/`, replacing a bundle already there. It deletes only the files a bundle consists of, so anything else in the directory is left alone. `remove_bundle(root, name)` deletes a case's bundle, which is what the listener does when a test passes.

[examples/basic.cpp](../examples/basic.cpp) and [examples/without_verdicts.cpp](../examples/without_verdicts.cpp) are complete programs that use this pattern. Build and run them with:

```sh
cmake -S . -B build -DTENSORSCOPE_BUILD_EXAMPLES=ON && cmake --build build
build/examples/tensorscope_example_basic capture/
```

## Kinds and axes

`kind` tells the viewer how to read the data. `axes` names each dimension of the shape, outermost first, and must have one name per dimension. The viewer treats a last axis named `c` as channels and the last two other axes as rows and columns. It lets you step through any earlier axes one position at a time.

| kind | axes | use for |
|---|---|---|
| `image` | `n, h, w, c` | Images. Always channels-last, whatever your storage layout. Use `c = 1` for single-channel images. |
| `voxel` | `n, d, h, w, c` | Volumes. |
| `nd` | `n, d1, d2, ...` | General tensors, with logical dimensions in their natural order. |
| `reduction` | `i` | 1-D results such as per-row sums. |

The viewer displays an unrecognized kind the same way, so you can add a kind before the viewer handles it specially. [spec/format.md](../spec/format.md) is the authoritative list.

## Element types

`Capture` accepts any arithmetic type of up to 8 bytes as `TRef` or `TAct`: `bool`, `int8` to `int64`, `uint8` to `uint64`, `float`, and `double`. Elements are copied bytewise, so the type must be trivially copyable.

For a type that is not arithmetic, such as a 16-bit half class, specialize `NpyDescr` with its NumPy dtype string:

```cpp
template <>
struct tensorscope::NpyDescr<my::half> {
    static std::string get() { return "<f2"; }
};
```

The viewer reads `f2` (IEEE half), but have no bfloat16 type. Convert bfloat16 tensors to `float` in the adapter.

`diff` is always stored as `float32`, whatever the element types.

## Runtime control

| variable | effect |
|---|---|
| `TENSORSCOPE_CAPTURE_DIR` | Turns capture on and sets the root directory for bundles. When unset or empty, `enabled()` is false and `install()` does nothing. |
| `TENSORSCOPE_CAPTURE_ALL` | Set to `1` to have the GoogleTest listener write passing cases too. Unset, empty, or `0` means failing cases only. |

```sh
TENSORSCOPE_CAPTURE_DIR=$PWD/capture ./my_tests --gtest_filter='Filters/*'
```

## Errors and pitfalls

The library throws on mistakes rather than writing a misleading bundle. Inside a GoogleTest test, an exception fails the test with its message.

| mistake | what happens |
|---|---|
| `axes` doesn't have one name per dimension of the shape, or `kind` is empty | The `Capture` constructor throws `std::invalid_argument`. |
| A dense index outside the shape | `put` throws `std::out_of_range`. |
| The comparator reports a storage index no `put` mapped | The observer throws `std::out_of_range`, naming the index. |
| Mixing `put(i, ...)` and `put(storage, dense, ...)` in one capture | `put` throws `std::logic_error`. |
| A case name that is empty or contains `.` or `..` components | `write_bundle` and `remove_bundle` throw `std::invalid_argument`. |
| The bundle can't be written (disk full, no permission) | `write_bundle` throws. The listener catches it and prints a warning. |

Things the library can't check for you:

- **Call `submit()` after the comparator returns.** The observer ignores reports made after `submit()`, so they don't reach the bundle. A `Capture` that is never submitted is dropped silently.
- **Submit from one thread.** The case queue has no lock. (The observer may be called from several threads; see above.)
- **Don't keep anything across test cases.** The listener discards whatever is queued when each test starts. A comparison submitted outside a test body, for example in a global fixture, is dropped.
- **Mind memory use.** Until the case ends, each comparison holds copies of both tensors, plus 5 bytes per element for verdicts. A capture filled with `put(storage, dense, ...)` also holds an 8-byte mapping entry per storage index until it is submitted. For very large tensors, capture only the cases you need with `--gtest_filter`.

## API reference

All names are in namespace `tensorscope`.

**Building a comparison** (`<tensorscope/capture.hpp>`):

| name | description |
|---|---|
| `bool enabled()` | True when `TENSORSCOPE_CAPTURE_DIR` is set and not empty. |
| `Capture<TRef, TAct>(kind, axes, shape)` | Starts capturing one comparison. A default-constructed `Capture` is inactive and ignores every call. Move-only. |
| `Capture::put(i, ref, act)` | Copies one element of data that is already dense; the comparator reports `i`. |
| `Capture::put(storage, dense, ref, act)` | Copies one element and maps the comparator's index `storage` to `dense`. |
| `Capture::observer()` | The callback to pass to the comparator. Calling it gives the comparison verdicts. Empty when inactive. |
| `Capture::set_label(label)` | Optional name for the comparison within its case. |
| `Capture::submit()` | Queues the comparison for the current case. The `Capture` is inactive afterwards. |
| `Capture::active()` | False when default-constructed, moved from, or submitted. |
| `Observer` | `std::function<void(std::size_t storage, double diff, bool pass)>`. |

**Writing bundles** (`<tensorscope/capture.hpp>`):

| name | description |
|---|---|
| `take_pending()` | Returns the comparisons submitted so far and empties the queue. |
| `Case` | `name`, `passed`, `failure`, and `comparisons` of one test case. |
| `write_bundle(root, case)` | Writes the case's bundle under `root`, replacing an earlier one. Throws on error. |
| `remove_bundle(root, name)` | Deletes a case's bundle, if there is one. |
| `bundle_dir(root, name)` | Where the case's bundle lives. |
| `const char* capture_dir()` | The value of `TENSORSCOPE_CAPTURE_DIR`, or `nullptr` when it is unset or empty. |
| `bool capture_all()` | True when `TENSORSCOPE_CAPTURE_ALL` asks for passing cases too. |
| `install()` | Registers the GoogleTest listener. From `<tensorscope/gtest.hpp>`. |

**Reading a comparison back**, for example in tests of your adapter:

| name | description |
|---|---|
| `Comparison::kind()`, `label()`, `axes()`, `shape()` | What was passed to the `Capture`. |
| `Comparison::reference()`, `actual()`, `diff()`, `status()` | The arrays. `diff` and `status` are absent (`present()` is false) without verdicts. |
| `Comparison::has_verdicts()` | True when `observer()` was called. |
| `Comparison::compared()`, `failed()` | Elements with status pass or fail, and with status fail. |
| `Array::get<T>(i)` | Element `i`. Throws if `T` is not the array's element type. |
| `Array::descr()`, `shape()`, `size()`, `bytes()` | The NumPy dtype string, shape, element count, and raw bytes. |
| `Status` | `kNotCompared`, `kPass`, `kFail`: the values in a status array. |
