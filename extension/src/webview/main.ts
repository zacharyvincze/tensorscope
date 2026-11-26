// The webview's entry point: builds the page and connects it to the extension.

import "./style.css";

import { App } from "./app";
import { listen, post } from "./host";
import { handleKey } from "./shortcuts";

const app = new App(document.body);
listen((m) => app.receive(m));

document.addEventListener("keydown", (ev) => {
    const t = ev.target as HTMLElement;
    const typing = (t instanceof HTMLInputElement && (t.type === "text" || t.type === "number")) || t instanceof HTMLSelectElement;
    if (ev.key === "Escape" && typing) return t.blur();
    // The shortcuts dialog handles Escape itself, as a modal <dialog>.
    if (typing || app.shortcuts.el.open) return;
    if (handleKey(app, ev)) ev.preventDefault();
});

post({ type: "ready" });
