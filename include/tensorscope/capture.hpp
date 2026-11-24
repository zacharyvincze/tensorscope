#ifndef TENSORSCOPE_CAPTURE_HPP
#define TENSORSCOPE_CAPTURE_HPP

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iterator>
#include <limits>
#include <memory>
#include <sstream>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

// Core of the capture library: canonical arrays, per-element verdicts, and the bundle writer.
// Standard library only; the bundle format is defined in spec/format.md.

namespace tensorscope {

// NumPy dtype string for T. Specialize for types that are not arithmetic (e.g. a half class).
template <typename T>
struct NpyDescr {
    static std::string get() {
        static_assert(std::is_arithmetic_v<T>, "specialize NpyDescr for this type");
        const char kind = std::is_floating_point_v<T> ? 'f' : (std::is_signed_v<T> ? 'i' : 'u');
        return std::string(sizeof(T) == 1 ? "|" : "<") + kind + std::to_string(sizeof(T));
    }
};

// A dense row-major array of one element type.
struct Array {
    std::string descr;
    std::vector<std::size_t> shape;
    std::vector<unsigned char> bytes;

    template <typename T>
    static Array of(const std::vector<std::size_t>& shape) {
        std::size_t count = 1;
        for (std::size_t e : shape) count *= e;
        return {NpyDescr<T>::get(), shape, std::vector<unsigned char>(count * sizeof(T))};
    }

    template <typename T>
    void put(std::size_t i, const T& v) {
        std::memcpy(bytes.data() + i * sizeof(T), static_cast<const void*>(&v), sizeof(T));
    }
};

// Element status in a Comparison.
enum Status : std::uint8_t { kNotCompared = 0, kPass = 1, kFail = 2 };

// One comparator call: reference and actual over the same canonical shape, plus the signed
// difference and per-element status over the elements the comparator checked.
struct Comparison {
    std::string kind;
    std::vector<std::string> axes;
    Array reference, actual;
    Array diff;    // float32, actual - reference; NaN where not compared
    Array status;  // uint8 Status
    std::size_t compared = 0, failed = 0;

    template <typename TRef, typename TAct>
    static Comparison of(std::string kind, std::vector<std::string> axes,
                         const std::vector<std::size_t>& shape) {
        Comparison c;
        c.kind = std::move(kind);
        c.axes = std::move(axes);
        c.reference = Array::of<TRef>(shape);
        c.actual = Array::of<TAct>(shape);
        c.diff = Array::of<float>(shape);
        c.status = Array::of<std::uint8_t>(shape);
        const std::size_t count = c.status.bytes.size();
        for (std::size_t i = 0; i < count; ++i)
            c.diff.put(i, std::numeric_limits<float>::quiet_NaN());
        return c;
    }

    void mark(std::size_t i, double difference, bool pass) {
        diff.put(i, static_cast<float>(difference));
        status.put(i, static_cast<std::uint8_t>(pass ? kPass : kFail));
        ++compared;
        if (!pass) ++failed;
    }
};

namespace detail {

inline std::vector<Comparison>& pending() {
    static std::vector<Comparison> comparisons;
    return comparisons;
}

}  // namespace detail

// TENSORSCOPE_CAPTURE_DIR, or nullptr when capture is off.
inline const char* capture_dir() {
    return std::getenv("TENSORSCOPE_CAPTURE_DIR");
}

// True when TENSORSCOPE_CAPTURE_DIR is set; adapters skip all work otherwise.
inline bool enabled() {
    return capture_dir() != nullptr;
}

// Queues a comparison for the running test case; written out when the case ends.
inline void submit(Comparison&& comparison) {
    detail::pending().push_back(std::move(comparison));
}

// Hands the queued comparisons to the caller and clears the queue.
inline std::vector<Comparison> take_pending() {
    std::vector<Comparison> out = std::move(detail::pending());
    detail::pending().clear();
    return out;
}

// Called by a comparator for each element it checks: storage index, actual - reference, verdict.
using Observer = std::function<void(std::size_t, double, bool)>;

// A Comparison filled in two steps: the adapter copies every element up front, then the
// comparator's observer marks the ones it checks. Elements are keyed by their index in the
// comparator's buffer, so the comparator never needs the canonical layout. Default is inactive.
class Recording {
   public:
    Recording() = default;
    explicit Recording(Comparison cmp)
        : state_(std::make_shared<State>(State{std::move(cmp), {}})) {}

