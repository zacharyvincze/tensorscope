# tensorscope for VS Code

Opens tensorscope capture directories in a VS Code tab.

## Usage

- Right-click a capture directory (or a case's `manifest.json`) in the Explorer and choose **Open Capture…**.
- Or run **tensorscope: Open Capture…** from the Command Palette, or use the folder button in the tensorscope sidebar.

The capture opens in an editor tab, and its cases appear in the **Cases** view of the tensorscope sidebar (activity bar icon). Cases are grouped by test, with failing groups expanded. Hover a case to see its GTest failure. Click a case or arrow through the list to show it. Arrow keys in the tab move the list selection too. The view's title bar toggles failing-only and reloads the capture. Right-click a case to copy its `--gtest_filter` or open its manifest. With several captures open, the view follows the active tab.

The tab shows one comparison at a time:

- **Header:** the test's verdict, the case name, and a summary: kind, shape, element types, how many elements failed, and the largest difference. The copy button copies the case's `--gtest_filter`.
- **Toolbar:** steppers for any leading axes (batch, depth), the channel to show, buttons that jump to the previous or next failing pixel, and zoom.
- **Panes:** reference, actual, `|actual − reference|`, and status, with linked zoom and pan. Click the range in a reference or actual pane's title to set the display range by hand. Drag a pane's title onto another to swap them, and double-click it to maximize. When the bundle has no per-element verdict, the status pane marks elements over a threshold you set instead, and says so.
- **Inspector:** the values and verdict of the hovered pixel in every channel (click to pin it; it stays pinned as you step through cases), the comparison's details, and the test's failure text.

**Layout…** in the tab's title bar arranges the panes as a grid, row or column and shows or hides each one. Its `…` menu lists the keyboard shortcuts (or press `?`) and reloads the capture. The layout, pane sizes and display options are remembered across tabs and sessions.

The tab reloads by itself when bundles are added, changed, or removed under the opened directory, so rerunning the tests updates it. The selected case is kept across reloads. The extension runs on the workspace side (`extensionKind: workspace`), so over Remote-SSH it reads captures on the remote machine.

## Develop

```bash
cd extension && npm install
npm run build      # type-check, then bundle into out/
npm test           # unit tests of the page's data logic
npm run watch      # rebundle on change (no type checking; your editor does that)
```

In VS Code, run the **Run tensorscope extension** launch configuration (F5). It builds the extension and opens a second window with it loaded.

`npm run package` writes a `.vsix`; install it with **Extensions: Install from VSIX…**.

## How it works

The source is TypeScript in three parts, each type-checked against its own environment:

| path | runs in | contents |
|---|---|---|
| `src/shared/` | both | `protocol.ts`: every message between the extension and the page, the page's settings, and their validation. Both sides import it, so a message one side doesn't handle is a compile error. |
| `src/extension/` | VS Code (Node) | `extension.ts` registers commands; `panel.ts` owns one capture tab (webview, file watcher, message handling); `cases.ts` is the Cases view; `bundle.ts` reads bundles per [`spec/format.md`](../spec/format.md); `prefs.ts` stores the page's settings in `globalState`. |
| `src/webview/` | the webview (browser) | `app.ts` holds the page's state and every action on it; `header.ts`, `toolbar.ts`, `panes.ts`, `inspector.ts` and `controls.ts` render parts of it; `model.ts` (decoding, thresholds, failure search) and `render.ts` (painting a slice) have no DOM code; `shortcuts.ts` is the one table of keyboard shortcuts behind both the key handling and the help dialog; `style.css` takes every colour from the VS Code theme. |

`scripts/build.mjs` bundles the extension and the page with esbuild into `out/`, along with the codicon font, so the page loads nothing from outside the extension. `test/` holds unit tests of the DOM-free modules, run with Node's test runner.

The page has no case list of its own: the Cases view drives selection. On `ready`, the extension sends the page its settings and the capture's comparisons (`cases`, again on every reload); afterwards it sends `select`, `failOnly` and `command` (for the title-bar buttons). The page reports `selected`, sends changed settings as `prefs`, and asks for a comparison's arrays with `load`; the extension reads the NPYs and replies with `arrays`, carrying raw ArrayBuffers.

Opening a capture reads only the manifests. The arrays are read when the page first shows a case. The page prefetches the neighbouring cases and keeps the 24 most recent decoded cases. A capture of 518 small and 10 full-HD cases opens in about 30 ms, where embedding everything took about 50 s.
