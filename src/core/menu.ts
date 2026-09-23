/**
 * The one floating menu. The pill's menu, a plant's menu and a cell's menu were
 * three copies of the same builder, each with its styles written into the
 * elements; they are all this now, and the look lives in styles.css.
 */
import './shim';

export interface MenuItem {
    label: string;
    /** Smaller text after the label. */
    sub?: string;
    /** Shows a check mark. */
    active?: boolean;
    danger?: boolean;
    /** A non-clickable heading. */
    heading?: boolean;
    /** Shown, but greyed out and inert. */
    disabled?: boolean;
    onClick?: () => unknown;
    /**
     * Makes the row open a panel right under itself, inside the menu, instead of
     * acting and closing the menu. One panel is open at a time.
     */
    panel?: MenuPanel;
}

/**
 * Fills a row's panel, once, as the menu opens. What it returns runs as the
 * menu closes, told whether Escape closed it (a change of mind) or not.
 */
export type MenuPanel = (panel: HTMLElement, menu: MenuControls) => void | ((cancelled: boolean) => void);

/** What a panel can do to the menu it is in. */
export interface MenuControls {
    /** Close the menu, as choosing a row does. */
    close(): void;
    /** Change the smaller text on the panel's row, to show the value being picked. */
    setSub(text: string): void;
}

type Point = { x: number; y: number };

/** Where the menu opens: a point (a right-click) or under an element (the pill). */
export type MenuAnchor = Point | HTMLElement;

const MARGIN = 10;

/** How to close the menu open in a document, so the next one closes it properly. */
const openMenus = new WeakMap<Document, () => void>();

let panelCount = 0;

/**
 * The point a menu opens at: the anchor itself, or just under an element. Taken
 * once, so a menu whose element is drawn again while it is open stays put.
 */
function pointOf(anchor: MenuAnchor): Point {
    if (!(anchor instanceof HTMLElement)) return anchor;
    const rect = anchor.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 4 };
}

