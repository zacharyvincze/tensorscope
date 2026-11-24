# tensorscope

Visual debugger for tensor comparison tests. A test records its reference and actual tensors when a case fails, and the viewer shows reference, actual, difference, and pass/fail panes with linked zoom and a per-pixel inspector.

Status: early setup. Not ready for use yet.

## Layout

| path | contents |
|---|---|
| `include/tensorscope/` | Header-only C++17 capture library (CMake target `tensorscope::capture`) |
| `extension/` | VS Code extension that opens capture directories |
| `spec/format.md` | Bundle format, the contract between the two |

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
