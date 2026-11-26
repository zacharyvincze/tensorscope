// The smallest integration: copy reference and actual into a capture and write it. The comparator
// never gets an observer, so the bundle has no verdicts; the viewer derives the difference and
// offers a threshold slider in place of the pass/fail pane.

#include <cmath>
#include <cstddef>
#include <cstdio>
#include <filesystem>
#include <string>
#include <tensorscope/capture.hpp>
#include <vector>

namespace {

// Row-wise softmax in T, over rows of length cols.
template <typename T>
std::vector<T> softmax(const std::vector<float>& x, std::size_t cols) {
    std::vector<T> y(x.size());
    for (std::size_t r = 0; r < x.size(); r += cols) {
        T sum = 0;
        for (std::size_t i = r; i < r + cols; ++i) sum += y[i] = std::exp(static_cast<T>(x[i]));
        for (std::size_t i = r; i < r + cols; ++i) y[i] /= sum;
    }
    return y;
}

}  // namespace

int main(int argc, char** argv) {
    const std::filesystem::path root = argc > 1 ? argv[1] : "capture";

    const std::size_t batch = 2, rows = 16, cols = 32;
    std::vector<float> logits(batch * rows * cols);
    for (std::size_t i = 0; i < logits.size(); ++i)
        logits[i] = 8.0f * std::sin(0.11f * static_cast<float>(i));
    const std::vector<double> reference = softmax<double>(logits, cols);
    const std::vector<float> actual = softmax<float>(logits, cols);

    // Already dense and row-major in the bundle's axis order, so put(i, ...) needs no mapping.
    tensorscope::Capture<double, float> capture("nd", {"n", "d1", "d2"}, {batch, rows, cols});
    double worst = 0;
    for (std::size_t i = 0; i < reference.size(); ++i) {
        capture.put(i, reference[i], actual[i]);
        worst = std::fmax(worst, std::fabs(actual[i] - reference[i]));
    }
    capture.submit();

    // The case-level verdict is still the test's own; only the per-element one is missing.
    tensorscope::Case result;
    result.name = "Example/Softmax.Float32/2x16x32";
    result.passed = worst <= 1e-7;
    if (!result.passed) {
        char text[64];
        std::snprintf(text, sizeof(text), "max |actual - reference| %g", worst);
        result.failure = text;
    }
    result.comparisons = tensorscope::take_pending();
    tensorscope::write_bundle(root, result);

    std::printf("%s: max |actual - reference| = %g; bundle written to %s\n",
                result.passed ? "PASS" : "FAIL", worst,
                tensorscope::bundle_dir(root, result.name).string().c_str());
    return 0;
}
