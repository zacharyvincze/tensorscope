# tensorscope for VS Code

Opens capture directories in a VS Code tab, showing the same page as the [HTML viewer](../viewer/README.md) without generating a file first.

## Usage

- Right-click a capture directory (or a case's `manifest.json`) in the Explorer and choose **Open Capture…**.
- Or run **tensorscope: Open Capture…** from the Command Palette and pick a directory.

The tab reloads by itself when bundles are added, changed, or removed under the opened directory, so rerunning the tests updates it. The extension runs on the workspace side (`extensionKind: workspace`), so over Remote-SSH it reads captures on the remote machine.

## Develop

```bash
cd extension && npm install
```

In VS Code, run the **Run tensorscope extension** launch configuration (F5). It builds the extension and opens a second window with it loaded.

`npm run package` writes a `.vsix`; install it with **Extensions: Install from VSIX…**.

## How it works

`src/bundle.ts` reads bundles per [`spec/format.md`](../spec/format.md) and builds the same JSON payload as `viewer/src/tensorscope_viewer/html_export.py`. The build copies `html_viewer.html` from the Python viewer into `media/`, so there is one page template. `src/extension.ts` puts the payload in that page, adds a Content-Security-Policy, and shows it in a webview.

Like the HTML viewer, it embeds every case up front, so very large captures take a while to open.
