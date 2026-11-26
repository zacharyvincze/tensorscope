# Developing the tensorscope extension

## Build and test

```bash
cd extension && npm install
npm run build      # type-check, then bundle into out/
npm test           # unit tests of the page's data logic
npm run watch      # rebundle on change (no type checking)
npm run package    # write a .vsix
```

Press F5 in VS Code (**Run tensorscope extension**) to build and open a second window with the extension loaded.

## How it works

TypeScript in three parts, each type-checked against its own environment:

| path | runs in | contents |
|---|---|---|
| `src/shared/` | both | `protocol.ts`: every message between extension and page, the page's settings, and their validation. Both sides import it, so an unhandled message is a compile error. |
| `src/extension/` | VS Code (Node) | `extension.ts`: commands. `panel.ts`: one capture tab (webview, file watcher, messages). `cases.ts`: the Cases view. `bundle.ts`: reads bundles per [spec/format.md](../spec/format.md). `prefs.ts`: stores the page's settings in `globalState`. |
| `src/webview/` | webview (browser) | `app.ts`: page state and every action on it. `header.ts`, `toolbar.ts`, `panes.ts`, `inspector.ts`, `controls.ts`: render parts of it. `model.ts` (decoding, thresholds, failure search) and `render.ts` (painting a slice): no DOM code. `shortcuts.ts`: the one table of keyboard shortcuts, used by key handling and the help dialog. `style.css`: every colour from the VS Code theme. |

- `scripts/build.mjs` bundles extension and page with esbuild into `out/`, including the codicon font, so the page loads nothing from outside the extension.
- `test/` holds unit tests of the DOM-free modules, run with Node's test runner.

### Messages

The Cases view drives selection; the page has no case list.

All messages are typed in `src/shared/protocol.ts`.

| direction | message | meaning |
|---|---|---|
| page → extension | `ready` | Page loaded. |
| extension → page | `prefs` | Settings. Sent on `ready`, and when another tab changes them. |
| extension → page | `cases` | The capture's comparisons (metadata only). Sent on `ready` and on every reload. |
| extension → page | `select`, `failOnly`, `command` | Cases view selection, failing-only toggle, title-bar buttons. |
| page → extension | `selected` | The page changed the selection. |
| page → extension | `prefs` | The page changed a setting. |
| page → extension | `load` | Request for a comparison's arrays. |
| extension → page | `arrays` / `arraysFailed` | The NPYs as raw ArrayBuffers, or the read error. |
| page → extension | `focusCases`, `copyFilter`, `openLayout` | Run the matching VS Code command. |

### Loading cost

Opening a capture reads only the manifests. Arrays are read when a case is first shown; the page prefetches neighbouring cases and keeps the 24 most recent decoded. A capture of 518 small and 10 full-HD cases opens in about 30 ms (embedding everything took about 50 s).