    template <typename TRef, typename TAct>
    void put(std::size_t storage, std::size_t dense, const TRef& reference, const TAct& actual) {
        state_->cmp.reference.put(dense, reference);
        state_->cmp.actual.put(dense, actual);
        std::vector<std::size_t>& denseOf = state_->denseOf;
        if (storage >= denseOf.size()) denseOf.resize(storage + 1);
        denseOf[storage] = dense;
    }

    Observer observer() const {
        if (!state_) return {};
        return [s = state_](std::size_t storage, double diff, bool pass) {
            s->cmp.mark(s->denseOf.at(storage), diff, pass);
        };
    }

    void submit() {
        if (state_) tensorscope::submit(std::move(state_->cmp));
        state_.reset();
    }

   private:
    struct State {
        Comparison cmp;
        std::vector<std::size_t> denseOf;  // storage index -> canonical index
    };
    std::shared_ptr<State> state_;
};

namespace detail {

// NPY format v1.0: magic, header length, a Python-literal dict header padded to 64 bytes.
inline void write_npy(const std::filesystem::path& path, const Array& a) {
    std::ostringstream shape;
    shape << "(";
    for (std::size_t e : a.shape) shape << e << ",";
    shape << ")";
    std::string header =
        "{'descr': '" + a.descr + "', 'fortran_order': False, 'shape': " + shape.str() + ", }";
    const std::size_t preamble = 10;
    header.append(63 - (preamble + header.size()) % 64, ' ');
    header += '\n';

    std::ofstream out(path, std::ios::binary);
    out.write("\x93NUMPY\x01\x00", 8);
    const auto len = static_cast<std::uint16_t>(header.size());
    const unsigned char lenBytes[2] = {static_cast<unsigned char>(len & 0xff),
                                       static_cast<unsigned char>(len >> 8)};
    out.write(reinterpret_cast<const char*>(lenBytes), 2);
    out << header;
    out.write(reinterpret_cast<const char*>(a.bytes.data()),
              static_cast<std::streamsize>(a.bytes.size()));
}

inline std::string json_string(const std::string& s) {
    std::ostringstream out;
    out << '"';
    for (const char ch : s) {
        switch (ch) {
            case '"':
                out << "\\\"";
                break;
            case '\\':
                out << "\\\\";
                break;
            case '\n':
                out << "\\n";
                break;
            case '\t':
                out << "\\t";
                break;
            default:
                if (static_cast<unsigned char>(ch) < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", ch);
                    out << buf;
                } else {
                    out << ch;
                }
        }
    }
    out << '"';
    return out.str();
}

}  // namespace detail

// Writes one case's bundle (manifest.json plus its arrays) into dir, replacing what was there.
inline void write_bundle(const std::filesystem::path& dir, const std::string& name, bool passed,
                         const std::string& failure, const std::vector<Comparison>& comparisons) {
    using detail::json_string;
    std::filesystem::remove_all(dir);  // a rerun may record fewer comparisons than the last one
    std::filesystem::create_directories(dir);

    std::ofstream manifest(dir / "manifest.json");
    manifest << "{\n  \"format\": \"tensorscope\",\n  \"version\": 1,\n"
             << "  \"case\": " << json_string(name) << ",\n"
             << "  \"passed\": " << (passed ? "true" : "false") << ",\n"
             << "  \"failure\": " << json_string(failure) << ",\n"
             << "  \"comparisons\": [";

    for (std::size_t k = 0; k < comparisons.size(); ++k) {
        const Comparison& c = comparisons[k];
        const std::string prefix = std::to_string(k) + "_";
        const std::pair<const char*, const Array*> arrays[] = {{"reference", &c.reference},
                                                               {"actual", &c.actual},
                                                               {"diff", &c.diff},
                                                               {"status", &c.status}};

        manifest << (k ? ",\n" : "\n") << "    {\"kind\": " << json_string(c.kind)
                 << ", \"axes\": [";
        for (std::size_t a = 0; a < c.axes.size(); ++a)
            manifest << (a ? ", " : "") << json_string(c.axes[a]);
        manifest << "], \"compared\": " << c.compared << ", \"failed\": " << c.failed
                 << ", \"arrays\": {";
        for (std::size_t a = 0; a < std::size(arrays); ++a) {
            const std::string file = prefix + arrays[a].first + ".npy";
            detail::write_npy(dir / file, *arrays[a].second);
            manifest << (a ? ", " : "") << json_string(arrays[a].first) << ": "
                     << json_string(file);
        }
        manifest << "}}";
    }
    manifest << "\n  ]\n}\n";
}

}  // namespace tensorscope

#endif  // TENSORSCOPE_CAPTURE_HPP
