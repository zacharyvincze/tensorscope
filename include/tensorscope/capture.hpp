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
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

/**
 * @file
 * @brief Core of the capture library: Capture builds a Comparison, the queue holds a test case's
 * comparisons, and write_bundle() writes them. Standard library only; see spec/format.md.
 */

/** @brief Capture library for tensor comparison tests. */
namespace tensorscope {
// Versioned so two pinned copies of the library in one binary can't silently mix definitions.
inline namespace v1 {

/**
 * @brief NumPy dtype string for an element type.
 *
 * Specialize for types that are not arithmetic (e.g. a half class).
 * @tparam T Element type; at most 8 bytes.
 */
template <typename T>
struct NpyDescr {
    /** @return The NumPy dtype string for @p T, e.g. `"<f4"` or `"|u1"`. */
    static std::string get() {
        static_assert(std::is_arithmetic_v<T>, "specialize tensorscope::NpyDescr for this type");
        static_assert(sizeof(T) <= 8, "readers support elements of at most 8 bytes");
        if constexpr (std::is_same_v<T, bool>) {
            return "|b1";
        } else {
            const char kind = std::is_floating_point_v<T> ? 'f' : (std::is_signed_v<T> ? 'i' : 'u');
            return std::string(sizeof(T) == 1 ? "|" : "<") + kind + std::to_string(sizeof(T));
        }
    }
};

/** @brief One element's verdict, as stored in a comparison's status array. */
enum class Status : std::uint8_t {
    kNotCompared = 0, /**< The comparator did not check this element. */
    kPass = 1,        /**< The element was within tolerance. */
    kFail = 2,        /**< The element was out of tolerance. */
};

/**
 * @brief What a comparator calls for each element it checks.
 *
 * Arguments are the comparator's own (storage) index for the element, actual - reference as it
 * measured it, and its verdict (`true` for pass).
 */
using Observer = std::function<void(std::size_t storage, double diff, bool pass)>;

template <typename TRef, typename TAct>
class Capture;

/** @brief A dense row-major array of one element type, as written to one .npy file. Read-only. */
class Array {
   public:
    /** @return False for the diff and status of a comparison without verdicts. */
    bool present() const {
        return !descr_.empty();
    }
    /** @return The NumPy dtype string of the elements; empty when not present(). */
    const std::string& descr() const {
        return descr_;
    }
    /** @return The extent of each dimension, outermost first. */
    const std::vector<std::size_t>& shape() const {
        return shape_;
    }
    /** @return The number of elements: the product of shape(). */
    std::size_t size() const {
        return size_;
    }
    /** @return The raw element bytes in row-major order. */
    const std::vector<unsigned char>& bytes() const {
        return bytes_;
    }

    /**
     * @brief Reads one element.
     * @tparam T The array's element type.
     * @param[in] i Dense row-major index.
     * @return Element @p i, read as @p T.
     * @throws std::invalid_argument If @p T is not the array's element type.
     * @throws std::out_of_range If @p i is out of range.
     */
    template <typename T>
    T get(std::size_t i) const {
        if (NpyDescr<T>::get() != descr_)
            throw std::invalid_argument("tensorscope: array holds " + descr_ + ", not " +
                                        NpyDescr<T>::get());
        check(i);
        T v;
        std::memcpy(static_cast<void*>(&v), bytes_.data() + i * sizeof(T), sizeof(T));
        return v;
    }

   private:
    template <typename, typename>
    friend class Capture;

    template <typename T>
    static Array of(const std::vector<std::size_t>& shape) {
        static_assert(std::is_trivially_copyable_v<T>, "elements are copied bytewise");
        Array a;
        a.descr_ = NpyDescr<T>::get();
        a.shape_ = shape;
        a.size_ = 1;
        for (std::size_t e : shape) a.size_ *= e;
        a.bytes_.resize(a.size_ * sizeof(T));
        return a;
    }

    template <typename T>
    void put(std::size_t i, const T& v) {
        check(i);
        std::memcpy(bytes_.data() + i * sizeof(T), static_cast<const void*>(&v), sizeof(T));
    }

    void check(std::size_t i) const {
        if (i >= size_)
            throw std::out_of_range("tensorscope: dense index " + std::to_string(i) +
                                    " is outside an array of " + std::to_string(size_) +
                                    " elements");
    }

    std::string descr_;
    std::vector<std::size_t> shape_;
    std::size_t size_ = 0;
    std::vector<unsigned char> bytes_;
};

/**
 * @brief One comparator call as written to a bundle.
 *
 * Reference and actual over a canonical shape, plus the comparator's per-element verdicts if it
 * reported any. Read-only; built by a Capture.
 */
class Comparison {
   public:
    /** @return The comparison kind, as defined in spec/format.md. */
    const std::string& kind() const {
        return kind_;
    }
    /** @return The optional name set with Capture::set_label(); may be empty. */
    const std::string& label() const {
        return label_;
    }
    /** @return One axis name per dimension of shape(). */
    const std::vector<std::string>& axes() const {
        return axes_;
    }
    /** @return The canonical shape, one extent per axis. */
    const std::vector<std::size_t>& shape() const {
        return reference_.shape();
    }
    /** @return The reference elements in canonical order. */
    const Array& reference() const {
        return reference_;
    }
    /** @return The actual elements in canonical order. */
    const Array& actual() const {
        return actual_;
    }
    /** @return float32 actual - reference, NaN where not compared. Absent without verdicts. */
    const Array& diff() const {
        return diff_;
    }
    /** @return uint8 Status per element. Absent without verdicts. */
    const Array& status() const {
        return status_;
    }

    /** @return True when the comparator was given the observer, even if it then checked nothing. */
    bool has_verdicts() const {
        return status_.present();
    }
    /** @return The number of elements the comparator checked. */
    std::size_t compared() const {
        return count([](Status s) { return s != Status::kNotCompared; });
    }
    /** @return The number of elements the comparator marked as failed. */
    std::size_t failed() const {
        return count([](Status s) { return s == Status::kFail; });
    }

   private:
    template <typename, typename>
    friend class Capture;

    Comparison() = default;

    template <typename Pred>
    std::size_t count(Pred pred) const {
        std::size_t n = 0;
        for (unsigned char b : status_.bytes()) n += pred(static_cast<Status>(b)) ? 1 : 0;
        return n;
    }

    std::string kind_, label_;
    std::vector<std::string> axes_;
    Array reference_, actual_, diff_, status_;
};

namespace detail {

inline std::vector<Comparison>& queue() {
    static std::vector<Comparison> comparisons;
    return comparisons;
}

}  // namespace detail

/**
 * @brief Hands over the comparisons submitted so far and empties the queue.
 * @return The queued comparisons, in submission order.
 */
inline std::vector<Comparison> take_pending() {
    std::vector<Comparison> out;
    out.swap(detail::queue());
    return out;
}

/**
 * @brief Builds one Comparison in two steps.
 *
 * The adapter copies every element with put(), then the comparator reports its verdicts through
 * observer(). submit() queues the result for the test case. A default-constructed Capture is
 * inactive and ignores every call.
 * @tparam TRef Element type of the reference tensor.
 * @tparam TAct Element type of the actual tensor.
 */
template <typename TRef, typename TAct>
class Capture {
   public:
    /** @brief Constructs an inactive Capture that ignores every call. */
    Capture() = default;

    /**
     * @brief Constructs an active Capture with zero-filled reference and actual arrays.
     * @param[in] kind Comparison kind, as defined in spec/format.md.
     * @param[in] axes Axis names, as defined in spec/format.md.
     * @param[in] shape The canonical shape, one extent per axis.
     * @throws std::invalid_argument If @p kind is empty or @p axes and @p shape differ in length.
     */
    Capture(std::string kind, std::vector<std::string> axes, const std::vector<std::size_t>& shape)
        : state_(std::make_shared<State>()) {
        if (kind.empty()) throw std::invalid_argument("tensorscope: kind is empty");
        if (axes.size() != shape.size())
            throw std::invalid_argument("tensorscope: " + std::to_string(axes.size()) +
                                        " axes for a shape of " + std::to_string(shape.size()) +
                                        " dimensions");
        Comparison& c = state_->cmp;
        c.kind_ = std::move(kind);
        c.axes_ = std::move(axes);
        c.reference_ = Array::of<TRef>(shape);
        c.actual_ = Array::of<TAct>(shape);
    }

    /**
     * @name Move-only
     * One Capture owns its comparison until submit().
     * @{
     */
    Capture(const Capture&) = delete;
    Capture& operator=(const Capture&) = delete;
    Capture(Capture&&) noexcept = default;
    Capture& operator=(Capture&&) noexcept = default;
    /** @} */

    /** @return True until submit(); false for a default-constructed Capture. */
    bool active() const {
        return state_ != nullptr;
    }

    /**
     * @brief Sets an optional name for this comparison, shown by the viewer when a case has
     * several.
     * @param[in] label The name to show.
     */
    void set_label(std::string label) {
        if (state_) state_->cmp.label_ = std::move(label);
    }

    /**
     * @brief Copies element @p i, for data already in canonical order.
     *
     * The comparator reports the same index @p i. Cannot be mixed with the mapped overload.
     * @param[in] i Dense row-major index.
     * @param[in] reference Reference value of the element.
     * @param[in] actual Actual value of the element.
     * @throws std::out_of_range If @p i is outside the shape.
     * @throws std::logic_error If the mapped overload was used on this Capture.
     */
    void put(std::size_t i, const TRef& reference, const TAct& actual) {
        if (!state_) return;
        use(Layout::kDense);
        state_->cmp.reference_.put(i, reference);
        state_->cmp.actual_.put(i, actual);
    }

    /**
     * @brief Copies the element the comparator knows as @p storage to canonical position
     * @p dense.
     *
     * Cannot be mixed with the dense overload.
     * @param[in] storage The comparator's own index for the element.
     * @param[in] dense Dense row-major index in the canonical shape.
     * @param[in] reference Reference value of the element.
     * @param[in] actual Actual value of the element.
     * @throws std::out_of_range If @p dense is outside the shape.
     * @throws std::logic_error If the dense overload was used on this Capture.
     */
    void put(std::size_t storage, std::size_t dense, const TRef& reference, const TAct& actual) {
        if (!state_) return;
        use(Layout::kMapped);
        state_->cmp.reference_.put(dense, reference);
        state_->cmp.actual_.put(dense, actual);
        std::vector<std::size_t>& denseOf = state_->denseOf;
        if (storage >= denseOf.size()) denseOf.resize(storage + 1, kUnmapped);
        denseOf[storage] = dense;
    }

    /**
     * @brief The callback to hand the comparator.
     *
     * Calling this gives the comparison verdicts: every element starts as not compared, and the
     * comparator marks the ones it checks. The returned observer is safe to call from several
     * threads at once for different elements; it throws std::out_of_range for a storage index
     * no put() mapped.
     * @return The observer, or an empty function when inactive.
     */
    Observer observer() {
        if (!state_) return {};
        Comparison& c = state_->cmp;
        if (!c.has_verdicts()) {
            c.diff_ = Array::of<float>(c.shape());
            c.status_ = Array::of<std::uint8_t>(c.shape());
            for (std::size_t i = 0; i < c.diff_.size(); ++i)
                c.diff_.put(i, std::numeric_limits<float>::quiet_NaN());
        }
        return [s = state_](std::size_t storage, double diff, bool pass) {
            if (s->submitted) return;  // the comparison has already been queued
            const std::size_t dense = s->dense(storage);
            s->cmp.diff_.put(dense, static_cast<float>(diff));
            s->cmp.status_.put(dense,
                               static_cast<std::uint8_t>(pass ? Status::kPass : Status::kFail));
        };
    }

    /**
     * @brief Queues the comparison for the running test case; the Capture is inactive afterwards.
     *
     * Call it after the comparator returns: the observer ignores calls made later.
     */
    void submit() {
        if (!state_) return;
        detail::queue().push_back(std::move(state_->cmp));
        state_->submitted = true;
        std::vector<std::size_t>().swap(state_->denseOf);
        state_.reset();
    }

   private:
    enum class Layout { kUnset, kDense, kMapped };
    static constexpr std::size_t kUnmapped = std::numeric_limits<std::size_t>::max();

    struct State {
        Comparison cmp;
        std::vector<std::size_t> denseOf;  // storage index -> dense index, for kMapped
        Layout layout = Layout::kUnset;
        bool submitted = false;

        std::size_t dense(std::size_t storage) const {
            if (layout != Layout::kMapped) return storage;
            if (storage >= denseOf.size() || denseOf[storage] == kUnmapped)
                throw std::out_of_range("tensorscope: the comparator reported storage index " +
                                        std::to_string(storage) + ", which no put() mapped");
            return denseOf[storage];
        }
    };

    void use(Layout layout) {
        if (state_->layout == Layout::kUnset) state_->layout = layout;
        if (state_->layout != layout)
            throw std::logic_error(
                "tensorscope: put(i, ...) and put(storage, dense, ...) mixed in one Capture");
    }

    std::shared_ptr<State> state_;
};

/** @brief One test case as written to a bundle. */
struct Case {
    /** e.g. "Filters/BlurTest.Correctness/U8"; each '/' is a directory level. */
    std::string name;
    bool passed = false;                 /**< The test's own verdict for the whole case. */
    std::string failure;                 /**< Free text, may be empty. */
    std::vector<Comparison> comparisons; /**< The case's comparisons, in submission order. */
};

/** @return TENSORSCOPE_CAPTURE_DIR, or nullptr when capture is off (unset or empty). */
inline const char* capture_dir() {
    const char* dir = std::getenv("TENSORSCOPE_CAPTURE_DIR");
    return dir && *dir ? dir : nullptr;
}

/** @return True when TENSORSCOPE_CAPTURE_DIR is set; adapters skip all work otherwise. */
inline bool enabled() {
    return capture_dir() != nullptr;
}

/**
 * @return True when TENSORSCOPE_CAPTURE_ALL asks for passing cases too: set, and neither empty
 * nor "0".
 */
inline bool capture_all() {
    const char* all = std::getenv("TENSORSCOPE_CAPTURE_ALL");
    return all && *all && std::strcmp(all, "0") != 0;
}

namespace detail {

// NPY format v1.0: magic, header length, a Python-literal dict header padded to 64 bytes.
inline void write_npy(const std::filesystem::path& path, const Array& a) {
    std::ostringstream shape;
    shape << "(";
    for (std::size_t e : a.shape()) shape << e << ",";
    shape << ")";
    std::string header =
        "{'descr': '" + a.descr() + "', 'fortran_order': False, 'shape': " + shape.str() + ", }";
    const std::size_t preamble = 10;
    header.append(63 - (preamble + header.size()) % 64, ' ');
    header += '\n';

    std::ofstream out(path, std::ios::binary);
    out.write("\x93NUMPY\x01\x00", 8);
    const auto len = static_cast<std::uint16_t>(header.size());
    const char lenBytes[2] = {static_cast<char>(len & 0xff), static_cast<char>(len >> 8)};
    out.write(lenBytes, 2);
    out << header;
    out.write(reinterpret_cast<const char*>(a.bytes().data()),
              static_cast<std::streamsize>(a.bytes().size()));
    out.close();
    if (!out) throw std::runtime_error("tensorscope: failed to write " + path.string());
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

inline constexpr const char* kRoles[] = {"reference", "actual", "diff", "status"};

// Files this library writes into a bundle directory: manifest.json and <k>_<role>.npy.
inline bool is_bundle_file(const std::string& file) {
    if (file == "manifest.json" || file == "manifest.json.tmp") return true;
    std::size_t i = 0;
    while (i < file.size() && file[i] >= '0' && file[i] <= '9') ++i;
    if (i == 0 || i >= file.size() || file[i] != '_') return false;
    const std::string rest = file.substr(i + 1);
    for (const char* role : kRoles)
        if (rest == std::string(role) + ".npy") return true;
    return false;
}

// Deletes the bundle files in dir, manifest first, and nothing else (dir may hold nested cases).
inline void clear_bundle(const std::filesystem::path& dir) {
    namespace fs = std::filesystem;
    if (!fs::is_directory(dir)) return;
    fs::remove(dir / "manifest.json");
    for (const fs::directory_entry& entry : fs::directory_iterator(dir))
        if (entry.is_regular_file() && is_bundle_file(entry.path().filename().string()))
            fs::remove(entry.path());
}

}  // namespace detail

/**
 * @brief Where the bundle for a case lives.
 * @param[in] root The capture directory.
 * @param[in] name The case name; each '/' is a directory level.
 * @return The bundle directory for @p name under @p root.
 * @throws std::invalid_argument If @p name is empty, absolute, or could leave @p root.
 */
inline std::filesystem::path bundle_dir(const std::filesystem::path& root,
                                        const std::string& name) {
    const std::filesystem::path rel(name);
    bool ok = !name.empty() && rel.is_relative() && !rel.has_root_name();
    for (const std::filesystem::path& part : rel)
        ok = ok && !part.empty() && part != "." && part != "..";
    if (!ok) throw std::invalid_argument("tensorscope: unusable case name \"" + name + "\"");
    return root / rel;
}

/**
 * @brief Writes the case's bundle to bundle_dir(root, c.name), replacing any bundle already
 * there.
 *
 * Readers see the new bundle only once it is complete.
 * @param[in] root The capture directory.
 * @param[in] c The case to write.
 * @throws std::invalid_argument If the case name is unusable; see bundle_dir().
 * @throws std::runtime_error On I/O errors.
 * @throws std::filesystem::filesystem_error On filesystem errors.
 */
inline void write_bundle(const std::filesystem::path& root, const Case& c) {
    using detail::json_string;
    const std::filesystem::path dir = bundle_dir(root, c.name);
    detail::clear_bundle(dir);  // a rerun may record fewer comparisons than the last one
    std::filesystem::create_directories(dir);

    std::ostringstream manifest;
    manifest << "{\n  \"format\": \"tensorscope\",\n  \"version\": 1,\n"
             << "  \"case\": " << json_string(c.name) << ",\n"
             << "  \"passed\": " << (c.passed ? "true" : "false") << ",\n"
             << "  \"failure\": " << json_string(c.failure) << ",\n"
             << "  \"comparisons\": [";
    for (std::size_t k = 0; k < c.comparisons.size(); ++k) {
        const Comparison& cmp = c.comparisons[k];
        const Array* arrays[] = {&cmp.reference(), &cmp.actual(), &cmp.diff(), &cmp.status()};

        manifest << (k ? ",\n" : "\n") << "    {\"kind\": " << json_string(cmp.kind());
        if (!cmp.label().empty()) manifest << ", \"label\": " << json_string(cmp.label());
        manifest << ", \"axes\": [";
        for (std::size_t a = 0; a < cmp.axes().size(); ++a)
            manifest << (a ? ", " : "") << json_string(cmp.axes()[a]);
        manifest << "]";
        if (cmp.has_verdicts())
            manifest << ", \"compared\": " << cmp.compared() << ", \"failed\": " << cmp.failed();
        manifest << ", \"arrays\": {";
        bool first = true;
        for (std::size_t r = 0; r < std::size(arrays); ++r) {
            if (!arrays[r]->present()) continue;
            const std::string file = std::to_string(k) + "_" + detail::kRoles[r] + ".npy";
            detail::write_npy(dir / file, *arrays[r]);
            manifest << (first ? "" : ", ") << json_string(detail::kRoles[r]) << ": "
                     << json_string(file);
            first = false;
        }
        manifest << "}}";
    }
    manifest << "\n  ]\n}\n";

    // Written last and renamed into place, so a reader never finds a manifest without its arrays.
    const std::filesystem::path tmp = dir / "manifest.json.tmp";
    std::ofstream out(tmp);
    out << manifest.str();
    out.close();
    if (!out) throw std::runtime_error("tensorscope: failed to write " + tmp.string());
    std::filesystem::rename(tmp, dir / "manifest.json");
}

/**
 * @brief Deletes the bundle for a case, if there is one, and its directory if that is then empty.
 *
 * Used when a case passes, so an earlier failure's bundle doesn't linger.
 * @param[in] root The capture directory.
 * @param[in] name The case name.
 * @throws std::invalid_argument If @p name is unusable; see bundle_dir().
 */
inline void remove_bundle(const std::filesystem::path& root, const std::string& name) {
    const std::filesystem::path dir = bundle_dir(root, name);
    detail::clear_bundle(dir);
    std::error_code ec;
    std::filesystem::remove(dir, ec);  // fails harmlessly unless the directory is empty
}

}  // namespace v1
}  // namespace tensorscope

#endif  // TENSORSCOPE_CAPTURE_HPP
