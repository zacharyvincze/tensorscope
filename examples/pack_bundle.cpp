// How to pack a tensorscope bundle by hand, step by step.
//
// A bundle is one directory holding a manifest.json and a few .npy files. It records one test
// case, made of one or more comparisons, each a reference array against an actual array. This
// program writes one bundle with two comparisons, one with per-element verdicts and one without,
// so you can open it in the viewer and see both.
//
// Build and run:
//   cmake -S . -B build -DTENSORSCOPE_BUILD_EXAMPLES=ON && cmake --build build
//   build/examples/tensorscope_example_pack_bundle capture/
// Then open capture/ in VS Code with the tensorscope extension.

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>
#include <tensorscope/capture.hpp>

int main(int argc, char** argv) {
    // Bundles are written under a root directory. In a test suite this would normally come from
    // tensorscope::capture_dir(), which reads TENSORSCOPE_CAPTURE_DIR.
    const std::filesystem::path root = argc > 1 ? argv[1] : "capture";

    // =========================================================================================
    // Comparison 1: an RGB image, with per-element verdicts.
    // =========================================================================================

    // Step 1: create a Capture.
    //   - The template arguments are the element types of reference and actual (they may differ).
    //   - "image" is the kind, and spec/format.md fixes its axes as {"n", "h", "w", "c"}:
    //     batch, rows, columns, channels. Images are always channels-last, whatever your layout.
    //   - The shape gives one extent per axis. Here: a single 32x48 RGB image.
    const std::size_t h = 32, w = 48, c = 3;
    tensorscope::Capture<std::uint8_t, std::uint8_t> image("image", {"n", "h", "w", "c"},
                                                           {1, h, w, c});

    // Optional: a label tells comparisons apart when a case has more than one.
    image.set_label("rgb output");

    // Step 2 (optional): ask for the observer if you have per-element verdicts.
    //   - Once you call observer(), every element starts as "not compared".
    //   - You then call it with (index, actual - reference, passed) for each element you check.
    //   - The viewer shows exactly these verdicts in its pass/fail pane; it never recomputes them.
    //   - In a real integration you hand this to your comparator rather than calling it yourself.
    tensorscope::Observer observe = image.observer();
    std::size_t failed = 0;

    // Step 3: copy every element in with put(i, reference, actual).
    //   - i is the element's position in a dense, row-major array of the shape given in step 1,
    //     so here (with n = 1) i = (y * w + x) * c + ch.
    //   - If your data lives in another layout (planar, padded, strided), use the other overload,
    //     put(storage, dense, reference, actual); see docs/capture-library.md.
    for (std::size_t y = 0; y < h; ++y)
        for (std::size_t x = 0; x < w; ++x)
            for (std::size_t ch = 0; ch < c; ++ch) {
                const std::size_t i = (y * w + x) * c + ch;

                // Made-up data: a gradient, with a small square wrong in the red channel.
                const auto reference = static_cast<std::uint8_t>((x * 5 + y * 3 + ch * 60) % 256);
                const bool broken = ch == 0 && x >= 20 && x < 28 && y >= 10 && y < 18;
                const auto actual =
                    static_cast<std::uint8_t>(broken ? reference ^ 0x40 : reference);

                image.put(i, reference, actual);

                // The verdict for this element, using a tolerance of 1.
                const double diff = double(actual) - double(reference);
                const bool pass = std::fabs(diff) <= 1;
                observe(i, diff, pass);
                if (!pass) ++failed;
            }

    // Step 4: submit() hands the finished comparison to a queue for the current test case.
    // The Capture is empty afterwards and ignores further calls.
    image.submit();

    // =========================================================================================
    // Comparison 2: a plain 3-D float array, without verdicts.
    // =========================================================================================

    // Same steps, but observer() is never called. The bundle then holds only reference and
    // actual; the viewer computes the difference itself and offers a threshold slider instead of
    // the pass/fail pane. Use this when you have no per-element verdict to give.
    //
    // "nd" is the kind for generic arrays, with axes {"n", "d1", "d2", ...}. With no "c" axis,
    // the last two axes are rows and columns, and the viewer steps through "n" one slice at a time.
    const std::size_t n = 4, rows = 16, cols = 16;
    tensorscope::Capture<double, float> array("nd", {"n", "d1", "d2"}, {n, rows, cols});
    array.set_label("activations");

    for (std::size_t i = 0; i < n * rows * cols; ++i) {
        const double reference = std::sin(0.05 * double(i));
        const float actual = static_cast<float>(reference) + 1e-3f * float(i % 7);  // some noise
        array.put(i, reference, actual);
    }
    array.submit();

    // =========================================================================================
    // Writing the bundle
    // =========================================================================================

    // Step 5: describe the test case and collect the queued comparisons.
    //   - name: each '/' becomes a directory level under root, and the viewer's Cases view
    //     groups cases the same way.
    //   - passed / failure: the test's own verdict for the whole case, plus free text.
    //   - take_pending() returns every comparison submitted so far, in order, and empties the
    //     queue for the next case.
    tensorscope::Case result;
    result.name = "Examples/PackBundle.TwoComparisons";
    result.passed = failed == 0;
    result.failure = "rgb output: " + std::to_string(failed) + " elements differ by more than 1";
    result.comparisons = tensorscope::take_pending();

    // Step 6: write it. This creates root/Examples/PackBundle.TwoComparisons/ with:
    //   manifest.json      the case and a list of its comparisons
    //   0_reference.npy    comparison 0 ("rgb output"), one file per array
    //   0_actual.npy
    //   0_diff.npy         only present when the comparison has verdicts
    //   0_status.npy       likewise
    //   1_reference.npy    comparison 1 ("activations")
    //   1_actual.npy
    // An existing bundle for the same case is replaced. spec/format.md describes every file.
    tensorscope::write_bundle(root, result);

    std::printf("bundle written to %s\n",
                tensorscope::bundle_dir(root, result.name).string().c_str());
    return EXIT_SUCCESS;
}
