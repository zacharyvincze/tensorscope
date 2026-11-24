#ifndef TENSORSCOPE_GTEST_HPP
#define TENSORSCOPE_GTEST_HPP

#include <gtest/gtest.h>

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>
#include <utility>
#include <vector>

#include "capture.hpp"

// GoogleTest integration: collects comparisons per test case and writes a bundle when it ends.
// Kept apart from capture.hpp so the core carries no GTest dependency.

namespace tensorscope {

namespace detail {

inline std::string failure_text(const ::testing::TestResult& result) {
    std::string text;
    for (int i = 0; i < result.total_part_count(); ++i) {
        const ::testing::TestPartResult& part = result.GetTestPartResult(i);
        if (part.failed()) text += part.summary() + std::string("\n");
    }
    return text;
}

class CaptureListener : public ::testing::EmptyTestEventListener {
   public:
    CaptureListener(std::filesystem::path root, bool all) : root_(std::move(root)), all_(all) {}

    void OnTestStart(const ::testing::TestInfo&) override {
        take_pending();
    }

    void OnTestEnd(const ::testing::TestInfo& info) override {
        const ::testing::TestResult& result = *info.result();
        const std::vector<Comparison> comparisons = take_pending();
        if (!comparisons.empty() && (all_ || result.Failed())) {
            // "Suite/Param.Test/Case" -> Suite/Param.Test/Case/ (the '/'s become directories).
            const std::string name = std::string(info.test_suite_name()) + "." + info.name();
            write_bundle(root_ / name, name, !result.Failed(), failure_text(result), comparisons);
        }
    }

   private:
    std::filesystem::path root_;
    bool all_;
};

}  // namespace detail

// Registers the listener that writes bundles. Call once from main after InitGoogleTest.
// No-op unless TENSORSCOPE_CAPTURE_DIR is set; TENSORSCOPE_CAPTURE_ALL also writes passing cases.
inline void install() {
    if (!enabled()) {
        std::fprintf(stderr,
                     "note: TENSORSCOPE_CAPTURE_DIR is not set; nothing will be captured\n");
        return;
    }
    const bool all = std::getenv("TENSORSCOPE_CAPTURE_ALL") != nullptr;
    ::testing::UnitTest::GetInstance()->listeners().Append(
        new detail::CaptureListener(std::filesystem::absolute(capture_dir()), all));
    std::fprintf(stderr, "note: capturing %s cases to %s\n", all ? "all" : "failing",
                 capture_dir());
}

}  // namespace tensorscope

#endif  // TENSORSCOPE_GTEST_HPP
