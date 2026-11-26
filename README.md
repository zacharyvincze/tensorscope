# tensorscope

Visual debugger for tensor comparison tests. When a test case fails, it writes the reference and actual tensors to disk. The viewer shows reference, actual, difference and pass/fail panes with linked zoom and a per-pixel inspector.

Status: pre-release (0.x). Breaking changes bump the minor version. See [Releases](https://github.com/zacharyvincze/tensorscope/releases) and the [changelog](CHANGELOG.md).

| path | contents |
|---|---|
| `include/tensorscope/` | Header-only C++17 capture library, CMake target `tensorscope::capture` |
| `extension/` | VS Code extension that opens captures |
| `spec/format.md` | Bundle format: the contract between writer and reader |

## Quick start

1. Link the library with `FetchContent`:

   <!-- x-release-please-start-version -->

   ```cmake
   include(FetchContent)
   FetchContent_Declare(tensorscope
       GIT_REPOSITORY git@github.com:zacharyvincze/tensorscope.git
       GIT_TAG v0.1.0)
   FetchContent_MakeAvailable(tensorscope)
   target_link_libraries(my_tests PRIVATE tensorscope::capture)
   ```

   <!-- x-release-please-end -->

2. Call `tensorscope::install()` from your GoogleTest `main`, after `InitGoogleTest`.
3. In your comparison helper, copy the tensors into a `tensorscope::Capture`, pass `capture.observer()` to your comparator, and call `capture.submit()`.
4. Run the tests with `TENSORSCOPE_CAPTURE_DIR=$PWD/capture`, then open `capture/` with the [VS Code extension](extension/README.md).

The [library guide](docs/capture-library.md) covers each step with code. [examples/pack_bundle.cpp](examples/pack_bundle.cpp) is a commented program that writes a bundle without a test framework.

[CONTRIBUTING.md](CONTRIBUTING.md) covers commit messages, CI and releases.
