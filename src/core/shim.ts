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
    /** A detached element, as Obsidian's global helpers make it. */
    function createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: DomElementInfo | string): HTMLElementTagNameMap[K];
    function createDiv(o?: DomElementInfo | string): HTMLDivElement;
    function createSpan(o?: DomElementInfo | string): HTMLSpanElement;
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
    interface HTMLElement {
        setCssStyles(styles: Partial<CSSStyleDeclaration>): void;
        setCssProps(props: Record<string, string>): void;
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

/** A detached element in `doc`: the one maker behind every createEl below. */
function make<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, o?: DomElementInfo | string): HTMLElementTagNameMap[K] {
    // This is createEl itself, for hosts without Obsidian. The namespaced call
    // makes the same element as createElement for these lowercase HTML tags.
    const el = doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
    applyInfo(el, o);
    return el;
}

function docOf(node: Node): Document {
    return node.ownerDocument ?? (node as Document);
}

install(Node.prototype, 'createEl', function <K extends keyof HTMLElementTagNameMap>(this: Node, tag: K, o?: DomElementInfo | string) {
    return this.appendChild(make(docOf(this), tag, o));
});

install(Node.prototype, 'createDiv', function (this: Node, o?: DomElementInfo | string) {
    return this.appendChild(make(docOf(this), 'div', o));
});

install(Node.prototype, 'createSpan', function (this: Node, o?: DomElementInfo | string) {
    return this.appendChild(make(docOf(this), 'span', o));
});

install(window, 'createEl', <K extends keyof HTMLElementTagNameMap>(tag: K, o?: DomElementInfo | string) => make(document, tag, o));
install(window, 'createDiv', (o?: DomElementInfo | string) => make(document, 'div', o));
install(window, 'createSpan', (o?: DomElementInfo | string) => make(document, 'span', o));

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
install(HTMLElement.prototype, 'setCssStyles', function (this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
    Object.assign(this.style, styles);
});
install(HTMLElement.prototype, 'setCssProps', function (this: HTMLElement, props: Record<string, string>) {
    for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
});
install(Element.prototype, 'getText', function (this: Element) {
    return this.textContent ?? '';
});

export {};
