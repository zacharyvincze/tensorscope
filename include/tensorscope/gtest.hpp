#ifndef TENSORSCOPE_GTEST_HPP
#define TENSORSCOPE_GTEST_HPP

#include <gtest/gtest.h>

#include <cstdio>
#include <exception>
#include <filesystem>
#include <string>
#include <utility>

#include "capture.hpp"

/**
 * @file
 * @brief GoogleTest integration: collects comparisons per test case and writes a bundle when it
 * ends. Kept apart from capture.hpp so the core carries no GTest dependency.
 */

namespace tensorscope {
inline namespace v1 {

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
        take_pending();  // drop anything submitted outside a test
    }

    void OnTestEnd(const ::testing::TestInfo& info) override {
        const ::testing::TestResult& result = *info.result();
        Case c;
        // "Suite/Param.Test/Case": each '/' becomes a directory level.
        c.name = std::string(info.test_suite_name()) + "." + info.name();
        c.passed = !result.Failed();
        c.comparisons = take_pending();
        // Capture problems are reported, never allowed to stop the test run.
        try {
            if (!c.comparisons.empty() && (all_ || !c.passed)) {
                c.failure = failure_text(result);
                write_bundle(root_, c);
            } else {
                remove_bundle(root_, c.name);  // so an earlier run's failure doesn't linger
            }
        } catch (const std::exception& e) {
            std::fprintf(stderr, "tensorscope: could not update the bundle for %s: %s\n",
                         c.name.c_str(), e.what());
        }
    }

   private:
    std::filesystem::path root_;
    bool all_;
};

}  // namespace detail

/**
 * @brief Registers the listener that writes bundles.
 *
 * Call from main after InitGoogleTest; later calls do nothing. No-op unless
 * TENSORSCOPE_CAPTURE_DIR is set; TENSORSCOPE_CAPTURE_ALL=1 also writes passing cases.
 */
inline void install() {
    static bool installed = false;
    if (installed) return;
    if (!enabled()) {
        std::fprintf(stderr,
                     "note: TENSORSCOPE_CAPTURE_DIR is not set; nothing will be captured\n");
        return;
    }
    installed = true;
    const bool all = capture_all();
    ::testing::UnitTest::GetInstance()->listeners().Append(
        new detail::CaptureListener(std::filesystem::absolute(capture_dir()), all));
    std::fprintf(stderr, "note: capturing %s cases to %s\n", all ? "all" : "failing",
                 capture_dir());
}

}  // namespace v1
}  // namespace tensorscope

#endif  // TENSORSCOPE_GTEST_HPP