/** Put the menu as near its point as it fits inside the window. Again whenever a panel changes its size. */
function place(menu: HTMLElement, { x, y }: Point, win: Window) {
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(MARGIN, Math.min(x, win.innerWidth - width - MARGIN))}px`;
    menu.style.top = `${Math.max(MARGIN, Math.min(y, win.innerHeight - height - MARGIN))}px`;
}

/**
 * One row in the menu's look: a check column when `active` is given, the
 * label, the smaller text. Panels build their choices with it so they line up
 * with the rows around them; `media` fills a slot before the label (a sprite).
 */
export function menuRow(
    parent: HTMLElement,
    item: Pick<MenuItem, 'label' | 'sub' | 'active' | 'danger'>,
    media?: (slot: HTMLElement) => void,
): HTMLButtonElement {
    const row = parent.createEl('button', { cls: 'garden-menu-item', attr: { type: 'button' } });
    row.toggleClass('is-danger', !!item.danger);
    row.toggleClass('is-active', !!item.active);
    if (item.active) row.setAttribute('aria-current', 'true');
    if (item.active !== undefined) row.createSpan({ cls: 'garden-menu-check', text: item.active ? '✓' : '' });
    if (media) media(row.createSpan({ cls: 'garden-menu-media' }));
    row.createSpan({ cls: 'garden-menu-label', text: item.label });
    if (item.sub) row.createSpan({ cls: 'garden-menu-sub', text: item.sub });
    return row;
}

/**
 * Open a menu, replacing any other. It closes on the next click outside it, on
 * a row that acts, or on Escape. A row with a panel opens it in place instead.
 */
export function openMenu(
    items: MenuItem[],
    anchor: MenuAnchor,
    doc: Document = document,
    build?: (menu: HTMLElement) => void,
): HTMLElement {
    const win = doc.defaultView ?? window;
    const at = pointOf(anchor);
    openMenus.get(doc)?.();
    doc.querySelector('.garden-context-menu')?.remove();

    const menu = doc.body.createDiv('garden-context-menu');
    // Focus goes back here when the menu closes with the focus inside it.
    const opener = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    const endings: ((cancelled: boolean) => void)[] = [];
    const panels: { row: HTMLElement; panel: HTMLElement }[] = [];
    let closed = false;

    const close = (cancelled = false) => {
        if (closed) return;
        closed = true;
        win.removeEventListener('mousedown', onOutside, true);
        win.removeEventListener('keydown', onEscape, true);
        if (openMenus.get(doc) === close) openMenus.delete(doc);
        const hadFocus = menu.contains(doc.activeElement);
        try {
            // Before the menu goes, so a field in a panel still holds what was typed.
            for (const end of endings) end(cancelled);
        } finally {
            menu.remove();
            if (hadFocus && opener?.isConnected) opener.focus({ preventScroll: true });
        }
    };
    const onOutside = (e: Event) => {
        if (!menu.contains(e.target as Node)) close();
    };
    const onEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close(true);
    };

    const toggle = (open: { row: HTMLElement; panel: HTMLElement }, e: MouseEvent) => {
        const opening = !open.panel.hasClass('is-open');
        for (const p of panels) {
            const on = opening && p === open;
            p.panel.toggleClass('is-open', on);
            p.row.toggleClass('is-open', on);
            p.row.setAttribute('aria-expanded', String(on));
        }
        place(menu, at, win);
        if (!opening) return;
        // The current choice sits in the middle of a panel that scrolls.
        const current = open.panel.querySelector<HTMLElement>('.is-active');
        if (current && open.panel.scrollHeight > open.panel.clientHeight) {
            open.panel.scrollTop = current.offsetTop - (open.panel.clientHeight - current.offsetHeight) / 2;
        }
        // Keys and the mouse move into the panel, onto the current choice or the
        // first control. A finger does not: on a phone a focused field would
        // raise the keyboard over the menu.
        const finger = e.detail > 0 && win.matchMedia('(pointer: coarse)').matches;
        if (finger) return;
        const target = current ?? open.panel.querySelector<HTMLElement>('input, button');
        target?.focus({ preventScroll: true });
        if (target instanceof HTMLInputElement && target.type === 'number') target.select();
    };

    for (const item of items) {
        if (item.heading) {
            menu.createDiv({ cls: 'garden-menu-heading', text: item.label });
            continue;
        }
        const row = menuRow(menu, item);
        if (item.disabled) {
            row.disabled = true;
            continue;
        }
        if (item.panel) {
            const panel = menu.createDiv({ cls: 'garden-menu-panel', attr: { id: `garden-menu-panel-${++panelCount}` } });
            row.addClass('has-panel');
            row.setAttribute('aria-expanded', 'false');
            row.setAttribute('aria-controls', panel.id);
            const entry = { row, panel };
            panels.push(entry);
            const end = item.panel(panel, {
                close: () => close(),
                setSub: (text) => {
                    const sub = row.querySelector('.garden-menu-sub') ?? row.createSpan({ cls: 'garden-menu-sub' });
                    sub.setText(text);
                },
            });
            if (end) endings.push(end);
            row.onclick = (e) => {
                e.stopPropagation();
                toggle(entry, e);
            };
            continue;
        }
        row.onclick = (e) => {
            e.stopPropagation();
            close();
            item.onClick?.();
        };
    }

    // Up and down walk the rows and whatever an open panel shows; a field keeps its own arrows.
    menu.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        if (e.target instanceof HTMLInputElement) return;
        const rows = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
            .filter((b) => !b.closest('.garden-menu-panel:not(.is-open)'));
        if (!rows.length) return;
        e.preventDefault();
        const from = rows.indexOf(doc.activeElement as HTMLButtonElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = from === -1 ? (step > 0 ? 0 : rows.length - 1) : (from + step + rows.length) % rows.length;
        rows[next].focus();
    });

    build?.(menu);
    place(menu, at, win);
    openMenus.set(doc, close);

    // After this click has finished, or it would close the menu it opened.
    window.setTimeout(() => {
        if (closed) return;
        win.addEventListener('mousedown', onOutside, true);
        win.addEventListener('keydown', onEscape, true);
    }, 0);

    return menu;
}
