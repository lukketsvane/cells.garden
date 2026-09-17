/**
 * Touch for Max's garden view, without changing it.
 *
 * The view was written for a mouse: double-click edits a cell, right-click opens
 * a menu, and the divider drags with mousedown/mousemove. iOS sends none of
 * those for a finger. This adapter listens for touch on the host and hands the
 * view the mouse events it already understands:
 *
 *  - tap a cell that is already selected: dblclick (edit)
 *  - hold a cell or seed and let go without moving: contextmenu (menu)
 *  - drag the divider: mousedown on it, then mousemove / mouseup on window
 *
 * A hold that moves is left to Sortable, which picks the cell up after its
 * touch delay; a swipe scrolls the board as usual.
 */

const CELL = '.garden-item, .seed-content';
const HOLD_MS = 450;
const MOVE_TOLERANCE = 8;

function mouse(type: string, touch: Touch, target: EventTarget, extra: MouseEventInit = {}) {
    const init: MouseEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: touch.clientX,
        clientY: touch.clientY,
        screenX: touch.screenX,
        screenY: touch.screenY,
        button: type === 'contextmenu' ? 2 : 0,
        ...extra,
    };
    target.dispatchEvent(new MouseEvent(type, init));
}

export function installTouchAdapter(host: HTMLElement): () => void {
    let start: { x: number; y: number; t: number; cell: HTMLElement | null; wasSelected: boolean } | null = null;
    let resizing = false;

    const onStart = (e: TouchEvent) => {
        if (e.touches.length !== 1) {
            start = null;
            return;
        }
        const touch = e.touches[0];
        const target = e.target as HTMLElement;

        const resizer = target.closest('.garden-resizer') as HTMLElement | null;
        if (resizer) {
            e.preventDefault();
            resizing = true;
            mouse('mousedown', touch, resizer);
            return;
        }

        const cell = target.closest(CELL) as HTMLElement | null;
        if (cell?.classList.contains('is-editing')) {
            start = null; // typing: leave the caret alone
            return;
        }
        start = { x: touch.clientX, y: touch.clientY, t: Date.now(), cell, wasSelected: !!cell?.classList.contains('is-selected') };
    };

    const onMove = (e: TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        if (resizing) {
            e.preventDefault();
            mouse('mousemove', touch, window);
            return;
        }
        if (start && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > MOVE_TOLERANCE) start = null;
    };

    const onEnd = (e: TouchEvent) => {
        const touch = e.changedTouches[0];
        if (resizing) {
            resizing = false;
            if (touch) mouse('mouseup', touch, window);
            return;
        }
        const s = start;
        start = null;
        if (!s || !s.cell || !touch || !s.cell.isConnected) return;
        // A drag that Sortable moved is not a tap or a hold. (A hold alone only marks the
        // cell chosen; the ghost appears once it actually moves.)
        if (document.querySelector('.sortable-ghost, .sortable-column-ghost, .sortable-fallback')) return;

        const held = Date.now() - s.t;
        if (held >= HOLD_MS) {
            e.preventDefault();
            mouse('contextmenu', touch, s.cell);
        } else if (s.wasSelected) {
            e.preventDefault();
            mouse('dblclick', touch, s.cell, { detail: 2 });
        }
    };

    const onCancel = () => {
        start = null;
        resizing = false;
    };

    host.addEventListener('touchstart', onStart, { passive: false });
    host.addEventListener('touchmove', onMove, { passive: false });
    host.addEventListener('touchend', onEnd, { passive: false });
    host.addEventListener('touchcancel', onCancel);
    // iOS shows its own callout on a long press of text; the menu above replaces it.
    const noCallout = (e: Event) => {
        const cell = (e.target as HTMLElement).closest?.(CELL);
        if (cell && !cell.classList.contains('is-editing')) e.preventDefault();
    };
    host.addEventListener('selectstart', noCallout);

    return () => {
        host.removeEventListener('touchstart', onStart);
        host.removeEventListener('touchmove', onMove);
        host.removeEventListener('touchend', onEnd);
        host.removeEventListener('touchcancel', onCancel);
        host.removeEventListener('selectstart', noCallout);
    };
}
