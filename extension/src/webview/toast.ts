// A short-lived message at the bottom of the page, for results of actions with nothing else to show.

import { fill, h, icon } from "./dom";

const el = h("div", { className: "toast", role: "status", ariaLive: "polite" });
document.body.append(el);
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string, iconName = "info"): void {
    fill(el, icon(iconName), h("span", { textContent: message }));
    el.classList.add("show");
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove("show"), 2200);
}
