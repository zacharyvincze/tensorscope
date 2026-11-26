// Tests for the capture library. Each one pins down a behaviour adapters and readers rely on.

#include <gtest/gtest.h>

#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <tensorscope/capture.hpp>
#include <tensorscope/gtest.hpp>
#include <type_traits>
#include <utility>
#include <vector>

namespace fs = std::filesystem;
using tensorscope::Capture;
using tensorscope::Comparison;
using tensorscope::Status;

namespace {

// A fresh, empty directory per test.
fs::path scratch() {
    const ::testing::TestInfo* info = ::testing::UnitTest::GetInstance()->current_test_info();
    const fs::path dir = fs::temp_directory_path() / "tensorscope_tests" /
                         (std::string(info->test_suite_name()) + "." + info->name());
    fs::remove_all(dir);
    fs::create_directories(dir);
    return dir;
}

std::string read(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

// Runs the capture through submit() and returns the queued comparison.
template <typename TRef, typename TAct>
Comparison finish(Capture<TRef, TAct>& capture) {
    tensorscope::take_pending();
    capture.submit();
    std::vector<Comparison> queued = tensorscope::take_pending();
    EXPECT_EQ(queued.size(), 1u);
    return queued.at(0);
}

Status status_at(const Comparison& c, std::size_t i) {
    return static_cast<Status>(c.status().get<std::uint8_t>(i));
}

}  // namespace

TEST(Capture, RejectsAxesThatDoNotMatchTheShape) {
    using C = Capture<float, float>;
    EXPECT_THROW(C("image", {"n", "h", "w", "c"}, {4, 4}), std::invalid_argument);
    EXPECT_THROW(C("", {"i"}, {4}), std::invalid_argument);
}

TEST(Capture, ConvertsValuesToTheDeclaredElementType) {
    Capture<std::uint8_t, std::uint8_t> capture("nd", {"i"}, {4});
    const std::uint8_t a = 7;
    for (std::size_t i = 0; i < 4; ++i) capture.put(i, a + 0, 200);  // int arguments
    const Comparison c = finish(capture);
    EXPECT_EQ(c.reference().descr(), "|u1");
    EXPECT_EQ(c.reference().bytes().size(), 4u);
    EXPECT_EQ(c.reference().get<std::uint8_t>(3), 7);
    EXPECT_EQ(c.actual().get<std::uint8_t>(3), 200);
}

TEST(Capture, RejectsDenseIndicesOutsideTheShape) {
    Capture<float, float> capture("nd", {"i"}, {4});
    EXPECT_THROW(capture.put(4, 1.f, 1.f), std::out_of_range);
    Capture<float, float> mapped("nd", {"i"}, {4});
    EXPECT_THROW(mapped.put(0, 4, 1.f, 1.f), std::out_of_range);
}

TEST(Capture, InactiveCaptureIgnoresEveryCall) {
    tensorscope::take_pending();
    Capture<float, float> capture;
    EXPECT_FALSE(capture.active());
    capture.put(0, 1.f, 1.f);
    capture.put(5, 3, 1.f, 1.f);
    capture.set_label("x");
    EXPECT_FALSE(capture.observer());
    capture.submit();
    EXPECT_TRUE(tensorscope::take_pending().empty());
}

TEST(Capture, HasNoVerdictsUnlessTheObserverWasRequested) {
    Capture<double, float> capture("nd", {"i"}, {3});
    for (std::size_t i = 0; i < 3; ++i) capture.put(i, 1.0, 2.f);
    const Comparison c = finish(capture);
    EXPECT_FALSE(c.has_verdicts());
    EXPECT_FALSE(c.diff().present());
    EXPECT_FALSE(c.status().present());
}

TEST(Capture, ObserverThatChecksNothingStillMeansVerdicts) {
    Capture<float, float> capture("nd", {"i"}, {3});
    for (std::size_t i = 0; i < 3; ++i) capture.put(i, 1.f, 1.f);
    capture.observer();
    const Comparison c = finish(capture);
    EXPECT_TRUE(c.has_verdicts());
    EXPECT_EQ(c.compared(), 0u);
    EXPECT_TRUE(std::isnan(c.diff().get<float>(0)));
    EXPECT_EQ(status_at(c, 0), Status::kNotCompared);
}

TEST(Capture, CountsElementsNotObserverCalls) {
    Capture<float, float> capture("nd", {"i"}, {4});
    for (std::size_t i = 0; i < 4; ++i) capture.put(i, 1.f, 1.f);
    const tensorscope::Observer observe = capture.observer();
    for (int pass = 0; pass < 2; ++pass) observe(1, 0.5, false);
    observe(2, 0.0, true);
    const Comparison c = finish(capture);
    EXPECT_EQ(c.compared(), 2u);
    EXPECT_EQ(c.failed(), 1u);
}

TEST(Capture, MapsStorageIndicesToDenseOnes) {
    // Planar 2-channel storage [c][x] into channels-last [x][c].
    Capture<int, int> capture("image", {"n", "h", "w", "c"}, {1, 1, 3, 2});
    for (std::size_t ch = 0; ch < 2; ++ch)
        for (std::size_t x = 0; x < 3; ++x) {
            const int v = static_cast<int>(10 * ch + x);
            capture.put(ch * 3 + x, x * 2 + ch, v, v);
        }
    capture.observer()(4, 0.25, false);  // storage (ch 1, x 1) -> dense 3
    const Comparison c = finish(capture);
    EXPECT_EQ(c.reference().get<int>(3), 11);
    EXPECT_EQ(status_at(c, 3), Status::kFail);
    EXPECT_FLOAT_EQ(c.diff().get<float>(3), 0.25f);
    EXPECT_EQ(c.failed(), 1u);
}

TEST(Capture, RejectsStorageIndicesNoPutMapped) {
    Capture<float, float> capture("nd", {"i"}, {4});
    capture.put(0, 0, 1.f, 1.f);
    capture.put(3, 3, 1.f, 1.f);
    const tensorscope::Observer observe = capture.observer();
    EXPECT_THROW(observe(2, 1.0, false), std::out_of_range);
    EXPECT_THROW(observe(9, 1.0, false), std::out_of_range);
}

TEST(Capture, RejectsMixedLayouts) {
    Capture<float, float> capture("nd", {"i"}, {4});
    capture.put(0, 1.f, 1.f);
    EXPECT_THROW(capture.put(1, 1, 1.f, 1.f), std::logic_error);
}

TEST(Capture, ObserverIgnoresCallsAfterSubmit) {
    Capture<float, float> capture("nd", {"i"}, {4});
    for (std::size_t i = 0; i < 4; ++i) capture.put(i, 1.f, 1.f);
    const tensorscope::Observer observe = capture.observer();
    const Comparison c = finish(capture);
    observe(3, 1.0, false);
    EXPECT_FALSE(capture.active());
    EXPECT_EQ(c.failed(), 0u);
}

TEST(Capture, IsMoveOnly) {
    static_assert(!std::is_copy_constructible_v<Capture<float, float>>);
    static_assert(std::is_nothrow_move_constructible_v<Capture<float, float>>);
    Capture<float, float> a("nd", {"i"}, {1});
    Capture<float, float> b = std::move(a);
    EXPECT_FALSE(a.active());  // NOLINT(bugprone-use-after-move)
    EXPECT_TRUE(b.active());
}

TEST(Array, GetChecksTheElementType) {
    Capture<float, float> capture("nd", {"i"}, {1});
    const Comparison c = finish(capture);
    EXPECT_THROW(c.reference().get<double>(0), std::invalid_argument);
    EXPECT_THROW(c.reference().get<float>(1), std::out_of_range);
}

TEST(NpyDescr, NamesStandardTypes) {
    EXPECT_EQ(tensorscope::NpyDescr<bool>::get(), "|b1");
    EXPECT_EQ(tensorscope::NpyDescr<std::int8_t>::get(), "|i1");
    EXPECT_EQ(tensorscope::NpyDescr<std::uint16_t>::get(), "<u2");
    EXPECT_EQ(tensorscope::NpyDescr<double>::get(), "<f8");
}

TEST(Bundle, DirRejectsNamesThatLeaveTheRoot) {
    for (const char* name : {"", "..", "a/../b", "/abs", "a/", "./a"})
        EXPECT_THROW(tensorscope::bundle_dir("root", name), std::invalid_argument) << name;
    EXPECT_EQ(tensorscope::bundle_dir("root", "S/F.T/0"), fs::path("root/S/F.T/0"));
}

TEST(Bundle, WritesManifestAndArrays) {
    const fs::path root = scratch();
    Capture<float, double> verdicts("image", {"n", "h", "w", "c"}, {1, 2, 2, 1});
    verdicts.set_label("output \"main\"");
    for (std::size_t i = 0; i < 4; ++i) verdicts.put(i, 1.f, 1.5);
    const tensorscope::Observer observe = verdicts.observer();
    observe(0, 0.5, false);
    observe(1, 0.5, true);
    verdicts.submit();
    Capture<int, int> values("reduction", {"i"}, {2});
    values.submit();

    tensorscope::Case c;
    c.name = "Suite/Fixture.Test/0";
    c.failure = "line 1\nline 2";
    c.comparisons = tensorscope::take_pending();
    tensorscope::write_bundle(root, c);

    const fs::path dir = root / "Suite/Fixture.Test/0";
    const std::string manifest = read(dir / "manifest.json");
    EXPECT_NE(manifest.find(R"("label": "output \"main\"")"), std::string::npos) << manifest;
    EXPECT_NE(manifest.find(R"("failure": "line 1\nline 2")"), std::string::npos) << manifest;
    EXPECT_NE(manifest.find(R"("compared": 2, "failed": 1)"), std::string::npos) << manifest;
    EXPECT_EQ(manifest.find("\"compared\"", manifest.find("1_reference")), std::string::npos)
        << "a comparison without verdicts has no counts";
    EXPECT_FALSE(fs::exists(dir / "1_diff.npy"));
    EXPECT_FALSE(fs::exists(dir / "manifest.json.tmp"));

    const std::string npy = read(dir / "0_actual.npy");
    ASSERT_GT(npy.size(), 10u);
    EXPECT_EQ(npy.substr(0, 8), std::string("\x93NUMPY\x01\x00", 8));
    const std::size_t header = static_cast<unsigned char>(npy[8]) |
                               static_cast<std::size_t>(static_cast<unsigned char>(npy[9])) << 8;
    EXPECT_EQ((10 + header) % 64, 0u);
    EXPECT_NE(npy.find("'descr': '<f8'"), std::string::npos);
    EXPECT_NE(npy.find("'shape': (1,2,2,1,)"), std::string::npos);
    EXPECT_EQ(npy.size(), 10 + header + 4 * sizeof(double));
}

TEST(Bundle, RewriteReplacesOnlyBundleFiles) {
    const fs::path root = scratch();
    tensorscope::Case c;
    c.name = "S/F.T";
    for (int k = 0; k < 2; ++k) {
        Capture<float, float> capture("nd", {"i"}, {1});
        capture.submit();
    }
    c.comparisons = tensorscope::take_pending();
    tensorscope::write_bundle(root, c);
    std::ofstream(root / "S/F.T/notes.txt") << "mine";
    fs::create_directories(root / "S/F.T/nested");

    c.comparisons.pop_back();
    tensorscope::write_bundle(root, c);
    EXPECT_TRUE(fs::exists(root / "S/F.T/0_reference.npy"));
    EXPECT_FALSE(fs::exists(root / "S/F.T/1_reference.npy"));
    EXPECT_TRUE(fs::exists(root / "S/F.T/notes.txt"));
    EXPECT_TRUE(fs::exists(root / "S/F.T/nested"));
}

TEST(Bundle, RemoveDeletesTheBundleAndItsEmptyDirectory) {
    const fs::path root = scratch();
    tensorscope::Case outer, inner;
    outer.name = "S/F.T";
    inner.name = "S/F.T/0";
    tensorscope::write_bundle(root, outer);
    tensorscope::write_bundle(root, inner);

    tensorscope::remove_bundle(root, "S/F.T");
    EXPECT_FALSE(fs::exists(root / "S/F.T/manifest.json"));
    EXPECT_TRUE(fs::exists(root / "S/F.T/0/manifest.json")) << "a nested case is left alone";

    tensorscope::remove_bundle(root, "S/F.T/0");
    EXPECT_FALSE(fs::exists(root / "S/F.T/0"));
    EXPECT_NO_THROW(tensorscope::remove_bundle(root, "never/written"));
}

TEST(Environment, EmptyOrZeroMeansOff) {
    ::setenv("TENSORSCOPE_CAPTURE_DIR", "", 1);
    EXPECT_FALSE(tensorscope::enabled());
    ::setenv("TENSORSCOPE_CAPTURE_DIR", "/tmp/x", 1);
    EXPECT_TRUE(tensorscope::enabled());
    ::unsetenv("TENSORSCOPE_CAPTURE_DIR");
    EXPECT_FALSE(tensorscope::enabled());

    ::setenv("TENSORSCOPE_CAPTURE_ALL", "0", 1);
    EXPECT_FALSE(tensorscope::capture_all());
    ::setenv("TENSORSCOPE_CAPTURE_ALL", "1", 1);
    EXPECT_TRUE(tensorscope::capture_all());
    ::unsetenv("TENSORSCOPE_CAPTURE_ALL");
    EXPECT_FALSE(tensorscope::capture_all());
}

// The listener sees this test as passing so far, since nothing in it fails.
TEST(Listener, PassingCaseRemovesAStaleBundle) {
    const fs::path root = scratch();
    const ::testing::TestInfo& info = *::testing::UnitTest::GetInstance()->current_test_info();
    tensorscope::Case stale;
    stale.name = std::string(info.test_suite_name()) + "." + info.name();
    tensorscope::write_bundle(root, stale);

    tensorscope::detail::CaptureListener listener(root, false);
    Capture<float, float> capture("nd", {"i"}, {1});
    capture.submit();
    listener.OnTestEnd(info);
    EXPECT_FALSE(fs::exists(root / stale.name));
}

TEST(Listener, CaptureAllWritesPassingCases) {
    const fs::path root = scratch();
    const ::testing::TestInfo& info = *::testing::UnitTest::GetInstance()->current_test_info();
    tensorscope::detail::CaptureListener listener(root, true);
    Capture<float, float> capture("nd", {"i"}, {1});
    capture.submit();
    listener.OnTestEnd(info);
    const std::string name = std::string(info.test_suite_name()) + "." + info.name();
    EXPECT_NE(read(root / name / "manifest.json").find("\"passed\": true"), std::string::npos);
}

TEST(Listener, WriteErrorsDoNotEscape) {
    const fs::path root = scratch() / "a-file";
    std::ofstream(root) << "not a directory";
    tensorscope::detail::CaptureListener listener(root, true);
    Capture<float, float> capture("nd", {"i"}, {1});
    capture.submit();
    ::testing::internal::CaptureStderr();
    EXPECT_NO_THROW(listener.OnTestEnd(*::testing::UnitTest::GetInstance()->current_test_info()));
    EXPECT_NE(::testing::internal::GetCapturedStderr().find("could not update"), std::string::npos);
}
