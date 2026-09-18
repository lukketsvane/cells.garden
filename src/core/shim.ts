/**
 * DOM helpers that Obsidian installs on the prototypes of Node/Element.
 * Max's code uses createDiv/createEl/empty/setText/getText/addClass/... freely,
 * so we install the same helpers here and the garden code ports without edits.
 *
 * Import this module once (for its side effects) before anything else in core.
 *
 * Inside Obsidian the real helpers are already on the prototypes, and they are
 * the fuller implementation; ours covers only the surface the garden uses. So
 * every install below is skipped when the method is already there, and the core
 * runs unchanged in the vault, in the browser and in the extension.
 */

interface DomElementInfo {
    /** Classes to add, space-separated. */
    cls?: string;
    text?: string;
    attr?: Record<string, string>;
    type?: string;
    value?: string;
}

declare global {
    interface Node {
        createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: DomElementInfo | string): HTMLElementTagNameMap[K];
        createDiv(o?: DomElementInfo | string): HTMLDivElement;
        createSpan(o?: DomElementInfo | string): HTMLSpanElement;
        /** Remove every child node. */
        empty(): void;
    }
    interface Element {
        addClass(...classes: string[]): void;
        removeClass(...classes: string[]): void;
        toggleClass(classes: string, value: boolean): void;
        hasClass(cls: string): boolean;
        setText(val: string): void;
        getText(): string;
    }
}

function splitClasses(classes: string[]): string[] {
    return classes.flatMap(c => c.split(/\s+/)).filter(Boolean);
}

function applyInfo(el: HTMLElement, o?: DomElementInfo | string) {
    if (!o) return;
    if (typeof o === 'string') {
        el.addClass(o);
        return;
    }
    if (o.cls) el.addClass(o.cls);
    if (o.text !== undefined) el.setText(o.text);
    for (const [name, value] of Object.entries(o.attr ?? {})) el.setAttribute(name, value);
    if (o.type !== undefined) (el as HTMLInputElement).type = o.type;
    if (o.value !== undefined) (el as HTMLInputElement).value = o.value;
}

/**
 * Install `name` on `proto` unless something already provides it. Obsidian
 * does, and its version is the complete one.
 */
function install<T extends object>(proto: T, name: keyof T & string, value: unknown) {
    if (typeof (proto as Record<string, unknown>)[name] === 'function') return;
    Object.defineProperty(proto, name, { value, writable: true, configurable: true, enumerable: false });
}

install(Node.prototype, 'createEl', function <K extends keyof HTMLElementTagNameMap>(this: Node, tag: K, o?: DomElementInfo | string) {
    const el = (this.ownerDocument ?? (this as unknown as Document)).createElement(tag);
    applyInfo(el, o);
    return this.appendChild(el);
});

install(Node.prototype, 'createDiv', function (this: Node, o?: DomElementInfo | string) {
    return this.createEl('div', o);
});

install(Node.prototype, 'createSpan', function (this: Node, o?: DomElementInfo | string) {
    return this.createEl('span', o);
});

install(Node.prototype, 'empty', function (this: Node) {
    while (this.firstChild) this.removeChild(this.firstChild);
});

install(Element.prototype, 'addClass', function (this: Element, ...classes: string[]) {
    this.classList.add(...splitClasses(classes));
});
install(Element.prototype, 'removeClass', function (this: Element, ...classes: string[]) {
    this.classList.remove(...splitClasses(classes));
});
install(Element.prototype, 'toggleClass', function (this: Element, classes: string, value: boolean) {
    for (const c of splitClasses([classes])) this.classList.toggle(c, value);
});
install(Element.prototype, 'hasClass', function (this: Element, cls: string) {
    return this.classList.contains(cls);
});
install(Element.prototype, 'setText', function (this: Element, val: string) {
    this.textContent = val;
});
install(Element.prototype, 'getText', function (this: Element) {
    return this.textContent ?? '';
});

export {};
