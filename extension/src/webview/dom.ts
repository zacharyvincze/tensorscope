// A typed element factory, so building the page reads like the markup it makes and a misspelt
// property is a compile error.

type Child = Node | string | number | null | undefined | false;

export type Props<K extends keyof HTMLElementTagNameMap> =
    Partial<Omit<HTMLElementTagNameMap[K], "style" | "dataset" | "children">> & {
        style?: Partial<CSSStyleDeclaration>;
        dataset?: Record<string, string>;
    };

export function h<K extends keyof HTMLElementTagNameMap>(
    tag: K, props: Props<K> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    const { style, dataset, ...rest } = props;
    Object.assign(el, rest);
    if (style) Object.assign(el.style, style);
    if (dataset) Object.assign(el.dataset, dataset);
    append(el, children);
    return el;
}

export function append(el: Element, children: Child[]): void {
    for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === "number" ? String(c) : c);
}

/** Replaces an element's children. */
export function fill(el: Element, ...children: Child[]): void {
    el.replaceChildren();
    append(el, children);
}

/** A codicon (https://microsoft.github.io/vscode-codicons/dist/codicon.html). */
export function icon(name: string, className = ""): HTMLSpanElement {
    return h("span", { className: `codicon codicon-${name} ${className}`.trim(), ariaHidden: "true" });
}

/** A borderless toolbar button showing an icon; `label` is its tooltip and accessible name. */
export function iconButton(name: string, label: string, onclick: (ev: MouseEvent) => void, className = ""): HTMLButtonElement {
    return h("button", { className: `icon-btn ${className}`.trim(), title: label, ariaLabel: label, onclick }, icon(name));
}

/** A group of mutually exclusive toggle buttons. */
export class Segmented<T extends string> {
    readonly el: HTMLDivElement;
    private readonly buttons = new Map<T, HTMLButtonElement>();

    constructor(label: string, options: readonly { value: T; text: string; title?: string }[], onPick: (value: T) => void) {
        this.el = h("div", { className: "segmented", role: "group", ariaLabel: label });
        for (const o of options) {
            const b = h("button", { textContent: o.text, title: o.title ?? "", onclick: () => onPick(o.value) });
            this.buttons.set(o.value, b);
            this.el.append(b);
        }
    }

    set value(v: T) {
        for (const [k, b] of this.buttons) b.ariaPressed = String(k === v);
    }
}

export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
