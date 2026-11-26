# tensorscope for VS Code

Opens tensorscope capture directories in an editor tab.

## Quick start

1. Install the `.vsix` with **Extensions: Install from VSIX…** (build it with `npm run package`, see [DEVELOPMENT.md](DEVELOPMENT.md)).
2. Right-click a capture directory in the Explorer and choose **Open Capture…**.
3. Pick a case in the **Cases** view of the tensorscope sidebar.

You can also open a capture with **tensorscope: Open Capture…** from the Command Palette, with the folder button in the sidebar, or by right-clicking a case's `manifest.json`.

## Cases view

Lists the capture's cases, grouped by test. Failing groups start expanded.

- Click a case, or use the arrow keys, to show it. The arrow keys also work inside the tab.
- Hover a case to see its GTest failure.
- Right-click a case to copy its `--gtest_filter` or open its manifest.
- Title bar buttons: show failing cases only, reload.
- With several captures open, the view follows the active tab.

## Capture tab

The tab shows one comparison at a time.

| part | contents |
|---|---|
| Header | Verdict, case name, kind, shape, element types, failure count, largest difference. A button copies the `--gtest_filter`. |
| Toolbar | Steppers for leading axes (batch, depth), channel, previous/next failing pixel, zoom. |
| Panes | Reference, actual, `\|actual − reference\|`, status. Zoom and pan are linked. |
| Inspector | Values and verdict of the hovered pixel in every channel, the comparison's details, the test's failure text. |

Panes:

- Click a pane's range (reference or actual) to set the display range by hand.
- Drag a pane's title onto another to swap them. Double-click it to maximize.
- Without per-element verdicts in the bundle, the status pane marks elements above a threshold you set, and says so.

Inspector:

- Click a pixel to pin it. It stays pinned as you switch cases.
- Toggle the inspector with the button at the right of the toolbar, or `I`.

Title bar:

- **Layout…**: grid, row or column; show or hide each pane and the inspector.
- `…` menu: keyboard shortcuts (also `?`) and reload.

Layout, pane sizes and display options are remembered across tabs and sessions.

## Reloading

The tab reloads by itself when bundles under the opened directory are added, changed or removed, so rerunning the tests updates it. The selected case is kept.

## Remote-SSH

The extension runs on the workspace side (`extensionKind: workspace`), so it reads captures on the remote machine.
