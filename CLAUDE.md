# CLAUDE.md

## What tensorscope is

A visual debugger for tensor comparison tests. A test suite records the reference and actual tensors of each failing case into a capture bundle on disk; the viewer opens bundles and shows reference, actual, difference, and pass/fail panes with linked zoom/pan and a per-pixel inspector across every pane.

Built for one team's workflow, not as a general-purpose product. The main consumer is a GoogleTest suite that compares kernel outputs against reference implementations.

## Structure

A writer and a reader, joined only by the bundle format:

| path | part | role |
|---|---|---|
| `include/tensorscope/` | capture library | Header-only C++17. Writes bundles. CMake target `tensorscope::capture`. |
| `extension/` | VS Code extension | TypeScript. Opens capture directories directly in a webview. |
| `spec/format.md` | bundle format | The contract between writer and readers. |

### The format is the contract

`spec/format.md` is the single source of truth for what a bundle contains. The writer and every reader depend on the spec, never on each other. A format change lands in one commit across the spec, the writer, and every reader, and bumps `version` when an older reader would misread the new output.

### Capture library: generic core, consumer adapter

The library knows nothing about the code under test. Keep it that way: it holds dense row-major arrays, per-element verdicts, and the bundle writer.

- **Core header**: `Capture` (the only way to build a comparison), the read-only `Comparison` and `Array` it produces, the case queue, NPY and manifest writing. Standard library only. Everything sits in `inline namespace v1`.
- **Tests**: `tests/` (GoogleTest, `-DTENSORSCOPE_BUILD_TESTS=ON`) pins down the library's behaviour; a change to the API comes with a test.
- **GoogleTest header**: the listener that collects comparisons per test case and writes a bundle when a case ends. Separate from the core so the core carries no GTest dependency.
- **Adapter (lives in the consumer)**: maps the consumer's own tensor descriptors onto canonical arrays, and its comparators feed each element's verdict to the recording's observer. The status mask is the comparator's verdict, never recomputed.

Consumers fetch the library with `FetchContent` behind an opt-in build option, so default and release builds of the consumer never see it. Runtime capture is enabled by `TENSORSCOPE_CAPTURE_DIR`; `TENSORSCOPE_CAPTURE_ALL=1` also writes passing cases.

### Extension

The extension is the only reader. It is TypeScript in three parts: `src/extension/` (Node: commands, the Cases view, one `CapturePanel` per capture tab, the bundle reader), `src/webview/` (the page, built in TypeScript with no framework), and `src/shared/protocol.ts`, which types every message between them. Each part is type-checked against its own environment (`tsconfig.json`, `src/webview/tsconfig.json`), and esbuild bundles both into `out/`. The extension's README maps the files.

- A message or setting changes in `protocol.ts` first; the compiler then points at both sides.
- The page keeps its state in `App` (`src/webview/app.ts`); components render from it and call its actions. Data logic (`model.ts`, `render.ts`, `format.ts`) stays free of the DOM, so `npm test` covers it.
- The page takes every colour from VS Code's theme variables, and loads nothing from outside the extension: the codicon font is bundled, and the CSP allows only the extension's own files.
- Case selection lives in the native Cases view (`src/extension/cases.ts`); the page has no case list. The extension sends the page only metadata up front and each case's arrays on request, so opening cost doesn't grow with capture size.

The extension runs on the workspace side so it reads captures on a Remote-SSH host. Its build has to work on Node 18, which is why `@vscode/vsce` is pinned to 2.x, esbuild to 0.25, and `cheerio` is overridden in `package.json`.

## Conventions

- C++17, header-only. Every function in a header is `inline` or a template; file-scope state goes in a function-local static.
- Format with `.clang-format` (Google base, 4-space indent, 100 columns, left-aligned pointers).
- Header guards use `#ifndef`.
- Comments are one or two lines saying why; design rationale goes in `spec/` or the README.
- Markdown is one line per paragraph and per list item.
