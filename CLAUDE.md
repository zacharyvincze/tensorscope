# CLAUDE.md

## What tensorscope is

A visual debugger for tensor comparison tests. A test suite records the reference and actual tensors of each failing case into a capture bundle on disk; the viewer opens bundles and shows reference, actual, difference, and pass/fail panes with linked zoom/pan and a per-pixel inspector across every pane.

Built for one team's workflow, not as a general-purpose product. The main consumer is a GoogleTest suite that compares kernel outputs against reference implementations.

## Structure

Three parts, joined only by the bundle format:

| path | part | role |
|---|---|---|
| `include/tensorscope/` | capture library | Header-only C++17. Writes bundles. CMake target `tensorscope::capture`. |
| `viewer/` | HTML generator | Python CLI (run with `uv`). Turns a capture directory into one self-contained HTML file. |
| `extension/` | VS Code extension | TypeScript. Opens capture directories directly in a webview. |
| `spec/format.md` | bundle format | The contract between writer and readers. |

### The format is the contract

`spec/format.md` is the single source of truth for what a bundle contains. The writer and every reader depend on the spec, never on each other. A format change lands in one commit across the spec, the writer, and every reader, and bumps `version` when an older reader would misread the new output.

### Capture library: generic core, consumer adapter

The library knows nothing about the code under test. Keep it that way: it holds dense row-major arrays, per-element verdicts, and the bundle writer.

- **Core header**: arrays, `Comparison`, `Recording`, NPY and manifest writing. Standard library only.
- **GoogleTest header**: the listener that collects comparisons per test case and writes a bundle when a case ends. Separate from the core so the core carries no GTest dependency.
- **Adapter (lives in the consumer)**: maps the consumer's own tensor descriptors onto canonical arrays, and its comparators feed each element's verdict to the recording's observer. The status mask is the comparator's verdict, never recomputed.

Consumers fetch the library with `FetchContent` behind an opt-in build option, so default and release builds of the consumer never see it. Runtime capture is enabled by `TENSORSCOPE_CAPTURE_DIR`; `TENSORSCOPE_CAPTURE_ALL=1` also writes passing cases.

### Viewer

The generated HTML is one file with gzipped data embedded, no server, and no network access, so it opens from VS Code Live Preview, a port-forwarded browser, or a downloaded copy. `viewer/src/tensorscope_viewer/html_viewer.html` is the page template for both readers; the extension's build copies it into `extension/media/`.

### Extension

`extension/src/bundle.ts` builds the same JSON payload as `html_export.py`, so the shared page sees identical data from either reader. A change to the payload changes both. Inside the extension the page runs in hosted mode (it detects `acquireVsCodeApi`): its case list is replaced by the native Cases view (`extension/src/cases.ts`), and the two talk over `postMessage`. Opened standalone, the page must keep working with no host. The extension runs on the workspace side so it reads captures on a Remote-SSH host. Its build has to work on Node 18, which is why `@vscode/vsce` is pinned to 2.x and `cheerio` is overridden in `package.json`.

## Conventions

- C++17, header-only. Every function in a header is `inline` or a template; file-scope state goes in a function-local static.
- Format with `.clang-format` (Google base, 4-space indent, 100 columns, left-aligned pointers).
- Header guards use `#ifndef`.
- Comments are one or two lines saying why; design rationale goes in `spec/` or the README.
- Markdown is one line per paragraph and per list item.
