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

export interface DomElementInfo {
    /** One class or a list of classes to add. */
    cls?: string | string[];
    /** Text content. */
    text?: string | DocumentFragment;
    /** HTML attributes. `null` removes the attribute. */
    attr?: { [key: string]: string | number | boolean | null };
    title?: string;
    placeholder?: string;
    href?: string;
    type?: string;
    value?: string;
    /** Insert as the first child instead of appending. */
    prepend?: boolean;
}

declare global {
    interface Node {
        createEl<K extends keyof HTMLElementTagNameMap>(
            tag: K,
            o?: DomElementInfo | string,
            callback?: (el: HTMLElementTagNameMap[K]) => void
        ): HTMLElementTagNameMap[K];
        createDiv(o?: DomElementInfo | string, callback?: (el: HTMLDivElement) => void): HTMLDivElement;
        createSpan(o?: DomElementInfo | string, callback?: (el: HTMLSpanElement) => void): HTMLSpanElement;
        /** Remove every child node. */
        empty(): void;
    }
    interface Element {
        addClass(...classes: string[]): void;
        addClasses(classes: string[]): void;
        removeClass(...classes: string[]): void;
        removeClasses(classes: string[]): void;
        toggleClass(classes: string | string[], value: boolean): void;
        hasClass(cls: string): boolean;
        setAttr(name: string, value: string | number | boolean | null): void;
        setAttrs(attrs: { [key: string]: string | number | boolean | null }): void;
        getAttr(name: string): string | null;
        setText(val: string | DocumentFragment): void;
        getText(): string;
    }
}

function splitClasses(classes: string | string[]): string[] {
    const list = Array.isArray(classes) ? classes : [classes];
    return list.flatMap(c => c.split(/\s+/)).filter(Boolean);
}

function applyInfo(el: HTMLElement, o?: DomElementInfo | string) {
    if (!o) return;
    if (typeof o === 'string') {
        el.addClass(o);
        return;
    }
    if (o.cls) el.addClasses(splitClasses(o.cls));
    if (o.text !== undefined) el.setText(o.text);
    if (o.attr) el.setAttrs(o.attr);
    if (o.title !== undefined) el.title = o.title;
    if (o.placeholder !== undefined) (el as HTMLInputElement).placeholder = o.placeholder;
    if (o.href !== undefined) (el as HTMLAnchorElement).href = o.href;
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

install(Node.prototype, 'createEl', function <K extends keyof HTMLElementTagNameMap>(
    this: Node,
    tag: K,
    o?: DomElementInfo | string,
    callback?: (el: HTMLElementTagNameMap[K]) => void
): HTMLElementTagNameMap[K] {
    const doc = this.ownerDocument ?? (this as unknown as Document);
    const el = doc.createElement(tag);
    applyInfo(el, o);
    const prepend = typeof o === 'object' && o?.prepend;
    if (prepend && this.firstChild) this.insertBefore(el, this.firstChild);
    else this.appendChild(el);
    callback?.(el);
    return el;
});

install(Node.prototype, 'createDiv', function (this: Node, o?: DomElementInfo | string, callback?: (el: HTMLDivElement) => void) {
    return this.createEl('div', o, callback);
});

install(Node.prototype, 'createSpan', function (this: Node, o?: DomElementInfo | string, callback?: (el: HTMLSpanElement) => void) {
    return this.createEl('span', o, callback);
});

install(Node.prototype, 'empty', function (this: Node) {
    while (this.firstChild) this.removeChild(this.firstChild);
});

install(Element.prototype, 'addClass', function (this: Element, ...classes: string[]) {
    this.classList.add(...splitClasses(classes));
});
install(Element.prototype, 'addClasses', function (this: Element, classes: string[]) {
    this.classList.add(...splitClasses(classes));
});
install(Element.prototype, 'removeClass', function (this: Element, ...classes: string[]) {
    this.classList.remove(...splitClasses(classes));
});
install(Element.prototype, 'removeClasses', function (this: Element, classes: string[]) {
    this.classList.remove(...splitClasses(classes));
});
install(Element.prototype, 'toggleClass', function (this: Element, classes: string | string[], value: boolean) {
    for (const c of splitClasses(classes)) this.classList.toggle(c, value);
});
install(Element.prototype, 'hasClass', function (this: Element, cls: string) {
    return this.classList.contains(cls);
});
install(Element.prototype, 'setAttr', function (this: Element, name: string, value: string | number | boolean | null) {
    if (value === null) this.removeAttribute(name);
    else this.setAttribute(name, String(value));
});
install(Element.prototype, 'setAttrs', function (this: Element, attrs: { [key: string]: string | number | boolean | null }) {
    for (const [k, v] of Object.entries(attrs)) this.setAttr(k, v);
});
install(Element.prototype, 'getAttr', function (this: Element, name: string) {
    return this.getAttribute(name);
});
install(Element.prototype, 'setText', function (this: Element, val: string | DocumentFragment) {
    if (typeof val === 'string') this.textContent = val;
    else {
        this.empty();
        this.appendChild(val);
    }
});
install(Element.prototype, 'getText', function (this: Element) {
    return this.textContent ?? '';
});

export {};
