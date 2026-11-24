# tensorscope for VS Code

Opens capture directories in a VS Code tab, showing the same page as the [HTML viewer](../viewer/README.md) without generating a file first.

## Usage

- Right-click a capture directory (or a case's `manifest.json`) in the Explorer and choose **Open Capture…**.
- Or run **tensorscope: Open Capture…** from the Command Palette, or use the folder button in the tensorscope sidebar.

The capture opens in an editor tab, and its cases appear in the **Cases** view of the tensorscope sidebar (activity bar icon). Cases are grouped by test, with failing groups expanded. Hover a case to see its GTest failure. Click a case or arrow through the list to show it. Arrow keys in the tab move the list selection too. The view's title bar toggles failing-only and reloads the capture. Right-click a case to copy its `--gtest_filter` or open its manifest. With several captures open, the view follows the active tab.

The tab reloads by itself when bundles are added, changed, or removed under the opened directory, so rerunning the tests updates it. The selected case is kept across reloads. The extension runs on the workspace side (`extensionKind: workspace`), so over Remote-SSH it reads captures on the remote machine.

## Develop

```bash
cd extension && npm install
```

In VS Code, run the **Run tensorscope extension** launch configuration (F5). It builds the extension and opens a second window with it loaded.

`npm run package` writes a `.vsix`; install it with **Extensions: Install from VSIX…**.

## How it works

`src/bundle.ts` reads bundles per [`spec/format.md`](../spec/format.md) and builds the same JSON payload as `viewer/src/tensorscope_viewer/html_export.py`. The build copies `html_viewer.html` from the Python viewer into `media/`, so there is one page template. `src/extension.ts` puts the payload in that page, adds a Content-Security-Policy, and shows it in a webview. `src/cases.ts` is the Cases view. When the page finds the webview API it hides its own case list and lets the extension drive selection over `postMessage`: the page sends `ready`, `selected` and `focusCases`, and the extension sends `init`, `select` and `failOnly`.

Like the HTML viewer, it embeds every case up front, so very large captures take a while to open.
