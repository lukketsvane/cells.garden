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
}

/** Where the menu opens: a point (a right-click) or under an element (the pill). */
export type MenuAnchor = { x: number; y: number } | HTMLElement;

const MARGIN = 10;

function place(menu: HTMLElement, anchor: MenuAnchor, win: Window) {
    if (anchor instanceof HTMLElement) {
        const rect = anchor.getBoundingClientRect();
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${rect.bottom + 4}px`;
        return;
    }
    const { width, height } = menu.getBoundingClientRect();
    const x = Math.max(MARGIN, Math.min(anchor.x, win.innerWidth - width - MARGIN));
    const y = Math.max(MARGIN, Math.min(anchor.y, win.innerHeight - height - MARGIN));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
}

/**
 * Open a menu, replacing any other. It closes on the next click outside it, on
 * a row, or on Escape.
 */
export function openMenu(items: MenuItem[], anchor: MenuAnchor, doc: Document = document): HTMLElement {
    const win = doc.defaultView ?? window;
    doc.querySelector('.garden-context-menu')?.remove();

    const menu = doc.createElement('div');
    menu.className = 'garden-context-menu';

    for (const item of items) {
        if (item.heading) {
            menu.createDiv({ cls: 'garden-menu-heading', text: item.label });
            continue;
        }
        const row = menu.createEl('button', { cls: 'garden-menu-item', attr: { type: 'button' } });
        row.toggleClass('is-danger', !!item.danger);
        if (item.active !== undefined) row.createSpan({ cls: 'garden-menu-check', text: item.active ? '✓' : '' });
        row.createSpan({ cls: 'garden-menu-label', text: item.label });
        if (item.sub) row.createSpan({ cls: 'garden-menu-sub', text: item.sub });
        if (item.disabled) {
            row.disabled = true;
            continue;
        }
        row.onclick = (e) => {
            e.stopPropagation();
            menu.remove();
            item.onClick?.();
        };
    }

    doc.body.appendChild(menu);
    place(menu, anchor, win);

    const close = (e: Event) => {
        if (e.type === 'mousedown' && menu.contains(e.target as Node)) return;
        if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
        menu.remove();
        win.removeEventListener('mousedown', close, true);
        win.removeEventListener('keydown', close, true);
    };
    // After the click that opened it has finished travelling.
    window.setTimeout(() => {
        win.addEventListener('mousedown', close, true);
        win.addEventListener('keydown', close, true);
    }, 0);

    return menu;
}
