# tensorscope for VS Code

Opens tensorscope capture directories in a VS Code tab.

## Usage

- Right-click a capture directory (or a case's `manifest.json`) in the Explorer and choose **Open Capture…**.
- Or run **tensorscope: Open Capture…** from the Command Palette, or use the folder button in the tensorscope sidebar.

The capture opens in an editor tab, and its cases appear in the **Cases** view of the tensorscope sidebar (activity bar icon). Cases are grouped by test, with failing groups expanded. Hover a case to see its GTest failure. Click a case or arrow through the list to show it. Arrow keys in the tab move the list selection too. The view's title bar toggles failing-only and reloads the capture. Right-click a case to copy its `--gtest_filter` or open its manifest. With several captures open, the view follows the active tab.

The tab's own title bar copies the shown case's `--gtest_filter`, fits the image to its pane, and opens **Layout…**, a picker that arranges the panes as a grid, row or column and shows or hides each one. Its `…` menu lists the keyboard shortcuts and reloads the capture.

The tab reloads by itself when bundles are added, changed, or removed under the opened directory, so rerunning the tests updates it. The selected case is kept across reloads. The extension runs on the workspace side (`extensionKind: workspace`), so over Remote-SSH it reads captures on the remote machine.

## Develop

```bash
cd extension && npm install
```

In VS Code, run the **Run tensorscope extension** launch configuration (F5). It builds the extension and opens a second window with it loaded.

`npm run package` writes a `.vsix`; install it with **Extensions: Install from VSIX…**.

## How it works

`src/bundle.ts` reads bundles per [`spec/format.md`](../spec/format.md) and turns them into the page's entries, split into an index and per-case arrays. `media/html_viewer.html` is the page. `src/extension.ts` puts the index in that page, adds a Content-Security-Policy, and shows it in a webview. `src/cases.ts` is the Cases view. The page has no case list of its own; the extension drives selection over `postMessage`: the page sends `ready`, `selected`, `load` and `focusCases`, and the extension sends `init`, `select`, `failOnly` and `arrays`.

Opening a capture reads only the manifests; the page starts with that index. When the page shows a case it asks for the arrays with a `load` message, and the extension reads the four NPYs and replies with `arrays` carrying raw ArrayBuffers. The page prefetches the neighbouring cases and keeps the 24 most recent decoded cases. A capture of 518 small and 10 full-HD cases opens in about 30 ms, where embedding everything took about 50 s.
