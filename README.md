# tensorscope

Visual debugger for tensor comparison tests. When a test case fails, it writes the reference and actual tensors to disk. The viewer shows reference, actual, difference and pass/fail panes with linked zoom and a per-pixel inspector.

Status: early setup. Not ready for use yet.

| path | contents |
|---|---|
| `include/tensorscope/` | Header-only C++17 capture library, CMake target `tensorscope::capture` |
| `extension/` | VS Code extension that opens captures |
| `spec/format.md` | Bundle format: the contract between writer and reader |

## Quick start

1. Link the library with `FetchContent`:

   ```cmake
   include(FetchContent)
   FetchContent_Declare(tensorscope
       GIT_REPOSITORY git@github.com:zacharyvincze/tensorscope.git
       GIT_TAG <tag>)
   FetchContent_MakeAvailable(tensorscope)
   target_link_libraries(my_tests PRIVATE tensorscope::capture)
   ```

2. Call `tensorscope::install()` from your GoogleTest `main`, after `InitGoogleTest`.
3. In your comparison helper, copy the tensors into a `tensorscope::Capture`, pass `capture.observer()` to your comparator, and call `capture.submit()`.
4. Run the tests with `TENSORSCOPE_CAPTURE_DIR=$PWD/capture`, then open `capture/` with the [VS Code extension](extension/README.md).

The [library guide](docs/capture-library.md) covers each step with code. [examples/pack_bundle.cpp](examples/pack_bundle.cpp) is a commented program that writes a bundle without a test framework.
