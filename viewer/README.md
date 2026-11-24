# tensorscope viewer

Turns a capture directory into one self-contained HTML file. The data is embedded gzipped, there's no server and no network access, and it's about 1 MB for 128 small cases. Open it with VS Code Live Preview (`ms-vscode.live-server`), a browser over a port forward, or a downloaded copy.

## Usage

Run a test binary built with the capture library, with `TENSORSCOPE_CAPTURE_DIR` set. Only failing cases are written; set `TENSORSCOPE_CAPTURE_ALL=1` to write passing cases too.

```bash
TENSORSCOPE_CAPTURE_DIR=/tmp/cap ./my_tests --gtest_filter='*BlurTest*'
```

Then write the viewer:

```bash
uv run --project viewer tensorscope /tmp/cap                        # -> /tmp/cap/viewer.html
uv run --project viewer tensorscope /tmp/cap -o out.html --filter '*U8*'
uv run --project viewer tensorscope /tmp/cap --list                 # print the cases, write nothing
```

Every selected case is embedded, so narrow a broad capture with `--filter`.

## The page

The reference, actual, `|actual - reference|` and status panes zoom (wheel) and pan (drag) together. There's a slider for each leading axis (batch, depth, ...), a channel selector (all as RGB, or a single channel), slice or global contrast, and a per-channel pixel inspector. It also shows the test's failure text, and has a case filter and `j`/`k` to step through cases.

`src/tensorscope_viewer/html_viewer.html` is the page template. The exporter replaces its `/*__TENSORSCOPE_DATA__*/[]` placeholder with the case data.

The viewer reads only the bundle format in [`spec/format.md`](../spec/format.md).
