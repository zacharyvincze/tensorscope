// Minimal use of the capture library without a test framework: a buggy kernel's output is checked
// against a reference, and the comparison is written as one bundle the viewer can open.

#include <cmath>
#include <cstddef>
#include <cstdio>
#include <filesystem>
#include <functional>
#include <string>
#include <tensorscope/capture.hpp>
#include <vector>

namespace {

// A planar (NCHW) float image: the layout of the code under test, not the bundle's.
struct Image {
    std::size_t n, c, h, w;
    std::vector<float> data;

    std::size_t index(std::size_t b, std::size_t ch, std::size_t y, std::size_t x) const {
        return ((b * c + ch) * h + y) * w + x;
    }
};

// Horizontal 3-tap box blur, clamped at the edges. The buggy version reads zero past the right
// edge.
Image blur(const Image& src, bool buggy) {
    Image dst = src;
    for (std::size_t b = 0; b < src.n; ++b)
        for (std::size_t ch = 0; ch < src.c; ++ch)
            for (std::size_t y = 0; y < src.h; ++y)
                for (std::size_t x = 0; x < src.w; ++x) {
                    const float left = src.data[src.index(b, ch, y, x ? x - 1 : 0)];
                    const float mid = src.data[src.index(b, ch, y, x)];
                    const float right = x + 1 < src.w ? src.data[src.index(b, ch, y, x + 1)]
                                        : buggy       ? 0.0f
                                                      : mid;
                    dst.data[dst.index(b, ch, y, x)] = (left + mid + right) / 3;
                }
    return dst;
}

// The project's own comparator. Its only tie to tensorscope is the optional observer, which it
// calls with each element's storage index, actual - reference, and verdict.
std::size_t compare(const std::vector<float>& reference, const std::vector<float>& actual,
                    float tolerance,
                    const std::function<void(std::size_t, double, bool)>& observe) {
    std::size_t failed = 0;
    for (std::size_t i = 0; i < reference.size(); ++i) {
        const double diff = static_cast<double>(actual[i]) - reference[i];
        const bool pass = std::fabs(diff) <= tolerance;
        if (!pass) ++failed;
        if (observe) observe(i, diff, pass);
    }
    return failed;
}

}  // namespace

int main(int argc, char** argv) {
    const std::filesystem::path root = argc > 1 ? argv[1] : "capture";

    Image input{1, 3, 16, 24, {}};
    input.data.resize(input.n * input.c * input.h * input.w);
    for (std::size_t i = 0; i < input.data.size(); ++i)
        input.data[i] = std::sin(0.37f * static_cast<float>(i));
    const Image reference = blur(input, false);
    const Image actual = blur(input, true);

    // Adapter: bundles hold images channels-last (NHWC), so each planar element is copied to its
    // NHWC position. The capture remembers the mapping for the comparator's storage indices.
    const std::size_t n = input.n, c = input.c, h = input.h, w = input.w;
    tensorscope::Capture<float, float> capture("image", {"n", "h", "w", "c"}, {n, h, w, c});
    for (std::size_t b = 0; b < n; ++b)
        for (std::size_t ch = 0; ch < c; ++ch)
            for (std::size_t y = 0; y < h; ++y)
                for (std::size_t x = 0; x < w; ++x) {
                    const std::size_t storage = reference.index(b, ch, y, x);
                    const std::size_t dense = ((b * h + y) * w + x) * c + ch;
                    capture.put(storage, dense, reference.data[storage], actual.data[storage]);
                }

    const std::size_t failed = compare(reference.data, actual.data, 1e-5f, capture.observer());
    capture.submit();

    tensorscope::Case result;
    result.name = "Example/Blur.Horizontal/1x3x16x24";
    result.passed = failed == 0;
    if (!result.passed)
        result.failure = std::to_string(failed) + " elements differ by more than 1e-5";
    result.comparisons = tensorscope::take_pending();
    tensorscope::write_bundle(root, result);

    std::printf("%s: %zu of %zu elements failed; bundle written to %s\n",
                result.passed ? "PASS" : "FAIL", failed, reference.data.size(),
                tensorscope::bundle_dir(root, result.name).string().c_str());
    return 0;  // the failure is the point of the demo
}
