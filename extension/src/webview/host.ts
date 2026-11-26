// The connection to the extension: typed messages both ways, and array requests as promises.

import type { Arrays, HostMessage, PageMessage } from "../shared/protocol";

interface VsCodeApi {
    postMessage(message: PageMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export function post(message: PageMessage): void {
    api.postMessage(message);
}

/** The messages the page itself handles; array replies are settled here. */
export type AppMessage = Exclude<HostMessage, { type: "arrays" | "arraysFailed" }>;

const pending = new Map<number, { resolve: (a: Arrays) => void; reject: (e: Error) => void }>();
let lastId = 0;

/** Asks the extension for comparison `index`'s arrays. */
export function requestArrays(index: number): Promise<Arrays> {
    const id = ++lastId;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        post({ type: "load", id, index });
    });
}

/** Fails every outstanding request, e.g. when a reload renumbers the comparisons. */
export function abandonRequests(reason: string): void {
    for (const p of pending.values()) p.reject(new Error(reason));
    pending.clear();
}

export function listen(onMessage: (m: AppMessage) => void): void {
    window.addEventListener("message", (ev: MessageEvent<HostMessage>) => {
        const m = ev.data;
        if (m.type === "arrays" || m.type === "arraysFailed") {
            const p = pending.get(m.id);
            pending.delete(m.id);
            if (m.type === "arrays") p?.resolve(m);
            else p?.reject(new Error(m.error));
            return;
        }
        onMessage(m);
    });
}
