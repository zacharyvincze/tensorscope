# tensorscope

Visual debugger for tensor comparison tests. A test records its reference and actual tensors when a case fails, and the viewer shows reference, actual, difference, and pass/fail panes with linked zoom and a per-pixel inspector.

Status: early setup. Not ready for use yet.

## Layout

| path | contents |
|---|---|
| `include/tensorscope/` | Header-only C++17 capture library (CMake target `tensorscope::capture`) |
| `extension/` | VS Code extension that opens capture directories in a tab |
| `spec/format.md` | Bundle format, the contract between writer and readers |

## Using the capture library

```cmake
include(FetchContent)
FetchContent_Declare(tensorscope
    GIT_REPOSITORY git@github.com:zacharyvincze/tensorscope.git
    GIT_TAG <tag>)
FetchContent_MakeAvailable(tensorscope)
target_link_libraries(my_tests PRIVATE tensorscope::capture)
```

The library knows nothing about the code under test. A project provides an adapter that copies its tensors into canonical arrays, and its comparators report each element's verdict.

| header | contents |
|---|---|
| `<tensorscope/capture.hpp>` | `Capture`, the comparisons it builds, and the bundle writer. Standard library only. |
| `<tensorscope/gtest.hpp>` | GoogleTest listener. `tensorscope::install()` from `main` after `InitGoogleTest` writes a bundle for each failing case. |

An adapter creates a `Capture<TRef, TAct>(kind, axes, shape)` and copies each element with `put`. The comparator is handed `capture.observer()` and calls it for every element it checks; then `capture.submit()` queues the comparison for the test case. The status mask is the comparator's verdict, never recomputed. The [library guide](docs/capture-library.md) walks through it.

Two examples use the library without a test framework. [examples/basic.cpp](examples/basic.cpp) copies a planar float image into a channels-last comparison, has a tolerance comparator report through the observer, and writes the bundle. [examples/without_verdicts.cpp](examples/without_verdicts.cpp) is the smallest integration: it copies reference and actual but never hands out an observer, so the bundle has no verdicts and the viewer offers a threshold in its place. Build them with `cmake -S . -B build -DTENSORSCOPE_BUILD_EXAMPLES=ON && cmake --build build`, then run `build/examples/tensorscope_example_<name> [output dir]`.

Capture is off at runtime unless `TENSORSCOPE_CAPTURE_DIR` is set. `TENSORSCOPE_CAPTURE_ALL=1` also writes passing cases. View the result with the [VS Code extension](extension/README.md).
