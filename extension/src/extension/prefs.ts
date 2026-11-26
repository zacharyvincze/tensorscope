// The page's view settings, kept in globalState so every capture tab opens with the last layout.

import * as vscode from "vscode";

import { Prefs, sanitizePrefs } from "../shared/protocol";

const KEY = "tensorscope.prefs";

interface PrefsChange {
    prefs: Prefs;
    /** The panel whose page made the change, which already shows it. */
    source?: unknown;
}

export class PrefsStore implements vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<PrefsChange>();
    readonly onDidChange = this.changed.event;
    private value: Prefs;

    constructor(private readonly state: vscode.Memento) {
        this.value = sanitizePrefs(state.get(KEY));
    }

    get(): Prefs {
        return this.value;
    }

    set(prefs: unknown, source?: unknown): void {
        this.value = sanitizePrefs(prefs);
        void this.state.update(KEY, this.value);
        this.changed.fire({ prefs: this.value, source });
    }

    dispose(): void {
        this.changed.dispose();
    }
}
