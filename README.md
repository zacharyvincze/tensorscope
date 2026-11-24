# tensorscope

Visual debugger for tensor comparison tests. A test records its reference and actual tensors when a case fails, and the viewer shows reference, actual, difference, and pass/fail panes with linked zoom and a per-pixel inspector.

Status: early setup. Not ready for use yet.

## Layout

| path | contents |
|---|---|
| `include/tensorscope/` | Header-only C++17 capture library (CMake target `tensorscope::capture`) |
| `viewer/` | Python CLI that turns a capture directory into one self-contained HTML viewer |
| `extension/` | VS Code extension that opens capture directories (planned) |
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
| `<tensorscope/capture.hpp>` | Arrays, `Comparison`, `Recording`, and the bundle writer. Standard library only. |
| `<tensorscope/gtest.hpp>` | GoogleTest listener. `tensorscope::install()` from `main` after `InitGoogleTest` writes a bundle for each failing case. |

An adapter builds a `Comparison::of<TRef, TAct>(kind, axes, shape)`, wraps it in a `Recording`, and copies each element with `put(storage, dense, ref, act)`. The comparator calls `recording.observer()` for every element it checks, then `recording.submit()`. The status mask is the comparator's verdict, never recomputed.

Capture is off at runtime unless `TENSORSCOPE_CAPTURE_DIR` is set. `TENSORSCOPE_CAPTURE_ALL=1` also writes passing cases. See [`viewer/`](viewer/README.md) to view the result.
